import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as hosted from '../../src/backends/patina-hosted.js';
import { PatinaCliError } from '../../src/errors.js';

const URL_VAR = hosted.urlEnvVar;
const KEY_VAR = hosted.keyEnvVar;

let savedUrl;
let savedKey;

beforeEach(() => {
  savedUrl = process.env[URL_VAR];
  savedKey = process.env[KEY_VAR];
  delete process.env[URL_VAR];
  delete process.env[KEY_VAR];
});

afterEach(() => {
  restore(URL_VAR, savedUrl);
  restore(KEY_VAR, savedKey);
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('patina-hosted backend: duck-typed contract', () => {
  it('exposes the registry shape', () => {
    assert.strictEqual(hosted.name, 'patina-hosted');
    assert.strictEqual(typeof hosted.isAvailable, 'function');
    assert.strictEqual(typeof hosted.isAuthenticated, 'function');
    assert.strictEqual(typeof hosted.authHint, 'function');
    assert.strictEqual(typeof hosted.invoke, 'function');
  });

  it('reports availability from PATINA_HOSTED_URL only', () => {
    assert.strictEqual(hosted.isAvailable(), false);
    process.env[URL_VAR] = 'https://hosted.example/api';
    assert.strictEqual(hosted.isAvailable(), true);
  });

  it('reports authentication from PATINA_HOSTED_KEY only', () => {
    assert.strictEqual(hosted.isAuthenticated(), false);
    process.env[KEY_VAR] = 'secret';
    assert.strictEqual(hosted.isAuthenticated(), true);
  });

  it('returns an authHint naming both env vars', () => {
    const hint = hosted.authHint();
    assert.strictEqual(typeof hint, 'string');
    assert.match(hint, new RegExp(URL_VAR));
    assert.match(hint, new RegExp(KEY_VAR));
  });
});

describe('patina-hosted backend: explicit failure, never a silent fallback', () => {
  it('fails with an input error when the URL is unset', async () => {
    await assert.rejects(
      () => hosted.invoke({ prompt: 'rewrite this' }),
      (err) => {
        assert.ok(err instanceof PatinaCliError);
        assert.strictEqual(err.exitCode, 2);
        assert.match(err.message, /not configured/);
        return true;
      }
    );
  });

  it('fails with an input error when the key is unset', async () => {
    process.env[URL_VAR] = 'https://hosted.example/api';
    await assert.rejects(
      () => hosted.invoke({ prompt: 'rewrite this' }),
      (err) => {
        assert.ok(err instanceof PatinaCliError);
        assert.strictEqual(err.exitCode, 2);
        assert.match(err.message, /not authenticated/);
        return true;
      }
    );
  });

  it('rejects an empty prompt before touching the network', async () => {
    process.env[URL_VAR] = 'https://hosted.example/api';
    process.env[KEY_VAR] = 'secret';
    await assert.rejects(() => hosted.invoke({ prompt: '' }), /prompt must be a non-empty string/);
  });

  it('honors a pre-aborted signal', async () => {
    process.env[URL_VAR] = 'https://hosted.example/api';
    process.env[KEY_VAR] = 'secret';
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => hosted.invoke({ prompt: 'rewrite this', signal: controller.signal }),
      (err) => {
        assert.strictEqual(err.name, 'AbortError');
        return true;
      }
    );
  });

  it('refuses a non-loopback plaintext HTTP endpoint (SSRF/plaintext guard)', async () => {
    process.env[URL_VAR] = 'http://hosted.example/api';
    process.env[KEY_VAR] = 'secret';
    await assert.rejects(() => hosted.invoke({ prompt: 'rewrite this' }), /plaintext HTTP/);
  });
});
