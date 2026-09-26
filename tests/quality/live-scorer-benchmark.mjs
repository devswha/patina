#!/usr/bin/env node
// Opt-in production scorer benchmark (#412). No live performance CI gate.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { scoreText } from '../../src/scoring.js';
import { assertStudyActive, installStudySignals, studyCompletion, safeStudyError, validateTransport } from '../../scripts/research/model-evaluation-transport.mjs';
import { acceptedStudyIdentity, acquireStudyWriter, bindStudyProtocol, createCallJournal, readUniqueRows } from '../../scripts/research/study-journal.mjs';
import { fixtureIdentity, studySemantics, validateRawScore } from '../../scripts/research/study-validation.mjs';
import { createStudyInputs } from '../../scripts/research/study-inputs.mjs';
import { summarizeRanking } from './ranking-metrics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const textHash = (text) => createHash('sha256').update(text).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/i;
export function canonicalTextHash(value) {
  if (typeof value !== 'string') throw new Error('Invalid text hash');
  const hash = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
  if (!SHA256.test(hash)) throw new Error('Invalid text hash');
  return hash.toLowerCase();
}
const quietLogger = { warn() {}, info() {}, debug() {} };
function nullableExpectedHot(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  throw new Error('Invalid expected_hot label');
}
const safeMetadataCategory = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value) ? value : null;
const metadataHash = (value) => value === undefined || value === null ? null : textHash(JSON.stringify(value));
function manifestProvenance(row) {
  const source = { source_type: row.source_type ?? null, model_family: row.model_family ?? null,
    source_review: row.source_review ?? null, score_review: row.score_review ?? null };
  return { source_type: safeMetadataCategory(row.source_type), model_family: safeMetadataCategory(row.model_family),
    binding_sha256: metadataHash(source) };
}

export function loadScorerFixtures(repoRoot = ROOT) {
  const directory = resolve(repoRoot, 'tests/fixtures/suspect-zones');
  const rows = [];
  for (const language of ['en', 'ko', 'zh', 'ja']) {
    for (const classification of ['ai', 'natural']) {
      const base = resolve(directory, language, classification);
      for (const file of readdirSync(base).filter((name) => name.endsWith('.md')).sort()) {
        const path = resolve(base, file);
        const match = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
        if (!match) throw new Error(`Missing fixture frontmatter: ${relative(repoRoot, path)}`);
        const meta = yaml.load(match[1]);
        const text = match[2].trim();
        if (typeof meta.expected_hot !== 'boolean' || meta.language !== language || !meta.fixture_id || !text) throw new Error('Invalid scorer fixture');
        rows.push({ fixture_id: meta.fixture_id, language, class: classification,
          register: meta.register || 'unspecified', expected_hot: meta.expected_hot,
          text, text_hash: textHash(text), source: relative(repoRoot, path),
          provenance: 'repository regression fixture; not a human-authorship label' });
      }
    }
  }
  if (new Set(rows.map((row) => row.fixture_id)).size !== rows.length) throw new Error('Duplicate fixture IDs');
  return rows;
}

// A public/hash-only manifest must resolve every row to independently supplied
// local text with the exact recorded hash. Never infer missing text or labels.
export function loadScorerManifest(manifestPath, textsPath) {
  const readRows = (path) => readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const texts = new Map();
  for (const row of readRows(textsPath)) {
    if (typeof row.text !== 'string' || !row.text.trim()) throw new Error('Private text row is missing text');
    const hash = textHash(row.text);
    let suppliedHash = null;
    if (row.text_hash !== undefined && row.text_hash !== null) {
      suppliedHash = canonicalTextHash(row.text_hash);
    }
    if (suppliedHash && suppliedHash !== hash) throw new Error('Private text hash mismatch');
    texts.set(hash, row.text);
  }
  const seen = new Set();
  return readRows(manifestPath).map((row) => {
    const hash = canonicalTextHash(row.text_hash);
    const text = texts.get(hash);
    const expectedHot = nullableExpectedHot(row.expected_hot);
    const classValue = row.class === undefined || row.class === null ? null : row.class;
    const documentType = row.documentType === undefined || row.documentType === null ? undefined : row.documentType;
    const register = row.register === undefined || row.register === null || row.register === '' ? 'unspecified' : row.register;
    if (!text || typeof row.sample_id !== 'string' || !row.sample_id.trim() || row.sample_id.length > 256 || seen.has(row.sample_id)
      || (classValue !== null && (typeof classValue !== 'string' || classValue.length > 256))
      || (documentType !== undefined && (typeof documentType !== 'string' || !documentType.trim() || documentType.length > 256))
      || (typeof register !== 'string' || register.length > 256)
      || !['en', 'ko', 'zh', 'ja'].includes(row.language)) {
      throw new Error('Unresolved or invalid scorer manifest row');
    }
    seen.add(row.sample_id);
    return { fixture_id: row.sample_id, language: row.language, class: classValue,
      ...(documentType === undefined ? {} : { documentType }), register, expected_hot: expectedHot,
      text, text_hash: hash, source: 'caller-supplied hash-bound manifest',
      provenance: manifestProvenance(row) };
  });
}

