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
import { normalizeProtectedSpans, isWellFormedText } from './edit-controls.js';

/** Languages the rewrite pipeline supports. */
export const SUPPORTED_LANGS = Object.freeze(['ko', 'en', 'zh', 'ja']);

/** Public document-policy names shared by the CLI and hosted API. */
export const WEB_DOCUMENT_TYPES = Object.freeze([
  'default', 'blog', 'academic', 'technical', 'formal', 'resume',
  'personal-statement', 'project-writeup', 'social', 'email',
  'legal', 'medical', 'marketing', 'narrative', 'instructional',
  'casual-conversation', 'code-comment', 'commit-message', 'release-notes',
  'namuwiki',
]);

/** Explicit register overrides. Omission preserves the source register. */
export const WEB_REGISTERS = Object.freeze(['casual', 'professional']);

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
export const REWRITE_MODES = Object.freeze({ FIRST: 'first', REFINE: 'refine', VERIFY: 'verify' });

/**
 * Meaning-verification floors, hard-coded at 70/70 to mirror
 * `.patina.default.yaml` (`verification.mps-floor` / `verification.fidelity-floor`). A rewrite that scores
 * below either floor — or whose score is missing/unparseable — is rejected
 * fail-closed (see evaluateFloors).
 */
export const MPS_FLOOR = 70;
export const FIDELITY_FLOOR = 70;

/**
 * Per-tier request caps. These are recommended defaults; the server is the
 * enforcer.
 */
export const TIER_LIMITS = Object.freeze({
  // Launch-window free caps (2026-07-23): 5/day + 2/hour choked a first visit
  // (sample + own text + one refine already hit the burst). 20/day at ~$0.01
  // per free rewrite bounds worst-case spend at ~$0.20/IP/day while a session
  // can actually explore. Still abuse-bounded — never unlimited: the free tier
  // spends the server key.
  free: Object.freeze({ maxChars: 4000, maxConcurrent: 1, reqPerDay: 20, burstPerHour: 10 }),
  // BYOK spends the caller's own key, so caps only bound patina's
  // function/connection/egress usage, not user cost.
  byok: Object.freeze({ maxChars: 20000, maxConcurrent: 2, burstPerHour: 120, reqPerDay: 480 }),
  // Pro caps rest on a measured fact: pipeline cost is driven by REQUEST COUNT,
  // not text length. Every paid rewrite spends three LLM calls (rewrite + MPS +
  // fidelity) behind a ~20k-token prompt, so a 100-char request costs nearly as
  // much as a 1,000-char one. Measured 2026-07-29 on the shipped gemini-3.6-flash
  // serving pin: $0.035-0.075 per request (81% prompt-cache hit included).
  //
  // reqPerMonth 100 (owner-approved 2026-07-29) is the PRIMARY cost bound, set
  // against net revenue of $8.49/mo ($9.99 less fee and refund reserve): ~$4.5
  // COGS, ~47% margin at the measured blended cost. That is below the 60% floor
  // the PAY-B-COST spec pins, which is a deliberate pricing choice — BYOK lets
  // heavy users spend their own provider quota behind modest Patina admission
  // caps, so Pro sells key management and needs a credible allowance more than
  // a maximal margin.
  //
  // charsPerMonth 50,000 is retained as a SECONDARY bound only: on its own it is
  // not a cost control (500 x 100-char requests satisfy it while costing ~$17.5).
  // reqPerDay 200 likewise bounds burst, not spend.
  // See docs/operations/pro-margin-decision-20260729.md.
  pro: Object.freeze({ maxChars: 20000, reqPerDay: 200, reqPerMonth: 100, maxConcurrent: 3, charsPerMonth: 50_000 }),
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
      reqPerMonth: readPositiveInt(env, 'PATINA_PRO_REQ_PER_MONTH', pro.reqPerMonth),
    }),
  });
}

