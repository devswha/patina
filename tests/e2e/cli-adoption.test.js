import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { main, resolveProfileForLanguage } from '../../src/cli.js';
import { startMockServer } from './helpers/mock-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const BIN = resolve(REPO_ROOT, 'bin/patina.js');

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { logs, errors };
}

async function withEnv(envOverrides, fn) {
  const original = {};
  for (const key of Object.keys(envOverrides)) {
    original[key] = process.env[key];
    if (envOverrides[key] === undefined) delete process.env[key];
    else process.env[key] = envOverrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

// Async spawn wrapper for tests that talk to the in-process mock server:
// spawnSync would block the event loop and deadlock the mock's responses.
function runCli(args, { input = '', env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe('CLI adoption commands', () => {
  it('patina doctor --json reports setup checks without an LLM call', async () => {
    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withEnv({ PATINA_API_KEY: 'test-key', PATINA_API_KEY_FILE: undefined }, async () => {
        const { logs } = await captureConsole(() => main(['doctor', '--json']));
        const report = JSON.parse(logs.join('\n'));
        assert.strictEqual(report.ok, true);
        assert.ok(report.node.ok);
        assert.ok(report.backends.some((backend) => backend.name === 'openai-http'));
        assert.ok(report.providers.some((provider) => provider.name === 'openai'));
      });
    } finally {
      process.exitCode = oldExitCode;
    }
  });

  it('patina doctor defaults to text output and exits 1 when no backend is usable', async () => {
    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withEnv({
        PATH: '',
        PATINA_API_KEY: undefined,
        PATINA_API_KEY_FILE: undefined,
        OPENAI_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
        GROQ_API_KEY: undefined,
        TOGETHER_API_KEY: undefined,
        KIMI_API_KEY: undefined,
        MOONSHOT_API_KEY: undefined,
      }, async () => {
        const { logs } = await captureConsole(() => main(['doctor']));
        const output = logs.join('\n');
        assert.strictEqual(process.exitCode, 1);
        assert.match(output, /^patina doctor — blockers found/);
        assert.match(output, /Checks:/);
        assert.match(output, /Blockers:/);
        assert.match(output, /no authenticated backend/);
      });
    } finally {
      process.exitCode = oldExitCode;
    }
  });

  it('patina doctor treats PATINA_API_KEY_FILE as an authenticated HTTP backend source', async () => {
    const oldExitCode = process.exitCode;
    const dir = mkdtempSync(join(tmpdir(), 'patina-doctor-key-file-'));
    const keyFile = join(dir, 'key.txt');
    writeFileSync(keyFile, 'test-key\n');
    process.exitCode = undefined;
    try {
      await withEnv({
        PATINA_API_KEY: undefined,
        OPENAI_API_KEY: 'env-key',
        GEMINI_API_KEY: undefined,
        GROQ_API_KEY: undefined,
        TOGETHER_API_KEY: undefined,
        KIMI_API_KEY: undefined,
        MOONSHOT_API_KEY: undefined,
        PATINA_API_KEY_FILE: keyFile,
      }, async () => {
        const { logs } = await captureConsole(() => main(['doctor', '--json']));
        const report = JSON.parse(logs.join('\n'));
        const http = report.backends.find((backend) => backend.name === 'openai-http');
        const usable = report.checks.find((check) => check.name === 'usable-backend');
        const openai = report.providers.find((provider) => provider.name === 'openai');
        assert.strictEqual(report.ok, true);
        assert.strictEqual(http.authenticated, true);
        assert.strictEqual(usable.status, 'ok');
        assert.match(usable.detail, /openai-http/);
        assert.strictEqual(openai.keySource, 'PATINA_API_KEY_FILE');
      });
    } finally {
      process.exitCode = oldExitCode;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('patina --list-backends shows selectors and setup guidance', async () => {
    await withEnv({
      PATINA_API_KEY: 'test-key',
      PATINA_API_KEY_FILE: undefined,
      OPENAI_API_KEY: undefined,
      GEMINI_API_KEY: 'gemini-key',
      KIMI_API_KEY: undefined,
      MOONSHOT_API_KEY: undefined,
    }, async () => {
      const { logs } = await captureConsole(() => main(['--list-backends']));
      const output = logs.join('\n');
      assert.match(output, /Kind/);
      assert.match(output, /Select with/);
      assert.match(output, /Default model/);
      assert.match(output, /default, --backend openai-http, --provider <name>/);
      assert.match(output, /--model codex-\*/);
      assert.match(output, /--model gemini-\*/);
      assert.match(output, /--model kimi-\*/);
      assert.match(output, /gpt-5\.5/);
      assert.match(output, /gemini-2\.5-pro/);
      assert.match(output, /kimi-code\/kimi-for-coding/);
      assert.match(output, /PATINA_API_KEY/);
    });
  });

  it('--provider gemini stays on the HTTP backend without a model heuristic detour', () => {
    return withEnv({
      PATINA_API_KEY: undefined,
      PATINA_API_KEY_FILE: undefined,
      GEMINI_API_KEY: undefined,
      KIMI_API_KEY: undefined,
      MOONSHOT_API_KEY: undefined,
    }, () => {
      const result = spawnSync(process.execPath, [BIN, '--provider', 'gemini', '--lang', 'en'], {
        cwd: REPO_ROOT,
        input: 'This draft needs editing.\n',
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /no API key found/);
      assert.match(result.stderr, /--provider gemini expects GEMINI_API_KEY/);
      assert.doesNotMatch(result.stderr, /gemini-cli backend/);
    });
  });

  it('rewrites stdin through a real subprocess and keeps --quiet stdout to the humanized body', async () => {
    const mock = await startMockServer([
      '[BODY]',
      'This is the subprocess humanized result.',
      '[/BODY]',
      '',
      '[SELF_AUDIT]',
      'No user-facing output.',
      '[/SELF_AUDIT]',
    ].join('\n'));
    try {
      const result = await runCli([
        '--lang', 'en',
        '--quiet',
        '--format', 'text',
        '--base-url', `http://127.0.0.1:${mock.port}`,
      ], {
        input: 'This draft needs editing.\n',
        env: {
          ...process.env,
          PATINA_API_KEY: 'test-key',
          PATINA_API_KEY_FILE: '',
          PATINA_API_BASE: '',
          OPENAI_API_KEY: '',
          GEMINI_API_KEY: '',
          GROQ_API_KEY: '',
          TOGETHER_API_KEY: '',
          KIMI_API_KEY: '',
          MOONSHOT_API_KEY: '',
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.stdout, 'This is the subprocess humanized result.\n');
    } finally {
      await mock.stop();
    }
  });

  it('patina-humanizer alias bin resolves the local patina-cli package and executes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patina-humanizer-alias-'));
    try {
      const nodeModules = join(dir, 'node_modules');
      const aliasPackage = join(nodeModules, 'patina-humanizer');
      mkdirSync(join(aliasPackage, 'bin'), { recursive: true });
      symlinkSync(REPO_ROOT, join(nodeModules, 'patina-cli'), 'dir');

      const sourceAliasBin = resolve(REPO_ROOT, 'packages/patina-humanizer/bin/patina-humanizer.js');
      const aliasBin = join(aliasPackage, 'bin/patina-humanizer.js');
      writeFileSync(aliasBin, readFileSync(sourceAliasBin, 'utf8'));
      const result = spawnSync(process.execPath, [aliasBin, '--version'], {
        cwd: dir,
        input: '',
        encoding: 'utf8',
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /^patina \d+\.\d+\.\d+\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('patina init exits with a removed-command usage error', () => {
    const result = spawnSync(process.execPath, [BIN, 'init', '--defaults'], {
      cwd: REPO_ROOT,
      input: '',
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /\[patina\] Error: patina init was removed/);
    assert.doesNotMatch(result.stderr, /empty input/);
  });

  it('falls back from the ko-only NamuWiki profile outside Korean', () => {
    const warnings = [];
    const resolved = resolveProfileForLanguage('namuwiki', 'en', {
      warn: (event, payload) => warnings.push({ event, payload }),
    });
    assert.strictEqual(resolved, 'default');
    assert.strictEqual(warnings[0]?.event, 'profile.unsupported_language');
    assert.match(warnings[0]?.payload?.message, /profile "namuwiki" is ko-only/);
  });
});

describe('CLI adoption exit/error behavior', () => {
  it('unknown flags fail before stdin handling with a usage exit', () => {
    for (const flag of ['--bogus', '--gate', '--json', '--json-logs', '--list-providers', '--variants', '--save-run', '--cache', '--cache-ttl', '--no-cache', '--suspected-generator', '--prompt-mode']) {
      const result = spawnSync(process.execPath, [BIN, flag], {
        cwd: REPO_ROOT,
        input: '',
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 2);
      assert.match(result.stderr, new RegExp(`\\[patina\\] Error: unknown option ${flag}`));
    }
  });

  it('empty stdin uses the three-line patina error format and exits 2', () => {
    const result = spawnSync(process.execPath, [BIN], {
      cwd: REPO_ROOT,
      input: '   \n',
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /\[patina\] Error: empty input on stdin/);
    assert.ok(result.stderr.includes('echo "This is a draft." | patina --lang en'));
  });

  it('value-taking usage errors use the standardized input exit code', () => {
    const cases = [
      { args: ['--tone'], message: /--tone requires a value/ },
      { args: ['--exit-on', 'nope'], message: /--exit-on expects a number/ },
      { args: ['--api-key-file'], message: /--api-key-file requires a value/ },
    ];

    for (const { args, message } of cases) {
      const result = spawnSync(process.execPath, [BIN, ...args], {
        cwd: REPO_ROOT,
        input: '',
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 2, `${args.join(' ')} should exit 2`);
      assert.match(result.stderr, message);
    }
  });

  it('--format rejects missing and unsupported values with usage exits', () => {
    const cases = [
      { args: ['--format'], message: /--format requires a value/ },
      { args: ['--format', 'xml'], message: /Received "xml"/ },
      { args: ['doctor', '--format'], message: /patina doctor --format expects json or text|--format requires a value/ },
      { args: ['doctor', '--format', 'markdown'], message: /Received "markdown"/ },
    ];

    for (const { args, message } of cases) {
      const result = spawnSync(process.execPath, [BIN, ...args], {
        cwd: REPO_ROOT,
        input: '',
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 2, `${args.join(' ')} should exit 2`);
      assert.match(result.stderr, message);
    }
  });

  it('--exit-on outside score mode names the alias and exits 2', () => {
    const result = spawnSync(process.execPath, [BIN, '--exit-on', '30'], {
      cwd: REPO_ROOT,
      input: '',
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /--exit-on can only be used with --score/);
  });

  it('keeps hyphen-prefixed batch suffix values parseable', () => {
    const result = spawnSync(process.execPath, [BIN, '--batch', '--suffix', '-humanized'], {
      cwd: REPO_ROOT,
      input: '   \n',
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /empty input on stdin/);
    assert.doesNotMatch(result.stderr, /--suffix requires a value/);
  });
});
