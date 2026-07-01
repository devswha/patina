import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { validateXliffRequest, parseArgs } from '../../src/cli/args.js';
import { humanizeXliffDocument, parseXliffDocument, selectXliffSegments } from '../../src/cli/xliff.js';
import { tmpdir } from 'node:os';
import { runXliffMode } from '../../src/cli/run.js';
import { execFileSync } from 'node:child_process';

const EN_FIXTURE = '<?xml version="1.0"?>\n<xliff version="1.2"><file target-language="en-US"><body>'
  + '<trans-unit id="e1"><source>源文本内容示例。</source>'
  + '<target state="final">This translated sentence is long enough to count as prose for the humanizer.</target>'
  + '</trans-unit></body></file></xliff>';

const stubLogger = () => ({ info() {}, warn() {}, error() {}, closeProgress() {} });
const makeCtx = () => ({ config: { language: 'ko', profile: 'default' }, repoRoot: process.cwd(), voice: {}, scoring: {}, backends: [], resolved: { model: 'm' }, promptMode: 'strict', timeoutMs: 1000, providerName: 'deepseek' });
const fakeRewrite = async ({ core }) => core + ' [H]';
const fakeVerify = async ({ candidate }) => ({ verified: true, text: candidate });

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, '../fixtures/xliff/sample.xliff'), 'utf8');

// ---------- validateXliffRequest ----------
const base = (over = {}) => ({ files: ['a.xliff'], xliff: true, ...over });

test('validateXliffRequest: rejects incompatible modes/flags', () => {
  for (const [key, val] of [
    ['audit', true], ['score', true], ['diff', true], ['preview', true],
    ['ocr', true], ['serve', true], ['gate', 30], ['persona', 'x'],
    ['jargon', 'remove'], ['tone', 'casual'], ['profile', 'x'], ['rewriteHeadings', true],
    ['verify', true],
  ]) {
    assert.throws(() => validateXliffRequest(base({ [key]: val })), /cannot be combined with --xliff/, `${key} should be rejected`);
  }
});

test('validateXliffRequest: rejects stdin (no files) and multi-file without --batch', () => {
  assert.throws(() => validateXliffRequest({ xliff: true, files: [] }), /requires file paths, not stdin/);
  assert.throws(() => validateXliffRequest({ xliff: true, files: ['a.xliff', 'b.xliff'] }), /requires --batch/);
});

test('validateXliffRequest: accepts single file + allowed flags, and batch multi-file', () => {
  assert.doesNotThrow(() => validateXliffRequest(base({ backend: 'codex-cli', model: 'x', dryRun: true, maxSegments: 10, format: 'json', suffix: '.h' })));
  assert.doesNotThrow(() => validateXliffRequest({ xliff: true, batch: true, files: ['a.xliff', 'b.xliff'] }));
});

test('validateXliffRequest: --dry-run and --max-segments require --xliff', () => {
  assert.throws(() => validateXliffRequest({ dryRun: true, files: ['a.md'] }), /--dry-run requires --xliff/);
  assert.throws(() => validateXliffRequest({ maxSegments: 5, files: ['a.md'] }), /--max-segments requires --xliff/);
  assert.doesNotThrow(() => validateXliffRequest({ files: ['a.md'] })); // non-xliff normal run is unaffected
});

test('parseArgs: --xliff/--dry-run/--max-segments parse into parsed flags', () => {
  const p = parseArgs(['--xliff', '--dry-run', '--max-segments', '25', 'f.xliff']);
  assert.equal(p.xliff, true);
  assert.equal(p.dryRun, true);
  assert.equal(p.maxSegments, 25);
  assert.deepEqual(p.files, ['f.xliff']);
});

// ---------- humanizeXliffDocument (injected fakes) ----------
test('humanize: dry-run makes zero calls and returns byte-identical xml', async () => {
  let calls = 0;
  const r = await humanizeXliffDocument({
    xml: FIXTURE, dryRun: true,
    rewriteSegment: async () => { calls++; return 'x'; },
    verifySegment: async () => { calls++; return { verified: true }; },
  });
  assert.equal(r.dryRun, true);
  assert.equal(calls, 0);
  assert.equal(r.outputXml, FIXTURE);
  assert.equal(r.report.llmCalls, 0);
});

