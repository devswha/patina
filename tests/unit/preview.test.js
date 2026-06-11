import test from 'node:test';
import assert from 'node:assert';

import {
  fetchPreviewPage,
  extractProseBlocks,
  alignRewrites,
  buildPreviewHtml,
  harvestStreamOps,
  resolveStreamedHtml,
  prepareSnapshotHtml,
} from '../../src/preview.js';

const LONG_KO = '이 문장은 미리보기 추출 테스트를 위한 충분히 긴 한국어 단락입니다.';
const LONG_EN = 'This paragraph is comfortably long enough to pass the prose threshold.';

test('extractProseBlocks picks plain-text prose blocks and skips unsafe regions', () => {
  const html = [
    '<html><head><title>Ignored title that is long enough to match</title>',
    `<script type="application/json">{"html":"<p>${LONG_EN} inside script</p>"}</script>`,
    '</head><body>',
    `<p>${LONG_KO}</p>`,
    '<p>short</p>',
    `<h2>${LONG_EN}</h2>`,
    `<p>Has <strong>inline</strong> markup so the v1 walker must leave it alone entirely.</p>`,
    `<!-- <p>${LONG_EN} inside comment</p> -->`,
    `<li>12,345 · 67% · ★★★</li>`,
    `<p>Entity &amp; spacing\n  test paragraph that is long enough to qualify.</p>`,
    '</body></html>',
  ].join('\n');

  const { blocks, truncated } = extractProseBlocks(html);
  assert.strictEqual(truncated, false);
  assert.deepStrictEqual(blocks.map((b) => b.tag), ['p', 'h2', 'p']);
  assert.strictEqual(blocks[0].text, LONG_KO);
  assert.strictEqual(blocks[1].text, LONG_EN);
  assert.strictEqual(blocks[2].text, 'Entity & spacing test paragraph that is long enough to qualify.');
  // Offsets point at the raw inner content.
  assert.strictEqual(html.slice(blocks[0].start, blocks[0].end), LONG_KO);
});

test('extractProseBlocks reports truncation at the block cap', () => {
  const html = Array.from({ length: 5 }, (_, i) => `<p>${LONG_EN} number ${i}</p>`).join('');
  const { blocks, truncated } = extractProseBlocks(html, { maxBlocks: 3 });
  assert.strictEqual(blocks.length, 3);
  assert.strictEqual(truncated, true);
});

test('alignRewrites maps paragraphs 1:1 and rejects mismatches', () => {
  const blocks = [{ text: 'one' }, { text: 'two' }];
  assert.deepStrictEqual(alignRewrites(blocks, 'ONE\n\nTWO'), ['ONE', 'TWO']);
  assert.throws(() => alignRewrites(blocks, 'merged into a single paragraph'), /1 paragraphs for 2 prose blocks/);
});

