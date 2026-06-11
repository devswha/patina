import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  collectImageCandidates,
  stageOcrImages,
  ocrStagedImages,
  normalizeOcrText,
  setOcrRuntimeForTests,
  resetOcrRuntimeForTests,
} from '../../src/ocr.js';
import { stageCliImages } from '../../src/backends/contract.js';

const BIG_DATA_URI = `data:image/jpeg;base64,${'A'.repeat(4000)}`;

test('collectImageCandidates resolves sources, unwraps Next.js proxies, and dedupes', () => {
  const html = [
    '<img src="/img/banner-card.webp" alt="카드뉴스 배너">',
    '<img src="/_next/image?url=https%3A%2F%2Fcdn.test%2Fthumbnail-a.webp&amp;w=3840&amp;q=75">',
    '<img src="/img/banner-card.webp" alt="duplicate">',
    '<img srcset="/img/sm.jpg 320w, /img/mid.jpg 640w, /img/huge.jpg 3840w">',
    '<img src="/icons/logo.svg">',
    `<img src="${BIG_DATA_URI}">`,
    `<div style="background-image:url(${BIG_DATA_URI})"></div>`,
    '<img src="data:image/png;base64,AAAA">',
  ].join('\n');

  const { candidates, truncated } = collectImageCandidates(html, 'https://example.test/page');
  assert.strictEqual(truncated, false);
  const urls = candidates.filter((c) => c.kind === 'url').map((c) => c.url);
  assert.ok(urls.includes('https://example.test/img/banner-card.webp'));
  assert.ok(urls.includes('https://cdn.test/thumbnail-a.webp'));
  assert.ok(urls.includes('https://example.test/img/mid.jpg'));
  assert.strictEqual(urls.filter((u) => u.includes('banner-card')).length, 1);
  assert.ok(!urls.some((u) => u.endsWith('.svg')));
  // The two identical big data URIs dedupe to one; the tiny placeholder is dropped.
  assert.strictEqual(candidates.filter((c) => c.kind === 'data').length, 1);
});

test('collectImageCandidates rejects file:// images from a remote page', () => {
  const html = '<img src="file:///home/user/private.png" alt="x"><p>hi</p><img src="/_next/image?url=file%3A%2F%2F%2Fetc%2Fsecret.png&amp;w=640">';
  const { candidates } = collectImageCandidates(html, 'https://attacker.test/page');
  assert.strictEqual(candidates.filter((c) => c.kind === 'file').length, 0);
});

test('collectImageCandidates allows file:// images for a local .html preview', () => {
  const html = '<img src="banner.png" alt="배너 이미지입니다">';
  const { candidates } = collectImageCandidates(html, 'file:///home/user/page.html');
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].kind, 'file');
  assert.strictEqual(candidates[0].url, 'file:///home/user/banner.png');
});

test('collectImageCandidates caps by priority', () => {
  const html = [
    '<img src="/a/photo-1.jpg">',
    '<img src="/b/thumbnail-koreatext.jpg" alt="한국어 텍스트가 들어있는 배너">',
    '<img src="/c/photo-2.jpg">',
  ].join('');
  const { candidates, truncated } = collectImageCandidates(html, 'https://example.test/', { maxImages: 1 });
  assert.strictEqual(truncated, true);
  assert.strictEqual(candidates.length, 1);
  assert.ok(candidates[0].url.includes('thumbnail-koreatext'));
});

function bodyFor(text) {
  const data = Buffer.from(text);
  let sent = false;
  return {
    getReader() {
      return {
        read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(data) })),
      };
    },
  };
}

