import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStudyFamily, generationFamily, independentJudgeMetadata, validateJudgmentFamilies } from '../../scripts/research/study-family.mjs';
import { generateRewrite, judgeCandidates, judgeRewrite, main, summarizeRewrites } from '../../scripts/research/model-rewrite-benchmark.mjs';
import { studySemantics } from '../../scripts/research/study-validation.mjs';
import { textHash } from '../quality/live-scorer-benchmark.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const openai = { id: 'openai-5.5', provider: 'openai', model: 'gpt-test', transport: 'opencodex', baseURL: 'http://127.0.0.1:10100/v1' };
const google = { id: 'gemini-3.7', provider: 'gemini', model: 'google-antigravity/gemini-test', transport: 'opencodex', baseURL: openai.baseURL };
const anthropic = { id: 'anthropic-sonnet', provider: 'anthropic', model: 'claude-test', transport: 'claude-cli' };
const protocol = { candidates: [openai, google, anthropic] };
// Synthetic transport results below are tests, never provider observations.
const hosted = { id: 'hosted-test', provider: 'groq', model: 'openai/gpt-oss-120b', transport: 'http', baseURL: 'https://api.groq.com/openai/v1' };
const text = 'We shipped 12 fixes.';
const fixture = { fixture_id: 'synthetic', text, text_hash: textHash(text), language: 'en' };
function generation(candidate = hosted) {
  const family = resolveStudyFamily(candidate);
  return { candidate_id: candidate.id, fixture_id: fixture.fixture_id, repeat: 0, provider: candidate.provider,
    requested_model: candidate.model, transport: candidate.transport, upstream_family: family.upstreamFamily, family_evidence: family.familyEvidence,
    text_hash: fixture.text_hash, rewrite_hash: fixture.text_hash, rewrite: text, status: 'ok', number_safety: { ok: true }, language: 'en', duration_ms: 1 };
}
function judgment(source, judge) {
  return { candidate_id: source.candidate_id, fixture_id: source.fixture_id, repeat: source.repeat,
    text_hash: source.text_hash, rewrite_hash: source.rewrite_hash, judge_id: judge.id, judge_provider: judge.provider,
    judge_model: judge.model, judge_transport: judge.transport, ...independentJudgeMetadata(source, judge),
    status: 'ok', mps: 100, fidelity: 100, hard_fail_count: 0, naturalness: 3 };
}

test('hosted OpenAI identifiers resolve their upstream family without changing host or billing inputs', () => {
  for (const provider of ['groq', 'together']) {
    for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
      const candidate = { ...hosted, provider, model, apiKeyEnv: 'SYNTHETIC_KEY_NAME' }, before = JSON.stringify(candidate);
      assert.deepEqual(resolveStudyFamily(candidate), { upstreamFamily: 'openai', familyEvidence: 'model-id' });
      assert.deepEqual(judgeCandidates(candidate, protocol).map((seat) => seat.id), ['gemini-3.7', 'anthropic-sonnet']);
      assert.equal(JSON.stringify(candidate), before);
    }
  }
});

test('opaque hosted models need an explicit recognized family; contradictory and unknown declarations fail', () => {
  const opaque = { ...hosted, model: 'private-deployment-id' };
  assert.throws(() => resolveStudyFamily(opaque), /Missing upstream family/);
  assert.deepEqual(resolveStudyFamily({ ...opaque, upstreamFamily: 'openai' }), { upstreamFamily: 'openai', familyEvidence: 'declared' });
  for (const upstreamFamily of ['groq', 'together', 'unknown', 'new-independent-family', '', null, 1, ' openai']) {
    assert.throws(() => resolveStudyFamily({ ...opaque, upstreamFamily }));
  }
  for (const upstreamFamily of ['google', 'qwen', 'anthropic']) assert.throws(() => resolveStudyFamily({ ...hosted, upstreamFamily }), /Contradictory/);
  assert.throws(() => resolveStudyFamily({ ...openai, model: 'Qwen/Qwen3.5-9B' }), /Contradictory/);
  assert.throws(() => resolveStudyFamily({ ...openai, upstreamFamily: 'qwen' }), /Contradictory/);
  assert.equal(resolveStudyFamily({ ...google, upstreamFamily: 'gemini' }).upstreamFamily, 'google');
});

