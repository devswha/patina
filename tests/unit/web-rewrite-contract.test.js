import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SUPPORTED_LANGS,
  WEB_TIERS,
  REWRITE_MODES,
  MPS_FLOOR,
  FIDELITY_FLOOR,
  TIER_LIMITS,
  resolveTierLimits,
  CONTEXT_LIMITS,
  QUOTA_REASONS,
  STREAM_FRAME_TYPES,
  PROVIDER_PRESETS,
  WEB_PERSONAS,
  isWebPersonaAllowed,
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

test('validateRewriteRequest accepts an offered voice persona and rejects unknown/foreign ones', () => {
  // An offered ko voice is normalized onto value.persona.
  const ok = validateRewriteRequest(freeFirst({ persona: 'natural-ko' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.persona, 'natural-ko');

  // Absent or empty -> no persona (server applies its default voice).
  assert.equal(validateRewriteRequest(freeFirst()).value.persona, undefined);
  assert.equal(validateRewriteRequest(freeFirst({ persona: '' })).value.persona, undefined);

  // Unknown id, non-string, and a voice offered only in another language all 400
  // (fail-closed — an arbitrary id must never reach the persona loader).
  assert.equal(validateRewriteRequest(freeFirst({ persona: 'no-such-voice' })).status, 400);
  assert.equal(validateRewriteRequest(freeFirst({ persona: 42 })).status, 400);
  // technical-explainer is offered for ko/en but NOT zh.
  assert.equal(validateRewriteRequest(freeFirst({ lang: 'zh', persona: 'technical-explainer' })).status, 400);
});

test('WEB_PERSONAS covers every supported language with well-formed {id,label} entries', () => {
  for (const lang of SUPPORTED_LANGS) {
    const list = WEB_PERSONAS[lang];
    assert.ok(Array.isArray(list) && list.length > 0, `${lang} must offer at least one voice`);
    for (const p of list) {
      assert.match(p.id, /^[a-z0-9][a-z0-9-]*$/);
      assert.ok(typeof p.label === 'string' && p.label.length > 0);
      assert.equal(isWebPersonaAllowed(lang, p.id), true);
    }
  }
  assert.equal(isWebPersonaAllowed('ko', 'definitely-not-a-voice'), false);
  assert.equal(isWebPersonaAllowed('xx', 'natural-ko'), false);
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
  assert.deepEqual(WEB_TIERS, { FREE: 'free', BYOK: 'byok', PRO: 'pro' });
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

// --- pro tier (licensed hosted tier, LS validate-only gated) -----------------
// The pro tier extends the contract WITHOUT touching free/byok: the license is
// an entitlement (verified out-of-band as Authorization: Bearer), never a
// provider key, and must never surface in the body or the normalized value.
function proFirst(overrides = {}) {
  return { mode: 'first', lang: 'ko', tier: 'pro', text: '안녕하세요 프로 테스트 문장입니다.', ...overrides };
}

test('WEB_TIERS exposes the pro tier value', () => {
  assert.equal(WEB_TIERS.PRO, 'pro');
});

test('TIER_LIMITS.pro documents the pro caps without regressing free/byok', () => {
  assert.deepEqual(TIER_LIMITS.pro, { maxChars: 20000, reqPerDay: 200, maxConcurrent: 3 });
  // Free/byok caps are unchanged by the pro extension.
  assert.equal(TIER_LIMITS.free.maxChars, 4000);
  assert.equal(TIER_LIMITS.byok.maxChars, 20000);
});

test('resolveTierLimits returns the defaults when no env overrides are present', () => {
  const limits = resolveTierLimits();
  assert.deepEqual(limits.pro, { maxChars: 20000, reqPerDay: 200, maxConcurrent: 3 });
  assert.equal(limits.free.maxChars, 4000);
  assert.equal(limits.byok.maxChars, 20000);
  // An empty env behaves identically to the no-arg call.
  assert.deepEqual(resolveTierLimits({}).pro, limits.pro);
});

test('resolveTierLimits applies positive-integer pro env overrides', () => {
  const limits = resolveTierLimits({
    PATINA_PRO_MAX_CHARS: '50000',
    PATINA_PRO_REQ_PER_DAY: '1000',
    PATINA_PRO_MAX_CONCURRENT: '8',
  });
  assert.deepEqual(limits.pro, { maxChars: 50000, reqPerDay: 1000, maxConcurrent: 8 });
  // Free/byok stay pinned to the defaults regardless of pro env.
  assert.equal(limits.free.maxChars, 4000);
  assert.equal(limits.byok.maxChars, 20000);
});

test('resolveTierLimits falls back to defaults for invalid pro overrides', () => {
  for (const bad of ['0', '-5', 'abc', '3.5', '', ' ', undefined]) {
    const limits = resolveTierLimits({
      PATINA_PRO_MAX_CHARS: bad,
      PATINA_PRO_REQ_PER_DAY: bad,
      PATINA_PRO_MAX_CONCURRENT: bad,
    });
    assert.deepEqual(
      limits.pro,
      { maxChars: 20000, reqPerDay: 200, maxConcurrent: 3 },
      `invalid override ${JSON.stringify(bad)} must fall back to the default`,
    );
  }
});

test('resolveTierLimits returns a frozen object shaped like TIER_LIMITS', () => {
  const limits = resolveTierLimits({ PATINA_PRO_MAX_CHARS: '9999' });
  assert.ok(Object.isFrozen(limits));
  assert.ok(Object.isFrozen(limits.pro));
  assert.deepEqual(Object.keys(limits).sort(), ['byok', 'free', 'pro']);
});

test('resolveProviderModel resolves the pro tier from PATINA_PRO_* env', () => {
  const r = resolveProviderModel(
    { tier: WEB_TIERS.PRO, provider: 'evil', model: 'evil-model' },
    { PATINA_PRO_PROVIDER: 'claude', PATINA_PRO_MODEL: 'claude-opus-4-1' },
  );
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'pro');
  assert.equal(r.provider, 'claude');
  assert.equal(r.model, 'claude-opus-4-1');
  assert.equal(r.baseURL, PROVIDER_PRESETS.claude.baseURL);
  // Body-provided provider/model are ignored for pro (server-pinned like free).
  assert.notEqual(r.model, 'evil-model');
});

test('resolveProviderModel falls back to PATINA_FREE_* then defaults for pro', () => {
  // PRO env absent -> FREE env is the fallback source.
  const viaFree = resolveProviderModel(
    { tier: WEB_TIERS.PRO },
    { PATINA_FREE_PROVIDER: 'deepseek', PATINA_FREE_MODEL: 'deepseek-chat' },
  );
  assert.equal(viaFree.ok, true);
  assert.equal(viaFree.provider, 'deepseek');
  assert.equal(viaFree.model, 'deepseek-chat');

  // Nothing configured -> default openai + first allowlisted model.
  const viaDefault = resolveProviderModel({ tier: WEB_TIERS.PRO }, {});
  assert.equal(viaDefault.ok, true);
  assert.equal(viaDefault.provider, 'openai');
  assert.equal(viaDefault.model, PROVIDER_PRESETS.openai.models[0]);
  assert.equal(viaDefault.baseURL, PROVIDER_PRESETS.openai.baseURL);
});

test('resolveProviderModel rejects unlisted pro provider/model cleanly', () => {
  const badProvider = resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_PROVIDER: 'nope' });
  assert.equal(badProvider.ok, false);
  assert.match(badProvider.error, /pro provider not configured/);

  const badModel = resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_MODEL: 'ghost-model' });
  assert.equal(badModel.ok, false);
  assert.match(badModel.error, /pro model not allowlisted/);

  // A poisoned prototype name resolves to a clean rejection, never throws.
  assert.doesNotThrow(() => resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_PROVIDER: '__proto__' }));
  assert.equal(resolveProviderModel({ tier: WEB_TIERS.PRO }, { PATINA_PRO_PROVIDER: '__proto__' }).ok, false);
});

