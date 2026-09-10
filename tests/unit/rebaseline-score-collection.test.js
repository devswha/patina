import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLexicon } from '../../src/features/lexicon.js';
// Source hashes are part of the behavior under test. A private source copy
// keeps concurrent repository tests from changing this suite's frozen inputs.
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = fs.mkdtempSync(resolve(tmpdir(), 'patina-rebaseline-test-source-'));
for (const name of ['package.json', '.patina.default.yaml', 'src', 'patterns', 'core', 'document-types', 'lexicon', 'personas', 'scripts/research', 'tests/quality']) {
  const destination = resolve(ROOT, name); fs.mkdirSync(dirname(destination), { recursive: true });
  fs.cpSync(resolve(SOURCE_ROOT, name), destination, { recursive: true });
}
fs.symlinkSync(resolve(SOURCE_ROOT, 'node_modules'), resolve(ROOT, 'node_modules'), 'dir');
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const { hash, collectRebaselineScores, replayCollection, loadNullableIntake, loadProcessingApproval, validateApprovals, persistPrivate, boundedCompletion, main } =
  await import(pathToFileURL(resolve(ROOT, 'scripts/research/collect-rebaseline-scores.mjs')).href);
const { getStudyCancellationSignal } = await import(pathToFileURL(resolve(ROOT, 'scripts/research/model-evaluation-transport.mjs')).href);
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const canonical = value => hash(sort(value));
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const write = (path, value) => fs.writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
const paths = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(item => item.isDirectory() ? paths(resolve(root, item.name)) : [resolve(root, item.name)]);
const candidate = { id: 'unit-collector', provider: 'openai', transport: 'opencodex', baseURL: 'http://127.0.0.1:10100/v1', model: 'unit-test-model' };
function setup(t, count = 1) {
  const root = fs.mkdtempSync(resolve(tmpdir(), 'patina-rebaseline-collector-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = resolve(root, 'intake'); fs.mkdirSync(resolve(intake, 'evidence'), { recursive: true, mode: 0o700 });
  const records = Array.from({ length: count }, (_, i) => {
    const text = `The train leaves at noon. I packed ${i + 1} bag for the trip.`;
    return { id: `unit-${i}`, text, textHash: hash(text), language: 'en', documentType: 'default', register: 'source-declared',
      origins: [{ kind: 'unknown', evidenceHash: hash('unit evidence') }], originKind: 'unknown',
      expected_hot: null, labels: { generator: null, humanQuality: null, expected_short_form_tells: null },
      rights: { status: 'needs-review', sharing: 'private' }, eligibleForClaims: false };
  });
  const sourceIndex = { 'unit-evidence': { sha256: hash('unit evidence'), bytes: Buffer.byteLength('unit evidence') } };
  const data = { records, excluded: [], counts: { retained: records.length } };
  fs.writeFileSync(resolve(intake, 'evidence', hash('unit evidence')), 'unit evidence', { mode: 0o600 });
  write(resolve(intake, 'intake.private.json'), data); write(resolve(intake, 'source-index.private.json'), sourceIndex);
  write(resolve(intake, 'summary.json'), { intakeHash: canonical(data), manifestHash: canonical(records) });
  const protocol = resolve(root, 'protocol.json'); write(protocol, { schemaVersion: 1, candidates: [candidate] });
  const approvals = resolve(root, 'approval.private.json');
  const approval = { schemaVersion: 1, intakeHash: canonical(data), candidateHash: hash(candidate), decisions: records.map(record => ({
    textHash: record.textHash, sourceEvidenceHash: canonical(record.origins), decision: 'approved', reviewer: 'unit-test-only', reviewedAt: '2026-09-05T00:00:00Z',
    provider: candidate.provider, transport: candidate.transport, model: candidate.model, permittedLocalAnalysis: true, permittedProviderProcessing: true,
    retention: 'private-only', publication: 'summary-only' })) };
  write(approvals, approval);
  return { root, records, approval, options: { intake, protocol, protocolSha256: hash(fs.readFileSync(protocol)), candidateId: candidate.id,
    config: resolve(ROOT, '.patina.default.yaml'), approvals, output: resolve(root, 'output'), maxCalls: count * 2, timeoutMs: 60000, live: true } };
}
const valid = (model = candidate.model, overall = 5) => ({ text: JSON.stringify({ overall, categories: { content: { detected: 0, sum: 0, max: 30, score: 0, weighted: 0 } } }),
  effectiveModels: [model], usage: { prompt_tokens: 10, completion_tokens: 10 }, attempts: 1, durationMs: 2 });

function resume(options, live = true) { return { output: options.output, resume: true, live }; }

test('nullable intake verifies bytes and evidence without inventing human or generator labels', t => {
  const { options, records } = setup(t);
  const bundle = loadNullableIntake(options.intake);
  assert.deepEqual(bundle.intake.records[0].labels, records[0].labels);
  assert.equal(bundle.intake.records[0].expected_hot, null);
  fs.writeFileSync(resolve(options.intake, 'evidence', hash('unit evidence')), 'changed');
  assert.throws(() => loadNullableIntake(options.intake), /evidence mismatch/);
});

// The research collector prepares its private output directory with POSIX
// 0700 permissions and fails closed when they do not hold
// (collect-rebaseline-scores.mjs). win32 has no POSIX mode bits, so every
// test that reaches output preparation fails there by design — the tool
// stays fail-closed on Windows. These skips are absent coverage, not passes;
// the validation-only tests in this file still run on win32.
const POSIX_PRIVATE_OUTPUT_SKIP = process.platform === 'win32'
  ? 'research private-output 0700 enforcement is POSIX-only; tool stays fail-closed on win32'
  : false;

test('no opt-in means no call; snapshots preserve exact private inputs and loaded resources', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, records } = setup(t);
  const report = await collectRebaselineScores({ ...options, live: false }, { complete: async () => assert.fail('not opted in') });
  assert.equal(report.attempted, 0);
  const snapshot = read(resolve(options.output, 'snapshot.private.json'));
  assert.deepEqual(snapshot.records, records);
  assert.equal(snapshot.inputs.configSource.ambientOverrides, false);
  assert.ok(snapshot.prompts[records[0].textHash].includes(records[0].text));
  assert.deepEqual(snapshot.inputs.lexicons.en, JSON.parse(JSON.stringify(loadLexicon('en', ROOT))));
  assert.ok(snapshot.inputs.prepared[records[0].textHash].deterministicScore.bands);
  assert.equal(fs.readFileSync(resolve(options.output, '.gitignore'), 'utf8'), '*\n');
  for (const path of paths(options.output)) assert.equal(fs.statSync(path).mode & 0o777, 0o600);
});

