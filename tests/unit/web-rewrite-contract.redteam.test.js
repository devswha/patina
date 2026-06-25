import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_LIMITS,
  PROVIDER_PRESETS,
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
