import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isAuthenticated as kimiAuthenticated } from '../../src/backends/kimi-cli.js';
import {
  hasMacOsKeychainCredentials,
  isAuthenticated as claudeAuthenticated,
  readClaudeCredentialState,
} from '../../src/backends/claude-cli.js';
import {
  isAuthenticated as geminiAuthenticated,
  authHint as geminiAuthHint,
} from '../../src/backends/gemini-cli.js';

// Snapshot/restore so these tests never leak env mutations to siblings.
function withEnv(keys, body) {
  const saved = {};
  for (const key of keys) saved[key] = process.env[key];
  try {
    return body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Owned, self-cleaning fixture root. Credential fixtures live here only; no
// test reads the real home credential files or the host login state.
function withOwnedDir(prefix, body) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Unmistakably fake fixture tokens; never a real or real-shaped credential.
const FAKE_CLAUDE_TOKEN = 'patina-test-fake-claude-token';
const FAKE_GEMINI_KEY = 'patina-test-fake-gemini-key';

// readClaudeCredentialState takes the file path directly and is already
// deterministic; the isAuthenticated() wrappers accept the same path as an
// internal test seam (the no-argument production default is unchanged).
test('claude credential state distinguishes missing, unreadable, expired and live sessions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-claude-auth-'));
  const file = join(dir, '.credentials.json');
  const now = 1_800_000_000_000;
  const write = (value) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  try {
    assert.equal(readClaudeCredentialState(file, now), 'missing');

    write('{not json');
    assert.equal(readClaudeCredentialState(file, now), 'unreadable');

    // Unknown layout (what the e2e fake login writes) keeps presence semantics.
    write({});
    assert.equal(readClaudeCredentialState(file, now), 'ok');

    // Logged-out shape observed on disk: blank tokens, expiresAt 0, refresh
    // expiry still in the future. Nothing usable remains.
    write({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0, refreshTokenExpiresAt: now + 1 } });
    assert.equal(readClaudeCredentialState(file, now), 'expired');

    // Access token expired but a live refresh token lets the CLI renew it.
    write({ claudeAiOauth: { accessToken: 'a', expiresAt: now - 1, refreshToken: 'r', refreshTokenExpiresAt: now + 1 } });
    assert.equal(readClaudeCredentialState(file, now), 'ok');

    // Both tokens past their timestamps.
    write({ claudeAiOauth: { accessToken: 'a', expiresAt: now - 1, refreshToken: 'r', refreshTokenExpiresAt: now - 1 } });
    assert.equal(readClaudeCredentialState(file, now), 'expired');

    // Live access token with no timestamp is not treated as expired.
    write({ claudeAiOauth: { accessToken: 'a' } });
    assert.equal(readClaudeCredentialState(file, now), 'ok');

    // Whitespace-only tokens are blank.
    write({ claudeAiOauth: { accessToken: ' \t', refreshToken: '' } });
    assert.equal(readClaudeCredentialState(file, now), 'expired');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude macOS Keychain probe runs `security` only on darwin with a finite bound (#829, #448)', () => {
  const calls = [];
  const spawn = (result) => (...args) => { calls.push(args); return result; };

  // Non-darwin platforms never touch the Keychain: the file check decides.
  for (const platform of ['linux', 'win32', 'freebsd']) {
    assert.equal(hasMacOsKeychainCredentials({ platform, spawnSyncImpl: spawn({ status: 0 }) }), false);
  }
  assert.equal(calls.length, 0);

  // A stored `Claude Code-credentials` generic password means authenticated.
  assert.equal(hasMacOsKeychainCredentials({ platform: 'darwin', spawnSyncImpl: spawn({ status: 0 }) }), true);
  // The probe is bounded: 5000ms mirrors the doctor checkCommand convention
  // (#448) and killSignal SIGKILL makes the bound strict — a wedged
  // `security` that ignored SIGTERM cannot hold auth classification.
  assert.deepEqual(calls[0], ['security', ['find-generic-password', '-s', 'Claude Code-credentials'], { stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL' }]);

  // A lookup miss (e.g. errSecItemNotFound) means the Keychain has no session.
  assert.equal(hasMacOsKeychainCredentials({ platform: 'darwin', spawnSyncImpl: spawn({ status: 44 }) }), false);

  // A missing `security` binary surfaces as a spawn error, not a throw; any
  // synchronous failure also falls back to the file check instead of crashing.
  assert.equal(hasMacOsKeychainCredentials({ platform: 'darwin', spawnSyncImpl: spawn({ status: null, error: new Error('spawn security ENOENT') }) }), false);
  assert.equal(hasMacOsKeychainCredentials({ platform: 'darwin', spawnSyncImpl: () => { throw new Error('spawn failed'); } }), false);

  // A Keychain query that outlives the bound (spawnSync timeout shape: status
  // null, killed by the configured SIGKILL, ETIMEDOUT error) fails closed
  // like any other probe error — the file check decides instead of waiting.
  const timedOut = Object.assign(new Error('spawn security ETIMEDOUT'), { code: 'ETIMEDOUT' });
  assert.equal(hasMacOsKeychainCredentials({ platform: 'darwin', spawnSyncImpl: spawn({ status: null, signal: 'SIGKILL', error: timedOut }) }), false);
});

test('claude isAuthenticated classifies an owned credentials file, never the host home', () => {
  withOwnedDir('patina-claude-auth-', (dir) => {
    const file = join(dir, '.credentials.json');
    // A Keychain probe must never run off darwin; returning a would-be hit
    // also makes any rogue probe flip the missing/expired cases below.
    const calls = [];
    const spawnSyncImpl = (...args) => { calls.push(args); return { status: 0 }; };
    const linux = { credentialsFile: file, platform: 'linux', spawnSyncImpl };

    // Missing credentials file → not authenticated.
    assert.equal(claudeAuthenticated(linux), false);

    // Valid/live credential file → authenticated.
    writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_CLAUDE_TOKEN } }));
    assert.equal(claudeAuthenticated(linux), true);

    // Expired/logged-out shape observed on disk (blank tokens, expiresAt 0,
    // refresh expiry still in the future) → not authenticated.
    writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0, refreshTokenExpiresAt: Date.now() + 3_600_000 } }));
    assert.equal(claudeAuthenticated(linux), false);

    // Unknown layout keeps the presence-compatibility behavior.
    writeFileSync(file, JSON.stringify({}));
    assert.equal(claudeAuthenticated(linux), true);

    assert.equal(calls.length, 0);
  });
});