test('humanize: dedup rewrites each unique key once and applies to ALL duplicates (AC6)', async () => {
  let rewriteCalls = 0;
  const r = await humanizeXliffDocument({
    xml: FIXTURE,
    rewriteSegment: async ({ core }) => { rewriteCalls++; return core + ' [H]'; },
    verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
  });
  // fixture: u1, u6 (same core), u7 selected -> 2 unique keys -> 2 rewrite calls
  assert.equal(rewriteCalls, 2);
  assert.equal(r.report.changedUniqueKeys, 2);
  assert.equal(r.report.changedSegments, 3); // u1 + u6 + u7
  // both duplicates got the humanized text
  const occurrences = r.outputXml.split('[H]').length - 1;
  assert.equal(occurrences, 3);
});

test('humanize: verify floor miss keeps the original bytes (AC5, fail-closed)', async () => {
  const r = await humanizeXliffDocument({
    xml: FIXTURE,
    rewriteSegment: async ({ core }) => core + ' CHANGED',
    verifySegment: async () => ({ verified: false, text: 'CHANGED', mps: 40, fidelity: 55 }),
  });
  assert.equal(r.report.changedSegments, 0);
  assert.equal(r.outputXml, FIXTURE); // byte-identical
  for (const s of Object.values(r.report.perKey)) assert.equal(s.status, 'floor_failed');
});

test('humanize: verified-but-identical rewrite is a no-op (byte-identical, AC7)', async () => {
  const r = await humanizeXliffDocument({
    xml: FIXTURE,
    rewriteSegment: async ({ core }) => core, // returns the same core
    verifySegment: async ({ core }) => ({ verified: true, text: core }),
  });
  assert.equal(r.report.changedSegments, 0);
  assert.equal(r.outputXml, FIXTURE);
});

test('humanize: unique cap is enforced fail-closed in execution mode', async () => {
  await assert.rejects(
    () => humanizeXliffDocument({
      xml: FIXTURE, cap: 1,
      rewriteSegment: async ({ core }) => core + '!',
      verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
    }),
    (err) => err.code === 'xliff_cap_exceeded',
  );
});

test('humanize: a rewrite error keeps that segment original and records error (breaker)', async () => {
  const failures = [];
  const breaker = { recordSuccess() {}, recordFailure(f) { failures.push(f); }, shouldStop() { return false; } };
  const r = await humanizeXliffDocument({
    xml: FIXTURE, breaker,
    rewriteSegment: async () => { throw new Error('backend boom'); },
    verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
  });
  assert.equal(r.report.changedSegments, 0);
  assert.equal(r.outputXml, FIXTURE);
  assert.ok(failures.length >= 1);
  for (const s of Object.values(r.report.perKey)) assert.equal(s.status, 'error');
});

// sanity: the fixture still selects the expected 2 unique / 3 selected
test('fixture selection sanity (2 unique, 3 selected)', () => {
  const sel = selectXliffSegments(parseXliffDocument(FIXTURE));
  assert.equal(sel.selectedCount, 3);
  assert.equal(sel.uniqueCount, 2);
});

// ---------- --exit-on ordering ----------
test('validateXliffRequest rejects --exit-on (gate) with --xliff, ahead of generic validators', () => {
  const p = parseArgs(['--xliff', '--exit-on', '30', 'f.xliff']);
  assert.equal(p.gate, 30);
  assert.throws(() => validateXliffRequest(p), /cannot be combined with --xliff/);
});

