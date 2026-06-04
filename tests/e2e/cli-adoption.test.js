import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import yaml from 'js-yaml';
import { main, resolveProfileForLanguage } from '../../src/cli.js';

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

  it('patina --list-providers shows the effective shared key source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'patina-provider-key-file-'));
    const keyFile = join(dir, 'key.txt');
    writeFileSync(keyFile, 'file-key\n');
    try {
      await withEnv({
        PATINA_API_KEY: undefined,
        OPENAI_API_KEY: 'env-key',
        GEMINI_API_KEY: undefined,
        GROQ_API_KEY: undefined,
        TOGETHER_API_KEY: undefined,
        PATINA_API_KEY_FILE: keyFile,
      }, async () => {
        const { logs } = await captureConsole(() => main(['--list-providers']));
        const output = logs.join('\n');
        assert.match(output, /Key source/);
        assert.match(output, /Provider env/);
        assert.match(output, /PATINA_API_KEY_FILE/);
        assert.match(output, /OPENAI_API_KEY/);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('patina init --defaults writes a parseable project config', async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'patina-init-test-'));
    try {
      process.chdir(dir);
      await captureConsole(() => main(['init', '--defaults']));
      const config = yaml.load(readFileSync(join(dir, '.patina.yaml'), 'utf8'));
      assert.strictEqual(config.language, 'ko');
      assert.strictEqual(config.profile, 'default');
      assert.ok(config.backend);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
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
    for (const flag of ['--bogus', '--gate', '--variants', '--save-run', '--cache', '--cache-ttl', '--no-cache', '--suspected-generator', '--prompt-mode']) {
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