/**
 * Conversation context caps. The client holds the thread (no-store server); the
 * server re-caps every request to `maxTurns` recent turns and `maxBytes` total.
 *
 * `maxInstructionChars` bounds the optional refine `instruction` (see
 * validateRewriteRequest). An instruction is one composer line ("make it
 * shorter"), never a document: the document travels as `text`. 2,000 characters
 * is half the smallest tier text cap (free `maxChars`) and far above any real
 * follow-up, so it bounds prompt growth without truncating genuine use.
 */
export const CONTEXT_LIMITS = Object.freeze({ maxTurns: 6, maxBytes: 12 * 1024, maxInstructionChars: 2000 });

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
  // 429: this caller asked to validate more uncached licenses in one minute
  // than its own admission slice allows (src/entitlement.js). It is a
  // rate-limit verdict about the caller, never a verdict about the key, so it
  // is never cached and the browser classifier reads it through its generic
  // 429 branch.
  LICENSE_VALIDATION_BURST: 'license validation burst exceeded',
  MONTHLY_CHARS: 'monthly character limit reached',
  MONTHLY_REQUESTS: 'monthly rewrite limit reached',
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
// Model refresh policy (2026-07-23): additions are opt-in choices appended
// after the pinned default at index 0. Defaults stay exactly at the Gate-C
// held values (openai gpt-5.5; gemini gemini-2.5-pro with the 3.1 preview
// offered strictly under its opt_in_only ceiling). New entries mirror the CLI
// provider presets (src/providers.js / src/model-defaults.js) so the web BYOK
// surface never lags the models the CLI already documents.
//
// 2026-07-26: gemini-3.6-flash added as an opt-in entry. Measured on 22
// live-quality fixtures with a fixed judge (docs/operations/
// serving-engine-cost-20260725.md): AI-score improvement 13.0 vs 11.8 for the
// current Pro pin claude-sonnet-5, 7 meaning-loss fixtures vs 10, at $0.030
// per rewrite vs $0.156 and 8.3s vs 27.7s. Allowlisting only makes it
// selectable for BYOK and available to PATINA_PRO_MODEL / PATINA_FREE_MODEL;
// every held default, including the Pro pin, is untouched here.
//
// 2026-08-13: gemini-3.7-flash added as an opt-in entry. Same 22 fixtures,
// fixed judge deepseek-chat (thinking off), against gemini-3.6-flash on the
// identical apparatus (docs/operations/
// serving-engine-gemini-3.7-flash-20260813.md): 19 pass / 2 warn / 1 error vs
// 18 pass / 4 warn / 0 error, half the ai_not_improved warns (2 vs 4), ~2x
// faster (4.2s vs 8.9s per rewrite), identical published pricing. Its one
// regression is en-social-01, where 2 of 4 samples scored MPS 50 (3.6 floor
// on the same judge: 75). Opt-in only; the serving pin stays gemini-3.6-flash
// until the en-social meaning loss is understood.
export const PROVIDER_PRESETS = Object.freeze({
  openai: Object.freeze({
    baseURL: 'https://api.openai.com/v1',
    models: Object.freeze(['gpt-5.5', 'gpt-5.6', 'gpt-5.1', 'gpt-4.1', 'gpt-4.1-mini']),
  }),
  claude: Object.freeze({
    baseURL: 'https://api.anthropic.com/v1',
    models: Object.freeze(['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5']),
  }),
  gemini: Object.freeze({
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: Object.freeze(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.7-flash']),
  }),
  deepseek: Object.freeze({
    baseURL: 'https://api.deepseek.com/v1',
    models: Object.freeze(['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']),
  }),
  kimi: Object.freeze({
    baseURL: 'https://api.moonshot.ai/v1',
    models: Object.freeze(['kimi-k2.5', 'kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k']),
  }),
  glm: Object.freeze({
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: Object.freeze(['glm-4.6', 'glm-4.5', 'glm-4.5-air']),
  }),
});

/**
 * Voice personas offered by the hosted playground, per language. These are
 * opt-in reusable voices: when no persona is chosen, the server preserves the
 * source voice. The browser builds its Voice selector from this list, and the
 * server validates an id before touching the persona loader. Every id MUST ship
 * as personas/<lang>/<id>.md.
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
 * @returns {{ok:true, value:Array<{role:'user'|'assistant',content:string}>}|{ok:false, error:string}}
 */
export function normalizeHistory(history) {
  if (history == null) return { ok: true, value: [] };
  if (!Array.isArray(history)) return { ok: false, error: 'history must be an array' };
  /** @type {Array<{role:'user'|'assistant',content:string}>} */
  const turns = [];
  for (const turn of history) {
    if (!turn || typeof turn !== 'object') return { ok: false, error: 'history turn must be an object' };
    const role = turn.role;
    const content = turn.content;
    if (role !== 'user' && role !== 'assistant') return { ok: false, error: 'history role must be user or assistant' };
    if (typeof content !== 'string' || !isWellFormedText(content)) return { ok: false, error: 'history content must be well-formed Unicode text' };
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
 *
 * The return type is inferred so the normalized value cannot drift from the
 * object this function actually builds; see the `WebRewriteRequest` typedef
 * below for the consumer-facing name.
 */
export function validateRewriteRequest(body, env = {}, options = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'request body must be a JSON object' };
  }
  const { mode, lang, tier, text, original, history } = /** @type {any} */ (body);

  if (mode !== REWRITE_MODES.FIRST && mode !== REWRITE_MODES.REFINE && mode !== REWRITE_MODES.VERIFY) {
    return { ok: false, status: 400, error: 'mode must be "first", "refine", or "verify"' };
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

  if (Object.prototype.hasOwnProperty.call(body, 'profile')) {
    return { ok: false, status: 400, error: 'profile was removed; use documentType' };
  }
  for (const retiredKey of ['tone', 'formality']) {
    if (Object.prototype.hasOwnProperty.call(body, retiredKey)) {
      return { ok: false, status: 400, error: `${retiredKey} was removed; use register` };
    }
  }
  const documentTypeRaw = /** @type {any} */ (body).documentType;
  const documentType = documentTypeRaw == null || documentTypeRaw === '' ? 'default' : documentTypeRaw;
  if (typeof documentType !== 'string' || !WEB_DOCUMENT_TYPES.includes(documentType)) {
    return { ok: false, status: 400, error: `documentType must be one of ${WEB_DOCUMENT_TYPES.join(', ')}` };
  }
  if (documentType === 'namuwiki' && lang !== 'ko') {
    return { ok: false, status: 400, error: 'documentType "namuwiki" is available only for ko' };
  }
  const registerRaw = /** @type {any} */ (body).register;
  const register = registerRaw == null || registerRaw === '' ? undefined : registerRaw;
  if (register !== undefined && (typeof register !== 'string' || !WEB_REGISTERS.includes(register))) {
    return { ok: false, status: 400, error: `register must be one of ${WEB_REGISTERS.join(', ')}` };
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
  if (mode === REWRITE_MODES.REFINE || mode === REWRITE_MODES.VERIFY) {
    if (typeof original !== 'string' || original.trim().length === 0) {
      return { ok: false, status: 400, error: `${mode} mode requires the original text` };
    }
    if (original.length > limits.maxChars) {
      return { ok: false, status: 413, error: `original exceeds ${limits.maxChars} characters for tier ${tier}` };
    }
  }

  // Optional refine instruction: the user's follow-up edit request for this
  // turn ("make it shorter"). `text` is the text to rewrite in EVERY mode — on
  // a refine turn that is the latest draft — so the follow-up needs a field of
  // its own instead of overloading `text`. Absent or blank means exactly the
  // pre-instruction behavior, so deployed clients and API callers that never
  // send it are unaffected. It is meaningless outside refine (`first` has no
  // draft to edit, `verify` generates no text), and is rejected there rather
  // than silently dropped, like verify's rejection of conversation history.
  const instructionRaw = /** @type {any} */ (body).instruction;
  let instruction;
  const instructionBlank = instructionRaw == null
    || (typeof instructionRaw === 'string' && instructionRaw.trim().length === 0);
  if (!instructionBlank) {
    if (mode !== REWRITE_MODES.REFINE) {
      return { ok: false, status: 400, error: `${mode} mode does not accept an instruction` };
    }
    if (typeof instructionRaw !== 'string' || !isWellFormedText(instructionRaw)) {
      return { ok: false, status: 400, error: 'instruction must be well-formed Unicode text' };
    }
    if (instructionRaw.length > CONTEXT_LIMITS.maxInstructionChars) {
      return { ok: false, status: 413, error: `instruction exceeds ${CONTEXT_LIMITS.maxInstructionChars} characters` };
    }
    instruction = instructionRaw;
  }

  const controls = /** @type {any} */ (body);
  if (!isWellFormedText(text) || !isWellFormedText(mode === REWRITE_MODES.FIRST ? text : original)) {
    return { ok: false, status: 400, error: 'text and original must be well-formed Unicode' };
  }
  if (controls.includeEdits !== undefined && typeof controls.includeEdits !== 'boolean') {
    return { ok: false, status: 400, error: 'includeEdits must be a boolean' };
  }
  if ((controls.baseHash !== undefined || mode === REWRITE_MODES.VERIFY)
    && (typeof controls.baseHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(controls.baseHash))) {
    return { ok: false, status: 400, error: 'baseHash must identify the original text with SHA-256' };
  }
  if (mode === REWRITE_MODES.VERIFY && history != null && (!Array.isArray(history) || history.length > 0)) {
    return { ok: false, status: 400, error: 'verify mode does not accept conversation history' };
  }
  let protectedSpans;
  if (controls.protectedSpans !== undefined) {
    try {
      protectedSpans = normalizeProtectedSpans(mode === REWRITE_MODES.FIRST ? text : original, controls.protectedSpans);
    } catch {
      return { ok: false, status: 400, error: 'protectedSpans must contain at most 20 non-overlapping original-text ranges' };
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

  // Optional voice persona. Absent means preserve the source voice. When
  // present it MUST be one of the offered voices for this language.
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
      original: mode === REWRITE_MODES.FIRST ? text : original,
      history: normHistory.value,
      provider: resolved.provider,
      model: resolved.model,
      baseURL: resolved.baseURL,
      apiKey: tier === WEB_TIERS.BYOK ? apiKey : undefined,
      persona,
      documentType,
      register,
      ...(instruction !== undefined ? { instruction } : {}),
      ...(controls.includeEdits !== undefined ? { includeEdits: controls.includeEdits } : {}),
      ...(controls.baseHash !== undefined ? { baseHash: controls.baseHash } : {}),
      ...(protectedSpans !== undefined ? { protectedSpans } : {}),
    },
  };
}

/**
 * The normalized request `validateRewriteRequest` hands to the rewrite paths.
 * Derived from the function's own return type, so it tracks the contract
 * automatically instead of being a second copy that can fall out of date.
 * Discriminated on the presence of `value` rather than on `ok: true`, because
 * an object literal in a JS file widens `true` to `boolean`.
 * @typedef {Extract<ReturnType<typeof validateRewriteRequest>, {value: unknown}>['value']} WebRewriteRequest
 */

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
 * non-finite, outside 0–100, or below its floor fails. This numeric helper does
 * not certify semantic evidence; runtime callers use evaluateVerification.
 *
 * @param {{mps?:unknown, fidelity?:unknown}} scores
 * @returns {{ok:boolean, failed:string[]}}
 */
export function evaluateFloors({ mps, fidelity } = {}) {
  const failed = [];
  if (!Number.isFinite(mps) || /** @type {number} */ (mps) < MPS_FLOOR || /** @type {number} */ (mps) > 100) failed.push('mps');
  if (!Number.isFinite(fidelity) || /** @type {number} */ (fidelity) < FIDELITY_FLOOR || /** @type {number} */ (fidelity) > 100) failed.push('fidelity');
  return { ok: failed.length === 0, failed };
}