test('missing, unknown, denied and route-mismatched approvals never dispatch', async t => {
  for (const variant of ['missing', 'unknown', 'blocked', 'wrong-route', 'wrong-evidence']) {
    const { options, approval } = setup(t);
    if (variant === 'missing') fs.unlinkSync(options.approvals);
    else {
      if (['unknown', 'blocked'].includes(variant)) { approval.decisions[0].decision = variant; options.maxCalls = 0; }
      if (variant === 'wrong-route') approval.decisions[0].model = 'another-model';
      if (variant === 'wrong-evidence') approval.decisions[0].sourceEvidenceHash = hash('other evidence');
      write(options.approvals, approval);
    }
    await assert.rejects(collectRebaselineScores(options, { complete: async () => assert.fail('unapproved processing') }));
  }
});

test('mixed admission freezes the full denominator and preserves nullable labels', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, approval, records } = setup(t, 2);
  approval.decisions[1].decision = 'unknown'; options.maxCalls = 2; write(options.approvals, approval);
  let calls = 0;
  const report = await collectRebaselineScores(options, { complete: async () => { calls++; return valid(); } });
  assert.equal(calls, 1); assert.equal(report.denominator, 2); assert.equal(report.approved, 1); assert.equal(report.excluded, 1);
  const row = read(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
  assert.equal(row.expected_hot, null); assert.equal(row.class, null);
  assert.ok(row.productionResult.llmScore); assert.ok(row.productionResult.deterministicScore);
  assert.equal(report.classificationMetrics, null);
  assert.doesNotMatch(JSON.stringify(report), /\b(?:FNR|FPR|AUC|accuracy|precision|recall)\b/i);
  assert.ok(report.languages.en.packs.content);
  assert.equal(report.languages.en.packs['viral-hook'].missing, 1);
});

test('completed observations replay offline byte-for-byte; resume never pays for them again', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options } = setup(t, 2); let calls = 0;
  await collectRebaselineScores(options, { complete: async () => { calls++; return valid(); } });
  assert.equal(calls, 2);
  const before = Object.fromEntries(paths(options.output).map(path => [path, hash(fs.readFileSync(path))]));
  const replay = await replayCollection(options.output);
  assert.equal(replay.fullObservedReplay, true); assert.equal(replay.attempted, 2);
  assert.deepEqual(Object.fromEntries(paths(options.output).map(path => [path, hash(fs.readFileSync(path))])), before);
  await collectRebaselineScores(resume(options), { complete: async () => assert.fail('already paid') });
});

test('production JSON retry is retained, while valid-JSON schema failure is a separate missing score', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options } = setup(t, 2); const temperatures = [];
  const report = await collectRebaselineScores(options, { complete: async (_candidate, _prompt, args) => {
    temperatures.push(args.temperature);
    if (temperatures.length === 1) return { ...valid(), text: 'not JSON' };
    if (temperatures.length === 3) return { ...valid(), text: JSON.stringify({ overall: 0, categories: { content: { detected: 999, sum: 0, max: 1, score: 0, weighted: 0 } } }) };
    return valid();
  } });
  assert.deepEqual(temperatures, [.1, 0, .1]);
  assert.equal(report.valid, 1); assert.equal(report.errors, 1); assert.equal(report.distributions.rawLlm.n, 1);
  assert.equal(report.errorClasses['score-schema-failure'], 1);
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
});

test('transport failures remain errors and missing scores, with no transport retry', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options } = setup(t); let calls = 0;
  const report = await collectRebaselineScores(options, { complete: async () => { calls++; throw new Error('HTTP 429'); } });
  assert.equal(calls, 1); assert.equal(report.valid, 0); assert.equal(report.distributions.overall.n, 0);
  assert.equal(report.errorClasses['provider-rate-limited (HTTP 429)'], 1);
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
});

