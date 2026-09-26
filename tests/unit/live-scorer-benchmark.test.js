import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTextHash, distribution, evaluateScorerFixture, loadScorerFixtures, loadScorerManifest, renderScorerReport, summarizeScorerRows, textHash } from '../quality/live-scorer-benchmark.mjs';
import { readCredential, safeStudyError, validateTransport } from '../../scripts/research/model-evaluation-transport.mjs';
import { createStudyInputs } from '../../scripts/research/study-inputs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = { id: 'test', provider: 'gemini', transport: 'opencodex', model: 'google-antigravity/gemini-test', baseURL: 'http://127.0.0.1:10100/v1' };

test('Gemini study rejects every direct, foreign-host, unqualified or API-key route', () => {
  assert.doesNotThrow(() => validateTransport(candidate));
  for (const patch of [{ transport: 'http' }, { baseURL: 'https://generativelanguage.googleapis.com/v1' }, { model: 'gemini-test' }, { apiKeyEnv: 'GEMINI_API_KEY' }, { baseURL: 'http://127.0.0.1.evil.example/v1' }]) {
    assert.throws(() => validateTransport({ ...candidate, ...patch }));
  }
  assert.throws(() => readCredential('GEMINI_API_KEY'), /forbidden/);
});

test('scorer fixture suite carries both classes in every language and exact hashes', () => {
  const rows = loadScorerFixtures();
  for (const language of ['ko', 'en', 'zh', 'ja']) for (const expected of [true, false]) assert.ok(rows.some((row) => row.language === language && row.expected_hot === expected));
  for (const row of rows) assert.equal(row.text_hash, textHash(row.text));
});

