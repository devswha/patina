import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEB_TIERS,
  TIER_LIMITS,
  isProEnabled,
  resolveProviderModel,
  redactSecrets,
  validateRewriteRequest,
  MAX_PRO_SESSION_TOKEN_CHARS,
} from '../../src/web-rewrite-contract.js';

// G001: the hosted Pro tier is added to the isomorphic contract but is
// DISABLED BY DEFAULT behind a single `PATINA_PRO_ENABLED` gate. These tests
// assert (a) the gate is fail-closed off by default, (b) gate-off leaves the
// free/BYOK request path byte-for-byte unchanged (no regression), and (c) when
// the gate is on, Pro requests use an opaque session token and a server-pinned
// enhanced route, never caller-chosen provider/model/apiKey or a raw key.

const PRO_ENV = Object.freeze({
  PATINA_PRO_ENABLED: 'true',
  PATINA_PRO_PROVIDER: 'openai',
  PATINA_PRO_MODEL: 'gpt-5.5',
});

// --- tier constants ---------------------------------------------------------
test('WEB_TIERS exposes pro and TIER_LIMITS.pro carries the agreed caps', () => {
  assert.equal(WEB_TIERS.PRO, 'pro');
  assert.deepEqual(TIER_LIMITS.pro, {
    maxChars: 12000,
    maxConcurrent: 2,
    reqPerDay: 100,
    burstPerHour: 20,
    requestsPerMinute: 6,
  });
});

// --- the gate ---------------------------------------------------------------
test('isProEnabled is disabled by default and only true for explicit "true"', () => {
  assert.equal(isProEnabled(), false);
  assert.equal(isProEnabled({}), false);
  assert.equal(isProEnabled({ PATINA_PRO_ENABLED: undefined }), false);
  assert.equal(isProEnabled({ PATINA_PRO_ENABLED: '1' }), false);
  assert.equal(isProEnabled({ PATINA_PRO_ENABLED: 'TRUE' }), false);
  assert.equal(isProEnabled({ PATINA_PRO_ENABLED: 'yes' }), false);
  assert.equal(isProEnabled({ PATINA_PRO_ENABLED: 'true' }), true);
});

// --- gate OFF: Pro is fail-closed ------------------------------------------
test('validateRewriteRequest rejects a pro request when the gate is off (403)', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '안녕하세요', proSessionToken: 'opaque-token' },
    {}, // gate off
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(res.error, 'pro tier unavailable');
});

test('resolveProviderModel fails closed for pro when the gate is off', () => {
  const res = resolveProviderModel({ tier: 'pro' }, {});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'pro tier unavailable');
});

// --- gate OFF: free/BYOK regression (must be byte-for-byte unchanged) -------
test('gate-off: free first-turn request still validates exactly as before', () => {
  const res = validateRewriteRequest({ mode: 'first', lang: 'ko', tier: 'free', text: '테스트 문장' }, {});
  assert.equal(res.ok, true);
  assert.equal(res.value.tier, 'free');
  assert.equal(res.value.provider, 'openai');
  assert.equal(res.value.apiKey, undefined);
  assert.equal(res.value.proSessionToken, undefined);
});

test('gate-off: byok request still validates with an allowlisted model + key', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'en', tier: 'byok', text: 'hello there', provider: 'openai', model: 'gpt-4.1', apiKey: 'sk-xxxx' },
    {},
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.tier, 'byok');
  assert.equal(res.value.apiKey, 'sk-xxxx');
});

test('gate-off: free tier with a caller apiKey is still rejected', () => {
  const res = validateRewriteRequest({ mode: 'first', lang: 'ko', tier: 'free', text: '문장', apiKey: 'sk-x' }, {});
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /must not include an apiKey/);
});

test('gate-off: resolveProviderModel free/byok branches are unchanged', () => {
  const free = resolveProviderModel({ tier: 'free' }, {});
  assert.equal(free.ok, true);
  assert.equal(free.baseURL, 'https://api.openai.com/v1');
  const byok = resolveProviderModel({ tier: 'byok', provider: 'claude', model: 'claude-sonnet-4-5' }, {});
  assert.equal(byok.ok, true);
  assert.equal(byok.baseURL, 'https://api.anthropic.com/v1');
});