test('snapshot/row/receipt changes and missing parser receipts reject before any resumed paid call', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  for (const variant of ['snapshot', 'row', 'wire', 'missing-parser-call']) {
    const { options, records } = setup(t); let count = 0;
    await collectRebaselineScores(options, { complete: async () => (++count === 1 && variant === 'missing-parser-call' ? { ...valid(), text: 'malformed' } : valid()) });
    if (variant === 'snapshot') {
      const path = resolve(options.output, 'snapshot.private.json'), data = read(path); data.inputs.config.language = 'zh'; write(path, data);
    } else if (variant === 'row') {
      const path = resolve(options.output, 'rows', `${records[0].textHash}.private.json`), data = read(path); data.overall = 99; write(path, data);
    } else if (variant === 'wire') {
      const path = paths(resolve(options.output, 'wire'))[0], data = read(path); data.response.text = '{}'; write(path, data);
    } else {
      for (const kind of ['calls', 'wire']) for (const path of paths(resolve(options.output, kind)).filter(path => path.endsWith('2.private.json'))) fs.unlinkSync(path);
      const progressPath = resolve(options.output, 'progress.private.json'), progress = read(progressPath);
      progress.entries[records[0].textHash] = { state: 'started' }; write(progressPath, progress);
      fs.unlinkSync(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
    }
    await assert.rejects(collectRebaselineScores(resume(options), { complete: async () => assert.fail('unrecorded paid replay') }));
  }
});

test('persistence failure before dispatch pays nothing; after dispatch it stops and blocks paid resume', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  for (const phase of ['started', 'completed']) {
    const { options } = setup(t, 2); let calls = 0;
    await assert.rejects(collectRebaselineScores(options, {
      complete: async () => { calls++; return valid(); },
      persist: (path, value) => { if (path.includes('/wire/') && value.state === phase) throw new Error('disk full'); persistPrivate(path, value); },
    }), /persistence/);
    assert.equal(calls, phase === 'started' ? 0 : 1);
    await assert.rejects(collectRebaselineScores(resume(options), { complete: async () => assert.fail('unresolved paid call') }));
  }
});

test('completed paid receipts can recover a missing row offline after row persistence failure', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options } = setup(t); let calls = 0;
  await assert.rejects(collectRebaselineScores(options, { complete: async () => { calls++; return valid(); },
    persist: (path, value) => { if (path.includes('/rows/')) throw new Error('disk full'); persistPrivate(path, value); } }), /persistence/);
  const report = await collectRebaselineScores(resume(options), { complete: async () => assert.fail('recovery must use receipts') });
  assert.equal(calls, 1); assert.equal(report.valid, 1);
});

test('secrets reject preparation or response capture; no redacted full-replay claim', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const secret = 'sk-' + 'x'.repeat(32);
  const a = setup(t); a.options.config = resolve(a.root, 'secret.yaml'); fs.writeFileSync(a.options.config, `api_key: ${secret}\n`);
  await assert.rejects(collectRebaselineScores(a.options, { complete: async () => assert.fail('secret config') }), /secret/);
  const b = setup(t); let calls = 0;
  await assert.rejects(collectRebaselineScores(b.options, { complete: async () => { calls++; return { ...valid(), text: secret }; } }), /rejected/);
  assert.equal(calls, 1);
  for (const path of paths(b.options.output)) assert.ok(!fs.readFileSync(path, 'utf8').includes(secret));
  await assert.rejects(replayCollection(b.options.output));
});

test('Gemini direct API candidates, protocol drift, unknown CLI flags and unsafe output paths reject', async t => {
  const { options } = setup(t);
  write(options.protocol, { candidates: [{ ...candidate, provider: 'gemini', model: 'gemini-unit', transport: 'http', baseURL: 'https://example.invalid', apiKeyEnv: 'GEMINI_API_KEY' }] });
  await assert.rejects(collectRebaselineScores(options), /protocol hash/);
  options.protocolSha256 = hash(fs.readFileSync(options.protocol));
  await assert.rejects(collectRebaselineScores(options), /OpenCodex/);
  await assert.rejects(main(['--output', options.output, '--env-file', 'forbidden']), /unknown/);
  const b = setup(t); fs.symlinkSync(b.root, b.options.output);
  await assert.rejects(collectRebaselineScores(b.options), /symlink/);
});

test('the bounded HTTP path sends once even for temperature rejection and captures credential-free bodies', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let calls = 0, observed;
  globalThis.fetch = async (_url, options) => {
    calls++; assert.equal(options.redirect, 'error');
    return new Response('temperature is unsupported', { status: 400 });
  };
  await assert.rejects(boundedCompletion(candidate, 'unit prompt', { temperature: .1, timeoutMs: 1000 }, value => { observed = value; }), /HTTP 400/);
  assert.equal(calls, 1); assert.equal(observed.httpStatus, 400);
  assert.equal(observed.requestBody.temperature, .1);
  assert.ok(!JSON.stringify(observed).includes('Authorization'));
});

test('opt-in is boolean and the bound includes every production parser invocation', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const a = setup(t);
  const report = await collectRebaselineScores({ ...a.options, live: 'false' }, { complete: async () => assert.fail('string is not opt-in') });
  assert.equal(report.attempted, 0);
  const b = setup(t);
  await assert.rejects(collectRebaselineScores({ ...b.options, maxCalls: 3 }, { complete: async () => assert.fail('oversized budget') }), /call bound/);
  let calls = 0;
  await assert.rejects(collectRebaselineScores({ ...b.options, maxCalls: 1 }, { complete: async () => { calls++; return { ...valid(), text: 'malformed' }; } }), /budget exhausted/);
  assert.equal(calls, 1);
  await assert.rejects(collectRebaselineScores(resume(b.options), { complete: async () => assert.fail('budget cannot grow on resume') }));
});

test('observed partial error metadata survives replay without a new invocation', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options } = setup(t);
  const report = await collectRebaselineScores(options, { complete: async () => {
    const error = new Error('CLI failed');
    error.studyResult = { effectiveModels: [], identityEvidence: 'unverified', usage: { prompt_tokens: 9, completion_tokens: 0 }, attempts: 1 };
    throw error;
  } });
  assert.equal(report.errors, 1);
  const replay = await replayCollection(options.output);
  assert.equal(replay.fullObservedReplay, true);
});

