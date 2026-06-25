// @ts-check
// Phase 5 BYOK hardening: consolidated assertions that a browser-held BYOK key
// is transmitted ONLY in the same-origin request body (never the URL, never a
// browser-set Authorization header, never persisted) and that the deploy CSP
// keeps the browser pinned to the same origin so a key cannot be exfiltrated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRewriteThread, streamRewrite } from '../../playground/rewrite-client.js';
import { WEB_TIERS, redactSecrets } from '../../src/web-rewrite-contract.js';
import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { scoreMPS } from '../../src/scoring.js';
import { HttpError } from '../../src/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function okStream(line) {
  return {
    ok: true,
    status: 200,
    body: new globalThis.ReadableStream({
      start(c) { c.enqueue(new globalThis.TextEncoder().encode(line)); c.close(); },
    }),
  };
}

test('BYOK key travels only in the same-origin request body — not the URL, not a browser Authorization header', async () => {
  const thread = createRewriteThread({ lang: 'en' });
  const KEY = 'sk-byok-PHASE5-secret-key';
  const body = thread.buildRequest({
    text: 'humanize me', tier: WEB_TIERS.BYOK, provider: 'openai', model: 'gpt-5.5', apiKey: KEY,
  });

  let seen = /** @type {any} */ (undefined);
  await streamRewrite({
    body,
    fetchImpl: /** @type {any} */ (async (url, init) => { seen = { url, init }; return okStream('{"type":"done","rewrite":"ok"}\n'); }),
    onDone: () => {},
    onError: () => {},
  });

  // Same-origin endpoint only; no key anywhere in the URL/query.
  assert.equal(seen.url, '/api/rewrite');
  assert.doesNotMatch(String(seen.url), /sk-byok|apiKey|key=/i);
  // The browser does NOT set an Authorization header (the server attaches it to
  // the provider). The key rides inside the JSON body.
  const headers = seen.init?.headers ?? {};
  const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
  assert.equal(headerNames.includes('authorization'), false, 'browser must not set Authorization');
  assert.equal(JSON.parse(seen.init.body).apiKey, KEY);
});

test('a thrown error carrying the BYOK key is redacted before logging and never returned to the client', async () => {
  const KEY = 'sk-byok-PHASE5-secret-key';
  const logs = [];
  const handler = createRewriteHandler({
    rateLimiter: { check: async () => ({ allowed: true, tier: 'byok' }) },
    runRewrite: async () => { throw new Error(`provider rejected Authorization: Bearer ${KEY}`); },
    env: {},
    logger: { error: (m) => logs.push(m) },
  });
  const res = (() => {
    const headers = new Map();
    return { statusCode: 200, ended: '', setHeader: (k, v) => headers.set(k.toLowerCase(), v), getHeader: (k) => headers.get(k.toLowerCase()), end(b = '') { this.ended = String(b); } };
  })();
  const req = {
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.5' },
    body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'byok', provider: 'openai', model: 'gpt-5.5', apiKey: KEY, text: 'hi' }),
  };
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(res.ended, /sk-byok-PHASE5/); // client body never leaks the key
  const loggedJson = JSON.stringify(logs);
  assert.doesNotMatch(loggedJson, /sk-byok-PHASE5/); // logger received a redacted message
});

test('redactSecrets removes a BYOK key in every realistic carrier shape', () => {
  const KEY = 'sk-byok-PHASE5-secret-key';
  const carriers = {
    apiKey: KEY,
    authorization: `Bearer ${KEY}`,
    nested: { providerApiKey: KEY, note: `failed with ${KEY}` },
    arr: [`Bearer ${KEY}`, { token: KEY }],
  };
  assert.doesNotMatch(JSON.stringify(redactSecrets(carriers)), /sk-byok-PHASE5/);
});

test('deploy CSP keeps the browser same-origin (no key exfiltration path)', () => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
  const csp = config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy')?.value;
  assert.match(csp, /connect-src 'self'(?:;|$)/);
  // No external origin the browser could POST the key to.
  assert.doesNotMatch(csp, /connect-src[^;]*https?:\/\//);
  assert.doesNotMatch(csp, /connect-src[^;]*\*/);
});

test('HttpError redacts a BYOK key echoed in a provider error body (message + stored body)', () => {
  const KEY = 'sk-byok-PHASE5-secret-key';
  const err = new HttpError(401, `invalid token Authorization: Bearer ${KEY}; key=${KEY}`);
  assert.doesNotMatch(err.message, /sk-byok-PHASE5/);
  assert.doesNotMatch(String(err.body), /sk-byok-PHASE5/);
});

test('scoring-provider failure carrying a BYOK key is redacted before it reaches the logger', async () => {
  const KEY = 'sk-byok-PHASE5-secret-key';
  const warns = [];
  const logger = { warn: (_evt, fields) => warns.push(fields), info() {}, error() {}, debug() {} };
  // Provider rejects with an error body echoing the BYOK key (worst case).
  const callLLM = async () => { throw new HttpError(401, `unauthorized: Bearer ${KEY}`); };
  const result = await scoreMPS({
    original: 'a', rewritten: 'b', apiKey: KEY, baseURL: 'https://api.openai.com/v1', model: 'gpt-5.5',
    callLLM, logger,
  });
  // The scorer fails closed (null) and the captured log line carries no key.
  assert.equal(result.mps, null);
  assert.doesNotMatch(JSON.stringify(warns), /sk-byok-PHASE5/);
});