test('buildPreviewHtml swaps rewrites in place and hardens the snapshot', () => {
  const html = [
    '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>',
    '<body onload="boom()">',
    '<script>window.hydrate()</script>',
    '<a href="javascript:alert(1)">link</a>',
    `<p>${LONG_KO}</p>`,
    `<p>${LONG_EN}</p>`,
    '</body></html>',
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  assert.strictEqual(blocks.length, 2);

  const { html: out, changedCount } = buildPreviewHtml({
    html,
    blocks,
    rewrites: ['고쳐 쓴 <문장> 입니다', LONG_EN],
    sourceUrl: 'https://example.test/page',
  });

  assert.strictEqual(changedCount, 1);
  // Changed block: escaped rewrite + raw original behind the toggle.
  assert.ok(out.includes('<span class="ptna-blk" id="ptna-1" data-n="1">'));
  assert.ok(out.includes('<span class="ptna-after">고쳐 쓴 &lt;문장&gt; 입니다</span>'));
  assert.ok(out.includes(`<span class="ptna-before">${LONG_KO}</span>`));
  // Unchanged block left untouched.
  assert.ok(out.includes(`<p>${LONG_EN}</p>`));
  // Snapshot hardening.
  assert.ok(!out.includes('window.hydrate'));
  assert.ok(!out.includes('onload='));
  assert.ok(!out.includes('javascript:alert'));
  assert.ok(!/http-equiv/i.test(out));
  // Overlay chrome.
  assert.ok(out.includes('<base href="https://example.test/page">'));
  assert.ok(out.includes('id="ptna-style"'));
  assert.ok(out.includes('id="ptna-orig"'));
  assert.ok(out.includes('1 of 2 blocks rewritten'));
  assert.ok(out.includes('href="#ptna-1"'));
});

test('buildPreviewHtml keeps an existing base tag and omits the toggle when nothing changed', () => {
  const html = `<html><head><base href="https://keep.test/"></head><body><p>${LONG_EN}</p></body></html>`;
  const { blocks } = extractProseBlocks(html);
  const { html: out, changedCount } = buildPreviewHtml({
    html,
    blocks,
    rewrites: [LONG_EN],
    sourceUrl: 'https://other.test/',
  });
  assert.strictEqual(changedCount, 0);
  assert.ok(out.includes('href="https://keep.test/"'));
  assert.ok(!out.includes('href="https://other.test/"'));
  assert.ok(!out.includes('id="ptna-orig"'));
  assert.ok(out.includes('0 of 1 blocks rewritten'));
});

test('harvestStreamOps reads $RC and $RS pairs from inline scripts', () => {
  const html = '<script>$RC("B:0","S:0")</script><script>$RS("S:7","P:2")</script>';
  assert.deepStrictEqual(harvestStreamOps(html), [
    { kind: 'boundary', targetId: 'B:0', contentId: 'S:0' },
    { kind: 'placeholder', contentId: 'S:7', targetId: 'P:2' },
  ]);
});

test('resolveStreamedHtml swaps boundary fallbacks and placeholders into place', () => {
  const html = [
    '<body>',
    '<main><!--$?--><template id="B:0"></template><div class="spinner">loading…</div><!--/$--></main>',
    '<aside><template id="P:2"></template></aside>',
    `<div hidden id="S:0"><p>${LONG_KO}</p></div>`,
    '<div hidden id="S:7"><span>sidebar content arrived</span></div>',
    '<div hidden id="S:9"><p>orphaned segment with no swap call</p></div>',
    '</body>',
  ].join('');
  const ops = [
    { kind: 'boundary', targetId: 'B:0', contentId: 'S:0' },
    { kind: 'placeholder', contentId: 'S:7', targetId: 'P:2' },
  ];

  const out = resolveStreamedHtml(html, ops);
  assert.ok(out.includes(`<main><!--$?--><p>${LONG_KO}</p><!--/$--></main>`));
  assert.ok(out.includes('<aside><span>sidebar content arrived</span></aside>'));
  assert.ok(!out.includes('spinner'));
  assert.ok(!out.includes('hidden id="S:'));
  assert.ok(!out.includes('orphaned segment'));
});

test('resolveStreamedHtml keeps fallbacks whose segment never streamed', () => {
  const html = '<body><!--$?--><template id="B:0"></template><p>still loading fallback text here</p><!--/$--></body>';
  const out = resolveStreamedHtml(html, [{ kind: 'boundary', targetId: 'B:0', contentId: 'S:0' }]);
  assert.ok(out.includes('still loading fallback text here'));
});

test('prepareSnapshotHtml resolves a streamed page end to end', () => {
  const html = [
    '<html><head></head><body>',
    '<main><!--$?--><template id="B:1"></template><div role="status">spinner</div><!--/$--></main>',
    `<div hidden id="S:1"><p>${LONG_EN}</p></div>`,
    '<script>$RC("B:1","S:1")</script>',
    '</body></html>',
  ].join('');
  const out = prepareSnapshotHtml(html);
  assert.ok(out.includes(`<p>${LONG_EN}</p>`));
  assert.ok(!out.includes('spinner'));
  assert.ok(!out.includes('<script'));
  const { blocks } = extractProseBlocks(out);
  assert.strictEqual(blocks.length, 1);
});

test('fetchPreviewPage validates status, content type, and size', async () => {
  const page = (body, init = {}) => Promise.resolve({
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    url: init.url ?? '',
    headers: { get: (name) => ({ 'content-type': 'text/html; charset=utf-8', ...init.headers })[name.toLowerCase()] ?? null },
    text: async () => body,
  });

  const ok = await fetchPreviewPage('https://example.test/', { fetchImpl: () => page('<p>hi</p>') });
  assert.strictEqual(ok.html, '<p>hi</p>');
  assert.strictEqual(ok.finalUrl, 'https://example.test/');

  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', { fetchImpl: () => page('nope', { status: 404 }) }),
    /HTTP 404/,
  );
  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', {
      fetchImpl: () => page('{}', { headers: { 'content-type': 'application/json' } }),
    }),
    /not HTML/,
  );
  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', { fetchImpl: () => page('x'.repeat(64)), maxBytes: 10 }),
    /preview limit/,
  );
});

test('fetchPreviewPage aborts on timeout', async () => {
  const hang = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
  });
  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', { fetchImpl: hang, timeoutMs: 20 }),
    /timed out/,
  );
});