test('native profile admission remains distinct from server model verification', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, approval, records } = setup(t);
  const native = { id: 'unit-native', provider: 'kimi', transport: 'kimi-cli', model: 'kimi-code/kimi-for-coding' };
  write(options.protocol, { schemaVersion: 1, candidates: [native] });
  options.protocolSha256 = hash(fs.readFileSync(options.protocol)); options.candidateId = native.id;
  approval.candidateHash = hash(native);
  Object.assign(approval.decisions[0], { provider: native.provider, transport: native.transport, model: native.model });
  write(options.approvals, approval);
  const report = await collectRebaselineScores(options, { complete: async selected => {
    assert.deepEqual(selected, native);
    return { ...valid(native.model), identityEvidence: 'cli-request-trace', usageEvidence: 'cli-session-trace', effectiveTemperature: null };
  } });
  assert.equal(report.valid, 1);
  const row = read(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
  assert.equal(row.calls[0].profileIdentityVerified, true);
  assert.equal(row.calls[0].modelIdentityVerified, false);
  const snapshot = read(resolve(options.output, 'snapshot.private.json'));
  assert.equal(snapshot.budgetUnit, 'CLI-invocation');
  assert.equal(snapshot.nativeUpstreamAttemptCountVerified, false);
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
});

test('dataset genre and delivery register remain separate; source labels never label new targets', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, records, approval, root } = setup(t, 4);
  const genres = ['social', 'marketing', 'chat-update', 'chat-update'];
  const documentTypes = ['social', 'marketing', undefined, 'casual-conversation'];
  records.forEach((record, i) => {
    record.register = genres[i];
    if (documentTypes[i]) record.documentType = documentTypes[i]; else delete record.documentType;
    record.labels.registerStatus = 'source-declared-unreviewed';
    record.expected_hot = i % 2 === 0; record.class = i % 2 === 0 ? 'ai' : 'natural';
    record.origins[0].originalFixtureExpectedHot = true;
    approval.decisions[i].sourceEvidenceHash = canonical(record.origins);
  });
  const intake = read(resolve(options.intake, 'intake.private.json')); intake.records = records;
  write(resolve(options.intake, 'intake.private.json'), intake);
  const summary = read(resolve(options.intake, 'summary.json'));
  summary.intakeHash = canonical(intake); summary.manifestHash = canonical(records);
  write(resolve(options.intake, 'summary.json'), summary);
  approval.intakeHash = summary.intakeHash; write(options.approvals, approval);
  const config = fs.readFileSync(options.config, 'utf8').replace(/^register:.*$/m, 'register: professional');
  options.config = resolve(root, 'pinned-delivery-register.yaml'); fs.writeFileSync(options.config, config);
  const report = await collectRebaselineScores(options, { complete: async () => valid() });
  assert.equal(report.valid, 4); assert.equal(report.classificationMetrics, null);
  const snapshot = read(resolve(options.output, 'snapshot.private.json'));
  assert.ok(Object.values(snapshot.targetLabels).every(value => value === null));
  assert.deepEqual(snapshot.records.map(record => record.expected_hot), [true, false, true, false]);
  records.forEach((record, i) => {
    const row = read(resolve(options.output, 'rows', `${record.textHash}.private.json`));
    assert.equal(row.register, 'professional');
    assert.equal(row.datasetGenre.value, genres[i]);
    assert.equal(row.datasetGenre.reviewStatus, 'source-declared-unreviewed');
    assert.equal(row.expected_hot, null); assert.equal(row.class, null);
    assert.equal(row.documentTypeSelection.value, documentTypes[i] ?? 'default');
    assert.equal(row.documentTypeSelection.source, documentTypes[i] ? 'intake.documentType' : 'pinned-config');
    assert.equal(row.documentTypeSelection.inferredFromGenreByCollector, false);
    assert.equal(snapshot.inputs.prepared[record.textHash].config.register, 'professional');
  });
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
});

test('a dataset genre in pinned config.register is rejected instead of treated as delivery register', async t => {
  const { options, root } = setup(t);
  const config = fs.readFileSync(options.config, 'utf8').replace(/^register:.*$/m, 'register: marketing');
  options.config = resolve(root, 'invalid-register.yaml'); fs.writeFileSync(options.config, config);
  await assert.rejects(collectRebaselineScores(options, { complete: async () => assert.fail('invalid register cannot dispatch') }), /delivery-register axis/);
});