export function distribution(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return { n: 0, min: null, median: null, mean: null, p95: null, max: null };
  const midpoint = Math.floor(ordered.length / 2);
  return { n: ordered.length, min: ordered[0], median: ordered.length % 2 ? ordered[midpoint] : (ordered[midpoint - 1] + ordered[midpoint]) / 2,
    mean: ordered.reduce((sum, n) => sum + n, 0) / ordered.length,
    p95: ordered[Math.ceil(ordered.length * .95) - 1], max: ordered.at(-1) };
}

export async function evaluateScorerFixture(fixture, candidate, { repoRoot = ROOT, complete = studyCompletion, envFile, timeoutMs = 180_000, journalDirectory, logicalId, preparedInputs } = {}) {
  const prepared = preparedInputs || createStudyInputs(repoRoot).fixture(fixture);
  const { config, patterns, deterministicScore } = prepared;
  const fixtureHash = canonicalTextHash(fixture.text_hash);
  if (fixtureHash !== textHash(fixture.text)) throw new Error('Fixture text hash mismatch');
  const expectedHot = nullableExpectedHot(fixture.expected_hot);
  // Rebaseline snapshots retain the exact analysis object; normal scorer
  // preparation exposes only this boolean so no second analysis is needed.
  const analyzerHot = typeof prepared.analyzerHot === 'boolean' ? prepared.analyzerHot
    : typeof prepared.analysis?.hot === 'boolean' ? prepared.analysis.hot : null;
  const calls = [];
  let rawScore = null;
  const deadline = Date.now() + timeoutMs;
  const callLLM = createCallJournal({ directory: journalDirectory, logicalId: logicalId || `${candidate.id}/${fixture.fixture_id}/score`,
    candidate, complete, envFile, validate: (text) => validateRawScore(text, patterns),
    record: (call, raw) => { calls.push(call); rawScore = raw; } });
  const result = await scoreText({ text: fixture.text, config, patterns, deterministicScore, model: candidate.model, deadline,
    logger: quietLogger, callLLM,
  });
  const validScore = calls.at(-1)?.schema_valid === true && Number.isFinite(rawScore?.overall)
    && acceptedStudyIdentity(calls.at(-1))
    && Number.isFinite(result.overall) && result.overall >= 0 && result.overall <= 100 && !result.error;
  // Do not retain raw provider text, matched phrases, anchors, or private inputs.
  const allowedPacks = new Set(patterns.map((pack) => pack.frontmatter.pack.replace(/^[a-z]{2}-/, '')));
  const categories = Object.fromEntries(Object.entries(validScore ? result.categories || {} : {}).filter(([name]) => allowedPacks.has(name)).map(([name, value]) => [name,
    Object.fromEntries(['detected', 'sum', 'max', 'score', 'weighted'].filter((key) => Number.isFinite(value?.[key])).map((key) => [key, value[key]]))]));
  return { schemaVersion: 1, fixture_id: fixture.fixture_id, text_hash: fixtureHash,
    language: fixture.language, register: fixture.register, documentType: config?.documentType ?? null,
    class: fixture.class ?? null, expected_hot: expectedHot, source: fixture.source,
    provenance: fixture.provenance ?? null, analyzer_hot: analyzerHot,
    candidate_id: candidate.id, provider: candidate.provider, requested_model: candidate.model, transport: candidate.transport,
    status: validScore ? 'ok' : 'error', error: validScore ? null : calls.at(-1)?.error || 'score-schema-failure',
    overall: validScore ? result.overall : null,
    raw_overall: validScore ? rawScore.overall : null,
    schema_failures: calls.filter((call) => call.schema_valid === false).length,
    llm_overall: Number.isFinite(result.llmScore?.overall) ? result.llmScore.overall : null,
    deterministic_overall: Number.isFinite(result.deterministicScore?.overall) ? result.deterministicScore.overall : null,
    categories, calls, duration_ms: calls.reduce((sum, call) => sum + call.durationMs, 0) };
}

