#!/usr/bin/env node
// Cross-platform smoke for maintenance item P16b: run the representative
// install / start / non-ASCII-path / cancellation / suite checks on one
// machine and write two files:
//
//   docs/operations/platform-smoke-<platform>-<arch>-<date>.json   (public)
//   docs/internal/platform-smoke-<platform>-<arch>-<date>.diagnostics.json
//
// The public receipt is structured, allow-listed evidence only: exit
// statuses, parsed counts, failing test names, sanitized error messages. Raw
// child stdout/stderr go to the gitignored diagnostics file for the operator.
// A failing step is evidence, never a reason to stop; every step is recorded
// and the receipt is written even when setup itself fails.
//
//   node scripts/platform-smoke.mjs [--skip-install] [--skip-suite] [--out <file>]
//
// No LLM call is made: the text path uses --offline scoring and inspect.
// No environment values are recorded, only the names of key variables that
// are set.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, homedir, release, tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WIN = process.platform === 'win32';
const NPM = WIN ? 'npm.cmd' : 'npm';
const STEP_TIMEOUT_MS = 20 * 60 * 1000;
const DIAG_CAP = 20_000;
const KEY_ENV_NAMES = ['PATINA_API_KEY', 'PATINA_API_KEY_FILE', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'MINIMAX_API_KEY'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const stem = `platform-smoke-${process.platform}-${arch()}-${today}`;
const outPath = resolve(optionValue('--out') || join(REPO_ROOT, 'docs', 'operations', `${stem}.json`));
const diagPath = join(REPO_ROOT, 'docs', 'internal', `${stem}.diagnostics.json`);

const HOME = homedir();
// Secret values that must never appear in either file: every configured key
// value, plus the home directory (identity) in the public receipt.
const secretValues = KEY_ENV_NAMES.map((k) => process.env[k]).filter((v) => typeof v === 'string' && v.length >= 4);

function redact(text, { paths = true } = {}) {
  let out = String(text ?? '');
  for (const v of secretValues) out = out.split(v).join('***');
  out = out.replace(/(\w+:\/\/)[^/\s]*@/g, '$1***@');
  if (paths && HOME) out = out.split(HOME).join('~');
  return out;
}

function git(argv) {
  try {
    const r = spawnSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

const gitStatus = git(['status', '--porcelain']);
const receipt = {
  schemaVersion: 2,
  recordType: 'platform-smoke',
  planIds: ['P16b'],
  observedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    release: release(),
    arch: arch(),
    node: process.version,
    shell: basename(process.env.SHELL || process.env.ComSpec || '') || null,
    homeHasNonAscii: /[^\x20-\x7e]/.test(HOME),
    tmpdirHasSpace: /\s/.test(tmpdir()),
  },
  repo: {
    root: redact(REPO_ROOT),
    head: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: gitStatus === null ? null : gitStatus !== '',
    gitAvailable: gitStatus !== null,
  },
  keyEnvNamesSet: KEY_ENV_NAMES.filter((k) => Boolean(process.env[k])),
  steps: [],
  summary: null,
  diagnostics: 'docs/internal/<stem>.diagnostics.json (gitignored; raw child output, operator-only)',
};
const diagnostics = { stem, steps: [] };

/**
 * Run one child process and record it. `okWhen(result, parsed)` decides the
 * verdict once; the default is exit status 0 with no spawn error.
 */
function run(name, command, argv, { cwd = REPO_ROOT, env = {}, parse = null, okWhen = null } = {}) {
  const started = Date.now();
  const result = spawnSync(command, argv, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    shell: WIN && command.endsWith('.cmd'),
  });
  let parsed = null;
  let parseError = null;
  if (parse) {
    try {
      parsed = parse(result.stdout || '', result.stderr || '');
    } catch (err) {
      parseError = redact(String(err?.message ?? err));
    }
  }
  const ok = okWhen
    ? okWhen(result, parsed, parseError)
    : result.status === 0 && !result.error && parseError === null;
  const step = {
    name,
    command: redact([command, ...argv].join(' ')),
    cwd: cwd === REPO_ROOT ? '.' : redact(cwd),
    status: result.status,
    signal: result.signal || null,
    ms: Date.now() - started,
    ok,
    spawnError: result.error ? redact(String(result.error.message)) : null,
    parseError,
    parsed,
  };
  receipt.steps.push(step);
  diagnostics.steps.push({
    name,
    stdoutTail: redact(String(result.stdout || '').slice(-DIAG_CAP), { paths: false }),
    stderrTail: redact(String(result.stderr || '').slice(-DIAG_CAP), { paths: false }),
  });
  process.stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${name} (${step.ms} ms${result.status === null ? `, ${result.signal || 'no exit'}` : `, exit ${result.status}`})\n`);
  return step;
}

// A setup failure that prevents a step from even starting is still a step.
function recordSetupFailure(name, err) {
  const step = { name, command: null, cwd: '.', status: null, signal: null, ms: 0, ok: false, spawnError: null, parseError: null, parsed: null, setupError: redact(String(err?.message ?? err)) };
  receipt.steps.push(step);
  process.stderr.write(`FAIL ${name} (setup: ${step.setupError})\n`);
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
    if (m) failing.push(redact(m[1].replace(/\s+# .*$/, '')));
  }
  if (totals.tests === null) throw new Error('no TAP trailer found; the test run did not complete');
  return { ...totals, failing: failing.slice(0, 50) };
}

function listTests(dir) {
  return readdirSync(join(REPO_ROOT, dir)).filter((f) => f.endsWith('.test.js')).map((f) => `${dir}${sep}${f}`);
}

let smokeRoot = null;
try {
  // 1. Clean dependency install from the lockfile.
  if (!flag('--skip-install')) {
    run('npm ci', NPM, ['ci', '--no-audit', '--no-fund']);
  } else {
    receipt.steps.push({ name: 'npm ci', ok: null, skipped: '--skip-install' });
  }

  // 2. The CLI starts.
  run('cli --version', process.execPath, ['bin/patina.js', '--version'], {
    parse: (stdout) => ({ version: stdout.trim() }),
  });

  // 3. Non-ASCII + space paths: input file, output directory and cwd all carry
  // Korean and a space. Offline scoring needs no backend.
  let inputPath = null;
  let inputDir = null;
  let outDir = null;
  try {
    smokeRoot = mkdtempSync(join(tmpdir(), 'patina smoke 한글 경로 '));
    inputDir = join(smokeRoot, '입력 폴더');
    outDir = join(smokeRoot, '출력 폴더');
    mkdirSync(inputDir);
    mkdirSync(outDir);
    const fixture = readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'suspect-zones', 'ko', 'ai', 'ko-ai-01.md'), 'utf8');
    const body = `${fixture.split(/^---$/m).slice(2).join('---').trim()}\n`;
    inputPath = join(inputDir, '초안 파일.md');
    writeFileSync(inputPath, body);
  } catch (err) {
    recordSetupFailure('Korean/space path fixture setup', err);
  }
  if (inputPath) {
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
      parse: () => ({ outdirEntries: readdirSync(outDir).length }),
    });
  }

  // 4. Owned-process cancellation and session isolation. These tests make
  // platform-specific promises: on platforms without POSIX process groups
  // they skip, which is absent coverage, not a pass. backend-agy launch tests
  // skip for a different reason (unsafe host Antigravity settings), so skip
  // counts must be read with the failing/skipped names, not alone.
  run('cancellation + isolation tests', process.execPath, [
    '--test', '--test-reporter=tap',
    `tests${sep}unit${sep}backend-cancellation.test.js`, `tests${sep}unit${sep}backend-agy.test.js`, `tests${sep}e2e${sep}session-isolation.test.js`,
  ], { parse: parseTap });

  // 5. Setup diagnostics without network. Exit 1 with a valid report means
  // "no usable backend on this machine", which is a legitimate observation;
  // anything else (crash, no JSON) is a failure.
  run('doctor --offline --json', process.execPath, ['bin/patina.js', 'doctor', '--offline', '--json'], {
    parse: (stdout) => {
      const j = JSON.parse(stdout);
      if (!Array.isArray(j.checks) || !Array.isArray(j.backends)) throw new Error('doctor JSON lacks checks/backends');
      return { ok: j.ok, blockers: (j.blockers || []).map((b) => b.name), backends: j.backends.map((b) => ({ name: b.name, available: b.available, authenticated: b.authenticated })) };
    },
    okWhen: (result, parsed, parseError) => (result.status === 0 || result.status === 1) && !result.error && parseError === null && parsed !== null,
  });

  // 6. Full suite, files enumerated here so no shell glob expansion is needed.
  if (!flag('--skip-suite')) {
    run('npm test (unit + e2e, tap)', process.execPath, ['--test', '--test-reporter=tap', ...listTests('tests/unit'), ...listTests('tests/e2e')], { parse: parseTap });
  } else {
    receipt.steps.push({ name: 'npm test (unit + e2e, tap)', ok: null, skipped: '--skip-suite' });
  }
} catch (err) {
  recordSetupFailure('smoke harness', err);
} finally {
  if (smokeRoot) { try { rmSync(smokeRoot, { recursive: true, force: true }); } catch {} }

  const failed = receipt.steps.filter((s) => s.ok === false).map((s) => s.name);
  receipt.summary = {
    stepsRun: receipt.steps.filter((s) => s.ok !== null).length,
    stepsSkipped: receipt.steps.filter((s) => s.ok === null).map((s) => s.name),
    stepsFailed: failed,
    suite: receipt.steps.find((s) => s.name.startsWith('npm test'))?.parsed ?? null,
    lifecycle: receipt.steps.find((s) => s.name.startsWith('cancellation'))?.parsed ?? null,
    verdict: 'recorded; interpretation belongs to the maintenance record, not this script',
  };

  let wrote = true;
  try {
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (err) {
    wrote = false;
    process.stderr.write(`could not write receipt ${outPath}: ${redact(String(err?.message ?? err))}\n`);
  }
  try {
    mkdirSync(resolve(diagPath, '..'), { recursive: true });
    writeFileSync(diagPath, `${JSON.stringify(diagnostics, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`could not write diagnostics ${diagPath}: ${redact(String(err?.message ?? err))}\n`);
  }
  process.stderr.write(`\nreceipt: ${wrote ? outPath : '(not written)'}\ndiagnostics (private): ${diagPath}\n${failed.length ? `failed steps: ${failed.join(', ')}` : 'all steps ok'}\n`);
  process.exitCode = !wrote ? 2 : (failed.length ? 1 : 0);
}