function parentSetup(t, count = 2) {
  const base = setup(t, count), { options, root, records } = base;
  const gemini = { id: 'gemini-3.7', provider: 'gemini', transport: 'opencodex', baseURL: 'http://127.0.0.1:10100/v1', model: 'google-antigravity/gemini-3.7-flash' };
  records.forEach(record => {
    record.origins[0].sourceUrl = 'https://source.invalid/DO_NOT_SEND_SOURCE_URL';
    record.origins[0].priorReceipt = { prompt: 'DO_NOT_SEND_PRIOR_PROMPT', text: 'DO_NOT_SEND_PRIOR_RECEIPT' };
    record.origins[0].fullSourceDocument = 'DO_NOT_SEND_FULL_SOURCE_DOCUMENT';
    record.labels.generator = ['DO_NOT_SEND_GENERATOR_ID'];
  });
  const intake = read(resolve(options.intake, 'intake.private.json')); intake.records = records;
  write(resolve(options.intake, 'intake.private.json'), intake);
  const summary = read(resolve(options.intake, 'summary.json'));
  summary.intakeHash = canonical(intake); summary.manifestHash = canonical(records);
  write(resolve(options.intake, 'summary.json'), summary);
  const payloadBoundary = 'Only approved text and necessary scoring instructions; no provenance metadata.';
  const review = { schemaVersion: 1, status: 'pending-parent-review-before-any-live-call', scope: { id: 'private-benchmark-scoring-only', allowedCorpusSize: count, payloadBoundary },
    bundle: { intakeSemanticHash: summary.intakeHash, manifestHash: summary.manifestHash,
      fileSha256: Object.fromEntries(['intake.private.json', 'summary.json', 'source-index.private.json'].map(name => [name, hash(fs.readFileSync(resolve(options.intake, name)))])) },
    summary: { parentApprovalRecorded: false, noCallsAuthorizedByThisWorker: true },
    records: records.map(record => ({ textHash: record.textHash, recordId: record.id, decision: 'approve', scope: 'private-benchmark-scoring-only',
      parentReviewRequiredBeforeLiveCall: true, deferredReasons: [], bindingEvidence: { verified: true },
      preservedMetadata: Object.fromEntries(['language', 'register', 'documentType', 'chars', 'originKind', 'contextConflict', 'rights', 'labels', 'eligibleForClaims'].filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])) })) };
  const reviewPath = resolve(root, 'processing-review.private.json'); write(reviewPath, review);
  const parent = { schemaVersion: 1, status: 'parent-approved-for-private-benchmark-scoring', parentApproved: true, approvedAt: '2026-09-05T00:00:00Z',
    reviewPath, reviewHash: hash(fs.readFileSync(reviewPath)), scope: 'private-benchmark-scoring-only', authority: 'synthetic unit-test parent approval',
    approvedTextHashes: records.map(record => record.textHash).reverse(), candidate: gemini, logicalObservationLimit: count, repeats: 1,
    retryPolicy: 'Only bounded receipted parser retries; no quality replacements', payloadBoundary,
    unknownsPreserved: { humanQuality: null, perceivedAiPolish: null, expectedShortFormTells: null, editingActor: null, editDepth: null, eligibleForClaims: false, classifierTruthAssigned: false, humanRatingsCreated: 0 },
    notAuthorized: ['raw-publication', 'training-or-finetuning-job', 'changed-or-unlisted-texts', 'human-authorship-or-quality-labels'] };
  write(options.protocol, { schemaVersion: 1, candidates: [gemini] }); options.protocolSha256 = hash(fs.readFileSync(options.protocol)); options.candidateId = gemini.id;
  write(options.approvals, parent);
  const config = fs.readFileSync(options.config, 'utf8') + '\nauditOnly: DO_NOT_SEND_UNRELATED_CONFIG\n';
  options.config = resolve(root, 'parent-pinned-config.yaml'); fs.writeFileSync(options.config, config);
  return { ...base, gemini, parent, review, reviewPath };
}

test('parent approval is consumed losslessly and only approved text/scoring instructions reach HTTP', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, parent, reviewPath, records, gemini } = parentSetup(t);
  const approvalBytes = fs.readFileSync(options.approvals, 'utf8'), reviewBytes = fs.readFileSync(reviewPath, 'utf8');
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const sentTexts = [];
  globalThis.fetch = async (url, request) => {
    assert.equal(url, gemini.baseURL + '/chat/completions');
    const body = JSON.parse(request.body);
    assert.deepEqual(Object.keys(body), ['model', 'messages', 'temperature']);
    assert.equal(body.model, gemini.model); assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    const matches = records.filter(record => body.messages[0].content.includes(record.text));
    assert.equal(matches.length, 1); sentTexts.push(matches[0].textHash);
    for (const marker of ['DO_NOT_SEND_SOURCE_URL', 'DO_NOT_SEND_PRIOR_PROMPT', 'DO_NOT_SEND_PRIOR_RECEIPT', 'DO_NOT_SEND_FULL_SOURCE_DOCUMENT', 'DO_NOT_SEND_GENERATOR_ID', 'DO_NOT_SEND_UNRELATED_CONFIG', 'DO_NOT_SEND_PRIOR_COMPLETION', 'sourceIndex', 'approvedTextHashes', 'reviewHash']) assert.ok(!request.body.includes(marker));
    return new Response(JSON.stringify({ model: gemini.model, usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { content: sentTexts.length === 1 ? 'DO_NOT_SEND_PRIOR_COMPLETION' : valid().text } }] }), { status: 200 });
  };
  const report = await collectRebaselineScores(options);
  assert.equal(report.attempted, records.length); assert.equal(report.valid, records.length);
  assert.deepEqual(sentTexts, [parent.approvedTextHashes[0], ...parent.approvedTextHashes]);
  const snapshot = read(resolve(options.output, 'snapshot.private.json'));
  assert.deepEqual(snapshot.approvals, parent);
  assert.equal(snapshot.approvalSource.approvalBytes, approvalBytes);
  assert.equal(snapshot.approvalSource.approvalSha256, hash(approvalBytes));
  assert.equal(snapshot.approvalSource.reviewBytes, reviewBytes);
  assert.equal(snapshot.approvalSource.reviewSha256, parent.reviewHash);
  assert.deepEqual(snapshot.matrix, parent.approvedTextHashes);
  assert.equal(JSON.parse(snapshot.approvalSource.reviewBytes).summary.parentApprovalRecorded, false);
  assert.ok(snapshot.records.every(record => record.rights.status === 'needs-review' && record.labels.humanQuality === null));
  assert.ok(Object.values(snapshot.targetLabels).every(value => value === null));
  globalThis.fetch = async () => assert.fail('offline replay must not send a request');
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
  assert.equal(fs.readFileSync(options.approvals, 'utf8'), approvalBytes);
  assert.equal(fs.readFileSync(reviewPath, 'utf8'), reviewBytes);
});

