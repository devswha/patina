import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY, sha256, validateGeneration, validateHumanCandidate, selectIntake, diagnoseRecord, verifyPrivateCorpus, freezeShortGenerationPlan,
  counterfactuals, summarizeIntake, writePrivateCorpus } from '../../scripts/research/scorer-path-corpus.mjs';
import { safeCallRecord } from '../../scripts/research/study-journal.mjs';
import { createStudyInputs } from '../../scripts/research/study-inputs.mjs';
import { rewriteFixtures } from '../../scripts/research/model-rewrite-benchmark.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// These are synthetic test inputs, never study observations or human labels.
function generation() {
  const candidate = { id: 'unit-only', provider: 'unit-test', model: 'unit-model', transport: 'opencodex' };
  const fixture = { fixture_id: 'unit-source', text: 'Synthetic source.', language: 'en', register: 'social', documentType: 'social' };
  const prompt = 'Synthetic unit prompt.', protocolHash = sha256('unit protocol'), rewrite = 'Synthetic output — a unit test.';
  const logicalId = `${protocolHash}/${candidate.id}/${fixture.fixture_id}/0/rewrite`;
  const identity = { logicalId, index: 1, candidate, promptHash: sha256(prompt), temperature: .2, responseFormat: null, extraBody: null };
  const receipt = { schemaVersion: 1, state: 'completed', promptHash: sha256(prompt), requestHash: sha256(JSON.stringify(identity)),
    temperature: .2, schemaValid: true, response: { text: rewrite, effectiveModels: [candidate.model], durationMs: 1, attempts: 1 } };
  const row = { schemaVersion: 1, candidate_id: candidate.id, fixture_id: fixture.fixture_id, repeat: 0, protocol_hash: protocolHash,
    provider: candidate.provider, transport: candidate.transport, requested_model: candidate.model, status: 'ok',
    language: fixture.language, register: fixture.register, document_type: fixture.documentType,
    text_hash: sha256(fixture.text), prompt_hash: sha256(prompt), rewrite, rewrite_hash: sha256(rewrite), calls: [safeCallRecord(receipt, candidate)] };
  const { rewrite: _rewrite, ...publicRow } = row;
  return { row, publicRow, fixture, candidate, protocolHash, prompt, receipts: [receipt] };
}

test('generation provenance binds delivered text, original, request, candidate, ordinal and public row', () => {
  const input = generation();
  assert.equal(validateGeneration(input).model, 'unit-model');
  const mutations = [
    (x) => { x.row.rewrite = 'Substituted text.'; },
    (x) => { x.fixture.text = 'Substituted original.'; },
    (x) => { x.prompt += ' different'; },
    (x) => { x.candidate.model = 'another-unit-model'; },
    (x) => { x.row.repeat = 1; x.publicRow.repeat = 1; },
    (x) => { x.row.register = 'marketing'; x.publicRow.register = 'marketing'; },
    (x) => { x.receipts[0].requestHash = sha256('different ordinal'); },
    (x) => { x.receipts[0].response.text = 'Swapped delivered text.'; },
    (x) => { x.receipts[0].state = 'started'; },
    (x) => { x.receipts = []; },
    (x) => { x.publicRow.calls[0].modelIdentityVerified = false; },
  ];
  for (const mutate of mutations) {
    const value = globalThis.structuredClone(input); mutate(value);
    assert.throws(() => validateGeneration(value));
  }
});

test('matching a forged public identity flag does not override actual receipt model evidence', () => {
  const value = generation();
  value.receipts[0].response.effectiveModels = ['different-unit-model'];
  value.row.calls = [safeCallRecord(value.receipts[0], value.candidate)];
  value.publicRow.calls = globalThis.structuredClone(value.row.calls);
  assert.throws(() => validateGeneration(value), /identity is unverified/);
});

function human() {
  const text = 'Synthetic publisher excerpt for tests only.';
  const row = { sample_id: 'unit-human-candidate', language: 'en', register: 'chat-update', class: 'natural-human',
    text, text_hash: `sha256:${sha256(text)}`, source_url: 'https://example.test/source', source_license: 'rights unknown',
    source_review: { status: 'hash-only-web-candidate' } };
  const { text: _text, ...publicRow } = row;
  const source = { url: row.source_url, source_license: row.source_license, register: row.register };
  return { row, publicRow, source };
}

