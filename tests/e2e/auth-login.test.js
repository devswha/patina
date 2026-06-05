import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli.js';

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

async function captureConsole(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return logs.join('\n');
}

function writeFakeCli(binDir, name) {
  const script = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const cli = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.PATINA_FAKE_LOGIN_LOG, cli + ' ' + args.join(' ') + '\\n');

if (args[0] === '--version') process.exit(0);

if (cli === 'codex' && args.join(' ') === 'login') {
  mkdirSync(join(homedir(), '.codex'), { recursive: true });
  writeFileSync(join(homedir(), '.codex', 'auth.json'), '{}');
  process.exit(0);
}
if (cli === 'claude' && args.join(' ') === 'auth login') {
  mkdirSync(join(homedir(), '.claude'), { recursive: true });
  writeFileSync(join(homedir(), '.claude', '.credentials.json'), '{}');
  process.exit(0);
}
if (cli === 'gemini' && args.length === 0) {
  mkdirSync(join(homedir(), '.gemini'), { recursive: true });
  writeFileSync(join(homedir(), '.gemini', 'gemini-credentials.json'), '{}');
  process.exit(0);
}
if (cli === 'kimi' && args.join(' ') === 'login') {
  mkdirSync(join(homedir(), '.kimi', 'credentials'), { recursive: true });
  writeFileSync(join(homedir(), '.kimi', 'credentials', 'kimi-code.json'), '{}');
  process.exit(0);
}

process.exit(64);
`;
  const path = join(binDir, name);
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

function makeFakeCliEnv() {
  const root = mkdtempSync(join(tmpdir(), 'patina-auth-login-'));
  const binDir = join(root, 'bin');
  const home = join(root, 'home');
  const log = join(root, 'login.log');
  mkdirSync(binDir);
  mkdirSync(home);
  for (const name of ['codex', 'claude', 'gemini', 'kimi']) writeFakeCli(binDir, name);
  return {
    HOME: home,
    PATH: `${binDir}:${process.env.PATH || ''}`,
    PATINA_FAKE_LOGIN_LOG: log,
    GEMINI_API_KEY: undefined,
    KIMI_API_KEY: undefined,
    MOONSHOT_API_KEY: undefined,
    log,
    home,
  };
}

describe('patina auth login <backend>', () => {
  it('keeps no-arg login as a per-backend instruction listing', async () => {
    const output = await captureConsole(async () => {
      await main(['auth', 'login']);
    });

    assert.match(output, /To authenticate a backend/);
    assert.match(output, /codex-cli/);
    assert.match(output, /claude-cli/);
    assert.match(output, /gemini-cli/);
    assert.match(output, /kimi-cli/);
  });

  it('launches codex login and re-checks authentication', async () => {
    const env = makeFakeCliEnv();
    const output = await withEnv(env, () => captureConsole(async () => {
      await main(['auth', 'login', 'codex-cli', '--yes']);
    }));

    assert.match(readFileSync(env.log, 'utf8'), /codex --version\ncodex login\n/);
    assert.ok(existsSync(join(env.home, '.codex', 'auth.json')));
    assert.match(output, /codex-cli: authenticated/);
  });

  it('launches claude, gemini, and kimi interactive login flows', async () => {
    const env = makeFakeCliEnv();
    const output = await withEnv(env, () => captureConsole(async () => {
      await main(['auth', 'login', 'claude-cli', '--yes']);
      await main(['auth', 'login', 'gemini-cli', '--yes']);
      await main(['auth', 'login', 'kimi-cli', '--yes']);
    }));

    const log = readFileSync(env.log, 'utf8');
    assert.match(log, /claude --version\nclaude auth login\n/);
    assert.match(log, /gemini --version\ngemini \n/);
    assert.match(log, /kimi --version\nkimi login\n/);
    assert.ok(existsSync(join(env.home, '.claude', '.credentials.json')));
    assert.ok(existsSync(join(env.home, '.gemini', 'gemini-credentials.json')));
    assert.ok(existsSync(join(env.home, '.kimi', 'credentials', 'kimi-code.json')));
    assert.match(output, /claude-cli: authenticated/);
    assert.match(output, /gemini-cli: authenticated/);
    assert.match(output, /kimi-cli: authenticated/);
  });

  it('reports unsupported HTTP login instead of spawning', async () => {
    await assert.rejects(
      () => main(['auth', 'login', 'openai-http', '--yes']),
      /does not support interactive login/
    );
  });

  it('fails gracefully when the requested CLI is not installed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'patina-auth-missing-'));
    await withEnv({ PATH: root, HOME: root }, async () => {
      await assert.rejects(
        () => main(['auth', 'login', 'codex-cli', '--yes']),
        /codex-cli CLI is not installed or not on PATH/
      );
    });
  });
});
