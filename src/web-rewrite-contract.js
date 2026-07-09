// @ts-check
// Shared, dependency-free contract for the patina web rewrite surface.
//
// Imported by the serverless handler (api/rewrite.js), the web runner
// (src/web-rewrite.js), the browser client (playground/rewrite-client.js), and
// the test suite. This module MUST stay isomorphic: no `node:` imports, no fs,
// no network, no LLM. The same request validation, provider allowlist,
// redaction, stream-frame, and floor logic then runs identically on the server,
// in the browser, and under `node --test`, so there is one source of truth for
// the contract rather than parallel conventions.
//
// It is deliberately separate from src/features/* (which stays the deterministic
// detector layer): this file carries no detector logic and never scores text.

/** Languages the rewrite pipeline supports. */
export const SUPPORTED_LANGS = Object.freeze(['ko', 'en', 'zh', 'ja']);

/**
 * Whether the env describes a production deployment. Shared by the rate
 * limiter, the entitlement layer (both via rate-limit.js's re-export), and the
 * pro provider resolution below, so "production" means one thing everywhere.
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function isProductionPosture(env = {}) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.VERCEL === '1';
}

/** Service tiers. `free` is the abuse-bounded shared proxy; `byok` uses the user's own key; `pro` is the licensed hosted tier (server key, LS validate-only gated). */
export const WEB_TIERS = Object.freeze({ FREE: 'free', BYOK: 'byok', PRO: 'pro' });

/** Turn kinds. `first` is the one-shot rewrite; `refine` is a conversational follow-up. */
export const REWRITE_MODES = Object.freeze({ FIRST: 'first', REFINE: 'refine' });

/**
 * Meaning-preservation and fidelity floors. Mirrors the ouroboros floors in
 * `.patina.default.yaml` (mps-floor / fidelity-floor). A rewrite that scores
 * below either floor — or whose score is missing/unparseable — is rejected
 * fail-closed (see evaluateFloors).
 */
export const MPS_FLOOR = 70;
export const FIDELITY_FLOOR = 70;

/**
 * Per-tier request caps. `free` is abuse-bounded; `byok` reflects the user's own
 * provider quota. These are recommended defaults; the server is the enforcer.
 */
export const TIER_LIMITS = Object.freeze({
  free: Object.freeze({ maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 }),
  byok: Object.freeze({ maxChars: 20000, maxConcurrent: 2 }),
  pro: Object.freeze({ maxChars: 20000, reqPerDay: 200, maxConcurrent: 3, charsPerMonth: 1_000_000 }),
});

/**
 * Resolve the effective per-tier caps, applying optional env overrides to the
 * `pro` tier only; `free`/`byok` are always the frozen defaults. Isomorphic and
 * import-free — the server passes its process env, the browser/tests pass `{}`
 * (or an explicit override map). Returns a fresh frozen object shaped exactly
 * like TIER_LIMITS (free/byok/pro keys). Invalid overrides (non-integer, zero,
 * or negative) fall back to the default so a malformed env can never widen a cap.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {typeof TIER_LIMITS}
 */
