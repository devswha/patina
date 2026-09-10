#!/usr/bin/env node
// Cross-platform smoke for maintenance item P16b: run the representative
// install / start / non-ASCII-path / cancellation / suite checks on one
// machine and write a dated JSON receipt. The receipt records what happened,
// not a verdict; a failing step is evidence, never a reason to stop.
//
//   node scripts/platform-smoke.mjs [--skip-install] [--skip-suite] [--out <file>]
//
// No LLM call is made: the text path uses --offline scoring and inspect.
// No environment values are recorded, only the names of key variables that
// are set.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, homedir, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WIN = process.platform === 'win32';
const NPM = WIN ? 'npm.cmd' : 'npm';
const STEP_TIMEOUT_MS = 20 * 60 * 1000;
const OUTPUT_CAP = 4000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outPath = resolve(optionValue('--out') || join(REPO_ROOT, 'docs', 'operations', `platform-smoke-${process.platform}-${arch()}-${today}.json`));

const receipt = {
  schemaVersion: 1,
  recordType: 'platform-smoke',
  planIds: ['P16b'],
  observedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    release: release(),
    arch: arch(),
    node: process.version,
    shell: process.env.SHELL || process.env.ComSpec || null,
    homeHasNonAscii: /[^\x20-\x7e]/.test(homedir()),
    tmpdirHasSpace: /\s/.test(tmpdir()),
  },
  repo: {
    root: REPO_ROOT,
    head: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: git(['status', '--porcelain']) !== '',
  },
  keyEnvNamesSet: ['PATINA_API_KEY', 'PATINA_API_KEY_FILE', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'KIMI_API_KEY'].filter((k) => Boolean(process.env[k])),
  steps: [],
  summary: null,
};

