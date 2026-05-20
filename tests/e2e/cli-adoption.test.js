import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import yaml from 'js-yaml';
import { main } from '../../src/cli.js';

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
      assert.ok(Array.isArray(config['max-models']));
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI adoption exit/error behavior', () => {
  it('unknown flags fail before stdin handling with a usage exit', () => {
    const result = spawnSync(process.execPath, [BIN, '--bogus'], {
      cwd: REPO_ROOT,
      input: '',
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /\[patina\] Error: unknown option --bogus/);
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
});
