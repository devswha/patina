import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import {
  invokeBackendChain,
  selectBackendChain,
  resolveBackend,
} from '../../src/backends/index.js';
import { HOSTED_SCHEMA_VERSION } from '../../src/backends/patina-hosted-schema.js';
import { urlEnvVar, keyEnvVar } from '../../src/backends/patina-hosted.js';

let savedUrl;
let savedKey;
const openServers = [];

beforeEach(() => {
  savedUrl = process.env[urlEnvVar];
  savedKey = process.env[keyEnvVar];
});

afterEach(async () => {
  restore(urlEnvVar, savedUrl);
  restore(keyEnvVar, savedKey);
  await Promise.all(openServers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Mock hosted server. `handler({ body, req })` returns { status?, payload?, raw? }.
function startMockServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        const result = handler({ body, req }) || {};
        const status = result.status ?? 200;
        if (result.raw !== undefined) {
          res.writeHead(status, { 'Content-Type': 'text/plain' });
          res.end(result.raw);
          return;
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.payload ?? {}));
      });
    });
    openServers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, requests });
    });
  });
}

function okPayload(overrides = {}) {
  return {
    schemaVersion: HOSTED_SCHEMA_VERSION,
    text: 'humanized output',
    spans: [{ start: 0, end: 5, score: 0.9, category: 'lexicon-density' }],
    ...overrides,
  };
}

describe('patina-hosted integration: --backend patina-hosted against a mock server', () => {
  it('sends a versioned, authenticated request and returns the humanized text', async () => {
    const { url, requests } = await startMockServer(() => ({ payload: okPayload() }));
    process.env[urlEnvVar] = url;
    process.env[keyEnvVar] = 'test-key';

    const spansSeen = [];
    const { backends, reason } = selectBackendChain({ name: 'patina-hosted' });
    assert.strictEqual(reason, 'explicit');
    const result = await invokeBackendChain({
      backends,
      prompt: 'Please rewrite this draft.',
      onResponse: (meta) => spansSeen.push(meta),
    });

    assert.strictEqual(result, 'humanized output');
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].method, 'POST');
    assert.match(requests[0].url, /\/v1\/humanize$/);
    assert.strictEqual(requests[0].headers.authorization, 'Bearer test-key');
    assert.strictEqual(requests[0].body.schemaVersion, HOSTED_SCHEMA_VERSION);
    assert.strictEqual(requests[0].body.text, 'Please rewrite this draft.');
    assert.strictEqual(spansSeen.length, 1);
    assert.deepStrictEqual(spansSeen[0].spans, [{ start: 0, end: 5, score: 0.9, category: 'lexicon-density' }]);
    assert.strictEqual(spansSeen[0].provider, 'patina-hosted');
  });

  it('fails hard on a schema version mismatch (no best-effort parse)', async () => {
    const { url } = await startMockServer(() => ({ payload: okPayload({ schemaVersion: '999' }) }));
    process.env[urlEnvVar] = url;
    process.env[keyEnvVar] = 'test-key';
    await assert.rejects(
      () => resolveBackend('patina-hosted').invoke({ prompt: 'rewrite this' }),
      /schemaVersion mismatch/
    );
  });

  it('rejects a response that leaks an internal pattern identifier', async () => {
    const { url } = await startMockServer(() => ({
      payload: okPayload({ spans: [{ start: 0, end: 4, score: 0.8, category: 'lexicon-density', patternId: 'ko-secret-007' }] }),
    }));
    process.env[urlEnvVar] = url;
    process.env[keyEnvVar] = 'test-key';
    await assert.rejects(
      () => resolveBackend('patina-hosted').invoke({ prompt: 'rewrite this' }),
      /forbidden internal identifier/
    );
  });

  it('surfaces a non-retryable 401 and does not fall through an explicit chain', async () => {
    const { url } = await startMockServer(() => ({ status: 401, raw: 'unauthorized' }));
    process.env[urlEnvVar] = url;
    process.env[keyEnvVar] = 'bad-key';

    let fallbackCalled = false;
    await assert.rejects(
      () => invokeBackendChain({
        backends: [resolveBackend('patina-hosted'), { name: 'stub', invoke: async () => { fallbackCalled = true; return 'baseline'; } }],
        prompt: 'rewrite this',
      }),
      /HTTP 401/
    );
    assert.strictEqual(fallbackCalled, false, '401 must not silently fall back to the baseline');
  });

  it('falls through a 503 only because the user spelled out an explicit chain', async () => {
    const { url } = await startMockServer(() => ({ status: 503, raw: 'overloaded' }));
    process.env[urlEnvVar] = url;
    process.env[keyEnvVar] = 'test-key';

    const events = [];
    const result = await invokeBackendChain({
      backends: [resolveBackend('patina-hosted'), { name: 'openai-http-stub', invoke: async () => 'baseline fallback' }],
      prompt: 'rewrite this',
      logger: { warn: (event, fields) => events.push({ event, ...fields }) },
    });
    assert.strictEqual(result, 'baseline fallback');
    assert.deepStrictEqual(events.map((e) => e.event), ['backend.fallback']);
    assert.match(events[0].message, /patina-hosted failed with HTTP 503; falling back to openai-http-stub/);
  });

  it('does not fall back when the key is unset, even inside an explicit chain', async () => {
    // No server needed: the inputError fires before any network call.
    delete process.env[urlEnvVar];
    delete process.env[keyEnvVar];
    let fallbackCalled = false;
    await assert.rejects(
      () => invokeBackendChain({
        backends: [resolveBackend('patina-hosted'), { name: 'stub', invoke: async () => { fallbackCalled = true; return 'baseline'; } }],
        prompt: 'rewrite this',
      }),
      /not configured/
    );
    assert.strictEqual(fallbackCalled, false, 'misconfiguration is an explicit error, not a baseline fallback');
  });

  it('rejects a malformed (non-JSON) server response', async () => {
    const { url } = await startMockServer(() => ({ raw: 'not json at all' }));
    process.env[urlEnvVar] = url;
    process.env[keyEnvVar] = 'test-key';
    await assert.rejects(
      () => resolveBackend('patina-hosted').invoke({ prompt: 'rewrite this' }),
      /not valid JSON/
    );
  });
});