test('parent/review mismatches, deferred decisions, changed texts and expanded passes cannot dispatch', async t => {
  for (const variant of ['no-parent', 'review-hash', 'deferred', 'duplicate-hash', 'unlisted-hash', 'route', 'repeat', 'limit', 'provenance', 'bundle-bytes']) {
    const { options, parent, review, reviewPath } = parentSetup(t);
    if (variant === 'no-parent') parent.parentApproved = false;
    if (variant === 'review-hash') parent.reviewHash = hash('not the review');
    if (variant === 'duplicate-hash') parent.approvedTextHashes[1] = parent.approvedTextHashes[0];
    if (variant === 'unlisted-hash') parent.approvedTextHashes[0] = hash('unlisted text');
    if (variant === 'route') parent.candidate.model = 'google-antigravity/gemini-3.8-flash-low';
    if (variant === 'repeat') parent.repeats = 2;
    if (variant === 'limit') parent.logicalObservationLimit++;
    if (variant === 'deferred' || variant === 'provenance') {
      if (variant === 'deferred') review.records[0].decision = 'defer';
      else review.records[0].preservedMetadata.rights.status = 'newly-certified';
      write(reviewPath, review); parent.reviewHash = hash(fs.readFileSync(reviewPath));
    }
    if (variant === 'bundle-bytes') fs.appendFileSync(resolve(options.intake, 'summary.json'), '\n');
    write(options.approvals, parent);
    await assert.rejects(collectRebaselineScores(options, { complete: async () => assert.fail('invalid parent approval must not dispatch') }));
  }
});

test('parent approval validation can run read-only without creating a cohort or mutating review decisions', t => {
  const { options, parent, reviewPath } = parentSetup(t);
  const before = hash(fs.readFileSync(reviewPath));
  const bundle = loadNullableIntake(options.intake), { approvals, source } = loadProcessingApproval(options.approvals);
  const admission = validateApprovals(bundle, parent.candidate, approvals, source);
  assert.deepEqual(admission.map(row => row.textHash), parent.approvedTextHashes);
  assert.ok(admission.every(row => row.decision === 'approved' && row.sourceDecision === 'approve' && row.reviewSha256 === parent.reviewHash));
  assert.equal(hash(fs.readFileSync(reviewPath)), before);
  assert.equal(fs.existsSync(options.output), false);
});

test('approval of original bytes does not permit automatic input-fence neutralization', async t => {
  const { options, records, approval } = setup(t);
  const record = records[0];
  record.text = 'Original start\n⟦⟦⟦PATINA_INPUT_DATA⟧⟧⟧\nOriginal end'; record.textHash = hash(record.text);
  const intake = read(resolve(options.intake, 'intake.private.json')); intake.records = records;
  write(resolve(options.intake, 'intake.private.json'), intake);
  const summary = read(resolve(options.intake, 'summary.json')); summary.intakeHash = canonical(intake); summary.manifestHash = canonical(records);
  write(resolve(options.intake, 'summary.json'), summary);
  approval.intakeHash = summary.intakeHash; approval.decisions[0].textHash = record.textHash; write(options.approvals, approval);
  await assert.rejects(collectRebaselineScores(options, { complete: async () => assert.fail('changed text cannot be sent') }), /fencing changes approved text/);
});

test('offline replay still rejects actual scorer code changes in the isolated source tree', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options } = setup(t);
  await collectRebaselineScores(options, { complete: async () => valid() });
  const path = resolve(ROOT, 'src/scoring.js'), before = fs.readFileSync(path);
  try {
    fs.appendFileSync(path, '\n// Unit test: source bytes changed after collection.\n');
    await assert.rejects(replayCollection(options.output), /collector source changed/);
    await assert.rejects(collectRebaselineScores(resume(options), { complete: async () => assert.fail('changed source cannot dispatch') }), /collector source changed/);
  } finally { fs.writeFileSync(path, before); }
});