test('legacy human labels remain unknown authorship and unreviewed quality/rights', () => {
  const { row, publicRow, source } = human();
  assert.deepEqual(validateHumanCandidate(row, publicRow, source), { kind: 'public-web-candidate', generator: null,
    authorship: 'unknown', quality: 'needs-review', sourceVerification: 'existing-text-hash-and-source-record-bound', rights: 'needs-review' });
  for (const field of ['text_hash', 'source_url', 'source_license', 'sample_id']) {
    assert.throws(() => validateHumanCandidate({ ...row, [field]: 'tampered' }, publicRow, source));
  }
  assert.throws(() => validateHumanCandidate(row, publicRow, { ...source, source_license: 'permission invented' }));
});

function candidate(text, options = {}) {
  return { text, textHash: sha256(text), language: 'en', register: 'social', documentType: 'social',
    origin: { kind: 'model-generated', model: 'unit-model', recordKey: sha256(text), numberSafetyObservation: { ok: false } }, ...options };
}

test('deduplication retains every occurrence binding and never filters on quality', () => {
  const one = candidate('Unit source — retained despite a failed numeric proxy.');
  const duplicate = { ...one, origin: { ...one.origin, recordKey: 'repeat-two', numberSafetyObservation: { ok: true } } };
  const two = candidate('Another unit source.');
  const intake = selectIntake([duplicate, two, one]);
  assert.equal(intake.records.length, 2);
  assert.equal(intake.counts.deduplicatedOccurrences, 1);
  assert.equal(intake.records.find((row) => row.text === one.text).origins.length, 2);
  for (const record of intake.records) {
    assert.equal(record.labels.perceived_ai_polish, null);
    assert.equal(record.labels.expected_short_form_tells, null);
    assert.equal(record.labels.humanQuality, null);
    assert.equal(record.eligibleForClaims, false);
  }
  assert.deepEqual(intake, selectIntake([one, duplicate, two]));
});

test('whole-text bounds and hash-order cap are independent of source order', () => {
  const rows = [candidate('One.'), candidate('Two.'), candidate('Three.')];
  const policy = { ...POLICY, maxUniqueTexts: 2 };
  assert.deepEqual(selectIntake(rows, policy), selectIntake([...rows].reverse(), policy));
  const limits = selectIntake([candidate('x'.repeat(501)), candidate('😀'.repeat(500)), candidate('Out of register', { register: 'academic-summary' })]);
  assert.equal(limits.records.length, 1);
  assert.equal(limits.records[0].chars, 500);
  assert.deepEqual(limits.excluded.map((row) => row.reason), ['length-outside-intake', 'register-outside-intake']);
  assert.throws(() => selectIntake(rows, { ...POLICY, maxUniqueTexts: 0 }), /bounds/);
});

test('deduplicated cross-context and cross-origin text cannot acquire a false generator label', () => {
  const original = candidate('Same synthetic text.');
  const mixed = { ...original, register: 'chat-update', documentType: 'default', origin: { kind: 'public-web-candidate', recordKey: 'unit-human' } };
  const { records } = selectIntake([original, mixed]);
  assert.equal(records.length, 1);
  assert.equal(records[0].originKind, 'mixed-evidence');
  assert.equal(records[0].labels.generator, null);
  assert.equal(records[0].labels.register, null);
  assert.equal(diagnoseRecord(records[0], {}).status, 'context-conflict');
});

test('real scorer floor and zero diagnostics stay separate from unqualified FNR and human claims', () => {
  const inputs = createStudyInputs(ROOT, { env: {}, cwd: ROOT, sourceVoice: true });
  const intake = selectIntake([
    candidate('Unit check — keep this reply short.'),
    candidate('A plain synthetic reply.'),
    candidate('A source citation turn0search1 is exposed.'),
    candidate('A synthetic publisher control.', { register: 'chat-update', documentType: 'default', origin: { kind: 'public-web-candidate' } }),
  ]);
  const diagnostics = intake.records.map((row) => diagnoseRecord(row, inputs));
  const summary = summarizeIntake(intake, diagnostics, counterfactuals(intake.records, inputs));
  const dash = diagnostics.find((row) => row.textHash === sha256('Unit check — keep this reply short.'));
  assert.ok(dash.finalAtLlmZero > 0 && dash.finalAtLlmZero < 30);
  assert.equal(dash.shortFormEligible, true);
  assert.equal(summary.diagnostics.generatedOrigin.exactZeroAtLlmZero.numerator, 1);
  assert.equal(summary.diagnostics.generatedOrigin.exactZeroAtLlmZero.denominator, 3);
  assert.equal(summary.diagnostics.generatedOrigin.below30AtLlmZero.numerator, 2);
  assert.equal(summary.diagnostics.skippedEvidenceDiscarded, 0);
  assert.equal(summary.diagnostics.pairs.positiveDelta, 1);
  assert.ok(Object.values(summary.qualifiedMetrics).every((value) => value === null));
  assert.deepEqual(summary.gatesPromoted, []);
  assert.equal(summary.humanRatings, 0);
  assert.equal(summary.authenticatedHumanTexts, 0);
  assert.ok(diagnostics.every((row) => row.scoreTextOverall === null));
});

