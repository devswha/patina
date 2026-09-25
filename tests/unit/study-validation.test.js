import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPatterns } from '../../src/loader.js';
import { evaluateScorerFixture, loadScorerFixtures, textHash } from '../quality/live-scorer-benchmark.mjs';
import { acquireStudyWriter, createCallJournal, readUniqueRows, safeCallRecord } from '../../scripts/research/study-journal.mjs';
import { createStudyInputs } from '../../scripts/research/study-inputs.mjs';
import { fixtureIdentity, studySemantics, validateRawFidelity, validateRawMps } from '../../scripts/research/study-validation.mjs';
import { validateTransport } from '../../scripts/research/model-evaluation-transport.mjs';
import { generateRewrite, judgeCandidates, judgeRewrite, renderRewriteReport } from '../../scripts/research/model-rewrite-benchmark.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const protocol = JSON.parse(readFileSync(join(ROOT, 'docs/research/model-evaluation-20260904.json'), 'utf8'));
const candidate = protocol.candidates.find((row) => row.id === 'openai-astra');
const response = (text, model = candidate.model) => ({ text, durationMs: 2, effectiveModels: [model], attempts: 1, usage: { prompt_tokens: 3 } });
const validScore = (overall = 0) => ({ categories: { content: { detected: 0, sum: 0, max: 18, score: 0, weighted: 0 } }, overall, interpretation: 'human' });

test('raw invalid scores cannot become valid after deterministic reconciliation', async () => {
  for (const overall of [-20, false, '0', 101]) {
    const row = await evaluateScorerFixture(loadScorerFixtures()[0], candidate, { complete: async () => response(JSON.stringify(validScore(overall))) });
    assert.equal(row.status, 'error'); assert.equal(row.overall, null); assert.equal(row.schema_failures, 1);
  }
});

test('untrusted category names, usage and model identifiers do not enter public rows', async () => {
  const fixture = loadScorerFixtures()[0];
  const secret = 'confidential source text user@example.test';
  const value = validScore(); value.categories[secret] = value.categories.content;
  const row = await evaluateScorerFixture(fixture, candidate, { complete: async () => ({ ...response(JSON.stringify(value)), effectiveModels: [secret], usage: { prompt_tokens: 1, private_text: secret } }) });
  assert.equal(row.status, 'error');
  assert.doesNotMatch(JSON.stringify(row), /confidential|user@example/);
});

test('production parse retry keeps temperature zero and records recovered schema failure', async () => {
  const temperatures = [];
  const fixture = loadScorerFixtures().find((row) => row.language === 'en' && !row.expected_hot);
  const row = await evaluateScorerFixture(fixture, candidate, { complete: async (_model, _prompt, options) => {
    temperatures.push(options.temperature);
    return response(temperatures.length === 1 ? 'not JSON' : JSON.stringify(validScore()));
  } });
  assert.deepEqual(temperatures, [0.1, 0]);
  assert.equal(row.status, 'ok'); assert.equal(row.schema_failures, 1);
  assert.deepEqual(row.calls.map((call) => call.schema_valid), [false, true]);
});

test('MPS anchor/count/score consistency and raw fidelity ranges are mandatory', () => {
  const bad = { anchors: [{ type: 'claim', content: 'a', verdict: 'HARD_FAIL' }], pass_count: 1, total_count: 1, polarity_pass_count: 0, polarity_total_count: 0, mps: 100 };
  assert.throws(() => validateRawMps(JSON.stringify(bad)), /inconsistent/);
  assert.throws(() => validateRawMps(JSON.stringify({ ...bad, pass_count: 0 })), /inconsistent/);
  assert.equal(validateRawMps(JSON.stringify({ ...bad, pass_count: 0, mps: 0 })).hard_fail_count, 1);
  assert.throws(() => validateRawFidelity('{"claims_preserved":300,"no_fabrication":3,"audience_register_match":3}'), /invalid/);
  assert.throws(() => validateRawFidelity('{"claims_preserved":"3","no_fabrication":3,"audience_register_match":3}'), /invalid/);
});

test('a clamped fidelity and fabricated MPS cannot certify a successful judgment', async () => {
  const text = 'We shipped 12 updates.';
  const fixture = { fixture_id: 'test', language: 'en', text, text_hash: textHash(text) };
  const generation = { candidate_id: candidate.id, provider: candidate.provider, requested_model: candidate.model, repeat: 0, rewrite: text, rewrite_hash: textHash(text) };
  const judge = judgeCandidates(candidate, protocol)[0];
  const row = await judgeRewrite(fixture, generation, judge, { complete: async (_candidate, prompt) => {
    if (prompt.includes('Meaning Preservation evaluator')) return response('{"anchors":[{"type":"claim","content":"12","verdict":"HARD_FAIL"}],"pass_count":1,"total_count":1,"polarity_pass_count":0,"polarity_total_count":0,"mps":100}', judge.model);
    if (prompt.includes('Fidelity evaluator')) return response('{"claims_preserved":300,"no_fabrication":300,"audience_register_match":300}', judge.model);
    return response('{"naturalness":4}', judge.model);
  } });
  assert.equal(row.status, 'error');
  assert.equal(row.calls[0].schema_valid, false); assert.equal(row.calls[1].schema_valid, false);
});