// abortStudy is deliberately irreversible. Test real programmatic and process
// cancellation in child processes, without resetting the production controller.
const cancellationProgram = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getEventListeners } from 'node:events';
import { pathToFileURL } from 'node:url';
const [root, serializedOptions, mode] = process.argv.slice(1);
const options = JSON.parse(serializedOptions);
const collector = await import(pathToFileURL(root + '/scripts/research/collect-rebaseline-scores.mjs').href);
const transport = await import(pathToFileURL(root + '/scripts/research/model-evaluation-transport.mjs').href);
const candidate = JSON.parse(fs.readFileSync(options.protocol)).candidates[0];
const signal = transport.getStudyCancellationSignal();
let fetchCalls = 0, activeSignal;
if (mode === 'already' || mode === 'attach-race') {
  globalThis.fetch = async () => { fetchCalls++; assert.fail('cancelled before dispatch'); };
  if (mode === 'already') transport.abortStudy();
  else {
    const add = signal.addEventListener.bind(signal);
    signal.addEventListener = (...args) => { transport.abortStudy(); return add(...args); };
  }
  await assert.rejects(collector.boundedCompletion(candidate, 'unit prompt', { temperature: .1, timeoutMs: 1000 }, () => {}),
    error => transport.safeStudyError(error) === 'study-cancelled');
  assert.equal(fetchCalls, 0);
} else {
  transport.installStudySignals();
  let ready;
  const fetchStarted = new Promise(resolve => { ready = resolve; });
  globalThis.fetch = async (_url, request) => {
    fetchCalls++; activeSignal = request.signal;
    return new Promise((_resolve, reject) => {
      const stop = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      activeSignal.addEventListener('abort', stop, { once: true });
      if (activeSignal.aborted) stop();
      ready();
    });
  };
  const collection = collector.collectRebaselineScores(options);
  const stopped = assert.rejects(collection, /unresolved journal/);
  await fetchStarted;
  if (mode === 'programmatic') transport.abortStudy();
  else {
    const cancelled = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    process.kill(process.pid, 'SIGTERM');
    await cancelled;
  }
  assert.equal(signal.aborted, true);
  assert.equal(activeSignal.aborted, true, 'study cancellation must synchronously reach active fetch');
  await stopped;
  assert.equal(fetchCalls, 1, 'no later text may dispatch after cancellation');
  const progress = JSON.parse(fs.readFileSync(options.output + '/progress.private.json'));
  assert.equal(Object.keys(progress.entries).length, 1);
  assert.equal(fs.existsSync(options.output + '/rows'), false);
  const group = fs.readdirSync(options.output + '/wire')[0];
  const wire = JSON.parse(fs.readFileSync(options.output + '/wire/' + group + '/1.private.json'));
  assert.equal(wire.state, 'error'); assert.equal(wire.error, 'study-cancelled');
  assert.equal(wire.errorMetadata.interruption, 'operator-cancelled');
}
assert.equal(getEventListeners(signal, 'abort').length, 0, 'per-call cancellation listener must be removed');
console.log(JSON.stringify({ mode, fetchCalls, globalAborted: signal.aborted, activeFetchAborted: activeSignal?.aborted ?? null }));
`;

test('programmatic abortStudy and real SIGTERM abort active HTTP fetch and stop later texts', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, t => {
  for (const mode of ['programmatic', 'sigterm']) {
    const { options } = setup(t, 2); options.timeoutMs = 5000;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', cancellationProgram, ROOT, JSON.stringify(options), mode], { encoding: 'utf8', timeout: 15000 });
    const evidence = JSON.parse(result);
    assert.equal(evidence.fetchCalls, 1); assert.equal(evidence.globalAborted, true); assert.equal(evidence.activeFetchAborted, true);
  }
});

test('already-aborted and listener-installation races dispatch zero HTTP requests', t => {
  for (const mode of ['already', 'attach-race']) {
    const { options } = setup(t);
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', cancellationProgram, ROOT, JSON.stringify(options), mode], { encoding: 'utf8', timeout: 10000 });
    assert.equal(JSON.parse(result).fetchCalls, 0);
  }
});

test('ordinary deadlines and network AbortError are recorded errors and the cohort continues', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const signal = getStudyCancellationSignal();
  const baseline = getEventListeners(signal, 'abort').length;
  for (const cause of ['deadline', 'network']) {
    const { options, records } = setup(t, 2); options.timeoutMs = 1000;
    let calls = 0, firstSignal;
    globalThis.fetch = async (_url, request) => {
      calls++;
      if (calls === 1) {
        firstSignal = request.signal;
        if (cause === 'network') throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        return new Promise((_resolve, reject) => firstSignal.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        }, { once: true }));
      }
      return new Response(JSON.stringify({ model: candidate.model, choices: [{ message: { content: valid().text } }] }), { status: 200 });
    };
    const report = await collectRebaselineScores(options);
    assert.equal(calls, 2); assert.equal(report.attempted, 2); assert.equal(report.errors, 1); assert.equal(report.valid, 1);
    assert.equal(signal.aborted, false);
    assert.equal(firstSignal.aborted, cause === 'deadline');
    assert.equal(getEventListeners(signal, 'abort').length, baseline);
    const row = read(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
    assert.equal(row.error, cause === 'deadline' ? 'request-timeout' : 'study-call-failed');
    assert.equal(row.overall, null);
    const wire = paths(resolve(options.output, 'wire')).map(read).find(entry => entry.textHash === records[0].textHash);
    assert.equal(wire.state, 'error'); assert.equal(wire.errorMetadata.interruption, cause);
    assert.equal(read(resolve(options.output, 'rows', `${records[1].textHash}.private.json`)).status, 'ok');
    assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
  }
});

async function exhaustParserDeadline(options, records, dependencies) {
  const originalNow = Date.now, originalFetch = globalThis.fetch;
  let offset = 0, fetches = 0;
  const byText = new Map();
  Date.now = () => originalNow() + offset;
  globalThis.fetch = async (_url, request) => {
    const prompt = JSON.parse(request.body).messages[0].content;
    const record = records.find(item => prompt.includes(item.text));
    assert.ok(record);
    byText.set(record.textHash, (byText.get(record.textHash) || 0) + 1);
    fetches++;
    if (fetches === 1) offset += options.timeoutMs + 50;
    return new Response(JSON.stringify({ model: candidate.model, usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [{ message: { content: fetches === 1 ? 'malformed score' : valid().text } }] }), { status: 200 });
  };
  try { return { report: await collectRebaselineScores(options, dependencies), fetches, byText }; }
  catch (error) { return { error, fetches, byText }; }
  finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
}

test('logical deadline after malformed response records two journals but only one dispatched wire', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, records } = setup(t, 2); options.timeoutMs = 1000;
  const result = await exhaustParserDeadline(options, records);
  const snapshot = read(resolve(options.output, 'snapshot.private.json'));
  const protocolHash = read(resolve(options.output, 'study-protocol.json')).protocolHash;
  const group = hash(`${protocolHash}/${snapshot.candidate.id}/${records[0].id}/0/score`);
  const journal = resolve(options.output, 'calls', group), wire = resolve(options.output, 'wire', group);
  assert.equal(result.byText.get(records[0].textHash), 1);
  assert.equal(paths(journal).length, 2); assert.equal(paths(wire).length, 1);
  const zero = read(resolve(journal, '2.private.json'));
  assert.equal(zero.notStarted, true); assert.equal(zero.error, 'request-timeout');
  assert.equal(zero.startedAt, null); assert.equal(zero.durationMs, 0); assert.deepEqual(zero.transportAttempts, []);
  assert.equal(fs.existsSync(resolve(wire, '2.private.json')), false);
  assert.equal(result.error, undefined);
  assert.equal(result.fetches, 2, 'the next fixture gets one normal request');
  assert.equal(result.report.errors, 1); assert.equal(result.report.valid, 1);
  const row = read(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
  assert.equal(row.error, 'request-timeout'); assert.equal(row.overall, null);
  assert.equal(row.calls[1].notStarted, true); assert.equal(row.calls[1].attempts, 0);
  assert.equal(read(resolve(options.output, 'rows', `${records[1].textHash}.private.json`)).status, 'ok');
  const before = Object.fromEntries(paths(options.output).map(path => [path, hash(fs.readFileSync(path))]));
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => assert.fail('no replacement fetch on replay or resume');
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
  await collectRebaselineScores(resume(options), { complete: async () => assert.fail('no replacement completion') });
  assert.deepEqual(Object.fromEntries(paths(options.output).map(path => [path, hash(fs.readFileSync(path))])), before);
});

test('wireless notStarted timeout recovers a missing row without a replacement completion', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, records } = setup(t); options.timeoutMs = 1000;
  const result = await exhaustParserDeadline(options, records, { persist: (path, value) => {
    if (path.includes('/rows/')) throw new Error('row persistence interrupted');
    persistPrivate(path, value);
  } });
  assert.match(result.error.message, /persistence/); assert.equal(result.fetches, 1);
  const recorded = Object.fromEntries(['calls', 'wire'].flatMap(kind => paths(resolve(options.output, kind))).map(path => [path, hash(fs.readFileSync(path))]));
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => assert.fail('recovery cannot fetch');
  const report = await collectRebaselineScores(resume(options), { complete: async () => assert.fail('recovery cannot dispatch') });
  assert.equal(report.attempted, 1); assert.equal(report.errors, 1); assert.equal(report.errorClasses['request-timeout'], 1);
  const row = read(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
  assert.equal(row.calls[1].notStarted, true); assert.equal(row.calls[1].attempts, 0);
  assert.deepEqual(Object.fromEntries(['calls', 'wire'].flatMap(kind => paths(resolve(options.output, kind))).map(path => [path, hash(fs.readFileSync(path))])), recorded);
  assert.equal((await replayCollection(options.output)).fullObservedReplay, true);
});

test('zero-dispatch receipts require exact prompt/request/ordinal/state and no dispatch evidence', { skip: POSIX_PRIVATE_OUTPUT_SKIP }, async t => {
  const { options, records } = setup(t); options.timeoutMs = 1000;
  const result = await exhaustParserDeadline(options, records);
  assert.equal(result.error, undefined);
  const progressPath = resolve(options.output, 'progress.private.json');
  const progress = read(progressPath); progress.entries[records[0].textHash] = { state: 'started' }; write(progressPath, progress);
  fs.unlinkSync(resolve(options.output, 'rows', `${records[0].textHash}.private.json`));
  const journal = paths(resolve(options.output, 'calls')).find(path => path.endsWith('2.private.json'));
  const original = fs.readFileSync(journal);
  const fakeWire = journal.replace('/calls/', '/wire/');
  const shifted = journal.replace('2.private.json', '3.private.json');
  for (const variant of ['prompt', 'request', 'temperature', 'state', 'response', 'owner', 'startedAt', 'attempts', 'duration', 'endedAt', 'notStarted', 'wire', 'ordinal']) {
    const receipt = JSON.parse(original);
    if (variant === 'prompt') receipt.promptHash = hash('different prompt');
    if (variant === 'request') receipt.requestHash = hash('different request');
    if (variant === 'temperature') receipt.temperature = .1;
    if (variant === 'state') receipt.state = 'completed';
    if (variant === 'response') receipt.response = valid();
    if (variant === 'owner') receipt.owner = { pid: 123 };
    if (variant === 'startedAt') receipt.startedAt = receipt.endedAt;
    if (variant === 'attempts') receipt.transportAttempts = [{ outcome: 'success' }];
    if (variant === 'duration') receipt.durationMs = 1;
    if (variant === 'endedAt') receipt.endedAt = null;
    if (variant === 'notStarted') receipt.notStarted = false;
    write(journal, receipt);
    if (variant === 'wire') write(fakeWire, { state: 'error' });
    if (variant === 'ordinal') fs.renameSync(journal, shifted);
    try {
      await assert.rejects(collectRebaselineScores(resume(options), { complete: async () => assert.fail('invalid receipt cannot authorize dispatch') }), undefined, variant);
    } finally {
      if (fs.existsSync(fakeWire)) fs.unlinkSync(fakeWire);
      if (fs.existsSync(shifted)) fs.unlinkSync(shifted);
      fs.writeFileSync(journal, original);
    }
  }
});