test('stageOcrImages enforces size caps and stages files, urls, and data URIs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-ocr-test-'));
  const localImage = join(dir, 'local.png');
  writeFileSync(localImage, Buffer.from('local-bytes'));

  const fetchImpl = async (url) => ({
    ok: true,
    headers: { get: (name) => (name === 'content-length' && url.includes('huge') ? String(10 * 1024 * 1024) : null) },
    body: bodyFor(url.includes('huge') ? 'x'.repeat(5 * 1024 * 1024) : 'remote-bytes'),
  });

  const candidates = [
    { kind: 'url', url: 'https://cdn.test/ok.webp', ext: 'webp' },
    { kind: 'url', url: 'https://cdn.test/huge.jpg', ext: 'jpg' },
    { kind: 'file', url: pathToFileURL(localImage).href, ext: 'png' },
    { kind: 'data', dataUri: `data:image/png;base64,${Buffer.from('data-bytes').toString('base64')}`, ext: 'png' },
  ];

  const result = await stageOcrImages(candidates, { fetchImpl });
  try {
    assert.strictEqual(result.staged.length, 3);
    assert.strictEqual(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /larger than/);
    assert.strictEqual(readFileSync(result.staged.find((s) => s.kind === 'file').path, 'utf8'), 'local-bytes');
    assert.strictEqual(readFileSync(result.staged.find((s) => s.kind === 'data').path, 'utf8'), 'data-bytes');
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stageOcrImages caps a stream that lies about (omits) Content-Length', async () => {
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => null }, // no content-length
    body: bodyFor('y'.repeat(5 * 1024 * 1024)),
  });
  const result = await stageOcrImages(
    [{ kind: 'url', url: 'https://evil.test/stream.png', ext: 'png' }],
    { fetchImpl, maxBytes: 1024 },
  );
  try {
    assert.strictEqual(result.staged.length, 0);
    assert.strictEqual(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /larger than/);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test('stageOcrImages records skips for every candidate past the total budget', async () => {
  const fetchImpl = async () => ({ ok: true, headers: { get: () => null }, body: bodyFor('z'.repeat(800)) });
  const candidates = Array.from({ length: 4 }, (_, i) => ({ kind: 'url', url: `https://cdn.test/${i}.png`, ext: 'png' }));
  const result = await stageOcrImages(candidates, { fetchImpl, totalBudget: 1000 });
  try {
    assert.strictEqual(result.staged.length, 1);
    assert.strictEqual(result.skipped.length, 3);
    assert.ok(result.skipped.every((s) => /budget/.test(s.reason)));
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test('normalizeOcrText filters NO_TEXT and flattens to one paragraph', () => {
  assert.strictEqual(normalizeOcrText('NO_TEXT'), null);
  assert.strictEqual(normalizeOcrText('  \n '), null);
  assert.strictEqual(normalizeOcrText('카드뉴스\n딸깍\n\n이번 주 AI 뉴스'), '카드뉴스 / 딸깍 / 이번 주 AI 뉴스');
});

test('ocrStagedImages uses the injected runner and drops empty results', async () => {
  setOcrRuntimeForTests({
    runOcr: async (image) => (image.path.includes('texty') ? '이미지 속 한국어 문장입니다' : 'NO_TEXT'),
  });
  try {
    const results = await ocrStagedImages(
      [{ path: '/tmp/texty.png', kind: 'url', url: 'https://x.test/texty.png' }, { path: '/tmp/blank.png', kind: 'url', url: 'https://x.test/blank.png' }],
      {},
    );
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].text, '이미지 속 한국어 문장입니다');
  } finally {
    resetOcrRuntimeForTests();
  }
});

test('stageCliImages copies attachments into the backend temp dir', () => {
  const src = mkdtempSync(join(tmpdir(), 'patina-stage-src-'));
  const dst = mkdtempSync(join(tmpdir(), 'patina-stage-dst-'));
  try {
    const imagePath = join(src, 'photo.webp');
    writeFileSync(imagePath, Buffer.from('img'));
    const staged = stageCliImages(dst, [imagePath]);
    assert.deepStrictEqual(staged, ['ocr-image-0.webp']);
    assert.ok(existsSync(join(dst, 'ocr-image-0.webp')));
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  }
});
