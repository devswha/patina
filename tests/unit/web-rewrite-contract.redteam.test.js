import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_LIMITS,
  PROVIDER_PRESETS,
  QUOTA_REASONS,
  REWRITE_MODES,
  STREAM_FRAME_TYPES,
  TIER_LIMITS,
  WEB_TIERS,
  encodeStreamFrame,
  evaluateFloors,
  normalizeHistory,
  parseStreamFrame,
  redactSecrets,
  resolveProviderModel,
  resolveTierLimits,
  validateRewriteRequest,
} from '../../src/web-rewrite-contract.js';

const attackerBaseURL = 'https://attacker.example/steal';
const validByok = {
  mode: REWRITE_MODES.FIRST,
  lang: 'en',
  tier: WEB_TIERS.BYOK,
  text: 'Rewrite this without sounding like generated text.',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  apiKey: 'sk-valid-user-key',
};

function assertRejectsCleanly(body, expectedStatus) {
  assert.doesNotThrow(() => validateRewriteRequest(body));
  const result = validateRewriteRequest(body);
  assert.equal(result.ok, false);
  assert.equal(result.status, expectedStatus);
  assert.equal(typeof result.error, 'string');
  assert.notEqual(result.error.length, 0);
  return result;
}

test('redteam: provider/baseURL injection cannot exfiltrate BYOK keys', () => {
  const attackerProvider = resolveProviderModel({
    tier: WEB_TIERS.BYOK,
    provider: 'evil-openai-compatible',
    model: 'gpt-4.1-mini',
    baseURL: attackerBaseURL,
  });
  assert.equal(attackerProvider.ok, false);

  const unlistedModel = resolveProviderModel({
    tier: WEB_TIERS.BYOK,
    provider: 'openai',
    model: 'attacker-model',
    baseURL: attackerBaseURL,
  });
  assert.equal(unlistedModel.ok, false);

  const injectedBase = resolveProviderModel({
    tier: WEB_TIERS.BYOK,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseURL: attackerBaseURL,
  });
  assert.equal(injectedBase.ok, true);
  assert.equal(injectedBase.baseURL, PROVIDER_PRESETS.openai.baseURL);
  assert.notEqual(injectedBase.baseURL, attackerBaseURL);

  const rejectedProvider = validateRewriteRequest({
    ...validByok,
    provider: 'evil-openai-compatible',
    baseURL: attackerBaseURL,
  });
  assert.equal(rejectedProvider.ok, false);
  assert.equal(rejectedProvider.status, 400);

  const rejectedModel = validateRewriteRequest({ ...validByok, model: 'attacker-model', baseURL: attackerBaseURL });
  assert.equal(rejectedModel.ok, false);
  assert.equal(rejectedModel.status, 400);

  const acceptedWithIgnoredBase = validateRewriteRequest({ ...validByok, baseURL: attackerBaseURL });
  assert.equal(acceptedWithIgnoredBase.ok, true);
  assert.equal(acceptedWithIgnoredBase.value.baseURL, PROVIDER_PRESETS.openai.baseURL);
  assert.notEqual(acceptedWithIgnoredBase.value.baseURL, attackerBaseURL);
});