test('validateRewriteRequest accepts a pro request whose license arrived as Authorization: Bearer', () => {
  const r = validateRewriteRequest(proFirst(), {}, { proLicenseSource: 'authorization-bearer' });
  assert.equal(r.ok, true);
  assert.equal(r.value.tier, 'pro');
  // The server key is resolved later by the handler; the contract returns no key.
  assert.equal(r.value.apiKey, undefined);
  // A raw license must NEVER surface in the normalized value.
  assert.equal('licenseKey' in r.value, false);
  assert.equal('license_key' in r.value, false);
  assert.equal('license' in r.value, false);
  // Provider/model are pinned like the free path.
  assert.equal(r.value.provider, 'openai');
  assert.equal(r.value.baseURL, PROVIDER_PRESETS.openai.baseURL);
});

test('validateRewriteRequest allows pro text up to the 20000-char cap', () => {
  const atCap = validateRewriteRequest(
    proFirst({ text: 'a'.repeat(TIER_LIMITS.pro.maxChars) }),
    {},
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(atCap.ok, true);

  const overCap = validateRewriteRequest(
    proFirst({ text: 'a'.repeat(TIER_LIMITS.pro.maxChars + 1) }),
    {},
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(overCap.ok, false);
  assert.equal(overCap.status, 413);
});

test('validateRewriteRequest honors a pro maxChars env override', () => {
  const env = { PATINA_PRO_MAX_CHARS: '30000' };
  // 25000 chars is over the default 20000 but under the overridden 30000.
  const ok = validateRewriteRequest(
    proFirst({ text: 'a'.repeat(25000) }),
    env,
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(ok.ok, true);

  const over = validateRewriteRequest(
    proFirst({ text: 'a'.repeat(30001) }),
    env,
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(over.ok, false);
  assert.equal(over.status, 413);
});

test('validateRewriteRequest fails closed with 401 when the pro license source is missing', () => {
  // No options -> the backward-compatible 2-arg call cannot assert a bearer source.
  const noOpts = validateRewriteRequest(proFirst());
  assert.equal(noOpts.ok, false);
  assert.equal(noOpts.status, 401);
  assert.equal(noOpts.error, QUOTA_REASONS.LICENSE_REQUIRED);

  // A wrong source value is equally rejected.
  const wrong = validateRewriteRequest(proFirst(), {}, { proLicenseSource: 'query-param' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.error, QUOTA_REASONS.LICENSE_REQUIRED);
});

test('validateRewriteRequest rejects a pro request carrying an apiKey', () => {
  const r = validateRewriteRequest(
    proFirst({ apiKey: 'sk-should-not-be-here' }),
    {},
    { proLicenseSource: 'authorization-bearer' },
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('validateRewriteRequest rejects a pro license smuggled in the body (400, not the header)', () => {
  for (const field of ['licenseKey', 'license_key']) {
    const r = validateRewriteRequest(
      proFirst({ [field]: 'lic-abcdef123456' }),
      {},
      { proLicenseSource: 'authorization-bearer' },
    );
    assert.equal(r.ok, false, `${field} in body must be rejected`);
    assert.equal(r.status, 400);
    assert.match(r.error, /Authorization: Bearer/);
  }
});

test('QUOTA_REASONS exposes stable license denial strings without changing existing ones', () => {
  assert.equal(QUOTA_REASONS.LICENSE_REQUIRED, 'license required');
  assert.equal(QUOTA_REASONS.LICENSE_INVALID, 'license not entitled');
  assert.equal(QUOTA_REASONS.LICENSE_UNAVAILABLE, 'license validation unavailable');
  // Pre-existing reason strings are untouched.
  assert.equal(QUOTA_REASONS.DAILY, 'daily quota exceeded');
  assert.equal(QUOTA_REASONS.SERVICE_UNAVAILABLE, 'rewrite service unavailable');
});

test('redactSecrets masks license keys and inline license_key labels', () => {
  const out = /** @type {any} */ (redactSecrets({
    licenseKey: 'lic-cafebabe12345678',
    license_key: 'lic-deadbeef99999999',
    nested: { message: 'activation failed: license_key=abcdef123 rejected' },
    safe: 'keep-me',
  }));
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /lic-cafebabe12345678/);
  assert.doesNotMatch(json, /lic-deadbeef99999999/);
  assert.doesNotMatch(json, /abcdef123/);
  assert.equal(out.licenseKey, '[REDACTED]');
  assert.equal(out.license_key, '[REDACTED]');
  assert.ok(out.nested.message.includes('[REDACTED]'));
  assert.equal(out.safe, 'keep-me');

  // The bare labelled string form is masked too.
  assert.equal(redactSecrets('license_key=abcdef123'), '[REDACTED]');
});

test('redactSecrets keeps masking bearer/sk- shapes after the license extension', () => {
  const out = /** @type {any} */ (redactSecrets({
    Authorization: 'Bearer sk-live-abcdefghij',
    stray: 'inline sk-deadbeefcafef00d here',
    note: 'no secret',
  }));
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /sk-live-abcdefghij/);
  assert.doesNotMatch(json, /sk-deadbeefcafef00d/);
  assert.equal(out.note, 'no secret');
});

test('validateRewriteRequest: unauthenticated pro fails closed with 401 BEFORE char-cap/provider errors (auth gate dominant)', () => {
  const env = { PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5' };
  const base = { mode: 'first', lang: 'en', tier: 'pro' };

  // over-cap text + no bearer source -> 401 LICENSE_REQUIRED, not 413
  const overCap = validateRewriteRequest({ ...base, text: 'x'.repeat(20001) }, env, {});
  assert.equal(overCap.ok, false);
  assert.equal(overCap.status, 401);
  assert.equal(overCap.error, QUOTA_REASONS.LICENSE_REQUIRED);

  // misconfigured pro provider env + no bearer source -> 401, not a 400 provider error
  const badEnv = validateRewriteRequest({ ...base, text: 'hi' }, { PATINA_PRO_PROVIDER: 'not-a-provider' }, {});
  assert.equal(badEnv.ok, false);
  assert.equal(badEnv.status, 401);
  assert.equal(badEnv.error, QUOTA_REASONS.LICENSE_REQUIRED);

  // pro apiKey rejected with a pro-specific 400 message (never the free-tier wording)
  const withKey = validateRewriteRequest({ ...base, text: 'hi', apiKey: 'sk-x' }, env, { proLicenseSource: 'authorization-bearer' });
  assert.equal(withKey.ok, false);
  assert.equal(withKey.status, 400);
  assert.match(withKey.error, /pro tier must not include an apiKey/);
  assert.doesNotMatch(withKey.error, /free tier/);

  // authenticated pro over-cap still 413 (the cap applies only AFTER auth passes)
  const authOverCap = validateRewriteRequest({ ...base, text: 'x'.repeat(20001) }, env, { proLicenseSource: 'authorization-bearer' });
  assert.equal(authOverCap.ok, false);
  assert.equal(authOverCap.status, 413);
});