export function resolveTierLimits(env = {}) {
  const readPositiveInt = (env, name, fallback) => {
    const n = Number(env[name]);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const { pro } = TIER_LIMITS;
  return Object.freeze({
    free: TIER_LIMITS.free,
    byok: TIER_LIMITS.byok,
    pro: Object.freeze({
      maxChars: readPositiveInt(env, 'PATINA_PRO_MAX_CHARS', pro.maxChars),
      reqPerDay: readPositiveInt(env, 'PATINA_PRO_REQ_PER_DAY', pro.reqPerDay),
      maxConcurrent: readPositiveInt(env, 'PATINA_PRO_MAX_CONCURRENT', pro.maxConcurrent),
      charsPerMonth: readPositiveInt(env, 'PATINA_PRO_CHARS_PER_MONTH', pro.charsPerMonth),
    }),
  });
}

/**
 * Conversation context caps. The client holds the thread (no-store server); the
 * server re-caps every request to `maxTurns` recent turns and `maxBytes` total.
 */
export const CONTEXT_LIMITS = Object.freeze({ maxTurns: 6, maxBytes: 12 * 1024 });

/**
 * Stable quota/service denial reason strings, emitted by the rate limiter
 * (src/rate-limit.js) and the API entry (api/rewrite.js) and recognized by the
 * browser error classifier (playground/rewrite-client.js). These exact strings
 * are part of the public error contract: keep values backward-compatible and
 * change them only with a coordinated classifier/UI migration.
 */
export const QUOTA_REASONS = Object.freeze({
  DAILY: 'daily quota exceeded',
  HOURLY: 'hourly burst exceeded',
  CONCURRENT: 'concurrent limit exceeded',
  IP_UNAVAILABLE: 'client ip unavailable',
  STORAGE_UNAVAILABLE: 'quota storage unavailable',
  SECRET_UNAVAILABLE: 'quota secret unavailable',
  SERVICE_UNAVAILABLE: 'rewrite service unavailable',
  LICENSE_REQUIRED: 'license required',
  LICENSE_INVALID: 'license not entitled',
  LICENSE_UNAVAILABLE: 'license validation unavailable',
  MONTHLY_CHARS: 'monthly character limit reached',
});

/**
 * Stream frame protocol. The handler streams newline-delimited JSON ("NDJSON")
 * frames over a POST fetch ReadableStream. Every line is exactly one JSON frame
 * with a `type` field. A successful stream is `start` → `delta`* → `done`; any
 * failure (including a corrupted/truncated stream) is a terminal `error` frame.
 * `done` is never emitted on failure, so a consumer can treat "no done" as error.
 */
export const STREAM_FRAME_TYPES = Object.freeze({
  START: 'start',
  DELTA: 'delta',
  DONE: 'done',
  ERROR: 'error',
});

/** The closed set of valid stream frame type values (for fail-closed parsing). */
export const STREAM_FRAME_VALUES = new Set(Object.values(STREAM_FRAME_TYPES));

/**
 * OpenAI-compatible provider presets. The base URL is fixed per provider here so
 * the UI can never inject an arbitrary base URL (which would let a Bearer token
 * be exfiltrated to an attacker-chosen host). BYOK requests may only select a
 * provider+model from this allowlist; free requests are pinned by env.
 */
export const PROVIDER_PRESETS = Object.freeze({
  openai: Object.freeze({
    baseURL: 'https://api.openai.com/v1',
    models: Object.freeze(['gpt-5.5', 'gpt-5.1', 'gpt-4.1', 'gpt-4.1-mini']),
  }),
  claude: Object.freeze({
    baseURL: 'https://api.anthropic.com/v1',
    models: Object.freeze(['claude-sonnet-5', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5']),
  }),
  deepseek: Object.freeze({
    baseURL: 'https://api.deepseek.com/v1',
    models: Object.freeze(['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']),
  }),
  kimi: Object.freeze({
    baseURL: 'https://api.moonshot.ai/v1',
    models: Object.freeze(['kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k']),
  }),
  glm: Object.freeze({
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: Object.freeze(['glm-4.6', 'glm-4.5', 'glm-4.5-air']),
  }),
});

/**
 * Voice personas offered by the hosted playground, per language. Curated genre
 * voices only: when no persona is chosen the server applies its default (ko ->
 * preserve; en/zh/ja stay voice-free), so this list is the OPT-IN set. It is the
 * isomorphic single source of truth — the browser builds the Voice selector from
 * it, and the server validates a requested id against it before ever touching the
 * persona loader. Every id MUST ship as personas/<lang>/<id>.md (pinned by a
 * bundled-assets test in tests/unit/web-rewrite.test.js).
 */
export const WEB_PERSONAS = Object.freeze({
  ko: Object.freeze([
    Object.freeze({ id: 'natural-ko', label: 'Natural' }),
    Object.freeze({ id: 'blog-essay', label: 'Blog / essay' }),
    Object.freeze({ id: 'technical-explainer', label: 'Technical' }),
    Object.freeze({ id: 'soft-professional', label: 'Soft professional' }),
    Object.freeze({ id: 'pragmatic-founder', label: 'Pragmatic founder' }),
  ]),
  en: Object.freeze([
    Object.freeze({ id: 'natural-en', label: 'Natural' }),
    Object.freeze({ id: 'blog-essay', label: 'Blog / essay' }),
    Object.freeze({ id: 'technical-explainer', label: 'Technical' }),
  ]),
  zh: Object.freeze([
    Object.freeze({ id: 'natural-zh', label: 'Natural' }),
    Object.freeze({ id: 'blog-essay', label: 'Blog / essay' }),
  ]),
  ja: Object.freeze([
    Object.freeze({ id: 'natural-ja', label: 'Natural' }),
    Object.freeze({ id: 'blog-essay', label: 'Blog / essay' }),
  ]),
});

/**
 * Whether `id` is a voice persona the hosted surface offers for `lang`.
 * @param {string} lang
 * @param {string} id
 * @returns {boolean}
 */
export function isWebPersonaAllowed(lang, id) {
  const list = WEB_PERSONAS[/** @type {keyof typeof WEB_PERSONAS} */ (lang)];
  return Array.isArray(list) && list.some((p) => p.id === id);
}

/**
 * Keys whose values are secrets and must be redacted before logging. Matched by
 * normalized substring (lowercased, separators stripped) so families like
 * apiKey/openaiApiKey/x-api-key, access_token/refreshToken, client_secret, and
 * password/credential/authorization/bearer/license are all caught — over-redacting is
 * the safe failure for a key-handling boundary.
 */
const SECRET_KEY_MARKERS = Object.freeze([
  'apikey', 'token', 'secret', 'password', 'passwd', 'credential', 'authorization', 'bearer', 'license',
]);
function isSecretKey(key) {
  const norm = String(key).toLowerCase().replace(/[_-]/g, '');
  return SECRET_KEY_MARKERS.some((marker) => norm.includes(marker));
}
/**
 * Inline secret shapes inside free-form strings (Bearer tokens, OpenAI keys),
 * plus labelled secrets (`apiKey=...`, `x-api-key: ...`, `token=...`, `license_key=...`) that
 * upstream provider error messages embed regardless of key format (#565).
 * The value part is bounded (no nested quantifiers) so a hostile error string
 * cannot trigger catastrophic backtracking; over-redacting is the safe
 * failure for a log boundary.
 */
const SECRET_VALUE_RES = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /\bsk-[A-Za-z0-9._-]{8,}/g,
  /\b(?:x-)?api[-_]?key\s*[:=]\s*[^\s"'`&,;]{6,}/gi,
  /\b(?:access|refresh)[-_]?token\s*[:=]\s*[^\s"'`&,;]{6,}/gi,
  /\bclient[-_]?secret\s*[:=]\s*[^\s"'`&,;]{6,}/gi,
  /\b(?:token|secret|password|passwd|credential|authorization)\s*[:=]\s*[^\s"'`&,;]{6,}/gi,
  /\blicense[-_]?key\s*[:=]\s*[^\s"'`&,;]{6,}/gi,
];
const REDACTED = '[REDACTED]';

/** Count UTF-8 bytes isomorphically (TextEncoder exists in Node >=18 and browsers). */
export function byteLength(str) {
  return new globalThis.TextEncoder().encode(String(str ?? '')).length;
}

/**
 * Redact secrets from a value before it reaches a log line or an error body.
 * Recurses objects/arrays (cloning, never mutating the input), drops values of
 * secret-named keys, and masks inline Bearer/sk- token shapes inside strings.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactSecrets(value) {
  if (typeof value === 'string') {
    let out = value;
    for (const re of SECRET_VALUE_RES) out = out.replace(re, REDACTED);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) out[k] = REDACTED;
      else out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * Resolve and allowlist the provider/model/baseURL for a request.
 * - free: provider/model come from env (PATINA_FREE_PROVIDER/PATINA_FREE_MODEL),
 *   defaulting to the first preset; the request body cannot choose them.
 * - byok: provider+model must both be on the PROVIDER_PRESETS allowlist.
 * - pro: pinned by env (PATINA_PRO_*); in production both must be set explicitly
 *   (no free fallback — see the tier branch), outside production PATINA_FREE_*
 *   then the preset default fill in. The request body cannot choose provider/model.
 * The base URL is ALWAYS taken from the preset, never from the request body.
 *
 * @param {{tier?:string, provider?:string, model?:string}} req
 * @param {Record<string,string|undefined>} [env]
 * @returns {{ok:true, tier:string, provider:string, model:string, baseURL:string}|{ok:false, error:string}}
 */
export function resolveProviderModel({ tier, provider, model } = {}, env = {}) {
  // Look up presets by own-property only, so request- or env-controlled provider
  // names like "__proto__", "constructor", or "toString" resolve to undefined
  // (a clean allowlist rejection) instead of reaching Object.prototype and
  // throwing on the subsequent `.models.includes(...)`.
  const presetFor = (name) =>
    (typeof name === 'string' && Object.hasOwn(PROVIDER_PRESETS, name)) ? PROVIDER_PRESETS[name] : undefined;

  if (tier === WEB_TIERS.FREE) {
    const p = env.PATINA_FREE_PROVIDER || 'openai';
    const preset = presetFor(p);
    if (!preset) return { ok: false, error: 'free provider not configured' };
    const m = env.PATINA_FREE_MODEL || preset.models[0];
    if (!preset.models.includes(m)) return { ok: false, error: 'free model not allowlisted' };
    return { ok: true, tier, provider: p, model: m, baseURL: preset.baseURL };
  }
  if (tier === WEB_TIERS.PRO) {
    // Pro is server-pinned like free, but in production it NEVER falls back to
    // the free provider/model: paying traffic silently running on the free
    // model would break the advertised contract, so a missing PATINA_PRO_PROVIDER
    // or PATINA_PRO_MODEL fails closed instead. Outside production the free-env
    // fallback stays for local playground/test convenience.
    const production = isProductionPosture(env);
    const p = env.PATINA_PRO_PROVIDER || (production ? undefined : (env.PATINA_FREE_PROVIDER || 'openai'));
    if (!p) return { ok: false, error: 'pro provider not configured' };
    const preset = presetFor(p);
    if (!preset) return { ok: false, error: 'pro provider not configured' };
    const m = env.PATINA_PRO_MODEL || (production ? undefined : (env.PATINA_FREE_MODEL || preset.models[0]));
    if (!m) return { ok: false, error: 'pro model not configured' };
    if (!preset.models.includes(m)) return { ok: false, error: 'pro model not allowlisted' };
    return { ok: true, tier, provider: p, model: m, baseURL: preset.baseURL };
  }
  if (tier === WEB_TIERS.BYOK) {
    const preset = presetFor(provider);
    if (!preset) return { ok: false, error: 'provider not allowlisted' };
    if (!preset.models.includes(model)) return { ok: false, error: 'model not allowlisted' };
    return { ok: true, tier, provider, model, baseURL: preset.baseURL };
  }
  return { ok: false, error: 'unknown tier' };
}

/**
 * Normalize and validate one conversation history array, capped to the most
 * recent CONTEXT_LIMITS.maxTurns turns and CONTEXT_LIMITS.maxBytes total bytes.
 * Returns a trimmed copy; invalid shapes are rejected.
 *
 * @param {unknown} history
 * @returns {{ok:true, value:Array<{role:string,content:string}>}|{ok:false, error:string}}
 */
export function normalizeHistory(history) {
  if (history == null) return { ok: true, value: [] };
  if (!Array.isArray(history)) return { ok: false, error: 'history must be an array' };
  /** @type {Array<{role:string,content:string}>} */
  const turns = [];
  for (const turn of history) {
    if (!turn || typeof turn !== 'object') return { ok: false, error: 'history turn must be an object' };
    const role = turn.role;
    const content = turn.content;
    if (role !== 'user' && role !== 'assistant') return { ok: false, error: 'history role must be user or assistant' };
    if (typeof content !== 'string') return { ok: false, error: 'history content must be a string' };
    turns.push({ role, content });
  }
  // Keep the most recent maxTurns, then trim oldest until under the byte cap.
  let capped = turns.slice(-CONTEXT_LIMITS.maxTurns);
  while (capped.length > 0 && capped.reduce((sum, t) => sum + byteLength(t.content), 0) > CONTEXT_LIMITS.maxBytes) {
    capped = capped.slice(1);
  }
  return { ok: true, value: capped };
}

/**
 * Validate an inbound /api/rewrite request body against the contract.
 * Returns a normalized value on success, or an error plus the HTTP status the
 * handler should reply with (400 bad request, 401 unauthorized, 413 payload too large).
 *
 * @param {unknown} body
 * @param {Record<string,string|undefined>} [env]
 * @param {{proLicenseSource?:string}} [options] Out-of-band request facts the
 *   handler has already established (e.g. that a pro license arrived as an
 *   Authorization: Bearer header). Optional — existing 2-arg callers are
 *   unaffected and behave exactly as before.
 * @returns {{ok:true, value:object}|{ok:false, status:number, error:string}}
 */
export function validateRewriteRequest(body, env = {}, options = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'request body must be a JSON object' };
  }
  const { mode, lang, tier, text, original, history } = /** @type {any} */ (body);

  if (mode !== REWRITE_MODES.FIRST && mode !== REWRITE_MODES.REFINE) {
    return { ok: false, status: 400, error: 'mode must be "first" or "refine"' };
  }
  if (!SUPPORTED_LANGS.includes(lang)) {
    return { ok: false, status: 400, error: `lang must be one of ${SUPPORTED_LANGS.join(', ')}` };
  }
  if (tier !== WEB_TIERS.FREE && tier !== WEB_TIERS.BYOK && tier !== WEB_TIERS.PRO) {
    return { ok: false, status: 400, error: 'tier must be "free", "byok", or "pro"' };
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, status: 400, error: 'text must be a non-empty string' };
  }

  // Pro tier gates on the license credential BEFORE char caps or provider/model
  // resolution, so an unauthenticated pro request always fails closed with 401
  // LICENSE_REQUIRED and never leaks limit/config state ahead of the auth
  // boundary. The license is an entitlement (the handler verifies it via LS
  // validate-only from an Authorization: Bearer header), never a provider key
  // and never a body field.
  if (tier === WEB_TIERS.PRO) {
    if (/** @type {any} */ (body).apiKey != null) {
      return { ok: false, status: 400, error: 'pro tier must not include an apiKey; the license is sent as Authorization: Bearer' };
    }
    if (/** @type {any} */ (body).licenseKey != null || /** @type {any} */ (body).license_key != null) {
      return { ok: false, status: 400, error: 'pro tier license must be sent as Authorization: Bearer, not in the body' };
    }
    if (options.proLicenseSource !== 'authorization-bearer') {
      return { ok: false, status: 401, error: QUOTA_REASONS.LICENSE_REQUIRED };
    }
  }

  const limits = resolveTierLimits(env)[tier];
  if (text.length > limits.maxChars) {
    return { ok: false, status: 413, error: `text exceeds ${limits.maxChars} characters for tier ${tier}` };
  }

  // refine turns must carry the original anchor so meaning preservation is
  // measured against the source, not the latest draft.
  if (mode === REWRITE_MODES.REFINE) {
    if (typeof original !== 'string' || original.trim().length === 0) {
      return { ok: false, status: 400, error: 'refine mode requires the original text' };
    }
    if (original.length > limits.maxChars) {
      return { ok: false, status: 413, error: `original exceeds ${limits.maxChars} characters for tier ${tier}` };
    }
  }

  const provider = /** @type {any} */ (body).provider;
  const model = /** @type {any} */ (body).model;
  const resolved = resolveProviderModel({ tier, provider, model }, env);
  if (!resolved.ok) {
    const error = 'error' in resolved ? resolved.error : 'provider not allowed';
    // A pro-tier "not configured" failure is a server-side misconfiguration
    // (production requires explicit PATINA_PRO_PROVIDER/MODEL), never something
    // the client sent wrong: surface it as 503 so operators see an availability
    // signal, not a client-error blip. All other resolution failures stay 400.
    const status = tier === WEB_TIERS.PRO && /not configured/.test(error) ? 503 : 400;
    return { ok: false, status, error };
  }

  const apiKey = /** @type {any} */ (body).apiKey;
  if (tier === WEB_TIERS.BYOK) {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return { ok: false, status: 400, error: 'byok tier requires an apiKey' };
    }
  } else if (apiKey != null) {
    // Free tier must never carry a caller key; reject rather than silently drop.
    return { ok: false, status: 400, error: 'free tier must not include an apiKey' };
  }

  const normHistory = normalizeHistory(history);
  if (!normHistory.ok) return { ok: false, status: 400, error: 'error' in normHistory ? normHistory.error : 'invalid history' };

  // Optional voice persona. Absent -> the server default (ko preserve; en/zh/ja
  // voice-free). When present it MUST be one of the offered voices for this
  // language, so an arbitrary/adversarial id can never reach the persona loader.
  const personaRaw = /** @type {any} */ (body).persona;
  let persona;
  if (personaRaw != null && personaRaw !== '') {
    if (typeof personaRaw !== 'string' || !isWebPersonaAllowed(lang, personaRaw)) {
      return { ok: false, status: 400, error: `persona must be one of the offered voices for ${lang}` };
    }
    persona = personaRaw;
  }

  return {
    ok: true,
    value: {
      mode,
      lang,
      tier,
      text,
      original: mode === REWRITE_MODES.REFINE ? original : text,
      history: normHistory.value,
      provider: resolved.provider,
      model: resolved.model,
      baseURL: resolved.baseURL,
      apiKey: tier === WEB_TIERS.BYOK ? apiKey : undefined,
      persona,
    },
  };
}

/** Serialize one stream frame as an NDJSON line (object + trailing newline). */
export function encodeStreamFrame(frame) {
  return JSON.stringify(frame) + '\n';
}

/**
 * Parse one NDJSON stream line into a frame. Blank lines return null (skip).
 * A non-JSON, non-object, or type-less line is reported as a terminal error
 * frame so a corrupted/truncated stream can never be mistaken for success.
 *
 * @param {string} line
 * @returns {null|{type:string,[k:string]:unknown}}
 */
export function parseStreamFrame(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: STREAM_FRAME_TYPES.ERROR, error: 'malformed stream frame' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.type !== 'string') {
    return { type: STREAM_FRAME_TYPES.ERROR, error: 'malformed stream frame' };
  }
  // The frame type set is closed: an unrecognized type (e.g. {"type":"bogus"})
  // is treated as a corrupt stream, never silently accepted as a valid frame.
  if (!STREAM_FRAME_VALUES.has(parsed.type)) {
    return { type: STREAM_FRAME_TYPES.ERROR, error: 'unknown stream frame type' };
  }
  return parsed;
}

/**
 * Fail-closed floor check for a completed rewrite. A score that is missing,
 * non-finite, or below its floor fails — there is no "assume pass on missing".
 *
 * @param {{mps?:unknown, fidelity?:unknown}} scores
 * @returns {{ok:boolean, failed:string[]}}
 */
export function evaluateFloors({ mps, fidelity } = {}) {
  const failed = [];
  if (!Number.isFinite(mps) || /** @type {number} */ (mps) < MPS_FLOOR) failed.push('mps');
  if (!Number.isFinite(fidelity) || /** @type {number} */ (fidelity) < FIDELITY_FLOOR) failed.push('fidelity');
  return { ok: failed.length === 0, failed };
}