test('an unknown tier is still rejected (now naming the three valid tiers)', () => {
  const res = validateRewriteRequest({ mode: 'first', lang: 'ko', tier: 'enterprise', text: 'x' }, {});
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /free.*byok.*pro/);
});

// --- gate ON: Pro happy path + hardening ------------------------------------
test('gate-on: a pro request with an opaque session token resolves the server enhanced route', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '안녕하세요', proSessionToken: 'opaque-session-token' },
    PRO_ENV,
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.tier, 'pro');
  assert.equal(res.value.provider, 'openai');
  assert.equal(res.value.model, 'gpt-5.5');
  assert.equal(res.value.proSessionToken, 'opaque-session-token');
  assert.equal(res.value.apiKey, undefined);
});

test('gate-on: pro rejects a raw licenseKey on the rewrite contract', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '문장', licenseKey: 'LEMON-RAW-KEY', proSessionToken: 't' },
    PRO_ENV,
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /proSessionToken, not a raw licenseKey/);
});

test('gate-on: pro rejects caller provider/model override', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '문장', proSessionToken: 't', provider: 'claude', model: 'claude-opus-4-1' },
    PRO_ENV,
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /must not include provider\/model/);
});

test('gate-on: pro rejects a caller apiKey', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '문장', proSessionToken: 't', apiKey: 'sk-x' },
    PRO_ENV,
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /pro tier must not include an apiKey/);
});

test('gate-on: pro requires a non-empty proSessionToken', () => {
  for (const bad of [undefined, '', '   ', 42, null]) {
    const res = validateRewriteRequest(
      { mode: 'first', lang: 'ko', tier: 'pro', text: '문장', proSessionToken: bad },
      PRO_ENV,
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /requires a proSessionToken/);
  }
});

test('gate-on: pro enforces the 12000-char cap with 413', () => {
  const res = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: 'a'.repeat(12001), proSessionToken: 't' },
    PRO_ENV,
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 413);
});

test('gate-on: pro fails closed when the server enhanced route is not configured', () => {
  const res = resolveProviderModel({ tier: 'pro' }, { PATINA_PRO_ENABLED: 'true' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'pro provider not configured');
});

// --- redaction (new Pro secret-key families) --------------------------------
test('redactSecrets strips pro license/session/signature key families', () => {
  const out = redactSecrets({
    licenseKey: 'LEMON-RAW-KEY',
    proSessionToken: 'opaque-token',
    sessionToken: 'sess',
    entitlementToken: 'ent',
    lemonSignature: 'sig-abc',
    keep: 'visible',
  });
  assert.equal(out.licenseKey, '[REDACTED]');
  assert.equal(out.proSessionToken, '[REDACTED]');
  assert.equal(out.sessionToken, '[REDACTED]');
  assert.equal(out.entitlementToken, '[REDACTED]');
  assert.equal(out.lemonSignature, '[REDACTED]');
  assert.equal(out.keep, 'visible');
});

// --- gate hardening from G001 review (architect + red-team blockers) --------
test('gate-on: pro fails closed when the provider is set but the model is missing', () => {
  // Provider-only misconfiguration must NOT silently route to a preset model.
  const res = resolveProviderModel({ tier: 'pro' }, { PATINA_PRO_ENABLED: 'true', PATINA_PRO_PROVIDER: 'openai' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'pro model not configured');
});

test('gate-on: pro rejects an oversized proSessionToken (abuse/DoS bound)', () => {
  const ok = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '문장', proSessionToken: 'x'.repeat(MAX_PRO_SESSION_TOKEN_CHARS) },
    PRO_ENV,
  );
  assert.equal(ok.ok, true);
  const tooLong = validateRewriteRequest(
    { mode: 'first', lang: 'ko', tier: 'pro', text: '문장', proSessionToken: 'x'.repeat(MAX_PRO_SESSION_TOKEN_CHARS + 1) },
    PRO_ENV,
  );
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.error, /proSessionToken is too long/);
});
