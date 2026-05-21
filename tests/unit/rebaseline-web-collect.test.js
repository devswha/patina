import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSources,
  extractTextCandidates,
  loadSourceRows,
  parseArgs,
  renderSummary,
} from '../../scripts/rebaseline-web-collect.mjs';

const LONG_KOREAN_PARAGRAPH = '이 문서는 공개 웹 문서에서 가져온 한국어 문단 후보를 검증하기 위한 예시입니다. 실제 벤치마크에는 원문을 공개하지 않고 해시와 출처 메타데이터만 남깁니다.';
const SECOND_KOREAN_PARAGRAPH = '수집기는 짧은 메뉴나 공유 버튼 문구를 버리고, 충분한 길이와 한국어 비율을 갖춘 본문 문단만 후보로 남겨야 합니다. 이렇게 해야 기술문서 특유의 오탐을 더 안정적으로 관찰할 수 있습니다.';

test('extractTextCandidates keeps useful Korean body text and drops page chrome', () => {
  const html = `
    <html>
      <head><style>.hidden{display:none}</style><script>console.log('drop')</script></head>
      <body>
        <nav>검색 공유하기 목록 닫기</nav>
        <p>${LONG_KOREAN_PARAGRAPH}</p>
        <p>짧다.</p>
        <p>저작권자(c) 뉴스 제공, 무단 전재 및 재배포 금지</p>
        <div>${SECOND_KOREAN_PARAGRAPH}</div>
      </body>
    </html>`;

  assert.deepEqual(extractTextCandidates(html, { minChars: 40, maxChars: 220 }), [
    LONG_KOREAN_PARAGRAPH,
    SECOND_KOREAN_PARAGRAPH,
  ]);
});

test('collectSources writes private hash-only records with source metadata', async () => {
  const html = `<article><p>${LONG_KOREAN_PARAGRAPH}</p><p>${SECOND_KOREAN_PARAGRAPH}</p></article>`;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => html,
  });

  const result = await collectSources([
    {
      source_id: 'unit-source',
      url: 'https://example.test/article',
      register: 'blog',
      source_title: 'Unit source',
      source_license: 'Hash-only test fixture.',
      source_kind: 'unit-test',
      sample_prefix: 'ko-human-unit',
      max_rows: 2,
    },
  ], {
    fetchImpl,
    minChars: 40,
    maxChars: 220,
    maxPerSource: 2,
    targetPerRegister: 1,
    delayMs: 0,
    collectedAt: '2026-05-22',
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.registerCounts.blog, 1);
  assert.equal(result.records[0].sample_id, 'ko-human-unit-01');
  assert.equal(result.records[0].redistribution, 'hash-only');
  assert.equal(result.records[0].source_url, 'https://example.test/article');
  assert.equal(result.records[0].source_review.license_basis, 'Hash-only test fixture.');
  assert.match(result.records[0].text_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.records[0].text, LONG_KOREAN_PARAGRAPH);
});

test('collectSources treats fetch failures as warnings so other sources can proceed', async () => {
  const html = `<article><p>${LONG_KOREAN_PARAGRAPH}</p></article>`;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, headers: { get: () => 'text/html' }, text: async () => '' };
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => html };
  };

  const result = await collectSources([
    {
      source_id: 'bad-source',
      url: 'https://example.test/bad',
      register: 'blog',
      source_title: 'Bad source',
      source_license: 'Hash-only test fixture.',
      max_rows: 1,
      sample_prefix: 'bad-source',
    },
    {
      source_id: 'good-source',
      url: 'https://example.test/good',
      register: 'blog',
      source_title: 'Good source',
      source_license: 'Hash-only test fixture.',
      max_rows: 1,
      sample_prefix: 'good-source',
    },
  ], {
    fetchImpl,
    minChars: 40,
    maxChars: 220,
    maxPerSource: 1,
    targetPerRegister: 2,
    delayMs: 0,
    collectedAt: '2026-05-22',
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /bad-source: fetch failed: HTTP 503/u);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sample_id, 'good-source-01');
});

test('loadSourceRows validates source inventory shape', () => {
  const loaded = loadSourceRows('artifacts/rebaseline-2025/sources.ko-public.jsonl');

  assert.equal(loaded.errors.length, 0);
  assert.ok(loaded.rows.length >= 5);
  assert.ok(loaded.rows.every((row) => row.value.redistribution === undefined));
  assert.ok(loaded.rows.every((row) => row.value.url.startsWith('https://')));
});

test('parseArgs and renderSummary expose operator-facing controls', () => {
  const args = parseArgs([
    '--target-per-register', '7',
    '--max-per-source', '3',
    '--min-chars', '50',
    '--max-chars', '500',
    '--delay-ms', '0',
    '--collected-at', '2026-05-22',
    '--dry-run',
  ]);

  assert.equal(args.targetPerRegister, 7);
  assert.equal(args.maxPerSource, 3);
  assert.equal(args.dryRun, true);

  const summary = renderSummary({
    sources: 2,
    records: [{}, {}],
    errors: [],
    warnings: ['unit warning'],
    registerCounts: { blog: 2, 'academic-summary': 0, 'product-doc': 0, 'chat-update': 0, 'technical-how-to': 0 },
  });
  assert.match(summary, /Private rows: 2/u);
  assert.match(summary, /unit warning/u);
});
