import test from 'node:test';
import assert from 'node:assert/strict';

import { appendApiKeyProbe, redactSecrets } from '../../src/commands/doctor.js';

const KEY_ENV = ['PATINA_API_KEY', 'PATINA_API_KEY_FILE', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'PATINA_API_BASE', 'PATINA_ALLOW_INSECURE_BASE_URL', 'PATINA_ANTHROPIC_NATIVE_CACHE'];

async function withEnv(values, body) {
  const saved = {};
  for (const key of KEY_ENV) saved[key] = process.env[key];
  try {
    for (const key of KEY_ENV) delete process.env[key];
    Object.assign(process.env, values);
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// A report shaped like buildDoctorReport() output, with the presence-based
// verdict already in place so the probe's recount is observable.
function reportWithHttpKey() {
  return {
    ok: true,
    checks: [
      { name: 'usable-backend', status: 'ok', summary: '1 authenticated backend(s)', detail: 'openai-http' },
    ],
    backends: [
      { name: 'openai-http', available: true, authenticated: true, authHint: 'Authenticated via PATINA_API_KEY.' },
      { name: 'codex-cli', available: true, authenticated: false, authHint: 'Run `codex login`.' },
    ],
    blockers: [],
  };
}

const respond = (status, expect) => async (url, init) => {
  if (expect) expect(url, init);
  return { status, ok: status >= 200 && status < 300 };
};

test('accepted key -> ok probe check, bearer sent only to the configured base URL', async () => {
  await withEnv({ PATINA_API_KEY: 'sk-test-accept', PATINA_API_BASE: 'https://example.test/v1/' }, async () => {
    const report = reportWithHttpKey();
    let seen = null;
    await appendApiKeyProbe(report, {
      config: {},
      fetchImpl: respond(200, (url, init) => { seen = { url, init }; }),
    });
    assert.equal(seen.url, 'https://example.test/v1/models');
    assert.equal(seen.init.method, 'GET');
    assert.equal(seen.init.headers.authorization, 'Bearer sk-test-accept');
    assert.deepEqual(report.apiKeyProbe, { attempted: true, host: 'example.test', status: 200, ok: true, error: null });
    assert.equal(report.backends[0].keyProbe, 'accepted');
    assert.equal(report.backends[0].authenticated, true);
    const check = report.checks.find((c) => c.name === 'api-key-probe');
    assert.equal(check.status, 'ok');
    assert.match(check.summary, /accepted by example\.test/);
    // The secret never lands in the report.
    assert.doesNotMatch(JSON.stringify(report), /sk-test-accept/);
  });
});

test('rejected key (401/403) -> warning, backend no longer authenticated, usable-backend recounted', async () => {
  for (const status of [401, 403]) {
    await withEnv({ OPENAI_API_KEY: 'sk-dead' }, async () => {
      const report = reportWithHttpKey();
      await appendApiKeyProbe(report, { config: {}, fetchImpl: respond(status) });
      assert.equal(report.apiKeyProbe.ok, false);
      assert.equal(report.apiKeyProbe.host, 'api.openai.com');
      assert.equal(report.backends[0].keyProbe, 'rejected');
      assert.equal(report.backends[0].authenticated, false);
      assert.match(report.backends[0].authHint, new RegExp(`HTTP ${status}`));
      assert.equal(report.checks.find((c) => c.name === 'api-key-probe').status, 'warning');
      // openai-http was the only authenticated backend, so the aggregate flips.
      const usable = report.checks.find((c) => c.name === 'usable-backend');
      assert.equal(usable.status, 'blocker');
      assert.equal(report.ok, false);
      assert.equal(report.blockers[0].name, 'usable-backend');
      assert.doesNotMatch(JSON.stringify(report), /sk-dead/);
    });
  }
});

test('rejected key does not flip the aggregate when another backend is authenticated', async () => {
  await withEnv({ OPENAI_API_KEY: 'sk-dead' }, async () => {
    const report = reportWithHttpKey();
    report.backends[1].authenticated = true;
    await appendApiKeyProbe(report, { config: {}, fetchImpl: respond(401) });
    const usable = report.checks.find((c) => c.name === 'usable-backend');
    assert.equal(usable.status, 'ok');
    assert.equal(usable.detail, 'codex-cli');
    assert.equal(report.ok, true);
  });
});

test('network failure, timeout, or odd status -> inconclusive, informational, never throws', async () => {
  const cases = [
    { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); }, expectError: /ENOTFOUND/ },
    { fetchImpl: respond(503), expectError: null, expectStatus: 503 },
    { fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), expectError: /timed out after 5ms/, timeoutMs: 5 },
  ];
  for (const c of cases) {
    await withEnv({ PATINA_API_KEY: 'sk-x' }, async () => {
      const report = reportWithHttpKey();
      await appendApiKeyProbe(report, { config: {}, fetchImpl: c.fetchImpl, timeoutMs: c.timeoutMs });
      assert.equal(report.apiKeyProbe.ok, null);
      if (c.expectError) assert.match(report.apiKeyProbe.error, c.expectError);
      if (c.expectStatus) assert.equal(report.apiKeyProbe.status, c.expectStatus);
      assert.equal(report.backends[0].keyProbe, 'inconclusive');
      assert.equal(report.backends[0].authenticated, true);
      const check = report.checks.find((c2) => c2.name === 'api-key-probe');
      assert.equal(check.status, 'ok');
      assert.match(check.summary, /not verified/);
      assert.equal(report.ok, true);
    });
  }
});