export function summarizeScorerRows(rows) {
  const groups = {};
  for (const row of rows) (groups[row.candidate_id] ||= []).push(row);
  return Object.fromEntries(Object.entries(groups).map(([id, all]) => {
    const valid = all.filter((row) => row.status === 'ok' && Number.isFinite(row.overall));
    const labeled = all.filter((row) => typeof row.expected_hot === 'boolean');
    const validLabeled = valid.filter((row) => typeof row.expected_hot === 'boolean');
    const unlabeled = all.filter((row) => typeof row.expected_hot !== 'boolean').length;
    const packs = {};
    for (const row of valid) for (const [pack, value] of Object.entries(row.categories)) {
      const key = `${row.language}/${pack}`;
      (packs[key] ||= []).push(value.score);
    }
    return [id, { total: all.length, valid: valid.length, errors: all.length - valid.length,
      labeled: labeled.length, unlabeled,
      overall: distribution(valid.map((row) => row.overall)), latency_ms: distribution(all.map((row) => row.duration_ms)),
      ai_fixture_scores: distribution(validLabeled.filter((row) => row.expected_hot === true).map((row) => row.overall)),
      natural_fixture_scores: distribution(validLabeled.filter((row) => row.expected_hot === false).map((row) => row.overall)),
      by_language: Object.fromEntries(['en', 'ko', 'zh', 'ja'].map((lang) => [lang, distribution(valid.filter((row) => row.language === lang).map((row) => row.overall))])),
      by_pattern_pack: Object.fromEntries(Object.entries(packs).map(([key, values]) => [key, distribution(values)])),
      ranking: summarizeRanking(validLabeled.map((row) => ({ score: row.overall, expected: row.expected_hot }))),
    }];
  }));
}

