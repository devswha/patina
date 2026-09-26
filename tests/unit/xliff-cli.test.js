import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { validateXliffRequest, parseArgs } from '../../src/cli/args.js';
import { humanizeXliffDocument, parseXliffDocument, selectXliffSegments } from '../../src/cli/xliff.js';
import { tmpdir } from 'node:os';
import { runXliffMode } from '../../src/cli/run.js';
import { cleanRewriteOutput } from '../../src/output.js';
import { execFileSync } from 'node:child_process';

const EN_FIXTURE = '<?xml version="1.0"?>\n<xliff version="1.2"><file target-language="en-US"><body>'
  + '<trans-unit id="e1"><source>源文本内容示例。</source>'
  + '<target state="final">This translated sentence is long enough to count as prose for the humanizer.</target>'
  + '</trans-unit></body></file></xliff>';

const stubLogger = () => ({ info() {}, warn() {}, error() {} });
const makeCtx = () => ({ config: { language: 'ko', documentType: 'default' }, repoRoot: process.cwd(), voice: {}, scoring: {}, backends: [], resolved: { model: 'm' }, promptMode: 'strict', timeoutMs: 1000, providerName: 'deepseek' });
const fakeRewrite = async ({ core }) => core + ' [H]';
const fakeVerify = async ({ candidate }) => ({ verified: true, text: candidate });

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, '../fixtures/xliff/sample.xliff'), 'utf8');
// Regression: the production rewriteSegment cleaner must strip leaked model
// scaffolding so XLIFF <target> write-back never persists patina's own output
// chrome (a leaked YAML register footer / [SELF_AUDIT]) as translated content.
// Observed live with deepseek-chat on sample/Supernote_en.xliff.
test('cleanRewriteOutput strips leaked register footer and self-audit from a segment rewrite', () => {
  const leaked = [
    'File name cannot be a system reserved name: %s',
    '',
    '---',
    'register: professional',
    'register_source: command',
    'register_evidence: ["user-specified"]',
    'register_confidence: high',
    '---',
  ].join('\n');
  assert.strictEqual(cleanRewriteOutput(leaked), 'File name cannot be a system reserved name: %s');

  const audited = '[BODY]\nHumanized sentence here.\n[/BODY]\n[SELF_AUDIT]\nnotes\n[/SELF_AUDIT]';
  assert.strictEqual(cleanRewriteOutput(audited), 'Humanized sentence here.');

  // Real translated prose containing an em-dash / triple-dash-like text but no
  // full register-footer schema must pass through untouched (no over-stripping).
  const clean = 'Please read and understand the full content of this document before using the product.';
  assert.strictEqual(cleanRewriteOutput(clean), clean);
});

// ---------- validateXliffRequest ----------
const base = (over = {}) => ({ files: ['a.xliff'], xliff: true, ...over });

