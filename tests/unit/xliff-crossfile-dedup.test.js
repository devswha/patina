import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { humanizeXliffDocument, estimateXliffRun } from '../../src/cli/xliff.js';
import { runXliffMode } from '../../src/cli/run.js';

// A prose target: 9 space-delimited words (>=5) so it selects in any language.
const SHARED = '이 문서의 전체 내용을 반드시 읽고 이해해 주시기 바랍니다.';
const OTHER = '계정에 로그인하지 않으면 파일이 일정 기간 후 삭제됩니다.';

function doc(lang, targets) {
  const units = targets
    .map((t, i) => `<trans-unit id="u${i}"><source>source string ${i}</source><target state="translated">${t}</target></trans-unit>`)
    .join('');
  return `<?xml version="1.0"?>\n<xliff version="1.2"><file target-language="${lang}"><body>${units}</body></file></xliff>`;
}

const okVerify = async ({ candidate }) => ({ verified: true, text: candidate });

test('cross-file cache: a segment shared across files is rewritten once and reused', async () => {
  const cache = new Map();
  const calls = [];
  const rewrite = async ({ core }) => { calls.push(core); return `${core} (다듬음)`; };

  const r1 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify, cache });
  const r2 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify, cache });

  assert.equal(calls.length, 1, 'rewritten exactly once across both files');
  assert.equal(r1.report.reusedFromCache, 0);
  assert.equal(r2.report.reusedFromCache, 1, 'second file served the segment from cache');
  assert.equal(r1.report.changedSegments, 1);
  assert.equal(r2.report.changedSegments, 1, 'the reused rewrite is still applied to the second file');
  assert.ok(r2.outputXml.includes('다듬음'), 'second file carries the reused humanized text');
});

test('cross-file cache: a duplicate WITHIN one file plus reuse ACROSS files both collapse to one call', async () => {
  const cache = new Map();
  const calls = [];
  const rewrite = async ({ core }) => { calls.push(core); return `${core} (X)`; };
  // file 1 has the shared segment twice (within-file dup) + one other unique segment
  const r1 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED, SHARED, OTHER]), rewriteSegment: rewrite, verifySegment: okVerify, cache });
  // file 2 repeats SHARED (cross-file) and OTHER (cross-file)
  const r2 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED, OTHER]), rewriteSegment: rewrite, verifySegment: okVerify, cache });

  assert.equal(r1.report.selectedCount, 3);
  assert.equal(r1.report.uniqueCount, 2, 'within-file dedup: SHARED counted once');
  assert.equal(calls.length, 2, 'file 1 makes 2 unique rewrites (SHARED, OTHER)');
  assert.equal(r2.report.reusedFromCache, 2, 'file 2 reuses both from cache — no new calls');
  assert.equal(r2.report.changedSegments, 2, 'both segments still humanized in file 2');
});

test('cross-file cache is target-language scoped: same text in ko and ja is rewritten twice', async () => {
  const cache = new Map();
  const langs = [];
  const rewrite = async ({ core, lang }) => { langs.push(lang); return `${core} (${lang})`; };

  const rKo = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify, cache });
  const rJa = await humanizeXliffDocument({ xml: doc('ja-JP', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify, cache });

  assert.deepEqual(langs, ['ko', 'ja'], 'each language humanized independently');
  assert.equal(rKo.report.reusedFromCache, 0);
  assert.equal(rJa.report.reusedFromCache, 0, 'ja did NOT reuse the ko cache entry');
});

test('cross-file cache: dry-run accounts cross-file duplicate savings without any calls', async () => {
  const cache = new Map();
  const r1 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED, OTHER]), dryRun: true, cache });
  const r2 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), dryRun: true, cache });

  assert.equal(r1.report.crossFileDuplicateSavings, 0);
  assert.equal(r1.report.billableUniqueCount, 2);
  assert.equal(r2.report.crossFileDuplicateSavings, 1, 'SHARED already seen in file 1');
  assert.equal(r2.report.billableUniqueCount, 0, 'nothing new to bill in file 2');
  assert.equal(r2.report.worstCaseLlmCalls, 0, 'no billable calls for a fully-reused file');
  assert.equal(r1.report.llmCalls, 0);
  assert.equal(r2.report.writes, 0);
});