test('probe resolves provider, key order and base URL the way a rewrite does', async () => {
  // Config-file provider: key comes from the provider env var, URL from the preset.
  await withEnv({ GEMINI_API_KEY: 'g-key', OPENAI_API_KEY: 'o-key' }, async () => {
    const report = reportWithHttpKey();
    let seen = null;
    await appendApiKeyProbe(report, { config: { provider: 'gemini' }, fetchImpl: respond(200, (url, init) => { seen = { url, init }; }) });
    assert.match(seen.url, /^https:\/\/generativelanguage\.googleapis\.com\/.*\/models$/);
    assert.equal(seen.init.headers.authorization, 'Bearer g-key');
  });
  // Config-file base URL wins over the OpenAI default.
  await withEnv({ PATINA_API_KEY: 'k' }, async () => {
    const report = reportWithHttpKey();
    let seen = null;
    await appendApiKeyProbe(report, { config: { baseURL: 'https://proxy.example/v1' }, fetchImpl: respond(200, (url) => { seen = url; }) });
    assert.equal(seen, 'https://proxy.example/v1/models');
    assert.equal(report.apiKeyProbe.host, 'proxy.example');
  });
});

test('probe refuses destinations a rewrite would refuse and sends nothing', async () => {
  for (const base of ['http://proxy.example/v1', 'https://169.254.169.254/v1', 'not a url']) {
    await withEnv({ PATINA_API_KEY: 'sk-never-sent', PATINA_API_BASE: base }, async () => {
      const report = reportWithHttpKey();
      let called = false;
      await appendApiKeyProbe(report, { config: {}, fetchImpl: async () => { called = true; return { status: 200, ok: true }; } });
      assert.equal(called, false, base);
      assert.equal(report.apiKeyProbe.attempted, false);
      assert.match(report.apiKeyProbe.error, /refusing|Invalid base URL/);
      assert.equal(report.backends[0].keyProbe, 'inconclusive');
      assert.equal(report.backends[0].authenticated, true);
      assert.equal(report.checks.find((c) => c.name === 'api-key-probe').status, 'ok');
      assert.doesNotMatch(JSON.stringify(report), /sk-never-sent/);
    });
  }
});