export function renderScorerReport(rows, metadata = {}) {
  const summary = summarizeScorerRows(rows);
  const keys = rows.map((row) => `${row.candidate_id}/${row.fixture_id}/${row.repeat}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate scorer result');
  const complete = Array.isArray(metadata.expectedKeys) && metadata.expectedKeys.length === keys.length
    && metadata.expectedKeys.every((key) => keys.includes(key))
    && !rows.some((row) => row.calls.some((call) => ['study-call-unobserved', 'study-call-inflight', 'study-cancelled', 'study-journal-persistence-failed'].includes(call.error)));
  const f = (n) => Number.isFinite(n) ? n.toFixed(2) : 'N/A';
  const lines = ['# Live scorer benchmark', '', `Generated: ${new Date().toISOString()}`, '',
    'Opt-in diagnostics from the production `scoreText` path. No live score is a CI gate.',
    'Regression fixture labels identify editing hotspots, not authorship or human preference.',
    'Null scores and transport/schema failures remain errors; they are never converted to zero.', '',
    `Protocol: ${metadata.protocolHash || 'ad-hoc'}. Collection complete: ${complete ? 'yes' : 'no'}.`, '',
    '| Candidate | Valid / attempted | Errors | Unlabeled | Median score | AI fixture mean | Natural fixture mean | Median ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const [id, s] of Object.entries(summary)) lines.push(`| ${id} | ${s.valid}/${s.total} | ${s.errors} | ${s.unlabeled} | ${f(s.overall.median)} | ${f(s.ai_fixture_scores.mean)} | ${f(s.natural_fixture_scores.mean)} | ${f(s.latency_ms.median)} |`);
  lines.push('', '## Pattern-pack distributions', '', '| Candidate | Language / pack | n | Min | Median | Mean | p95 | Max |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const [id, s] of Object.entries(summary)) for (const [pack, d] of Object.entries(s.by_pattern_pack)) lines.push(`| ${id} | ${pack} | ${d.n} | ${f(d.min)} | ${f(d.median)} | ${f(d.mean)} | ${f(d.p95)} | ${f(d.max)} |`);
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = { repeat: 1 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live') options.live = true;
    else if (arg === '--help') { console.log('live-scorer-benchmark --live --candidates FILE --output DIR [--provider NAME] [--candidate ID] [--env-file FILE] [--repeat N] [--limit N] [--manifest FILE --texts FILE]'); return; }
    else if (['--candidates', '--candidate', '--provider', '--output', '--env-file', '--repeat', '--limit', '--manifest', '--texts'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.live) { console.log('Live scorer benchmark skipped; pass --live explicitly.'); return; }
  installStudySignals();
  if (!options.candidates || !options.output) throw new Error('--candidates and --output are required');
  if (Boolean(options.manifest) !== Boolean(options.texts)) throw new Error('--manifest and --texts are required together');
  const repeat = Number(options.repeat);
  const limit = options.limit === undefined ? null : Number(options.limit);
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10 || (limit !== null && (!Number.isSafeInteger(limit) || limit < 1))) throw new Error('Invalid repeat or limit');
  const protocol = JSON.parse(readFileSync(options.candidates, 'utf8'));
  const candidates = protocol.candidates.filter((row) => (!options.candidate || row.id === options.candidate) && (!options.provider || row.provider === options.provider));
  if (!candidates.length) throw new Error('No matching candidate');
  for (const candidate of candidates) validateTransport(candidate);
  let fixtures = options.manifest ? loadScorerManifest(options.manifest, options.texts) : loadScorerFixtures();
  if (limit) fixtures = fixtures.slice(0, limit);
  const inputs = createStudyInputs(ROOT);
  const prepared = new Map(fixtures.map((fixture) => [fixture.fixture_id, inputs.fixture(fixture)]));
  const semantics = studySemantics(ROOT);
  const protocolHash = textHash(JSON.stringify({ protocol, semantics, effectiveInputs: inputs.fingerprint,
    analyses: fixtures.map((fixture) => [fixture.fixture_id, textHash(JSON.stringify(prepared.get(fixture.fixture_id).deterministicScore))]),
    candidates: candidates.map((row) => row.id), fixtures: fixtures.map(fixtureIdentity), repeat }));
  const output = resolve(options.output); mkdirSync(output, { recursive: true });
  const releaseWriter = acquireStudyWriter(output, 'scorer');
  try {
  bindStudyProtocol(output, protocolHash);
  const path = resolve(output, 'scorer-rows.jsonl');
  const key = (row) => `${row.candidate_id}/${row.fixture_id}/${row.repeat}`;
  const rows = readUniqueRows(path, key);
  if (rows.some((row) => row.protocol_hash !== protocolHash)) throw new Error('Existing scorer output belongs to a different protocol');
  const done = new Set(rows.map(key));
  const expectedKeys = candidates.flatMap((candidate) => Array.from({ length: repeat }, (_, iteration) => fixtures.map((fixture) => `${candidate.id}/${fixture.fixture_id}/${iteration}`)).flat());
  if (rows.some((row) => !expectedKeys.includes(key(row)))) throw new Error('Scorer output includes an unexpected logical key');
  // Serial within a candidate. A caller may use separate output directories to
  // schedule different providers without concurrent writers to the same file.
  for (const candidate of candidates) for (let iteration = 0; iteration < repeat; iteration++) for (const fixture of fixtures) {
    assertStudyActive();
    if (done.has(`${candidate.id}/${fixture.fixture_id}/${iteration}`)) continue;
    const row = { ...await evaluateScorerFixture(fixture, candidate, { envFile: options['env-file'], journalDirectory: output,
      preparedInputs: prepared.get(fixture.fixture_id), logicalId: `${protocolHash}/${candidate.id}/${fixture.fixture_id}/${iteration}/score` }), repeat: iteration, protocol_hash: protocolHash, recorded_at: new Date().toISOString() };
    appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 }); rows.push(row);
    console.log(JSON.stringify({ candidate: candidate.id, fixture: fixture.fixture_id, repeat: iteration, status: row.status, overall: row.overall }));
  }
  writeFileSync(resolve(output, 'scorer-summary.json'), `${JSON.stringify({ protocolHash, expectedKeys, summary: summarizeScorerRows(rows) }, null, 2)}\n`);
  writeFileSync(resolve(output, 'scorer-report.md'), renderScorerReport(rows, { protocolHash, expectedKeys }));
  writeFileSync(resolve(output, 'semantics.json'), `${JSON.stringify({ protocolHash, semantics, effectiveInputs: inputs.fingerprint, fixtures: fixtures.map(fixtureIdentity) }, null, 2)}\n`);
  } finally { releaseWriter(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(safeStudyError(error)); process.exitCode = 1; });
