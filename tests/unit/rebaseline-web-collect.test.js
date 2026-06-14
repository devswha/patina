import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSources,
  extractTextCandidates,
  isUsefulParagraph,
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

// --- Wave 0.4: multilingual collector support ------------------------------

const MULTILINGUAL_SAMPLES = {
  ko: '이 문서는 공개 웹 문서에서 가져온 한국어 문단 후보를 검증하기 위한 예시이며 실제 벤치마크에는 원문을 공개하지 않고 해시만 남깁니다.',
  en: 'This public web document is a sample English paragraph used to validate the multilingual collector path; only hashes and source metadata are kept, never the raw paragraph text itself.',
  zh: '这是一段用于验证多语言采集器的公开网页中文示例段落，实际基准只保留哈希和来源元数据，绝不会公开原始文本内容，以便稳定地观察误报情况。',
  ja: 'これは多言語コレクターを検証するための公開ウェブの日本語サンプル段落です。実際のベンチマークではハッシュと出典メタデータのみを保持し、原文は決して公開しません。',
};

test('isUsefulParagraph accepts each language script and rejects wrong-script / chrome', () => {
  const opts = { minChars: 40, maxChars: 2000 };
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES[lang], { ...opts, language: lang }), true, `${lang} accepts its own script`);
  }
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.ko, { ...opts, language: 'en' }), false);
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.ko, { ...opts, language: 'zh' }), false);
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.en, { ...opts, language: 'ko' }), false);
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.en, { ...opts, language: 'ja' }), false);
  assert.equal(isUsefulParagraph('short text', { ...opts, language: 'en' }), false);
  assert.equal(isUsefulParagraph(`Copyright ${MULTILINGUAL_SAMPLES.en}`, { ...opts, language: 'en' }), false);
});

test('parseArgs --language validates against supported languages', () => {
  assert.equal(parseArgs(['--language', 'en']).language, 'en');
  assert.equal(parseArgs(['--language', 'zh']).language, 'zh');
  assert.equal(parseArgs([]).language, null);
  assert.throws(() => parseArgs(['--language', 'xx']), /--language must be one of/u);
});

test('extractTextCandidates honors the language script filter', () => {
  const html = `<p>${MULTILINGUAL_SAMPLES.en}</p><p>${MULTILINGUAL_SAMPLES.ko}</p>`;
  const en = extractTextCandidates(html, { language: 'en', minChars: 40, maxChars: 2000 });
  assert.ok(en.includes(MULTILINGUAL_SAMPLES.en));
  assert.ok(!en.includes(MULTILINGUAL_SAMPLES.ko));
  const ko = extractTextCandidates(html, { language: 'ko', minChars: 40, maxChars: 2000 });
  assert.ok(ko.includes(MULTILINGUAL_SAMPLES.ko));
  assert.ok(!ko.includes(MULTILINGUAL_SAMPLES.en));
});

test('collectSources stamps the source language onto private records', async () => {
  const source = {
    source_id: 'en-gov-1',
    url: 'https://example.gov/article',
    register: 'product-doc',
    source_title: 'Example',
    source_license: 'public-domain',
    language: 'en',
    max_rows: null,
    sample_prefix: 'en-human-web-en-gov-1',
    source_kind: 'public-web',
  };
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => 'text/html' },
    text: async () => `<p>${MULTILINGUAL_SAMPLES.en}</p>`,
  });
  const direct = await collectSources([source], { fetchImpl, minChars: 40, maxChars: 2000, delayMs: 0 });
  assert.equal(direct.records.length, 1);
  assert.equal(direct.records[0].language, 'en');
  assert.ok(direct.records[0].sample_id.startsWith('en-human-web-'));
});

test('ja requires kana and zh forbids kana (CJK Han disambiguation)', () => {
  const opts = { minChars: 40, maxChars: 2000 };
  // Han-only Chinese text under ja -> rejected (no kana present).
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.zh, { ...opts, language: 'ja' }), false);
  // Kana-bearing Japanese text under zh -> rejected (kana forbidden).
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.ja, { ...opts, language: 'zh' }), false);
  // Each still accepts its own script.
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.ja, { ...opts, language: 'ja' }), true);
  assert.equal(isUsefulParagraph(MULTILINGUAL_SAMPLES.zh, { ...opts, language: 'zh' }), true);
});

test('collectSources derives sample_prefix from the effective language', async () => {
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => 'text/html' },
    text: async () => `<p>${MULTILINGUAL_SAMPLES.en}</p>`,
  });
  const baseSource = {
    url: 'https://example.gov/a',
    register: 'product-doc',
    source_title: 'X',
    source_license: 'public-domain',
    max_rows: null,
    source_kind: 'public-web',
  };
  // (a) implicit prefix (null) is derived from the per-source language.
  const implicit = await collectSources(
    [{ ...baseSource, source_id: 'en-gov-2', language: 'en', sample_prefix: null }],
    { fetchImpl, minChars: 40, maxChars: 2000, delayMs: 0 },
  );
  assert.ok(implicit.records[0].sample_id.startsWith('en-human-web-en-gov-2-'));

  // (b) --language override regenerates an implicit ko prefix to the override language.
  const overridden = await collectSources(
    [{ ...baseSource, source_id: 'src-1', language: 'ko', sample_prefix: null }],
    { fetchImpl, language: 'en', minChars: 40, maxChars: 2000, delayMs: 0 },
  );
  assert.equal(overridden.records[0].language, 'en');
  assert.ok(overridden.records[0].sample_id.startsWith('en-human-web-'), 'override must regenerate the implicit prefix');

  // (c) an EXPLICIT prefix is preserved even under override (user choice).
  const explicit = await collectSources(
    [{ ...baseSource, source_id: 'src-2', language: 'ko', sample_prefix: 'custom-control' }],
    { fetchImpl, language: 'en', minChars: 40, maxChars: 2000, delayMs: 0 },
  );
  assert.ok(explicit.records[0].sample_id.startsWith('custom-control-'));
});