test('probe uses native Anthropic headers when a rewrite would, and cancels the response body', async () => {
  await withEnv({ PATINA_API_KEY: 'ant-key', PATINA_API_BASE: 'https://api.anthropic.com/v1', PATINA_ANTHROPIC_NATIVE_CACHE: '1' }, async () => {
    const report = reportWithHttpKey();
    let seen = null;
    let cancelled = false;
    await appendApiKeyProbe(report, {
      config: {},
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return { status: 200, ok: true, body: { cancel: async () => { cancelled = true; } } };
      },
    });
    assert.equal(seen.url, 'https://api.anthropic.com/v1/models');
    assert.equal(seen.init.headers['x-api-key'], 'ant-key');
    assert.equal(seen.init.headers.authorization, undefined);
    assert.equal(cancelled, true);
    assert.equal(report.apiKeyProbe.ok, true);
  });
  // Without the opt-in the same host gets a bearer, like a rewrite.
  await withEnv({ PATINA_API_KEY: 'ant-key', PATINA_API_BASE: 'https://api.anthropic.com/v1' }, async () => {
    const report = reportWithHttpKey();
    let seen = null;
    await appendApiKeyProbe(report, { config: {}, fetchImpl: respond(200, (url, init) => { seen = init; }) });
    assert.equal(seen.headers.authorization, 'Bearer ant-key');
    assert.equal(seen.headers['x-api-key'], undefined);
  });
});

test('explicit inconclusive statuses and unrelated blockers survive the probe', async () => {
  for (const status of [404, 405, 429]) {
    await withEnv({ PATINA_API_KEY: 'k' }, async () => {
      const report = reportWithHttpKey();
      report.checks.unshift({ name: 'node', status: 'blocker', summary: 'Node 16', detail: 'requires Node >=18' });
      report.ok = false;
      report.blockers = [{ name: 'node', summary: 'Node 16', detail: 'requires Node >=18' }];
      await appendApiKeyProbe(report, { config: {}, fetchImpl: respond(status) });
      assert.equal(report.apiKeyProbe.ok, null, String(status));
      assert.equal(report.backends[0].authenticated, true);
      assert.equal(report.ok, false);
      assert.equal(report.blockers[0].name, 'node');
    });
  }
  // A rejection recount keeps the unrelated blocker as well.
  await withEnv({ PATINA_API_KEY: 'k' }, async () => {
    const report = reportWithHttpKey();
    report.checks.unshift({ name: 'node', status: 'blocker', summary: 'Node 16', detail: 'requires Node >=18' });
    await appendApiKeyProbe(report, { config: {}, fetchImpl: respond(401) });
    assert.deepEqual(report.blockers.map((b) => b.name), ['node', 'usable-backend']);
  });
});

test('redactSecrets strips the key value and URL userinfo from error text', () => {
  assert.equal(redactSecrets('fetch failed for https://user:pw@proxy.example/v1/models', 'sk-abc'), 'fetch failed for https://***@proxy.example/v1/models');
  assert.equal(redactSecrets('bad key sk-abc in header', 'sk-abc'), 'bad key *** in header');
  assert.equal(redactSecrets('plain message', null), 'plain message');
  // An error that echoes a URL with embedded credentials never reaches the report unredacted.
  return withEnv({ PATINA_API_KEY: 'sk-abc', PATINA_API_BASE: 'https://user:pw@proxy.example/v1' }, async () => {
    const report = reportWithHttpKey();
    await appendApiKeyProbe(report, { config: {}, fetchImpl: async (url) => { throw new Error(`ECONNRESET ${url} Bearer sk-abc`); } });
    assert.equal(report.apiKeyProbe.host, 'proxy.example');
    assert.doesNotMatch(report.apiKeyProbe.error, /user:pw|sk-abc/);
    assert.doesNotMatch(JSON.stringify(report), /user:pw|sk-abc/);
  });
});

test('no HTTP key configured -> probe not attempted and nothing is fetched', async () => {
  await withEnv({}, async () => {
    const report = reportWithHttpKey();
    report.backends[0].authenticated = false;
    let called = false;
    await appendApiKeyProbe(report, { fetchImpl: async () => { called = true; return { status: 200, ok: true }; } });
    assert.equal(called, false);
    assert.equal(report.apiKeyProbe.attempted, false);
    assert.equal(report.checks.find((c) => c.name === 'api-key-probe'), undefined);
  });
});
