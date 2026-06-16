import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { isAuthenticated as kimiAuthenticated } from '../../src/backends/kimi-cli.js';
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

// os.homedir() ignores $HOME on this platform (it resolves via getpwuid), so the
// OAuth-credentials path cannot be redirected to a temp dir. authHint() reads
// only the env var, so it is the deterministic surface for the trim guard.
test('gemini authHint treats a whitespace-only GEMINI_API_KEY as not authenticated (#508 G8)', () => {
  withEnv(GEMINI_ENV, () => {
    process.env.GEMINI_API_KEY = '   \t ';
    assert.doesNotMatch(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);

    process.env.GEMINI_API_KEY = '';
    assert.doesNotMatch(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);

    delete process.env.GEMINI_API_KEY;
    assert.doesNotMatch(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);

    process.env.GEMINI_API_KEY = 'AIza-real-key';
    assert.match(geminiAuthHint(), /Authenticated via GEMINI_API_KEY/);
  });
});

// The env-key half of isAuthenticated is only observable when the OAuth
// credentials file is absent; otherwise that file short-circuits to true. Skip
// (rather than flake) on hosts that already have a real Gemini login on disk.
const geminiOAuthPresent = existsSync(join(homedir(), '.gemini', 'gemini-credentials.json'));

test('gemini isAuthenticated requires a non-blank GEMINI_API_KEY when no OAuth file exists (#508 G8)', {
  skip: geminiOAuthPresent ? 'Gemini OAuth credentials present on this host mask the env-key path' : false,
}, () => {
  withEnv(GEMINI_ENV, () => {
    delete process.env.GEMINI_API_KEY;
    assert.equal(geminiAuthenticated(), false);

    process.env.GEMINI_API_KEY = '';
    assert.equal(geminiAuthenticated(), false);

    process.env.GEMINI_API_KEY = '   \t ';
    assert.equal(geminiAuthenticated(), false);

    process.env.GEMINI_API_KEY = 'AIza-real-key';
    assert.equal(geminiAuthenticated(), true);
  });
});

test('gemini isAuthenticated accepts a non-blank GEMINI_API_KEY (env path unchanged)', () => {
  withEnv(GEMINI_ENV, () => {
    process.env.GEMINI_API_KEY = 'AIza-real-key';
    assert.equal(geminiAuthenticated(), true);
  });
});