test('opaque generation evidence stays declared without an admitted definition', async (t) => {
  const candidate = { ...hosted, model: 'private-deployment-id', upstreamFamily: 'qwen' };
  const source = generation(candidate), forged = { ...source, family_evidence: 'model-id' };
  assert.deepEqual(generationFamily(source), { upstreamFamily: 'qwen', familyEvidence: 'declared' });
  assert.equal(summarizeRewrites([source], [judgment(source, openai), judgment(source, google)])[candidate.id].safe, 1);
  assert.throws(() => generationFamily(forged), /model-id.*evidence/);
  assert.throws(() => summarizeRewrites([forged], []), /model-id.*evidence/);
  const root = mkdtempSync(join(tmpdir(), 'patina-family-evidence-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const output = join(root, 'blocked');
  await assert.rejects(judgeRewrite(fixture, forged, openai, { journalDirectory: output,
    complete: async () => { calls++; throw new Error('Injected evaluator reached'); } }), /model-id.*evidence/);
  assert.equal(calls, 0); assert.equal(existsSync(output), false);
});

test('opaque judge evidence cannot claim model-id in saved results', () => {
  const source = generation(), judge = { ...hosted, id: 'opaque-judge', model: 'private-deployment-id', upstreamFamily: 'qwen' };
  const good = judgment(source, judge), forged = { ...good, judge_family_evidence: 'model-id' };
  assert.equal(validateJudgmentFamilies(source, good), 'qwen');
  assert.throws(() => validateJudgmentFamilies(source, forged), /model-id.*evidence/);
  assert.throws(() => summarizeRewrites([source], [judgment(source, google), forged]), /model-id.*evidence/);
});

test('all original admitted first-party protocols keep their seats and remain byte-for-byte unchanged', () => {
  for (const name of ['model-evaluation-20260904.json', 'model-evaluation-kimi-code-20260905.json', 'model-evaluation-claude-isolated-20260905.json']) {
    const path = join(ROOT, 'docs/research', name), bytes = readFileSync(path, 'utf8'), original = JSON.parse(bytes);
    const before = JSON.stringify(original);
    for (const candidate of original.candidates) {
      const family = resolveStudyFamily(candidate).upstreamFamily, judges = judgeCandidates(candidate, original);
      assert.ok(judges.every((judge) => resolveStudyFamily(judge).upstreamFamily !== family));
    }
    assert.equal(JSON.stringify(original), before); assert.equal(readFileSync(path, 'utf8'), bytes);
  }
  assert.deepEqual(generationFamily({ provider: 'openai' }), { upstreamFamily: 'openai', familyEvidence: 'legacy-first-party' });
  assert.throws(() => generationFamily({ provider: 'together', requested_model: hosted.model }), /Missing hosted row/);
});

test('cross-host duplicate judge families cannot supply independence', () => {
  const producer = { ...hosted, model: 'Qwen/Qwen3.5-9B' };
  const panel = { candidates: [openai, { ...hosted, id: google.id }, anthropic] };
  assert.throws(() => judgeCandidates(producer, panel), /independent judge families/);
  const source = generation(producer), judges = [judgment(source, openai), judgment(source, { ...hosted, id: 'hosted-openai-judge' })];
  const summary = summarizeRewrites([source], judges)[source.candidate_id];
  assert.equal(summary.safe, 0); assert.equal(summary.pending_judgments, 1);
});

test('new rows record upstream family and preserve host, requested model and usage', async () => {
  const candidate = { ...hosted, upstreamFamily: 'openai' };
  const row = await generateRewrite(fixture, candidate, 'Synthetic prompt', { complete: async () => ({
    text, effectiveModels: [candidate.model], durationMs: 1, attempts: 1, usage: { prompt_tokens: 4, completion_tokens: 5 } }) });
  assert.equal(row.provider, 'groq'); assert.equal(row.requested_model, candidate.model);
  assert.equal(row.upstream_family, 'openai'); assert.equal(row.family_evidence, 'declared');
  assert.equal(row.usage.prompt_tokens, 4);
  let calls = 0;
  const result = await judgeRewrite(fixture, row, google, { complete: async (judge, prompt) => {
    calls++;
    const value = prompt.includes('Meaning Preservation evaluator')
      ? '{"anchors":[],"pass_count":0,"total_count":0,"polarity_pass_count":0,"polarity_total_count":0,"mps":100}'
      : prompt.includes('Fidelity evaluator') ? '{"claims_preserved":3,"no_fabrication":3,"audience_register_match":3}' : '{"naturalness":3}';
    return { text: value, effectiveModels: [judge.model], durationMs: 1, attempts: 1 };
  } });
  assert.equal(calls, 3); assert.equal(result.status, 'ok');
  assert.equal(result.generator_upstream_family, 'openai'); assert.equal(result.judge_upstream_family, 'google');
  assert.equal(result.judge_provider, 'gemini');
});

test('direct generation and judging reject unknown, missing and self-family identities before calls', async () => {
  let calls = 0; const complete = async () => { calls++; throw new Error('must not call'); };
  await assert.rejects(generateRewrite(fixture, { ...hosted, model: 'opaque' }, 'prompt', { complete }), /Missing upstream family/);
  await assert.rejects(generateRewrite(fixture, { ...hosted, upstreamFamily: 'qwen' }, 'prompt', { complete }), /Contradictory/);
  await assert.rejects(judgeRewrite(fixture, generation(), openai, { complete }), /own family/);
  await assert.rejects(judgeRewrite(fixture, { ...generation(), upstream_family: 'qwen' }, google, { complete }), /Contradictory/);
  const missing = generation(); delete missing.upstream_family;
  await assert.rejects(judgeRewrite(fixture, missing, google, { complete }), /Missing hosted row/);
  assert.equal(calls, 0);
});

test('summary guards reject self-family and contradictory generator/judge metadata; legacy first-party rows still work', () => {
  const source = generation(), good = judgment(source, google);
  assert.throws(() => summarizeRewrites([source], [{ ...good, judge_provider: 'openai', judge_model: 'gpt-test', judge_upstream_family: 'openai' }]), /same-family/);
  assert.throws(() => validateJudgmentFamilies(source, { ...good, generator_upstream_family: 'qwen' }), /generator family/);
  assert.throws(() => validateJudgmentFamilies(source, { ...good, judge_upstream_family: 'openai' }), /Contradictory/);
  const legacy = { ...generation(openai) }; delete legacy.upstream_family; delete legacy.family_evidence;
  const judges = [google, anthropic].map((judge) => {
    const row = judgment(legacy, judge);
    for (const key of ['generator_upstream_family', 'generator_family_evidence', 'judge_upstream_family', 'judge_family_evidence']) delete row[key];
    return row;
  });
  assert.equal(summarizeRewrites([legacy], judges)[openai.id].safe, 1);
  assert.equal(summarizeRewrites([source], [good, judgment(source, anthropic)])[hosted.id].provider, 'groq');
});

test('benchmark preflight rejects a later unknown family before the first candidate is called', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'patina-family-preflight-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'protocol.json'), output = join(root, 'output');
  writeFileSync(path, JSON.stringify({ candidates: [...protocol.candidates, { ...hosted, model: 'opaque' }] }));
  await assert.rejects(main(['--live', '--candidates', path, '--output', output]), /Missing upstream family/);
  assert.equal(existsSync(output), false);
});

test('new study semantics hash the family helper', () => {
  const path = 'scripts/research/study-family.mjs';
  assert.equal(studySemantics(ROOT)[path], textHash(readFileSync(join(ROOT, path))));
});
