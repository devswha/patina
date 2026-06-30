import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRewriteThread, exchangeProLicense } from '../../playground/rewrite-client.js';
import { PRO_LEGAL_COPY_BLOCK_KO, PRO_LEGAL_COPY_KO, PRO_REFUND_WINDOW_DAYS } from '../../src/pro-legal-copy.js';

// --- buildRequest pro tier --------------------------------------------------
test('buildRequest for the pro tier carries ONLY the opaque session token', () => {
  const thread = createRewriteThread({ lang: 'ko' });
  const body = thread.buildRequest({ text: '안녕하세요', tier: 'pro', proSessionToken: 'opaque-tok', provider: 'claude', model: 'x', apiKey: 'sk-x' });
  assert.equal(body.tier, 'pro');
  assert.equal(body.proSessionToken, 'opaque-tok');
  // pro must not smuggle a caller-chosen provider/model/apiKey
  assert.equal(body.provider, undefined);
  assert.equal(body.model, undefined);
  assert.equal(body.apiKey, undefined);
});

test('buildRequest for free/byok is unchanged by the pro addition', () => {
  const thread = createRewriteThread({ lang: 'en' });
  const free = thread.buildRequest({ text: 'hi', tier: 'free' });
  assert.equal(free.tier, 'free');
  assert.equal(free.proSessionToken, undefined);
  const byok = thread.buildRequest({ text: 'hi', tier: 'byok', provider: 'openai', model: 'gpt-4.1', apiKey: 'sk-1' });
  assert.equal(byok.apiKey, 'sk-1');
  assert.equal(byok.proSessionToken, undefined);
});

// --- exchangeProLicense -----------------------------------------------------
function fetchOk(payload) {
  return async () => ({ ok: true, status: 200, async json() { return payload; } });
}
function fetchErr(status, payload) {
  return async () => ({ ok: false, status, async json() { return payload; } });
}

test('exchangeProLicense returns the opaque token on success and sends the key once in the body', async () => {
  let sentBody;
  const fetchImpl = async (_url, init) => { sentBody = init.body; return { ok: true, status: 200, async json() { return { proSessionToken: 't0k', expiresAt: 123, status: 'active' }; } }; };
  const res = await exchangeProLicense({ licenseKey: 'LEMON-RAW', fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.proSessionToken, 't0k');
  assert.equal(res.status, 'active');
  // the raw key travels once, in the POST body
  assert.equal(JSON.parse(sentBody).licenseKey, 'LEMON-RAW');
});

test('exchangeProLicense rejects a blank key without calling the network', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, status: 200, async json() { return {}; } }; };
  const res = await exchangeProLicense({ licenseKey: '   ', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test('exchangeProLicense surfaces a server error without leaking the raw key', async () => {
  const res = await exchangeProLicense({ licenseKey: 'SECRET-RAW', fetchImpl: fetchErr(402, { error: 'entitlement not active' }) });
  assert.equal(res.ok, false);
  assert.equal(res.status, 402);
  assert.equal(res.error, 'entitlement not active');
  assert.ok(!JSON.stringify(res).includes('SECRET-RAW'));
});

test('exchangeProLicense fails closed on a malformed success body (no token)', async () => {
  const res = await exchangeProLicense({ licenseKey: 'k', fetchImpl: fetchOk({ notAToken: true }) });
  assert.equal(res.ok, false);
});

test('exchangeProLicense fails closed on a network error', async () => {
  const res = await exchangeProLicense({ licenseKey: 'k', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(res.ok, false);
  assert.equal(res.status, 0);
});

// --- ko legal copy single source --------------------------------------------
test('the ko refund/cancel copy is a single ordered block with the 7-day window', () => {
  assert.equal(PRO_REFUND_WINDOW_DAYS, 7);
  for (const line of Object.values(PRO_LEGAL_COPY_KO)) {
    assert.ok(PRO_LEGAL_COPY_BLOCK_KO.includes(line), 'every line must appear in the shared block');
  }
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /7일/);
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /Lemon Squeezy/);
  assert.match(PRO_LEGAL_COPY_BLOCK_KO, /청약철회/);
});

test('exchangeProLicense scrubs the raw key even if a hostile server echoes it in the error', async () => {
  const raw = 'LEMON-RAW-ECHOED';
  const fetchImpl = async () => ({ ok: false, status: 403, async json() { return { error: `denied for ${raw}` }; } });
  const res = await exchangeProLicense({ licenseKey: raw, fetchImpl });
  assert.equal(res.ok, false);
  assert.ok(!JSON.stringify(res).includes(raw), 'raw key must be scrubbed from the returned error');
  assert.match(res.error, /\[REDACTED\]/);
});