// ---------- runXliffMode integration (injected rewrite/verify, no LLM) ----------
test('runXliffMode: resolves each file target-language and passes it to rewrite/verify (cross-language)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-xliff-run-'));
  try {
    const koFile = join(dir, 'ko.xliff'); writeFileSync(koFile, FIXTURE);
    const enFile = join(dir, 'en.xliff'); writeFileSync(enFile, EN_FIXTURE);
    const rewriteLangs = [];
    const verifyLangs = [];
    await runXliffMode(
      { xliff: true, batch: true, files: [koFile, enFile] },
      makeCtx(), stubLogger(),
      {
        rewriteSegment: async ({ core, lang }) => { rewriteLangs.push(lang); return core + ' [H]'; },
        verifySegment: async ({ candidate, lang }) => { verifyLangs.push(lang); return { verified: true, text: candidate }; },
      },
    );
    assert.ok(rewriteLangs.includes('ko'), 'ko target humanized as ko');
    assert.ok(rewriteLangs.includes('en'), 'en target humanized as en');
    assert.ok(verifyLangs.includes('ko') && verifyLangs.includes('en'), 'verify gets per-file lang');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runXliffMode: --outdir creates the directory, writes output, leaves the original untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-xliff-run-'));
  try {
    const input = join(dir, 'in.xliff'); writeFileSync(input, FIXTURE);
    const outdir = join(dir, 'nested', 'out'); // does not exist yet
    await runXliffMode({ xliff: true, outdir, files: [input] }, makeCtx(), stubLogger(),
      { rewriteSegment: fakeRewrite, verifySegment: fakeVerify });
    assert.ok(existsSync(join(outdir, 'in.xliff')), 'output written into created outdir');
    assert.equal(readFileSync(input, 'utf8'), FIXTURE, 'original untouched');
    assert.ok(readFileSync(join(outdir, 'in.xliff'), 'utf8').includes('[H]'), 'output humanized');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runXliffMode: default output is {name}.humanized.xliff and never clobbers the original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-xliff-run-'));
  try {
    const input = join(dir, 'in.xliff'); writeFileSync(input, FIXTURE);
    await runXliffMode({ xliff: true, files: [input] }, makeCtx(), stubLogger(),
      { rewriteSegment: fakeRewrite, verifySegment: fakeVerify });
    assert.ok(existsSync(join(dir, 'in.humanized.xliff')), 'default .humanized output written');
    assert.equal(readFileSync(input, 'utf8'), FIXTURE, 'original untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runXliffMode: --dry-run makes no calls and writes no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-xliff-run-'));
  try {
    const input = join(dir, 'in.xliff'); writeFileSync(input, FIXTURE);
    let calls = 0;
    await runXliffMode({ xliff: true, dryRun: true, files: [input] }, makeCtx(), stubLogger(),
      { rewriteSegment: async () => { calls++; return 'x'; }, verifySegment: async () => { calls++; return { verified: true }; } });
    assert.equal(calls, 0);
    assert.equal(existsSync(join(dir, 'in.humanized.xliff')), false, 'dry-run writes nothing');
    assert.equal(readFileSync(input, 'utf8'), FIXTURE);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- CLI dispatcher ordering (real subprocess) ----------
test('CLI: --xliff --exit-on rejects with the XLIFF-specific error before the generic score-gate guard', () => {
  let err;
  try {
    execFileSync('node', ['bin/patina.js', '--xliff', '--exit-on', '30', 'tests/fixtures/xliff/sample.xliff'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { err = e; }
  assert.ok(err, 'should exit non-zero');
  assert.equal(err.status, 2);
  const out = (err.stdout || '') + (err.stderr || '');
  assert.match(out, /cannot be combined with --xliff/);
  assert.doesNotMatch(out, /can only be used with --score/);
});

test('CLI: --xliff --dry-run on the fixture succeeds with zero calls/writes (real subprocess)', () => {
  const out = execFileSync('node', ['bin/patina.js', '--xliff', '--dry-run', '--format', 'json', 'tests/fixtures/xliff/sample.xliff'], { encoding: 'utf8' });
  const json = JSON.parse(out);
  assert.equal(json.llmCalls, 0);
  assert.equal(json.writes, 0);
  assert.equal(json.targetLang, 'ko');
  assert.equal(json.selectedCount, 3);
  assert.equal(json.uniqueCount, 2);
});