test('call receipts survive before later calls and replay without charging again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-call-journal-'));
  let calls = 0;
  try {
    const config = { directory: dir, logicalId: 'fixed-task', candidate, complete: async () => { calls++; return response('{"value":1}'); } };
    assert.equal(await createCallJournal(config)({ prompt: 'one', temperature: 0.1 }), '{"value":1}');
    const groups = readdirSync(join(dir, 'calls'));
    assert.equal(groups.length, 1);
    const receipt = JSON.parse(readFileSync(join(dir, 'calls', groups[0], '1.private.json'), 'utf8'));
    assert.equal(receipt.state, 'completed'); assert.equal(receipt.response.text, '{"value":1}');
    assert.equal(await createCallJournal(config)({ prompt: 'one', temperature: 0.1 }), '{"value":1}');
    assert.equal(calls, 1);
    await assert.rejects(createCallJournal(config)({ prompt: 'changed', temperature: 0.1 }), /semantics changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('phase ownership and unique rows prevent recovery races and false completion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-writer-'));
  try {
    const release = acquireStudyWriter(dir, 'judge-openai');
    assert.throws(() => acquireStudyWriter(dir, 'judge-openai'), /EEXIST/);
    release(); acquireStudyWriter(dir, 'judge-openai')();
    const path = join(dir, 'rows.jsonl'); writeFileSync(path, '{"id":"same"}\n{"id":"same"}\n');
    assert.throws(() => readUniqueRows(path, (row) => row.id), /Duplicate/);
    const row = { candidate_id: 'a', provider: 'openai', fixture_id: 'one', repeat: 0, status: 'error', language: 'en', duration_ms: 1 };
    assert.match(renderRewriteReport([row], [], { expectedKeys: ['a/different/0'] }), /complete: \*\*no/);
    assert.throws(() => renderRewriteReport([row, row], [], { expectedKeys: ['a/one/0', 'a/two/0'] }), /Duplicate/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('semantic identity binds configuration, pattern contents, language and labels', () => {
  const original = studySemantics(ROOT);
  const dir = mkdtempSync(join(tmpdir(), 'patina-semantics-'));
  try {
    for (const path of Object.keys(original)) { const target = join(dir, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(join(ROOT, path))); }
    assert.deepEqual(studySemantics(dir), original);
    const familyPolicy = 'scripts/research/study-family.mjs';
    rmSync(join(dir, familyPolicy));
    const legacy = { ...original }; delete legacy[familyPolicy];
    assert.deepEqual(studySemantics(dir), legacy, 'historical snapshots without the helper retain their semantics shape');
    writeFileSync(join(dir, familyPolicy), readFileSync(join(ROOT, familyPolicy)));
    writeFileSync(join(dir, '.patina.default.yaml'), '# changed configuration');
    assert.notEqual(studySemantics(dir)['.patina.default.yaml'], original['.patina.default.yaml']);
    const pattern = Object.keys(original).find((path) => path.startsWith('patterns/'));
    writeFileSync(join(dir, pattern), '# changed pattern');
    assert.notEqual(studySemantics(dir)[pattern], original[pattern]);
    const fixture = loadScorerFixtures()[0];
    assert.notEqual(textHash(JSON.stringify(fixtureIdentity(fixture))), textHash(JSON.stringify(fixtureIdentity({ ...fixture, expected_hot: !fixture.expected_hot }))));
    assert.notEqual(textHash(JSON.stringify(fixtureIdentity(fixture))), textHash(JSON.stringify(fixtureIdentity({ ...fixture, language: 'ko' }))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Gemini identity cannot bypass its transport restriction through Claude CLI', () => {
  assert.throws(() => validateTransport({ id: 'disguised', provider: 'anthropic', transport: 'claude-cli', model: 'google-antigravity/gemini-test' }), /Gemini/);
  assert.ok(loadPatterns(ROOT, 'en').length > 0);
});

test('different dataset phases cannot acquire simultaneous write/report locks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-phases-'));
  try {
    for (const first of ['rewrite', 'judge-openai', 'report']) {
      const release = acquireStudyWriter(dir, first);
      for (const other of ['rewrite', 'judge-gemini', 'report']) assert.throws(() => acquireStudyWriter(dir, other), /EEXIST/);
      release();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nested unresolved judge calls prevent a complete comparison', () => {
  const generation = { candidate_id: 'a', provider: 'openai', fixture_id: 'one', repeat: 0, status: 'ok', language: 'en', text_hash: 'a', rewrite_hash: 'b', number_safety: { ok: true }, duration_ms: 1 };
  const judges = ['gemini', 'anthropic'].map((provider) => ({ ...generation, judge_id: provider, judge_provider: provider,
    status: 'error', error: 'judge-schema-failure', calls: [{ error: 'study-call-unobserved' }] }));
  assert.match(renderRewriteReport([generation], judges, { expectedKeys: ['a/one/0'] }), /complete: \*\*no/);
});

test('mixed identities are not silently attributed and failed-attempt usage survives', () => {
  const record = safeCallRecord({ state: 'completed', response: response('x'), transportAttempts: [
    { outcome: 'error', retryReason: 'transport', usage: { prompt_tokens: 30, completion_tokens: 2 } },
    { outcome: 'ok', retryReason: 'initial', usage: { prompt_tokens: 40, completion_tokens: 3 } },
  ] }, candidate);
  assert.deepEqual(record.transportAttempts.map((row) => row.usage.prompt_tokens), [30, 40]);
  const mixed = safeCallRecord({ state: 'completed', response: { ...response('x'), effectiveModels: [candidate.model, 'untrusted model text'] } }, candidate);
  assert.equal(mixed.modelIdentityVerified, false); assert.equal(mixed.mixedOrUnexpectedModel, true);
  assert.doesNotMatch(JSON.stringify(mixed), /untrusted model text/);
});

test('replayed completed calls do not replenish a logical deadline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-replay-budget-'));
  try {
    const params = { directory: dir, logicalId: 'budget', candidate, complete: async () => ({ ...response('ok'), durationMs: 170000 }) };
    await createCallJournal(params)({ prompt: 'one', deadline: Date.now() + 180000 });
    let remaining;
    const resumed = createCallJournal({ ...params, complete: async (_candidate, _prompt, opts) => { remaining = opts.timeoutMs; return response('next'); } });
    const deadline = Date.now() + 180000;
    await resumed({ prompt: 'one', deadline }); await resumed({ prompt: 'two', deadline });
    assert.ok(remaining > 0 && remaining <= 10000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a pre-call deadline produces a terminal not-started receipt, not phantom in-flight work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-expired-budget-'));
  let called = false;
  try {
    const params = { directory: dir, logicalId: 'expired', candidate, complete: async () => { called = true; return response('no'); } };
    await assert.rejects(createCallJournal(params)({ prompt: 'one', deadline: Date.now() - 1 }), /deadline/);
    await assert.rejects(createCallJournal(params)({ prompt: 'one', deadline: Date.now() + 1000 }), /timeout/);
    assert.equal(called, false);
    const group = readdirSync(join(dir, 'calls'))[0];
    const receipt = JSON.parse(readFileSync(join(dir, 'calls', group, '1.private.json'), 'utf8'));
    assert.equal(receipt.state, 'error'); assert.equal(receipt.notStarted, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolved config is frozen and fingerprinted', () => {
  const config = { documentType: 'default', scoring: { deterministic: { enabled: true } } };
  const first = createStudyInputs(ROOT, { config });
  config.scoring.deterministic.enabled = false;
  assert.equal(first.config().scoring.deterministic.enabled, true);
  const second = createStudyInputs(ROOT, { config });
  assert.notEqual(first.fingerprint.configuration, second.fingerprint.configuration);
});

test('generation rows preserve successful retry attempts and the production success enum', async () => {
  const fixture = { fixture_id: 'generation-usage', language: 'en', text: 'We shipped 12 updates.', text_hash: textHash('We shipped 12 updates.') };
  const row = await generateRewrite(fixture, candidate, 'prompt', { complete: async (_candidate, _prompt, options) => {
    options.onAttempt({ outcome: 'error', retryReason: 'transport', usage: { prompt_tokens: 10, completion_tokens: 1 } });
    options.onAttempt({ outcome: 'success', retryReason: 'initial', usage: { prompt_tokens: 20, completion_tokens: 2 } });
    return { ...response(fixture.text), attempts: 2 };
  } });
  assert.deepEqual(row.calls[0].transportAttempts.map((attempt) => attempt.outcome), ['error', 'success']);
  assert.deepEqual(row.calls[0].transportAttempts.map((attempt) => attempt.usage.prompt_tokens), [10, 20]);
  assert.equal(row.attempts, 2);
});

test('failed and replayed generations retain original latency and paid-attempt metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-failed-generation-'));
  const fixture = { fixture_id: 'failed-generation', language: 'en', text: 'A draft.', text_hash: textHash('A draft.') };
  let called = 0;
  const options = { journalDirectory: dir, logicalId: 'fixed-generation', complete: async (_candidate, _prompt, args) => {
    called++; args.onAttempt({ outcome: 'error', retryReason: 'initial', usage: { prompt_tokens: 9, completion_tokens: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    throw new Error('HTTP 500');
  } };
  try {
    const first = await generateRewrite(fixture, candidate, 'prompt', options);
    const replay = await generateRewrite(fixture, candidate, 'prompt', options);
    assert.equal(called, 1); assert.equal(first.status, 'error');
    assert.equal(replay.duration_ms, first.duration_ms);
    assert.equal(replay.calls[0].transportAttempts[0].usage.prompt_tokens, 9);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