test('without a cache, behavior is unchanged: each file rewrites independently', async () => {
  const calls = [];
  const rewrite = async ({ core }) => { calls.push(core); return `${core} (Y)`; };
  const r1 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify });
  const r2 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify });

  assert.equal(calls.length, 2, 'no cache => rewritten in each file');
  assert.equal(r1.report.crossFileDuplicateSavings, 0);
  assert.equal(r1.report.billableUniqueCount, r1.report.uniqueCount);
  assert.equal(r2.report.reusedFromCache, 0);
});

test('cross-file cache never caches an error: the next file retries the failed segment', async () => {
  const cache = new Map();
  let n = 0;
  const rewrite = async ({ core }) => { n += 1; if (n === 1) throw new Error('transient backend failure'); return `${core} (ok)`; };

  const r1 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify, cache });
  assert.equal(r1.report.changedSegments, 0, 'error keeps original bytes (fail-closed)');

  const r2 = await humanizeXliffDocument({ xml: doc('ko-KR', [SHARED]), rewriteSegment: rewrite, verifySegment: okVerify, cache });
  assert.equal(n, 2, 'the errored segment was NOT cached — file 2 retried it');
  assert.equal(r2.report.reusedFromCache, 0);
  assert.equal(r2.report.changedSegments, 1, 'retry succeeded and was applied');
});

test('estimateXliffRun: billableUniqueCount drives calls/tokens; defaults preserve prior behavior', () => {
  const base = estimateXliffRun({ selectedCount: 5, uniqueCount: 3 });
  assert.equal(base.billableUniqueCount, 3, 'defaults to uniqueCount');
  assert.equal(base.crossFileDuplicateSavings, 0);
  assert.equal(base.worstCaseLlmCalls, 18, '3 unique * 6 calls (unchanged)');
  assert.equal(base.duplicateSavings, 2, 'within-file 5-3 still reported');

  const reduced = estimateXliffRun({ selectedCount: 5, uniqueCount: 3, billableUniqueCount: 1, crossFileDuplicateSavings: 2, backendAttemptsPerCall: 2 });
  assert.equal(reduced.billableUniqueCount, 1);
  assert.equal(reduced.crossFileDuplicateSavings, 2);
  assert.equal(reduced.worstCaseLlmCalls, 6, '1 billable * 6');
  assert.equal(reduced.worstCaseBackendAttempts, 12, '6 calls * 2 attempts');
  assert.equal(reduced.inputTokensEstimate, 1 * 2 * 12000, 'tokens track billable, not uniqueCount');
  assert.equal(reduced.uniqueCount, 3, 'uniqueCount unchanged');
});

test('runXliffMode: --batch shares the cache across files (one rewrite for a cross-file duplicate)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xliff-crossfile-'));
  const f1 = join(dir, 'a.xliff');
  const f2 = join(dir, 'b.xliff');
  writeFileSync(f1, doc('ko-KR', [SHARED]));
  writeFileSync(f2, doc('ko-KR', [SHARED]));

  const calls = [];
  const ctx = { config: { language: 'ko', profile: 'default' }, repoRoot: process.cwd(), voice: {}, scoring: {}, backends: [], resolved: { model: 'm' }, promptMode: 'strict', timeoutMs: 1000, providerName: 'deepseek' };
  const logger = { info() {}, warn() {}, error() {}, closeProgress() {} };

  await runXliffMode(
    { xliff: true, batch: true, files: [f1, f2] },
    ctx,
    logger,
    {
      rewriteSegment: async ({ core }) => { calls.push(core); return `${core} (다듬음)`; },
      verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
    },
  );

  assert.equal(calls.length, 1, 'cross-file: the shared segment is rewritten once for the whole batch');
  assert.ok(readFileSync(f1, 'utf8').includes('다듬음') === false, 'originals untouched (default writes *.humanized.xliff)');
  assert.ok(readFileSync(join(dir, 'a.humanized.xliff'), 'utf8').includes('다듬음'), 'file a humanized');
  assert.ok(readFileSync(join(dir, 'b.humanized.xliff'), 'utf8').includes('다듬음'), 'file b humanized via reused result');
});
