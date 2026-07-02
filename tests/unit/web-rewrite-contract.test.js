import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SUPPORTED_LANGS,
  WEB_TIERS,
  REWRITE_MODES,
  MPS_FLOOR,
  FIDELITY_FLOOR,
  TIER_LIMITS,
  CONTEXT_LIMITS,
  STREAM_FRAME_TYPES,
  PROVIDER_PRESETS,
  byteLength,
  redactSecrets,
  resolveProviderModel,
  normalizeHistory,
  validateRewriteRequest,
  encodeStreamFrame,
  parseStreamFrame,
  evaluateFloors,
} from '../../src/web-rewrite-contract.js';

// The contract module is the single source of truth shared by the serverless
// handler, the web runner, the browser client, and these tests. It MUST stay
// isomorphic (no node: imports) and dependency-free.
test('contract module imports no node: builtins or runtime deps', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../src/web-rewrite-contract.js', import.meta.url), 'utf8'),
  );
  assert.doesNotMatch(src, /from\s+['"]node:/, 'must not import node: builtins (stays browser-safe)');
  assert.doesNotMatch(src, /require\s*\(/, 'must stay pure ESM');
  // Only relative or bare specifiers would appear; there should be no imports at all.
  assert.doesNotMatch(src, /^\s*import\s+/m, 'contract must be self-contained with no imports');
});

test('supported languages and floors match the documented contract', () => {
  assert.deepEqual([...SUPPORTED_LANGS], ['ko', 'en', 'zh', 'ja']);
  assert.equal(MPS_FLOOR, 70);
  assert.equal(FIDELITY_FLOOR, 70);
  assert.equal(CONTEXT_LIMITS.maxTurns, 6);
  assert.equal(CONTEXT_LIMITS.maxBytes, 12 * 1024);
  assert.equal(TIER_LIMITS.free.maxChars, 4000);
  assert.equal(TIER_LIMITS.byok.maxChars, 20000);
});

test('byteLength counts UTF-8 bytes, not UTF-16 code units', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('한글'), 6); // 3 bytes each
  assert.equal(byteLength('🚀'), 4);
  assert.equal(byteLength(''), 0);
  assert.equal(byteLength(null), 0);
});

// --- redaction (premortem: BYOK key / Authorization leakage into logs) ------
test('redactSecrets strips secret-named keys and inline token shapes', () => {
  const input = {
    apiKey: 'sk-secret-key-value-123456',
    api_key: 'sk-another-9999999999',
    Authorization: 'Bearer sk-tok-abcdefgh',
    nested: { token: 't0ps3cr3t', safe: 'keep-me' },
    message: 'failed with Authorization: Bearer sk-live-abcdefghij and key sk-deadbeefcafef00d',
    list: [{ secret: 'x' }, 'Bearer sk-zzzzzzzzzz'],
  };
  const out = redactSecrets(input);
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /sk-secret-key-value/);
  assert.doesNotMatch(json, /sk-another/);
  assert.doesNotMatch(json, /sk-tok-abcdefgh/);
  assert.doesNotMatch(json, /t0ps3cr3t/);
  assert.doesNotMatch(json, /sk-live-abcdefghij/);
  assert.doesNotMatch(json, /sk-deadbeefcafef00d/);
  assert.doesNotMatch(json, /sk-zzzzzzzzzz/);
  assert.equal(out.nested.safe, 'keep-me');
});

test('redactSecrets does not mutate its input', () => {
  const input = { apiKey: 'sk-original-value-123' };
  redactSecrets(input);
  assert.equal(input.apiKey, 'sk-original-value-123');
});