test('counterfactuals retain ignored quote/code and too-long contexts without relabeling origin', () => {
  const inputs = createStudyInputs(ROOT, { env: {}, cwd: ROOT, sourceVoice: true });
  const intake = selectIntake([
    candidate('The command is `unit — test`.'), candidate('She said "unit — test" today.'),
    candidate(`Unit ${'long '.repeat(55)}— test.`), candidate('No dash in this test.'),
  ]);
  const pairs = counterfactuals(intake.records, inputs);
  assert.equal(pairs.length, 3);
  assert.ok(pairs.every((row) => row.pairedScoreDeltaAtLlmZero === 0 && !row.meaningReviewed && !row.eligibleForClaims));
  assert.ok(pairs.every((row) => sha256(row.variantText) === row.variantTextHash && row.kind === 'deterministic-punctuation-variant'));
});

test('empty qualified denominator is null; source candidate data cannot create an FPR', () => {
  const summary = summarizeIntake(selectIntake([]), [], []);
  assert.equal(summary.diagnostics.generatedOrigin.exactZeroAtLlmZero.rate, null);
  assert.equal(summary.qualifiedMetrics.short_social_human_false_positive_rate, null);
});

test('parent-only generation plan freezes 12 calls and exact prompts without publishing source text', () => {
  const protocol = { candidates: [{ id: 'gemini-3.7', provider: 'gemini', transport: 'opencodex', model: 'synthetic-unit-model' }] };
  const fixtures = ['en', 'ko'].flatMap((language) => ['social', 'marketing'].map((register) => ({
    fixture_id: `unit-${language}-${register}`, language, register, text: `PRIVATE_UNIT_SOURCE_${language}_${register}`,
  })));
  const plan = freezeShortGenerationPlan(protocol, fixtures);
  assert.equal(plan.requiredGenerationCalls, 12);
  assert.equal(plan.additionalScoreOrJudgeCalls, 0);
  assert.equal(plan.maxTransportAttemptsPerCall, 1);
  assert.equal(plan.status, 'frozen-awaiting-parent-execution');
  assert.ok(!JSON.stringify(plan).includes('PRIVATE_UNIT_SOURCE'));
  assert.deepEqual(plan, freezeShortGenerationPlan(protocol, [...fixtures].reverse()));
  const changed = globalThis.structuredClone(fixtures); changed[0].text += ' Changed.';
  assert.notEqual(freezeShortGenerationPlan(protocol, changed).planHash, plan.planHash);
  assert.throws(() => freezeShortGenerationPlan(protocol, fixtures.slice(1)));
  assert.throws(() => freezeShortGenerationPlan({ candidates: [{ ...protocol.candidates[0], transport: 'direct-api' }] }, fixtures));
});

test('generation prompts preserve literal replacement-dollar sequences in source text', () => {
  const protocol = { candidates: [{ id: 'gemini-3.7', provider: 'gemini', transport: 'opencodex', model: 'synthetic-unit-model' }] };
  for (const sequence of ['$&', '$`', "$'", '$$', '$1', '$<name>']) {
    const fixtures = ['en', 'ko'].flatMap((language) => ['social', 'marketing'].map((register) => ({
      fixture_id: `unit-${language}-${register}`, language, register,
      text: `Synthetic "${sequence}" source.\nKeep ${sequence} literal.`,
    })));
    const plan = freezeShortGenerationPlan(protocol, fixtures);
    for (const fixture of fixtures) {
      const [before, after] = plan.promptTemplate.replace('{register}', fixture.register)
        .replace('{language}', fixture.language).split('{sourceJson}');
      const expectedPrompt = before + JSON.stringify(fixture.text) + after;
      const source = plan.sources.find((row) => row.fixtureId === fixture.fixture_id);
      assert.equal(source.sourceTextHash, sha256(fixture.text));
      assert.equal(source.promptHash, sha256(expectedPrompt), `${fixture.fixture_id}: ${sequence}`);
    }
  }
});

