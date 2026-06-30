import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEB_TIERS,
  isProEnabled,
  redactSecrets,
  resolveProviderModel,
  validateRewriteRequest,
} from '../../src/web-rewrite-contract.js';

const PRO_ENV = Object.freeze({
  PATINA_PRO_ENABLED: 'true',
  PATINA_PRO_PROVIDER: 'openai',
  PATINA_PRO_MODEL: 'gpt-5.5',
});

const VALID_PRO_BODY = Object.freeze({
  mode: 'first',
  lang: 'ko',
  tier: WEB_TIERS.PRO,
  text: '적대적 테스트 문장',
  proSessionToken: 'opaque-session-token',
});

function assertRejectsCleanly(body, env, expectedStatus, label) {
  assert.doesNotThrow(() => validateRewriteRequest(body, env), label);
  const result = validateRewriteRequest(body, env);
  assert.equal(result.ok, false, label);
  assert.equal(result.status, expectedStatus, label);
  assert.equal(typeof result.error, 'string', label);
  assert.notEqual(result.error.length, 0, label);
  return result;
}

function assertNoRawSecrets(serialized, secrets) {
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `raw secret survived serialization: ${secret}`);
  }
}

test('redteam pro gate: PATINA_PRO_ENABLED bypass spellings stay disabled', () => {
  for (const value of ['True', 'TRUE', ' true ', '1', 'yes']) {
    const env = { ...PRO_ENV, PATINA_PRO_ENABLED: value };
    assert.equal(isProEnabled(env), false, `gate opened for ${JSON.stringify(value)}`);

    const validation = validateRewriteRequest(VALID_PRO_BODY, env);
    assert.equal(validation.ok, false, `pro validation opened for ${JSON.stringify(value)}`);
    assert.equal(validation.status, 403, `pro validation did not fail closed for ${JSON.stringify(value)}`);

    const resolved = resolveProviderModel({ tier: WEB_TIERS.PRO }, env);
    assert.equal(resolved.ok, false, `pro provider resolved for ${JSON.stringify(value)}`);
    assert.equal(resolved.error, 'pro tier unavailable');
  }
});

test('redteam pro gate: gate-off pro never silently downgrades to free or BYOK', () => {
  const attempts = [
    { ...VALID_PRO_BODY },
    { ...VALID_PRO_BODY, provider: 'openai', model: 'gpt-5.5' },
    { ...VALID_PRO_BODY, provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-attacker-byok-123456' },
    { ...VALID_PRO_BODY, apiKey: 'sk-attacker-byok-123456' },
    { ...VALID_PRO_BODY, text: 'x'.repeat(12000), history: [{ role: 'user', content: 'previous' }] },
    { ...VALID_PRO_BODY, mode: 'refine', original: '원문', text: '수정' },
  ];

  for (const body of attempts) {
    const result = assertRejectsCleanly(body, {}, 403, JSON.stringify(body));
    assert.equal(result.error, 'pro tier unavailable');
  }
});

test('redteam pro gate: tier prototype-pollution and type-confusion values reject without throwing', () => {
  const tierValues = ['__proto__', { toString: () => 'pro' }, ['pro'], 1];
  for (const tier of tierValues) {
    assertRejectsCleanly(
      { mode: 'first', lang: 'ko', tier, text: '문장', proSessionToken: 'opaque-session-token' },
      PRO_ENV,
      400,
      `tier=${Object.prototype.toString.call(tier)}`,
    );
  }
});

test('redteam pro gate: gate-on pro rejects simultaneous raw license, route override, and apiKey injection', () => {
  const attempts = [
    { ...VALID_PRO_BODY, licenseKey: 'LEMON-RAW-KEY' },
    { ...VALID_PRO_BODY, provider: 'claude', model: 'claude-opus-4-1' },
    { ...VALID_PRO_BODY, apiKey: 'sk-attacker-byok-123456' },
    {
      ...VALID_PRO_BODY,
      licenseKey: 'LEMON-RAW-KEY',
      provider: 'claude',
      model: 'claude-opus-4-1',
      apiKey: 'sk-attacker-byok-123456',
    },
  ];

  for (const body of attempts) {
    assertRejectsCleanly(body, PRO_ENV, 400, JSON.stringify(body));
  }
});

test('redteam pro gate: proSessionToken rejects non-string, blank, and oversized values', () => {
  const badTokens = [undefined, null, 0, 1, false, {}, [], '', '   ', 'x'.repeat(65536)];
  for (const proSessionToken of badTokens) {
    assertRejectsCleanly(
      { ...VALID_PRO_BODY, proSessionToken },
      PRO_ENV,
      400,
      `proSessionToken=${Object.prototype.toString.call(proSessionToken)}`,
    );
  }
});

test('redteam pro gate: pro redaction covers license/signature/session/entitlement families, casing, nesting, and preserves input', () => {
  const rawSecrets = [
    'LEMON-RAW-KEY',
    'sig-secret-value',
    'opaque-pro-session',
    'browser-session-token',
    'entitlement-token-value',
    'nested-license-value',
    'case-signature-value',
    'case-pro-session-value',
  ];
  const input = {
    licenseKey: rawSecrets[0],
    lemonSignature: rawSecrets[1],
    proSessionToken: rawSecrets[2],
    sessionToken: rawSecrets[3],
    entitlementToken: rawSecrets[4],
    nested: [{ license_key: rawSecrets[5] }, { harmless: 'visible' }],
    LEMON_SIGNATURE: rawSecrets[6],
    Pro_Session_Token: rawSecrets[7],
    message: 'visible text without raw key names',
  };
  const before = JSON.stringify(input);

  const redacted = redactSecrets(input);
  const serialized = JSON.stringify(redacted);

  assert.equal(JSON.stringify(input), before, 'redactSecrets must not mutate input');
  assertNoRawSecrets(serialized, rawSecrets);
  assert.equal(serialized.includes('[REDACTED]'), true);
  assert.equal(redacted.message, 'visible text without raw key names');
  assert.equal(redacted.nested[1].harmless, 'visible');

  for (const rawKey of ['licenseKey', 'lemonSignature', 'proSessionToken', 'sessionToken', 'entitlementToken']) {
    assert.equal(serialized.includes(`"${rawKey}":"${input[rawKey]}"`), false, `${rawKey} raw value survived`);
  }
});

test('redteam pro gate: gate-on pro fails closed when provider is missing or model is not allowlisted', () => {
  const missingProvider = validateRewriteRequest(VALID_PRO_BODY, { PATINA_PRO_ENABLED: 'true' });
  assert.equal(missingProvider.ok, false);
  assert.equal(missingProvider.status, 400);
  assert.equal(missingProvider.error, 'pro provider not configured');

  const badModel = validateRewriteRequest(VALID_PRO_BODY, {
    PATINA_PRO_ENABLED: 'true',
    PATINA_PRO_PROVIDER: 'openai',
    PATINA_PRO_MODEL: 'attacker-model',
  });
  assert.equal(badModel.ok, false);
  assert.equal(badModel.status, 400);
  assert.equal(badModel.error, 'pro model not configured');

  assert.equal(resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_ENABLED: 'true' }).ok, false);
  assert.equal(resolveProviderModel({ tier: WEB_TIERS.PRO }, {
    PATINA_PRO_ENABLED: 'true',
    PATINA_PRO_PROVIDER: 'openai',
    PATINA_PRO_MODEL: 'attacker-model',
  }).ok, false);
});