// Regression (architect finding 2): redaction must cover realistic secret-key
// families, not just exact apiKey/token names, since the README promises BYOK
// keys never survive into logs/errors.
test('redactSecrets covers secret-key families (openaiApiKey, access_token, client_secret, ...)', () => {
  const input = {
    openaiApiKey: 'sk-openai-aaaaaaaaaa',
    providerApiKey: 'sk-provider-bbbbbbbbbb',
    access_token: 'at-cccccccccccc',
    refreshToken: 'rt-dddddddddddd',
    client_secret: 'cs-eeeeeeeeeeee',
    'X-Api-Key': 'xak-ffffffffffff',
    credentials: { password: 'hunter2hunter2' },
    note: 'kept',
  };
  const out = redactSecrets(input);
  const json = JSON.stringify(out);
  for (const leak of ['sk-openai', 'sk-provider', 'at-cccc', 'rt-dddd', 'cs-eeee', 'xak-ffff', 'hunter2']) {
    assert.doesNotMatch(json, new RegExp(leak), `${leak} must be redacted`);
  }
  assert.equal(out.note, 'kept');
});

// --- provider/model allowlist (premortem: arbitrary base URL / model) -------
test('resolveProviderModel pins free provider from env and never trusts the body', () => {
  const r = resolveProviderModel({ tier: WEB_TIERS.FREE, provider: 'evil', model: 'evil-model' }, {});
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.baseURL, PROVIDER_PRESETS.openai.baseURL);
  // body-provided provider/model are ignored for free tier.
  assert.notEqual(r.model, 'evil-model');
});

