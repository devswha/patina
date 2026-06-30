import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRewriteThread, exchangeProLicense } from '../../playground/rewrite-client.js';
import { PRO_LEGAL_COPY_BLOCK_KO, PRO_LEGAL_COPY_KO, PRO_REFUND_WINDOW_DAYS } from '../../src/pro-legal-copy.js';

const rawKey = 'LEMON-RAW-SECRET-REDTEAM';

const assertDoesNotContain = (value, needle, message) => {
  assert.equal(JSON.stringify(value).includes(needle), false, message);
};

const makeJsonResponse = ({ ok = true, status = 200, payload = {} } = {}) => ({
  ok,
  status,
  json: async () => payload,
});

const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

test('pro buildRequest ignores caller BYOK credentials and sends only the opaque pro token', () => {
  const thread = createRewriteThread({ lang: 'ko' });
  const body = thread.buildRequest({
    text: '공격 입력',
    tier: 'pro',
    provider: 'attacker-provider',
    model: 'attacker-model',
    apiKey: 'sk-attacker-key',
    proSessionToken: 'opaque-pro-token',
  });

  assert.equal(body.proSessionToken, 'opaque-pro-token');
  assert.equal(Object.hasOwn(body, 'provider'), false);
  assert.equal(Object.hasOwn(body, 'model'), false);
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
  assert.deepEqual(Object.keys(body).sort(), ['lang', 'mode', 'proSessionToken', 'text', 'tier'].sort());
});

test('pro buildRequest without a pro token omits the proSessionToken key so the server rejects it', () => {
  const thread = createRewriteThread({ lang: 'ko' });
  const body = thread.buildRequest({ text: '토큰 없는 pro 요청', tier: 'pro' });

  assert.equal(body.tier, 'pro');
  assert.equal(Object.hasOwn(body, 'proSessionToken'), false);
  assert.equal(Object.hasOwn(body, 'provider'), false);
  assert.equal(Object.hasOwn(body, 'model'), false);
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
});

test('exchangeProLicense never retains the raw license key in success, failure, or network-error results', async () => {
  const success = await exchangeProLicense({
    licenseKey: rawKey,
    fetchImpl: async () => makeJsonResponse({ payload: { proSessionToken: 'opaque-token', expiresAt: 123, status: 'active' } }),
  });
  assert.equal(success.ok, true);
  assertDoesNotContain(success, rawKey, 'success result must not retain the raw license key');

  const failure = await exchangeProLicense({
    licenseKey: rawKey,
    fetchImpl: async () => makeJsonResponse({ ok: false, status: 402, payload: { error: `denied ${rawKey}` } }),
  });
  assert.equal(failure.ok, false);
  assertDoesNotContain(failure, rawKey, 'failure result must not echo or retain the raw license key');

  const network = await exchangeProLicense({
    licenseKey: rawKey,
    fetchImpl: async () => { throw new Error(`offline ${rawKey}`); },
  });
  assert.equal(network.ok, false);
  assert.equal(network.status, 0);
  assertDoesNotContain(network, rawKey, 'network-error result must not retain the raw license key');
});

test('exchangeProLicense fails closed for tokenless 200 and non-2xx responses', async () => {
  const tokenlessOk = await exchangeProLicense({
    licenseKey: rawKey,
    fetchImpl: async () => makeJsonResponse({ payload: { status: 'active', expiresAt: 123 } }),
  });
  assert.deepEqual(tokenlessOk, { ok: false, status: 200, error: 'pro exchange failed' });

  const non2xx = await exchangeProLicense({
    licenseKey: rawKey,
    fetchImpl: async () => makeJsonResponse({ ok: false, status: 403, payload: { error: 'forbidden' } }),
  });
  assert.deepEqual(non2xx, { ok: false, status: 403, error: 'forbidden' });
});

test('exchangeProLicense returns ok:false status:0 on network throws', async () => {
  const result = await exchangeProLicense({
    licenseKey: rawKey,
    fetchImpl: async () => { throw new Error('network down'); },
  });

  assert.deepEqual(result, { ok: false, status: 0, error: 'network error' });
});

test('exchangeProLicense rejects empty and non-string license keys before calling fetch', async () => {
  const rejectedInputs = ['', '   ', null, undefined, 0, false, {}, []];

  for (const licenseKey of rejectedInputs) {
    let called = false;
    const result = await exchangeProLicense({
      licenseKey,
      fetchImpl: async () => {
        called = true;
        return makeJsonResponse({ payload: { proSessionToken: 'should-not-happen' } });
      },
    });

    assert.deepEqual(result, { ok: false, status: 400, error: 'licenseKey required' });
    assert.equal(called, false, `fetch must not be called for ${String(licenseKey)}`);
  }
});

test('exchangeProLicense sends the raw license key exactly once in the body and never in URL or headers', async () => {
  let capturedUrl;
  let capturedInit;
  const result = await exchangeProLicense({
    licenseKey: rawKey,
    url: `/api/pro-session?probe=${encodeURIComponent('not-the-key')}`,
    fetchImpl: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return makeJsonResponse({ payload: { proSessionToken: 'opaque-token', expiresAt: 456, status: 'active' } });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(countOccurrences(String(capturedInit.body), rawKey), 1);
  assert.equal(JSON.parse(capturedInit.body).licenseKey, rawKey);
  assert.equal(String(capturedUrl).includes(rawKey), false);
  assert.equal(JSON.stringify(capturedInit.headers).includes(rawKey), false);
});

test('ko legal copy is a single source block containing 7-day withdrawal and Lemon MoR lines', () => {
  assert.equal(PRO_REFUND_WINDOW_DAYS, 7);
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /7일/);
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /청약철회/);
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /Lemon Squeezy/);
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /Merchant of Record/);

  const blockLines = PRO_LEGAL_COPY_BLOCK_KO.split('\n');
  const sourceLines = Object.values(PRO_LEGAL_COPY_KO);
  assert.deepEqual(blockLines, sourceLines);

  for (const line of sourceLines) {
    assert.equal(blockLines.includes(line), true, `legal block must contain source line: ${line}`);
  }
});