test('validateXliffRequest: rejects incompatible modes/flags', () => {
  for (const [key, val] of [
    ['audit', true], ['score', true], ['diff', true], ['preview', true],
    ['ocr', true], ['serve', true], ['gate', 30], ['persona', 'x'],
    ['jargon', 'remove'], ['register', 'casual'], ['documentType', 'technical'], ['rewriteHeadings', true],
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

test('humanize: dedup rewrites each unique key once and applies to ALL duplicates', async () => {
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

test('humanize: verify floor miss keeps the original bytes (fail-closed)', async () => {
  const r = await humanizeXliffDocument({
    xml: FIXTURE,
    rewriteSegment: async ({ core }) => core + ' CHANGED',
    verifySegment: async () => ({ verified: false, text: 'CHANGED', mps: 40, fidelity: 55 }),
  });
  assert.equal(r.report.changedSegments, 0);
  assert.equal(r.outputXml, FIXTURE); // byte-identical
  for (const s of Object.values(r.report.perKey)) assert.equal(s.status, 'floor_failed');
});

test('humanize: verified-but-identical rewrite is a no-op (byte-identical)', async () => {
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

const KO_A = '첫 번째 문장은 사람이 읽기 좋게 다듬을 수 있는 충분히 긴 번역문입니다.';
const KO_B = '두 번째 문장도 검증 경계값을 확인하기에 충분한 한국어 번역문입니다.';
const KO_C = '세 번째 문장은 변경하지 않는 경로를 확인하기 위해 준비한 문장입니다.';
const xml = (units) => `<xliff version="1.2"><file target-language="ko"><body>${units}</body></file></xliff>`;
const unit = (id, target) => `<trans-unit id="${id}"><source>Source text ${id}</source><target state="translated">${target}</target></trans-unit>`;

test('parseArgs/validateXliffRequest: fail closed for XLIFF-only flags and does not interfere with normal score', () => {
  for (const argv of [
    ['--xliff', '--audit', 'f.xliff'],
    ['--xliff', '--verify', 'f.xliff'],
    ['--xliff', '--register', 'casual', 'f.xliff'],
    ['--xliff', '--persona', 'x', 'f.xliff'],
    ['--xliff', '--jargon', 'remove', 'f.xliff'],
    ['--xliff', '--score', 'f.xliff'],
    ['--xliff', '--preview', 'f.xliff'],
  ]) {
    assert.throws(() => validateXliffRequest(parseArgs(argv)), /cannot be combined with --xliff/);
  }

  assert.throws(() => validateXliffRequest(parseArgs(['--xliff'])), /requires file paths, not stdin/);
  assert.throws(() => validateXliffRequest(parseArgs(['--xliff', 'a.xliff', 'b.xliff'])), /requires --batch/);
  assert.throws(() => validateXliffRequest(parseArgs(['--dry-run', 'a.md'])), /--dry-run requires --xliff/);
  assert.throws(() => validateXliffRequest(parseArgs(['--max-segments', '5', 'a.md'])), /--max-segments requires --xliff/);

  for (const argv of [
    ['--xliff', '--max-segments', '0', 'f.xliff'],
    ['--xliff', '--max-segments', '-1', 'f.xliff'],
    ['--xliff', '--max-segments', 'NaN', 'f.xliff'],
  ]) {
    assert.throws(() => parseArgs(argv), /positive integer/);
  }

  const normal = parseArgs(['--score']);
  assert.equal(normal.score, true);
  assert.doesNotThrow(() => validateXliffRequest(normal));
});

test('humanize orchestration: mixed rewritten, floor-failed, and unchanged keys preserve byte integrity', async () => {
  const doc = xml(unit('rewrite', KO_A) + unit('floor', KO_B) + unit('unchanged', KO_C));
  const originalFloor = `<target state="translated">${KO_B}</target>`;
  const originalUnchanged = `<target state="translated">${KO_C}</target>`;

  const result = await humanizeXliffDocument({
    xml: doc,
    rewriteSegment: async ({ core }) => {
      if (core === KO_A) return `${core} 자연스럽게`;
      if (core === KO_B) return `${core} 망가짐`;
      return core;
    },
    verifySegment: async ({ core, candidate }) => {
      if (core === KO_B) return { verified: false, text: candidate, mps: 20, fidelity: 30 };
      return { verified: true, text: candidate };
    },
  });

  assert.equal(result.report.changedUniqueKeys, 1);
  assert.equal(result.report.changedSegments, 1);
  assert.equal(result.outputXml.includes('자연스럽게'), true);
  assert.equal(result.outputXml.includes(originalFloor), true);
  assert.equal(result.outputXml.includes(originalUnchanged), true);
  assert.equal(result.outputXml.includes('망가짐'), false);
  assert.equal(result.report.perKey[KO_B].status, 'floor_failed');
  assert.equal(result.report.perKey[KO_C].status, 'unchanged');
});

test('humanize orchestration: breaker stop throws typed breaker error and leaves caller without partial output', async () => {
  const failures = [];
  const breakerError = new Error('breaker open');
  breakerError.code = 'breaker_open';
  const breaker = {
    recordSuccess() {},
    recordFailure(failure) { failures.push(failure); },
    shouldStop() { return true; },
    toError() { return breakerError; },
  };

  await assert.rejects(
    () => humanizeXliffDocument({
      xml: FIXTURE,
      breaker,
      rewriteSegment: async () => { throw new Error('backend down'); },
      verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
    }),
    (err) => err.code === 'breaker_open'
  );
  assert.equal(failures.length, 1);
});

test('humanize orchestration: cap boundary allows exactly capped unique count and rejects one below before calls', async () => {
  let calls = 0;
  const ok = await humanizeXliffDocument({
    xml: FIXTURE,
    cap: 2,
    rewriteSegment: async ({ core }) => { calls++; return `${core} 통과`; },
    verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
  });
  assert.equal(ok.report.changedUniqueKeys, 2);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    () => humanizeXliffDocument({
      xml: FIXTURE,
      cap: 1,
      rewriteSegment: async ({ core }) => { calls++; return `${core} 안됨`; },
      verifySegment: async ({ candidate }) => ({ verified: true, text: candidate }),
    }),
    (err) => err.code === 'xliff_cap_exceeded'
  );
  assert.equal(calls, 0);
});