test('live scorer executes the production prompt, preserves zero, and omits raw content', async () => {
  const fixture = loadScorerFixtures().find((row) => row.language === 'en' && !row.expected_hot);
  let calls = 0;
  const result = await evaluateScorerFixture(fixture, candidate, { complete: async (_candidate, prompt) => {
    calls++;
    assert.match(prompt, /AI-likeness scoring engine/);
    assert.ok(prompt.includes(fixture.text));
    return { text: JSON.stringify({ categories: { content: { detected: 0, sum: 0, max: 18, score: 0, weighted: 0 } }, overall: 0, interpretation: 'natural' }), durationMs: 10, effectiveModels: [candidate.model], usage: { prompt_tokens: 1 }, attempts: 1 };
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.overall, 0);
  assert.equal(result.categories.content.score, 0);
  assert.equal(result.documentType, 'default');
  assert.equal(typeof result.analyzer_hot, 'boolean');
  assert.ok(!JSON.stringify(result).includes(fixture.text));
});

test('schema and transport failures remain missing, not perfect zero scores', async () => {
  const result = await evaluateScorerFixture(loadScorerFixtures()[0], candidate, { complete: async () => { throw new Error('transport unavailable'); } });
  assert.equal(result.status, 'error');
  assert.equal(result.overall, null);
  const summary = summarizeScorerRows([result]).test;
  assert.equal(summary.errors, 1);
  assert.equal(summary.overall.n, 0);
  assert.equal(summary.overall.mean, null);
});

test('statistics exclude null and report the even-sample median', () => {
  assert.deepEqual(distribution([null, undefined, NaN]), { n: 0, min: null, median: null, mean: null, p95: null, max: null });
  assert.equal(distribution([2, 0, 4, 6, null]).median, 3);
});

test('unlabeled scorer rows stay out of class distributions and ranking', () => {
  const rows = [
    { candidate_id: 'unit', status: 'ok', overall: 80, expected_hot: true, categories: {}, duration_ms: 1 },
    { candidate_id: 'unit', status: 'ok', overall: 20, expected_hot: false, categories: {}, duration_ms: 1 },
    { candidate_id: 'unit', status: 'ok', overall: 50, expected_hot: null, categories: {}, duration_ms: 1 },
    { candidate_id: 'unit', status: 'error', overall: null, expected_hot: true, categories: {}, duration_ms: 1 },
    { candidate_id: 'unit', status: 'error', overall: null, expected_hot: null, categories: {}, duration_ms: 1 },
  ];
  const summary = summarizeScorerRows(rows).unit;
  assert.equal(summary.labeled, 3);
  assert.equal(summary.unlabeled, 2);
  assert.equal(summary.errors, 2);
  assert.equal(summary.ai_fixture_scores.n, 1);
  assert.equal(summary.natural_fixture_scores.n, 1);
  assert.equal(summary.ranking.n, 2);
  assert.equal(summary.ranking.negatives, 1);
});

test('unknown-only diagnostics retain zero and distributions without ranked labels', () => {
  const rows = [null, undefined].map((expected_hot, index) => ({
    candidate_id: 'unit', fixture_id: `unknown-${index}`, repeat: 0, language: 'en',
    status: 'ok', overall: index * 10, expected_hot,
    categories: { style: { score: index * 10 } }, duration_ms: 1, calls: [],
  }));
  const summary = summarizeScorerRows(rows).unit;
  assert.equal(summary.overall.n, 2);
  assert.equal(summary.overall.min, 0);
  assert.equal(summary.by_language.en.n, 2);
  assert.equal(summary.by_pattern_pack['en/style'].n, 2);
  assert.equal(summary.labeled, 0);
  assert.equal(summary.unlabeled, 2);
  assert.equal(summary.ai_fixture_scores.n, 0);
  assert.equal(summary.natural_fixture_scores.n, 0);
  assert.equal(summary.ranking.n, 0);
  assert.equal(summary.ranking.roc_auc, null);
  assert.equal(summary.ranking.pr_auc, null);
  assert.match(renderScorerReport(rows), /\| unit \| 2\/2 \| 0 \| 2 \| 5\.00 \| N\/A \| N\/A \| 1\.00 \|/);
});

test('public transport errors omit provider account IDs and echoed source text', () => {
  const error = new Error('HTTP 429: account org-private <ak-private> suspended due to insufficient balance; input: confidential draft');
  assert.equal(safeStudyError(error), 'provider-insufficient-balance (HTTP 429)');
  assert.equal(safeStudyError(new Error('HTTP 400: token=secret; draft=private')), 'study-call-failed (HTTP 400)');
});

test('manifest text resolution rejects missing, duplicate and mismatched evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-live-manifest-'));
  const manifest = join(dir, 'manifest.jsonl');
  const texts = join(dir, 'texts.jsonl');
  const text = 'A public example.';
  const row = { sample_id: 'one', language: 'en', class: 'natural-human', expected_hot: false, text_hash: textHash(text) };
  try {
    writeFileSync(manifest, JSON.stringify(row));
    writeFileSync(texts, JSON.stringify({ text, text_hash: textHash(text) }));
    assert.equal(loadScorerManifest(manifest, texts)[0].text, text);
    writeFileSync(texts, JSON.stringify({ text, text_hash: 'wrong' }));
    assert.throws(() => loadScorerManifest(manifest, texts), /Invalid text hash/);
    writeFileSync(texts, JSON.stringify({ text, text_hash: textHash('Different input') }));
    assert.throws(() => loadScorerManifest(manifest, texts), /Private text hash mismatch/);
    writeFileSync(texts, JSON.stringify({ text: 'Different input' }));
    assert.throws(() => loadScorerManifest(manifest, texts), /Unresolved/);
    writeFileSync(texts, JSON.stringify({ text }));
    writeFileSync(manifest, `${JSON.stringify(row)}\n${JSON.stringify(row)}`);
    assert.throws(() => loadScorerManifest(manifest, texts), /invalid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exact manifest bytes reach the production prompt and changed bytes never dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-live-exact-text-'));
  const manifest = join(dir, 'manifest.jsonl');
  const texts = join(dir, 'texts.jsonl');
  const text = '  Cafe\u0301 opens at noon.\r\n\r\nBring one bag.  \n';
  let calls = 0;
  try {
    writeFileSync(texts, JSON.stringify({ text, text_hash: `sha256:${textHash(text).toUpperCase()}` }));
    writeFileSync(manifest, JSON.stringify({ sample_id: 'exact', language: 'en', text_hash: textHash(text) }));
    const [fixture] = loadScorerManifest(manifest, texts);
    assert.equal(fixture.text, text);
    const preparedInputs = createStudyInputs(ROOT, { config: { documentType: 'default' } }).fixture(fixture);
    const complete = async (_candidate, prompt) => {
      calls++;
      assert.ok(prompt.includes(text), 'the provider receives the same bytes bound by text_hash');
      return { text: JSON.stringify({ categories: { content: { detected: 0, sum: 0, max: 18, score: 0, weighted: 0 } }, overall: 0 }),
        durationMs: 1, effectiveModels: [candidate.model], attempts: 1 };
    };
    const result = await evaluateScorerFixture({ ...fixture, text_hash: `sha256:${textHash(text)}` }, candidate, { preparedInputs, complete });
    assert.equal(result.status, 'ok');
    assert.equal(result.text_hash, textHash(text));
    assert.equal(result.expected_hot, null);
    for (const changed of [text.trim(), text.normalize('NFC'), text.replaceAll('\r\n', '\n')]) {
      await assert.rejects(evaluateScorerFixture({ ...fixture, text: changed }, candidate, { preparedInputs, complete }), /Fixture text hash mismatch/);
    }
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('manifest hashes canonicalize and retain nullable labels, document type and safe bindings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-live-manifest-canonical-'));
  const manifest = join(dir, 'manifest.jsonl');
  const texts = join(dir, 'texts.jsonl');
  const text = 'A short social post.';
  const hash = textHash(text);
  try {
    writeFileSync(manifest, JSON.stringify({
      sample_id: 'social-one', language: 'en', register: 'social', documentType: 'social',
      expected_hot: null, class: 'unknown', text_hash: `sha256:${hash}`,
      source_type: 'synthetic-ai', model_family: 'fixture', source_review: { status: 'hash-only', rationale: text },
      score_review: { status: 'unreviewed', text },
    }));
    writeFileSync(texts, JSON.stringify({ text, text_hash: hash }));
    const [row] = loadScorerManifest(manifest, texts);
    assert.equal(row.text_hash, hash);
    assert.equal(canonicalTextHash(`sha256:${hash.toUpperCase()}`), hash);
    assert.equal(row.documentType, 'social');
    assert.equal(row.expected_hot, null);
    assert.equal(row.provenance.source_type, 'synthetic-ai');
    assert.equal(row.provenance.model_family, 'fixture');
    assert.match(row.provenance.binding_sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(row.provenance).includes(text));
    assert.throws(() => canonicalTextHash('not-a-sha256'), /Invalid text hash/);
    writeFileSync(manifest, JSON.stringify({ sample_id: 'bad', language: 'en', text_hash: 'not-a-sha256' }));
    assert.throws(() => loadScorerManifest(manifest, texts), /Invalid text hash/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('document type reaches prepared scoreText inputs and analyzer hot remains nullable', async () => {
  const text = 'According to turn0search1 the short social note is ready.';
  const fixture = { fixture_id: 'social-known', language: 'en', register: 'social', documentType: 'social',
    expected_hot: null, class: null, text, text_hash: textHash(text) };
  const response = () => ({ text: JSON.stringify({ categories: { content: { detected: 0, sum: 0, max: 18, score: 0, weighted: 0 } }, overall: 0, interpretation: 'natural' }),
    durationMs: 1, effectiveModels: [candidate.model], usage: null, attempts: 1 });
  const known = await evaluateScorerFixture(fixture, candidate, { complete: async () => response() });
  assert.equal(known.documentType, 'social');
  assert.equal(known.expected_hot, null);
  assert.equal(known.analyzer_hot, true);

  const inputs = createStudyInputs(ROOT, { config: { documentType: 'social', scoring: { deterministic: { enabled: false } } } });
  const missingDocumentType = { ...fixture };
  delete missingDocumentType.documentType;
  assert.equal(inputs.fixture(missingDocumentType).config.documentType, 'social');
  const unknown = await evaluateScorerFixture(fixture, candidate, { preparedInputs: inputs.fixture(fixture), complete: async () => response() });
  assert.equal(unknown.documentType, 'social');
  assert.equal(unknown.analyzer_hot, null);
});

test('analyzer hot uses frozen inputs and remains unknown when the language is disabled', async () => {
  const text = 'The train leaves at noon. According to turn0search1 it runs on time.';
  const fixture = { fixture_id: 'frozen', language: 'en', register: 'social', text, text_hash: textHash(text) };
  const config = { documentType: 'default', register: 'professional', stylometry: { languages: ['en'] } };
  const complete = async () => ({
    text: JSON.stringify({ categories: { content: { detected: 0, sum: 0, max: 18, score: 0, weighted: 0 } }, overall: 0 }),
    durationMs: 1, effectiveModels: [candidate.model], attempts: 1,
  });
  const frozen = createStudyInputs(ROOT, { config });
  config.stylometry.languages = ['ko'];
  const prepared = frozen.fixture(fixture);
  assert.equal(prepared.analyzerHot, true);
  assert.equal(prepared.config.register, 'professional', 'dataset genre must not replace the delivery register');
  assert.equal(prepared.config.documentType, 'default', 'dataset genre must not imply a document type');
  assert.equal(prepared.deterministicScore.bands.markupLeakage.leaked, true);
  const result = await evaluateScorerFixture(fixture, candidate, { preparedInputs: prepared, complete });
  assert.equal(result.status, 'ok');
  assert.equal(result.analyzer_hot, true);
  assert.equal(result.overall, prepared.deterministicScore.evidenceFloor);
  assert.equal(Object.hasOwn(result, 'analysis'), false);
  assert.ok(!JSON.stringify(result).includes(text));

  const disabled = createStudyInputs(ROOT, { config }).fixture(fixture);
  assert.equal(disabled.deterministicScore.skipReason, 'language-disabled');
  const skipped = await evaluateScorerFixture(fixture, candidate, { preparedInputs: disabled, complete });
  assert.equal(skipped.status, 'ok');
  assert.equal(skipped.analyzer_hot, null);
});

test('unlabeled manifest social scoring keeps the short-form floor without affecting default prose', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-live-social-floor-'));
  const manifest = join(dir, 'manifest.jsonl');
  const texts = join(dir, 'texts.jsonl');
  const text = 'built patina for exactly that — keeps your meaning intact.';
  const complete = async () => ({
    text: JSON.stringify({ categories: { style: { detected: 0, sum: 0, max: 18, score: 0, weighted: 0 } }, overall: 0 }),
    durationMs: 1, effectiveModels: [candidate.model], attempts: 1,
  });
  try {
    const base = { language: 'en', text_hash: `sha256:${textHash(text)}`, register: 'social' };
    writeFileSync(texts, JSON.stringify({ text, text_hash: textHash(text) }));
    writeFileSync(manifest, [
      { ...base, sample_id: 'social', documentType: 'social' },
      { ...base, sample_id: 'default', documentType: 'default' },
      { ...base, sample_id: 'configured' },
    ].map((row) => JSON.stringify(row)).join('\n'));
    const [social, defaultProse, configured] = loadScorerManifest(manifest, texts);
    assert.equal(social.expected_hot, null);
    assert.equal(configured.documentType, undefined);
    const config = createStudyInputs(ROOT).config();
    config.documentType = 'social';
    const inputs = createStudyInputs(ROOT, { config });
    assert.equal(inputs.fixture(configured).config.documentType, 'social');
    const socialResult = await evaluateScorerFixture(social, candidate, { complete, preparedInputs: inputs.fixture(social) });
    const defaultResult = await evaluateScorerFixture(defaultProse, candidate, { complete, preparedInputs: inputs.fixture(defaultProse) });
    assert.equal(socialResult.status, 'ok');
    assert.equal(defaultResult.status, 'ok');
    assert.ok(socialResult.overall > 0);
    assert.equal(socialResult.analyzer_hot, false, 'the short-form score floor is not an analyzer hot verdict');
    assert.equal(defaultResult.overall, 0);
    writeFileSync(manifest, JSON.stringify({ ...base, sample_id: 'invalid-label', expected_hot: 'false' }));
    assert.throws(() => loadScorerManifest(manifest, texts), /Invalid expected_hot label/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