test('claude isAuthenticated on darwin keeps file-first order with Keychain fallback (#829)', () => {
  withOwnedDir('patina-claude-auth-', (dir) => {
    const file = join(dir, '.credentials.json');
    const probe = (result) => {
      const calls = [];
      return { calls, spawnSyncImpl: (...args) => { calls.push(args); return result; } };
    };

    // The file classifies as authenticated → the Keychain path is not needed
    // and does not run (existing short-circuit order).
    writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_CLAUDE_TOKEN } }));
    let p = probe({ status: 0 });
    assert.equal(claudeAuthenticated({ credentialsFile: file, platform: 'darwin', spawnSyncImpl: p.spawnSyncImpl }), true);
    assert.equal(p.calls.length, 0);

    // The file cannot authenticate but the Keychain can → authenticated.
    rmSync(file, { force: true });
    p = probe({ status: 0 });
    assert.equal(claudeAuthenticated({ credentialsFile: file, platform: 'darwin', spawnSyncImpl: p.spawnSyncImpl }), true);
    assert.equal(p.calls.length, 1);

    // The file is expired and the Keychain has no session → not authenticated.
    writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0, refreshTokenExpiresAt: Date.now() + 3_600_000 } }));
    p = probe({ status: 44 });
    assert.equal(claudeAuthenticated({ credentialsFile: file, platform: 'darwin', spawnSyncImpl: p.spawnSyncImpl }), false);
    assert.equal(p.calls.length, 1);
  });
});