function git(argv) {
  const r = spawnSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function cap(text) {
  const s = String(text || '');
  return s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n…[${s.length - OUTPUT_CAP} more bytes]` : s;
}

function run(name, command, argv, { cwd = REPO_ROOT, env = {}, expectStatus = 0, parse = null } = {}) {
  const started = Date.now();
  const result = spawnSync(command, argv, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    shell: WIN && command.endsWith('.cmd'),
  });
  const step = {
    name,
    command: [command, ...argv].join(' '),
    cwd: cwd === REPO_ROOT ? '.' : cwd,
    status: result.status,
    signal: result.signal || null,
    ms: Date.now() - started,
    ok: result.status === expectStatus,
    stdoutTail: cap(result.stdout?.slice(-OUTPUT_CAP)),
    stderrTail: cap(result.stderr?.slice(-OUTPUT_CAP)),
    error: result.error ? String(result.error.message) : null,
  };
  if (parse) {
    try {
      step.parsed = parse(result.stdout || '', result.stderr || '');
    } catch (err) {
      step.parsed = { error: String(err?.message ?? err) };
    }
  }
  receipt.steps.push(step);
  process.stderr.write(`${step.ok ? 'ok  ' : 'FAIL'} ${name} (${step.ms} ms${step.status === null ? `, ${step.signal || 'no exit'}` : `, exit ${step.status}`})\n`);
  return step;
}

// TAP reporter output: totals come from node's trailer (`# tests`, `# pass`,
// `# fail`, `# skipped`), which counts each test once; failing names come
// from top-level and nested `not ok` lines.
function parseTap(stdout) {
  const totals = { tests: null, pass: null, fail: null, skip: null };
  const failing = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trailer = /^# (tests|pass|fail|skipped) (\d+)$/.exec(line);
    if (trailer) {
      totals[trailer[1] === 'skipped' ? 'skip' : trailer[1]] = Number(trailer[2]);
      continue;
    }
    const m = /^\s*not ok \d+ - (.*)$/.exec(line);
    if (m) failing.push(m[1].replace(/\s+# .*$/, ''));
  }
  return { ...totals, failing: failing.slice(0, 50) };
}

function listTests(dir) {
  return readdirSync(join(REPO_ROOT, dir)).filter((f) => f.endsWith('.test.js')).map((f) => join(dir, f));
}

// 1. Clean dependency install from the lockfile.
if (!flag('--skip-install')) {
  run('npm ci', NPM, ['ci', '--no-audit', '--no-fund']);
}

// 2. The CLI starts.
run('cli --version', process.execPath, ['bin/patina.js', '--version']);

// 3. Non-ASCII + space paths: input file, output directory and cwd all carry
// Korean and a space. Offline scoring needs no backend.
const smokeRoot = mkdtempSync(join(tmpdir(), 'patina smoke 한글 경로 '));
const inputDir = join(smokeRoot, '입력 폴더');
const outDir = join(smokeRoot, '출력 폴더');
mkdirSync(inputDir);
mkdirSync(outDir);
const fixture = readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'suspect-zones', 'ko', 'ai', 'ko-ai-01.md'), 'utf8');
const body = fixture.split(/^---$/m).slice(2).join('---').trim() + '\n';
const inputPath = join(inputDir, '초안 파일.md');
writeFileSync(inputPath, body);
run('offline score on Korean/space path', process.execPath, ['bin/patina.js', '--offline', '--score', '--format', 'json', inputPath], {
  parse: (stdout) => {
    const j = JSON.parse(stdout);
    return { deterministicOverall: j?.scores?.deterministic?.overall ?? null, paragraphCount: j?.scores?.deterministic?.paragraphCount ?? null };
  },
});
run('inspect on Korean/space path from a Korean/space cwd', process.execPath, [join(REPO_ROOT, 'bin', 'patina.js'), 'inspect', inputPath], {
  cwd: inputDir,
  parse: (stdout) => ({ jsonParses: Boolean(JSON.parse(stdout)) }),
});
run('offline batch score into Korean/space outdir', process.execPath, ['bin/patina.js', '--offline', '--score', '--batch', '--outdir', outDir, inputPath], {
  parse: () => ({ outdirEntries: readdirSync(outDir) }),
});
try { rmSync(smokeRoot, { recursive: true, force: true }); } catch {}

// 4. Owned-process cancellation and session isolation. These are the tests
// that make platform-specific promises; on Windows they skip by design and
// the skip counts are the evidence.
run('cancellation + isolation tests', process.execPath, [
  '--test', '--test-reporter=tap',
  'tests/unit/backend-cancellation.test.js', 'tests/unit/backend-agy.test.js', 'tests/e2e/session-isolation.test.js',
], { parse: parseTap });

// 5. Setup diagnostics without network.
run('doctor --offline --json', process.execPath, ['bin/patina.js', 'doctor', '--offline', '--json'], {
  expectStatus: undefined,
  parse: (stdout) => {
    const j = JSON.parse(stdout);
    return { ok: j.ok, backends: j.backends.map((b) => ({ name: b.name, available: b.available, authenticated: b.authenticated })) };
  },
});
receipt.steps[receipt.steps.length - 1].ok = receipt.steps[receipt.steps.length - 1].status !== null;

// 6. Full suite, files enumerated here so no shell glob expansion is needed.
if (!flag('--skip-suite')) {
  run('npm test (unit + e2e, tap)', process.execPath, ['--test', '--test-reporter=tap', ...listTests('tests/unit'), ...listTests('tests/e2e')], { parse: parseTap });
}

const failed = receipt.steps.filter((s) => !s.ok).map((s) => s.name);
receipt.summary = {
  stepsRun: receipt.steps.length,
  stepsFailed: failed,
  suite: receipt.steps.find((s) => s.name.startsWith('npm test'))?.parsed ?? null,
  lifecycle: receipt.steps.find((s) => s.name.startsWith('cancellation'))?.parsed ?? null,
  verdict: 'recorded; interpretation belongs to the maintenance record, not this script',
};

mkdirSync(resolve(outPath, '..'), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stderr.write(`\nreceipt: ${outPath}\n${failed.length ? `failed steps: ${failed.join(', ')}` : 'all steps ok'}\n`);
process.exitCode = failed.length ? 1 : 0;
if (!existsSync(outPath)) process.exitCode = 2;