test('resolveProviderModel honors env overrides for the free preset', () => {
  const r = resolveProviderModel(
    { tier: WEB_TIERS.FREE },
    { PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-4.1-mini' },
  );
  assert.equal(r.ok, true);
  assert.equal(r.model, 'gpt-4.1-mini');
});

test('resolveProviderModel rejects an env free model that is not allowlisted', () => {
  const r = resolveProviderModel({ tier: WEB_TIERS.FREE }, { PATINA_FREE_MODEL: 'not-real' });
  assert.equal(r.ok, false);
});

test('resolveProviderModel enforces the byok allowlist', () => {
  const ok = resolveProviderModel({ tier: WEB_TIERS.BYOK, provider: 'openai', model: 'gpt-5.5' });
  assert.equal(ok.ok, true);
  assert.equal(ok.baseURL, PROVIDER_PRESETS.openai.baseURL);

  assert.equal(resolveProviderModel({ tier: WEB_TIERS.BYOK, provider: 'openai', model: 'ghost' }).ok, false);
  assert.equal(resolveProviderModel({ tier: WEB_TIERS.BYOK, provider: 'unknown', model: 'gpt-5.5' }).ok, false);
  assert.equal(resolveProviderModel({ tier: 'mystery' }).ok, false);
});

// Regression (architect finding 1): inherited Object.prototype property names
// must resolve to a clean allowlist rejection, never reach the prototype and
// throw on `.models.includes`.
test('resolveProviderModel rejects inherited prototype names without throwing', () => {
  for (const name of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']) {
    const r = resolveProviderModel({ tier: WEB_TIERS.BYOK, provider: name, model: 'gpt-5.5' });
    assert.equal(r.ok, false, `provider "${name}" must be rejected`);
  }
  // Same guard on the env-driven free provider path.
  assert.equal(resolveProviderModel({ tier: WEB_TIERS.FREE }, { PATINA_FREE_PROVIDER: '__proto__' }).ok, false);
  // And validateRewriteRequest must not throw on a poisoned byok provider.
  assert.doesNotThrow(() =>
    validateRewriteRequest({
      mode: 'first', lang: 'ko', tier: 'byok', text: 'hi', provider: '__proto__', model: 'gpt-5.5', apiKey: 'sk-x',
    }),
  );
});

// --- request validation -----------------------------------------------------
function freeFirst(overrides = {}) {
  return { mode: 'first', lang: 'ko', tier: 'free', text: '안녕하세요 테스트 문장입니다.', ...overrides };
}

test('validateRewriteRequest accepts a well-formed free first-turn request', () => {
  const r = validateRewriteRequest(freeFirst());
  assert.equal(r.ok, true);
  assert.equal(r.value.provider, 'openai');
  assert.equal(r.value.baseURL, PROVIDER_PRESETS.openai.baseURL);
  assert.equal(r.value.apiKey, undefined);
  assert.equal(r.value.original, r.value.text); // first turn anchors to itself
  assert.deepEqual(r.value.history, []);
});

test('validateRewriteRequest accepts a byok request with an allowlisted model + key', () => {
  const r = validateRewriteRequest(
    freeFirst({ tier: 'byok', provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-user-key-xyz' }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.tier, 'byok');
  assert.equal(r.value.apiKey, 'sk-user-key-xyz');
});

test('validateRewriteRequest rejects bad mode/lang/tier/text', () => {
  assert.equal(validateRewriteRequest(null).ok, false);
  assert.equal(validateRewriteRequest([]).ok, false);
  assert.equal(validateRewriteRequest(freeFirst({ mode: 'bogus' })).status, 400);
  assert.equal(validateRewriteRequest(freeFirst({ lang: 'fr' })).status, 400);
  assert.equal(validateRewriteRequest(freeFirst({ tier: 'enterprise' })).status, 400);
  assert.equal(validateRewriteRequest(freeFirst({ text: '   ' })).status, 400);
});

test('validateRewriteRequest enforces per-tier char caps with 413', () => {
  const overFree = validateRewriteRequest(freeFirst({ text: 'a'.repeat(TIER_LIMITS.free.maxChars + 1) }));
  assert.equal(overFree.ok, false);
  assert.equal(overFree.status, 413);

  // The same text fits under the higher byok cap.
  const okByok = validateRewriteRequest(
    freeFirst({
      tier: 'byok',
      provider: 'openai',
      model: 'gpt-5.5',
      apiKey: 'sk-key',
      text: 'a'.repeat(TIER_LIMITS.free.maxChars + 1),
    }),
  );
  assert.equal(okByok.ok, true);
});

test('validateRewriteRequest requires original text for refine turns', () => {
  const missing = validateRewriteRequest(freeFirst({ mode: 'refine' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);

  const ok = validateRewriteRequest(freeFirst({ mode: 'refine', original: '원본 문장.' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.original, '원본 문장.');
});

test('validateRewriteRequest rejects a key on the free tier and a missing key on byok', () => {
  assert.equal(validateRewriteRequest(freeFirst({ apiKey: 'sk-leak' })).ok, false);
  assert.equal(
    validateRewriteRequest(freeFirst({ tier: 'byok', provider: 'openai', model: 'gpt-5.5' })).ok,
    false,
  );
});

// --- history capping --------------------------------------------------------
test('normalizeHistory caps to the most recent maxTurns', () => {
  const turns = [];
  for (let i = 0; i < 20; i += 1) turns.push({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` });
  const r = normalizeHistory(turns);
  assert.equal(r.ok, true);
  assert.equal(r.value.length, CONTEXT_LIMITS.maxTurns);
  assert.equal(r.value.at(-1).content, 't19');
});

test('normalizeHistory trims oldest turns until under the byte cap', () => {
  const big = 'x'.repeat(CONTEXT_LIMITS.maxBytes); // one turn alone hits the cap
  const r = normalizeHistory([
    { role: 'user', content: big },
    { role: 'assistant', content: 'short' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.value.length, 1);
  assert.equal(r.value[0].content, 'short');
});

test('normalizeHistory rejects malformed turns', () => {
  assert.equal(normalizeHistory('nope').ok, false);
  assert.equal(normalizeHistory([{ role: 'system', content: 'x' }]).ok, false);
  assert.equal(normalizeHistory([{ role: 'user', content: 42 }]).ok, false);
  assert.equal(normalizeHistory(null).ok, true); // absent history is allowed
});

// --- stream frames (premortem: broken/truncated stream) ---------------------
test('encode/parse round-trips well-formed frames', () => {
  for (const type of Object.values(STREAM_FRAME_TYPES)) {
    const frame = { type, payload: type };
    const line = encodeStreamFrame(frame);
    assert.ok(line.endsWith('\n'));
    assert.deepEqual(parseStreamFrame(line), frame);
  }
});

test('parseStreamFrame treats malformed/truncated lines as terminal error frames', () => {
  assert.equal(parseStreamFrame(''), null);
  assert.equal(parseStreamFrame('   '), null);
  assert.equal(parseStreamFrame('{"type":"delta","text":"par').type, STREAM_FRAME_TYPES.ERROR); // truncated JSON
  assert.equal(parseStreamFrame('not json at all').type, STREAM_FRAME_TYPES.ERROR);
  assert.equal(parseStreamFrame('{"no":"type"}').type, STREAM_FRAME_TYPES.ERROR);
  assert.equal(parseStreamFrame('[1,2,3]').type, STREAM_FRAME_TYPES.ERROR);
  assert.equal(parseStreamFrame('42').type, STREAM_FRAME_TYPES.ERROR);
});

// Regression (architect finding 3): the frame type set is closed — an
// unrecognized type must fail closed rather than cross as a valid frame.
test('parseStreamFrame fails closed on unknown frame types', () => {
  assert.equal(parseStreamFrame('{"type":"bogus"}').type, STREAM_FRAME_TYPES.ERROR);
  assert.equal(parseStreamFrame('{"type":"START"}').type, STREAM_FRAME_TYPES.ERROR); // case-sensitive
  assert.equal(parseStreamFrame('{"type":""}').type, STREAM_FRAME_TYPES.ERROR);
  // The four documented types still parse.
  for (const t of ['start', 'delta', 'done', 'error']) {
    assert.equal(parseStreamFrame(JSON.stringify({ type: t })).type, t);
  }
});

// --- floors (premortem: missing/below-floor score must fail closed) ---------
test('evaluateFloors passes only when both scores are finite and >= floor', () => {
  assert.deepEqual(evaluateFloors({ mps: 90, fidelity: 85 }), { ok: true, failed: [] });
  assert.deepEqual(evaluateFloors({ mps: 69, fidelity: 99 }).failed, ['mps']);
  assert.deepEqual(evaluateFloors({ mps: 99, fidelity: 10 }).failed, ['fidelity']);
});

test('evaluateFloors fails closed on missing or non-numeric scores', () => {
  assert.equal(evaluateFloors({}).ok, false);
  assert.equal(evaluateFloors({ mps: NaN, fidelity: NaN }).ok, false);
  assert.equal(evaluateFloors({ mps: '90', fidelity: '90' }).ok, false); // strings are not finite numbers
  assert.equal(evaluateFloors(undefined).ok, false);
});

test('REWRITE_MODES and WEB_TIERS expose the documented values', () => {
  assert.deepEqual(REWRITE_MODES, { FIRST: 'first', REFINE: 'refine' });
  assert.deepEqual(WEB_TIERS, { FREE: 'free', BYOK: 'byok' });
});

test('redactSecrets masks labelled provider secrets in free-form strings (#565)', () => {
  const cases = [
    'call failed: apiKey=FAKE_PROVIDER_KEY_1234567890',
    'upstream said x-api-key: FAKE_ANTHROPIC_KEY_abcdef123456 rejected',
    'token=ghp_FAKEFAKE1234567890 expired',
    'client_secret: FAKESECRET99 invalid',
    'authorization: FAKEAUTH999999 denied',
  ];
  for (const message of cases) {
    const out = /** @type {{message: string}} */ (redactSecrets({ message }));
    assert.ok(!/FAKE|ghp_/.test(out.message), `leaked: ${out.message}`);
    assert.ok(out.message.includes('[REDACTED]'), `not redacted: ${out.message}`);
  }
  // Benign prose without labelled values survives untouched.
  assert.equal(redactSecrets('no secrets here, just text'), 'no secrets here, just text');
});