test('existing four source prompt hashes and frozen 12-call plan remain unchanged', () => {
  const protocol = JSON.parse(readFileSync(resolve(ROOT, 'docs/research/model-evaluation-20260904.json'), 'utf8'));
  const published = JSON.parse(readFileSync(resolve(ROOT, 'docs/research/scorer-path-corpus-20260905.json'), 'utf8'));
  const plan = freezeShortGenerationPlan(protocol, rewriteFixtures('full', ROOT));
  assert.equal(plan.sources.length, 4);
  assert.deepEqual(plan, published.optionalGenerationPlan);
});

test('private output uses restrictive permissions, content hashes and refuses to overwrite', { skip: process.platform === 'win32' && 'research private-output 0700 enforcement is POSIX-only; tool stays fail-closed on win32' }, () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'scorer-corpus-unit-'));
  try {
    const output = resolve(directory, 'private'), secret = Buffer.from('Synthetic private text marker.');
    const result = { evidence: { files: new Map([[sha256(secret), secret]]), paths: new Map() },
      summary: { rows: 1 }, intake: { text: secret.toString() }, diagnostics: [], pairs: [] };
    writePrivateCorpus(result, output);
    assert.equal(readFileSync(resolve(output, '.gitignore'), 'utf8'), '*\n');
    assert.equal(statSync(output).mode & 0o777, 0o700);
    assert.equal(statSync(resolve(output, 'intake.private.json')).mode & 0o777, 0o600);
    assert.equal(sha256(readFileSync(resolve(output, 'evidence', sha256(secret)))), sha256(secret));
    assert.ok(!readFileSync(resolve(output, 'summary.json'), 'utf8').includes(secret.toString()));
    assert.throws(() => writePrivateCorpus(result, output));
    const occupied = resolve(directory, 'occupied'); mkdirSync(occupied); writeFileSync(resolve(occupied, 'existing'), 'untouched');
    assert.throws(() => writePrivateCorpus(result, occupied));
    assert.deepEqual(readdirSync(occupied), ['existing']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('private integrity verification detects swapped evidence, changed text, exclusion drift and public-summary mismatch', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'scorer-corpus-integrity-unit-'));
  const objectHash = (value) => sha256(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item));
  try {
    const output = resolve(directory, 'private'), bytes = Buffer.from('Synthetic receipt bytes.');
    const intake = selectIntake([candidate('Synthetic private text.', { origin: { kind: 'model-generated',
      model: 'unit-model', sourceText: { sha256: sha256(bytes), bytes: bytes.length } } })]);
    const summary = { intakeHash: objectHash(intake), manifestHash: objectHash(intake.records), diagnosticsHash: objectHash([]), pairsHash: objectHash([]) };
    writePrivateCorpus({ evidence: { files: new Map([[sha256(bytes), bytes]]), paths: new Map() }, summary, intake, diagnostics: [], pairs: [] }, output);
    assert.equal(verifyPrivateCorpus(output, summary).verified, true);
    assert.throws(() => verifyPrivateCorpus(output, { ...summary, manifestHash: sha256('unrelated corpus') }), /public summary/);
    const receiptPath = resolve(output, 'evidence', sha256(bytes));
    writeFileSync(receiptPath, 'Swapped receipt.');
    assert.throws(() => verifyPrivateCorpus(output, summary), /evidence bytes differ/);
    writeFileSync(receiptPath, bytes);
    const path = resolve(output, 'intake.private.json'), original = readFileSync(path);
    const altered = globalThis.structuredClone(intake); altered.records[0].text += ' Changed.';
    writeFileSync(path, JSON.stringify(altered));
    assert.throws(() => verifyPrivateCorpus(output, summary), /binding differs/);
    altered.records = intake.records; altered.excluded.push({ reason: 'quality-filtered' });
    writeFileSync(path, JSON.stringify(altered));
    assert.throws(() => verifyPrivateCorpus(output, summary), /binding differs/);
    writeFileSync(path, original); rmSync(receiptPath);
    assert.throws(() => verifyPrivateCorpus(output, summary), /Missing bound private evidence/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