test('redteam: free tier rejects apiKey smuggling instead of silently dropping it', () => {
  const result = validateRewriteRequest({
    mode: REWRITE_MODES.FIRST,
    lang: 'en',
    tier: WEB_TIERS.FREE,
    text: 'Free rewrite attempt.',
    apiKey: 'sk-smuggled-free-key',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /free tier must not include an apiKey/);
});

test('redteam: redaction survives casing, nesting, inline tokens, deep structures, and does not mutate input', () => {
  const secrets = [
    'sk-UPPERCASESECRET123456',
    'sk-under_score_secret_123456',
    'Bearer sk-inline-bearer-token-123456',
    'sk-deepsecret1234567890',
    'Bearer abc.def-ghi_123456',
  ];
  const input = {
    APIKEY: secrets[0],
    Api_Key: secrets[1],
    Authorization: secrets[2],
    nested: [
      { token: 'sk-arraysecret12345678' },
      `prefix ${secrets[3]} suffix`,
      { harmless: 'visible text' },
    ],
    message: `long string before ${secrets[4]} and ${secrets[1]} after`,
    deep: { level1: { level2: { level3: { secret: 'sk-objectsecret12345678' } } } },
  };
  const before = JSON.stringify(input);

  const redacted = redactSecrets(input);
  const serialized = JSON.stringify(redacted);

  for (const secret of [...secrets, 'sk-arraysecret12345678', 'sk-objectsecret12345678']) {
    assert.equal(serialized.includes(secret), false, `secret survived redaction: ${secret}`);
  }
  assert.equal(serialized.includes('[REDACTED]'), true);
  assert.equal(JSON.stringify(input), before, 'redactSecrets must not mutate caller input');
});

test('redteam: evaluateFloors fails closed for missing, non-finite, strings, negative, and below-floor scores', () => {
  const failingCases = [
    {},
    { mps: Number.NaN, fidelity: 70 },
    { mps: 70, fidelity: Number.POSITIVE_INFINITY },
    { mps: '70', fidelity: 70 },
    { mps: 70, fidelity: '70' },
    { mps: -1, fidelity: 70 },
    { mps: 70, fidelity: 69 },
    { mps: 69, fidelity: 70 },
  ];

  for (const scores of failingCases) {
    const result = evaluateFloors(scores);
    assert.equal(result.ok, false, `unexpected pass for ${JSON.stringify(scores)}`);
    assert.ok(result.failed.length > 0);
  }

  assert.deepEqual(evaluateFloors({ mps: 70, fidelity: 70 }), { ok: true, failed: [] });
});

test('redteam: corrupt stream frames are terminal errors and newline-bearing deltas round-trip safely', () => {
  const corruptFrames = ['{"type":"delta"', '[{"type":"done"}]', '{"delta":"missing type"}', '123'];

  for (const line of corruptFrames) {
    const parsed = parseStreamFrame(line);
    assert.deepEqual(parsed, { type: STREAM_FRAME_TYPES.ERROR, error: 'malformed stream frame' });
    assert.notEqual(parsed.type, STREAM_FRAME_TYPES.DONE);
  }

  const deltaText = 'first line\n{"type":"done"}\nlast line';
  const encoded = encodeStreamFrame({ type: STREAM_FRAME_TYPES.DELTA, delta: deltaText });
  const parsed = parseStreamFrame(encoded);
  assert.equal(parsed.type, STREAM_FRAME_TYPES.DELTA);
  assert.equal(parsed.delta, deltaText);
  assert.notEqual(parsed.type, STREAM_FRAME_TYPES.DONE);
});

test('redteam: char caps and history DoS bounds hold at cap, cap+1, maxTurns, byte budget, and oversized turns', () => {
  const atCap = validateRewriteRequest({
    mode: REWRITE_MODES.FIRST,
    lang: 'en',
    tier: WEB_TIERS.FREE,
    text: 'x'.repeat(TIER_LIMITS.free.maxChars),
  });
  assert.equal(atCap.ok, true);

  const overCap = validateRewriteRequest({
    mode: REWRITE_MODES.FIRST,
    lang: 'en',
    tier: WEB_TIERS.FREE,
    text: 'x'.repeat(TIER_LIMITS.free.maxChars + 1),
  });
  assert.equal(overCap.ok, false);
  assert.equal(overCap.status, 413);

  const enormousHistory = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn-${i}-` + 'x'.repeat(2048),
  }));
  const normalized = normalizeHistory(enormousHistory);
  assert.equal(normalized.ok, true);
  assert.ok(normalized.value.length <= CONTEXT_LIMITS.maxTurns);
  assert.ok(normalized.value.reduce((sum, turn) => sum + new globalThis.TextEncoder().encode(turn.content).length, 0) <= CONTEXT_LIMITS.maxBytes);
  assert.deepEqual(normalized.value, enormousHistory.slice(-normalized.value.length));

  const oversizedTurn = normalizeHistory([{ role: 'user', content: 'x'.repeat(CONTEXT_LIMITS.maxBytes + 1) }]);
  assert.equal(oversizedTurn.ok, true);
  assert.deepEqual(oversizedTurn.value, []);
});

test('redteam: type confusion inputs reject cleanly with 400/413 and never throw', () => {
  for (const body of [[], null, 'string body']) {
    assertRejectsCleanly(body, 400);
  }

  for (const text of [123, null]) {
    assertRejectsCleanly({ mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.FREE, text }, 400);
  }

  for (const lang of [123, null]) {
    assertRejectsCleanly({ mode: REWRITE_MODES.FIRST, lang, tier: WEB_TIERS.FREE, text: 'valid text' }, 400);
  }

  for (const history of ['not-array', 42]) {
    assertRejectsCleanly({ mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.FREE, text: 'valid text', history }, 400);
  }

  assertRejectsCleanly({
    mode: REWRITE_MODES.FIRST,
    lang: 'en',
    tier: WEB_TIERS.FREE,
    text: 'valid text',
    history: [{ role: 'user', content: { nested: 'not a string' } }],
  }, 400);

  assertRejectsCleanly({ mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.FREE, text: 'x'.repeat(TIER_LIMITS.free.maxChars + 1) }, 413);
});

test('redteam: pro tier rejects licenseKey/license_key/apiKey smuggled in the body and never leaks the license', () => {
  const proBase = { mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.PRO, text: 'Rewrite this for a pro user.' };
  const validHeader = { proLicenseSource: 'authorization-bearer' };
  const licenseValue = 'LK-TOPSECRET-1234567890';

  // A body-carried license is rejected with 400 even when a valid Authorization
  // header is also present, and the raw license never appears in the result.
  for (const field of ['licenseKey', 'license_key']) {
    const r = validateRewriteRequest({ ...proBase, [field]: licenseValue }, {}, validHeader);
    assert.equal(r.ok, false, `${field} smuggling should be rejected`);
    assert.equal(r.status, 400);
    assert.match(r.error, /Authorization: Bearer/);
    assert.equal(JSON.stringify(r).includes(licenseValue), false, `${field} value leaked into the result`);
  }

  // A pro request must not carry a provider apiKey either (rejected, not silently dropped).
  const withApiKey = validateRewriteRequest({ ...proBase, apiKey: 'sk-should-not-be-here' }, {}, validHeader);
  assert.equal(withApiKey.ok, false);
  assert.equal(withApiKey.status, 400);
  assert.equal(JSON.stringify(withApiKey).includes('sk-should-not-be-here'), false);

  // Even a fully valid pro request never echoes a license/apiKey field in its normalized value.
  const ok = validateRewriteRequest(proBase, {}, validHeader);
  assert.equal(ok.ok, true);
  assert.equal('licenseKey' in ok.value, false);
  assert.equal('license_key' in ok.value, false);
  assert.equal(ok.value.apiKey, undefined);
});

test('redteam: pro tier fails closed with 401 LICENSE_REQUIRED for missing/typo/case/whitespace/object proLicenseSource', () => {
  const proBase = { mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.PRO, text: 'Pro request.' };
  const badSources = [
    '',
    'authorization_bearer',
    'authorizationbearer',
    'Authorization-Bearer',
    'AUTHORIZATION-BEARER',
    ' authorization-bearer ',
    'authorization-bearer\n',
    'bearer',
    'authorization-bearer ',
    123,
    true,
    ['authorization-bearer'],
    { toString: () => 'authorization-bearer' },
    { proLicenseSource: 'authorization-bearer' },
  ];
  for (const src of badSources) {
    const r = validateRewriteRequest(proBase, {}, { proLicenseSource: src });
    assert.equal(r.ok, false, `unexpected pass for proLicenseSource=${JSON.stringify(src)}`);
    assert.equal(r.status, 401, `expected 401 for proLicenseSource=${JSON.stringify(src)}`);
    assert.equal(r.error, QUOTA_REASONS.LICENSE_REQUIRED);
  }

  // Missing options entirely (2-arg and empty-object calls) also fails closed.
  for (const r of [validateRewriteRequest(proBase), validateRewriteRequest(proBase, {}), validateRewriteRequest(proBase, {}, {})]) {
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(r.error, QUOTA_REASONS.LICENSE_REQUIRED);
  }

  // Only the exact string unlocks pro.
  assert.equal(validateRewriteRequest(proBase, {}, { proLicenseSource: 'authorization-bearer' }).ok, true);
});

test('redteam: pro-like and mis-cased tier strings are rejected with 400 (no fuzzy tier matching)', () => {
  const badTiers = ['pro ', ' pro', 'PRO', 'Pro', 'pro\t', 'pro\n', 'proo', 'pr0', 'pro-tier', 'proish', 'FREE', 'Byok', 'BYOK', 123, 0, true, {}, ['pro'], null];
  for (const tier of badTiers) {
    const r = validateRewriteRequest({ mode: REWRITE_MODES.FIRST, lang: 'en', tier, text: 'hi' }, {}, { proLicenseSource: 'authorization-bearer' });
    assert.equal(r.ok, false, `unexpected pass for tier=${JSON.stringify(tier)}`);
    assert.equal(r.status, 400, `expected 400 for tier=${JSON.stringify(tier)}`);
    assert.match(r.error, /tier must be/);
  }
});

test('redteam: malformed pro env caps fall back to defaults, free/byok stay frozen, and the body cannot raise the 413 threshold', () => {
  const proDefault = TIER_LIMITS.pro.maxChars;

  // Malformed overrides must fall back to the frozen default: never widen, never
  // become unbounded (Infinity/NaN must not slip through as a cap).
  const malformed = ['-5000', '0', '', '   ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999', '4000.5', '4000abc', 'null', '0x'];
  for (const v of malformed) {
    const limits = resolveTierLimits({ PATINA_PRO_MAX_CHARS: v });
    assert.equal(limits.pro.maxChars, proDefault, `override ${JSON.stringify(v)} unexpectedly changed pro.maxChars`);
    assert.ok(Number.isFinite(limits.pro.maxChars) && Number.isInteger(limits.pro.maxChars) && limits.pro.maxChars > 0);
  }
  // Non-string junk (object) also falls back.
  assert.equal(resolveTierLimits({ PATINA_PRO_MAX_CHARS: {} }).pro.maxChars, proDefault);
  assert.equal(resolveTierLimits({ PATINA_PRO_REQ_PER_DAY: 'abc', PATINA_PRO_MAX_CONCURRENT: '-2' }).pro.reqPerDay, TIER_LIMITS.pro.reqPerDay);
  assert.equal(resolveTierLimits({ PATINA_PRO_MAX_CONCURRENT: '-2' }).pro.maxConcurrent, TIER_LIMITS.pro.maxConcurrent);

  // A pro env override NEVER touches free/byok caps (override blast radius is pro-only).
  const huge = resolveTierLimits({ PATINA_PRO_MAX_CHARS: '999999999', PATINA_PRO_REQ_PER_DAY: '999999999', PATINA_PRO_MAX_CONCURRENT: '999999999' });
  assert.equal(huge.free.maxChars, TIER_LIMITS.free.maxChars);
  assert.equal(huge.byok.maxChars, TIER_LIMITS.byok.maxChars);

  // Boundary: genuinely large *valid* positive integers are honored by design. These
  // come only from operator-controlled env (never the attacker-controlled body), so
  // they are not a 413 bypass. This pins the malformed=>fallback vs valid=>honored line.
  assert.equal(resolveTierLimits({ PATINA_PRO_MAX_CHARS: '1000000000' }).pro.maxChars, 1000000000);
  assert.equal(resolveTierLimits({ PATINA_PRO_MAX_CHARS: '1e9' }).pro.maxChars, 1e9);

  // The request body cannot raise its own 413 threshold: junk body fields shaped like
  // config are ignored, so text one char over the resolved cap is always 413.
  const overByOne = validateRewriteRequest(
    {
      mode: REWRITE_MODES.FIRST,
      lang: 'en',
      tier: WEB_TIERS.PRO,
      text: 'x'.repeat(proDefault + 1),
      maxChars: 10 ** 9,
      limits: { pro: { maxChars: 10 ** 9 } },
      PATINA_PRO_MAX_CHARS: '999999999',
    },
    {},
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(overByOne.ok, false);
  assert.equal(overByOne.status, 413);

  // At exactly the resolved cap it passes, confirming the cap is the default (not widened).
  const atCap = validateRewriteRequest(
    { mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.PRO, text: 'x'.repeat(proDefault) },
    {},
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(atCap.ok, true);
});

test('redteam: resolveProviderModel pro ignores body provider/model and rejects prototype/unlisted env picks without throwing', () => {
  // Body-supplied provider/model are IGNORED for pro — server env/defaults win.
  for (const inj of [
    { provider: 'claude', model: 'claude-opus-4-1' },
    { provider: '__proto__', model: 'constructor' },
    { provider: 'evil-host', model: 'attacker-model' },
    { provider: 123, model: {} },
    { provider: ['openai'], model: null },
  ]) {
    let r;
    assert.doesNotThrow(() => { r = resolveProviderModel({ tier: WEB_TIERS.PRO, ...inj }, {}); });
    assert.equal(r.ok, true, `pro body injection ${JSON.stringify(inj)} should resolve from env defaults`);
    assert.equal(r.provider, 'openai');
    assert.equal(r.model, PROVIDER_PRESETS.openai.models[0]);
    assert.equal(r.baseURL, PROVIDER_PRESETS.openai.baseURL);
  }

  // Prototype-polluting / unlisted env provider names resolve to a clean rejection, never a throw.
  for (const provider of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'evil-host']) {
    let r;
    assert.doesNotThrow(() => { r = resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_PROVIDER: provider }); });
    assert.equal(r.ok, false, `env provider ${provider} must be rejected`);
    assert.equal('error' in r, true);
    assert.equal(typeof r.error, 'string');
  }

  // Unlisted / prototype env model resolves to a clean rejection (valid provider, bad model).
  for (const model of ['attacker-model', '__proto__', 'constructor', 'toString']) {
    let r;
    assert.doesNotThrow(() => { r = resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_MODEL: model }); });
    assert.equal(r.ok, false, `env model ${model} must be rejected`);
  }

  // End-to-end: a pro request with body provider/model injection resolves to the env default.
  const req = validateRewriteRequest(
    { mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.PRO, text: 'hi', provider: 'claude', model: 'claude-opus-4-1' },
    {},
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(req.ok, true);
  assert.equal(req.value.provider, 'openai');
  assert.equal(req.value.baseURL, PROVIDER_PRESETS.openai.baseURL);
  assert.notEqual(req.value.model, 'claude-opus-4-1');
});

test('redteam: redactSecrets masks license keys (nested/array/casing/inline/tab/Bearer), preserves sk-/Bearer masking, and never mutates input', () => {
  const marker = 'ZZTOPSECRETVALUE';
  const input = {
    licenseKey: `LK-${marker}-1`,
    license_key: `LK-${marker}-2`,
    LICENSE_KEY: `LK-${marker}-3`,
    'License-Key': `LK-${marker}-4`,
    nested: { inner: { licenseKey: `LK-${marker}-6` } },
    arr: [{ license_key: `LK-${marker}-7` }, 'harmless-visible', { note: 'ok' }],
    inlineEq: `boom license_key=LIVE-${marker}-8 tail`,
    tabbed: `f1\tlicense_key=LIVE-${marker}-10\tf2`,
    authHeader: `Authorization: Bearer LIVE-${marker}-11`,
    upstreamLog: `upstream returned Bearer LIVE-${marker}-12 rejected`,
    skLine: `leak sk-${marker}abcdef12 here`,
    harmless: 'this stays visible',
  };
  const before = JSON.stringify(input);
  const out = redactSecrets(input);
  const flat = JSON.stringify(out);

  // No fragment of any license/secret value survives anywhere in the output.
  assert.equal(flat.includes(marker), false, 'a secret value fragment survived redaction');
  assert.equal(flat.includes('[REDACTED]'), true);

  // Secret-named keys (all casings) are fully masked, including nested and inside arrays.
  assert.equal(out.licenseKey, '[REDACTED]');
  assert.equal(out.license_key, '[REDACTED]');
  assert.equal(out.LICENSE_KEY, '[REDACTED]');
  assert.equal(out['License-Key'], '[REDACTED]');
  assert.equal(out.nested.inner.licenseKey, '[REDACTED]');
  assert.equal(out.arr[0].license_key, '[REDACTED]');

  // Inline license shapes on non-secret keys are masked while non-secret text is preserved.
  assert.match(out.inlineEq, /^boom \[REDACTED\] tail$/);
  assert.match(out.tabbed, /^f1\t\[REDACTED\]\tf2$/);
  assert.equal(out.authHeader.includes(marker), false);
  assert.equal(out.upstreamLog.includes(marker), false);
  assert.match(out.upstreamLog, /^upstream returned \[REDACTED\] rejected$/);

  // Regression guard: existing sk-/Bearer masking still fires unchanged.
  assert.match(out.skLine, /^leak \[REDACTED\] here$/);

  // Non-secret content stays visible (over-redaction is bounded to secret shapes/keys).
  assert.equal(out.harmless, 'this stays visible');
  assert.equal(out.arr[1], 'harmless-visible');
  assert.equal(out.arr[2].note, 'ok');

  // Input object is never mutated.
  assert.equal(JSON.stringify(input), before, 'redactSecrets must not mutate caller input');
});

test('redteam: free and byok requests are unaffected by the pro contract (no regression)', () => {
  // free: valid request resolves from env, no apiKey echoed, no license needed.
  const free = validateRewriteRequest({ mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.FREE, text: 'Free rewrite.' });
  assert.equal(free.ok, true);
  assert.equal(free.value.tier, WEB_TIERS.FREE);
  assert.equal(free.value.apiKey, undefined);
  assert.equal(free.value.provider, 'openai');

  // free: apiKey smuggling still 400 (unchanged behavior).
  const freeKey = validateRewriteRequest({ mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.FREE, text: 'x', apiKey: 'sk-x' });
  assert.equal(freeKey.ok, false);
  assert.equal(freeKey.status, 400);

  // free: the pro-only license gate does not bleed into free (no header required).
  assert.equal(validateRewriteRequest({ mode: REWRITE_MODES.FIRST, lang: 'en', tier: WEB_TIERS.FREE, text: 'x' }, {}, {}).ok, true);

  // byok: valid request preserves the caller apiKey and allowlisted provider/model.
  const byok = validateRewriteRequest(validByok);
  assert.equal(byok.ok, true);
  assert.equal(byok.value.tier, WEB_TIERS.BYOK);
  assert.equal(byok.value.apiKey, validByok.apiKey);
  assert.equal(byok.value.provider, 'openai');
  assert.equal(byok.value.model, 'gpt-4.1-mini');
  assert.equal(byok.value.baseURL, PROVIDER_PRESETS.openai.baseURL);

  // byok: missing apiKey still 400 (unchanged).
  const { apiKey: _drop, ...noKey } = validByok;
  const byokNoKey = validateRewriteRequest(noKey);
  assert.equal(byokNoKey.ok, false);
  assert.equal(byokNoKey.status, 400);

  // byok: unlisted provider still 400 (unchanged).
  const byokBadProvider = validateRewriteRequest({ ...validByok, provider: 'evil-host' });
  assert.equal(byokBadProvider.ok, false);
  assert.equal(byokBadProvider.status, 400);

  // byok does NOT require a pro license source — passing one changes nothing.
  const byokWithProSource = validateRewriteRequest(validByok, {}, { proLicenseSource: 'authorization-bearer' });
  assert.equal(byokWithProSource.ok, true);
  assert.deepEqual(byokWithProSource.value, byok.value);
});