const KIMI_ENV = ['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_SHARE_DIR'];
const GEMINI_ENV = ['GEMINI_API_KEY'];

test('kimi isAuthenticated rejects a missing or zero-byte config.toml, accepts a populated one (#508 G8)', () => {
  withEnv(KIMI_ENV, () => {
    const dir = mkdtempSync(join(tmpdir(), 'patina-kimi-auth-'));
    try {
      // Neutralize the env-key and credentials-dir paths so config.toml decides.
      delete process.env.KIMI_API_KEY;
      delete process.env.MOONSHOT_API_KEY;
      process.env.KIMI_SHARE_DIR = dir;

      // No config file at all → not authenticated.
      assert.equal(kimiAuthenticated(), false);

      // Zero-byte config — the previously-broken "exists ⇒ authenticated" case.
      writeFileSync(join(dir, 'config.toml'), '');
      assert.equal(kimiAuthenticated(), false);

      // A populated config → authenticated.
      writeFileSync(join(dir, 'config.toml'), 'api_key = "sk-test"\n');
      assert.equal(kimiAuthenticated(), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('kimi isAuthenticated still honors an env key with no config file', () => {
  withEnv(KIMI_ENV, () => {
    const dir = mkdtempSync(join(tmpdir(), 'patina-kimi-auth-'));
    try {
      process.env.KIMI_SHARE_DIR = dir; // empty: no config, no credentials dir
      delete process.env.MOONSHOT_API_KEY;
      process.env.KIMI_API_KEY = 'sk-env';
      assert.equal(kimiAuthenticated(), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// authHint() reads only the env var, so it is already deterministic and
// host-independent; the trim guard is pinned here.
test('gemini authHint treats a whitespace-only GEMINI_API_KEY as not authenticated (#508 G8)', () => {
  withEnv(GEMINI_ENV, () => {
    process.env.GEMINI_API_KEY = '   \t ';
    assert.doesNotMatch(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);

    process.env.GEMINI_API_KEY = '';
    assert.doesNotMatch(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);

    delete process.env.GEMINI_API_KEY;
    assert.doesNotMatch(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);

    process.env.GEMINI_API_KEY = FAKE_GEMINI_KEY;
    assert.match(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);
  });
});

// Every case classifies an owned fixture path, so the result no longer depends
// on whether this host happens to hold a real Gemini OAuth login.
test('gemini isAuthenticated combines an owned OAuth file and GEMINI_API_KEY (#508 G8)', () => {
  withEnv(GEMINI_ENV, () => {
    withOwnedDir('patina-gemini-auth-', (dir) => {
      const file = join(dir, 'gemini-credentials.json');

      // OAuth file absent + API key absent → not authenticated.
      delete process.env.GEMINI_API_KEY;
      assert.equal(geminiAuthenticated({ credentialsFile: file }), false);

      // OAuth file absent + blank/whitespace API key → not authenticated.
      process.env.GEMINI_API_KEY = '';
      assert.equal(geminiAuthenticated({ credentialsFile: file }), false);
      process.env.GEMINI_API_KEY = '   \t ';
      assert.equal(geminiAuthenticated({ credentialsFile: file }), false);

      // OAuth file absent + non-blank API key → authenticated.
      process.env.GEMINI_API_KEY = FAKE_GEMINI_KEY;
      assert.equal(geminiAuthenticated({ credentialsFile: file }), true);

      // OAuth file present (even zero-byte: presence alone is the OAuth
      // signal; contents are not validated) + API key absent → authenticated.
      writeFileSync(file, '');
      delete process.env.GEMINI_API_KEY;
      assert.equal(geminiAuthenticated({ credentialsFile: file }), true);

      // OAuth file present + blank API key → authenticated.
      process.env.GEMINI_API_KEY = '   \t ';
      assert.equal(geminiAuthenticated({ credentialsFile: file }), true);
    });
  });
});