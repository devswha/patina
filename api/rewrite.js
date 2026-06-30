// @ts-check
import { createRateLimiter, createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createRewriteHandler } from '../src/rewrite-handler.js';
import { encodeStreamFrame, WEB_TIERS, STREAM_FRAME_TYPES } from '../src/web-rewrite-contract.js';
import { buildRewriteMetric } from '../src/web-observability.js';
import { runWebRewriteStream } from '../src/web-rewrite-stream.js';
import { createStubEnhancedEngine } from '../src/enhanced-rewrite-engine-contract.js';
import { createProMetering } from '../src/pro-metering.js';
import { hashSessionToken, sessionKey, entitlementKey, verifyProSession } from '../src/pro-session.js';

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parseKvNumber(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (value && typeof value === 'object') {
    const result = /** @type {any} */ (value).result;
    return parseKvNumber(result);
  }
  return null;
}

/**
 * Create a dependency-free Upstash/Vercel KV REST adapter.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {null|{get(key: string): Promise<unknown>, set(key: string, val: string, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>}}
 */
export function createRestKv(env = {}) {
  const base = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!base || !token) return null;
  const root = base.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };

  async function request(path, { method = 'GET', body = undefined } = {}) {
    /** @type {RequestInit} */
    const init = { method, headers };
    if (body != null) init.body = body;
    const response = await globalThis.fetch(`${root}${path}`, init);
    if (!response.ok) throw new Error('kv request failed');
    return response.json();
  }
  const read = (path) => request(path);

  return {
    async get(key) {
      const data = await read(`/get/${encodeURIComponent(key)}`);
      return data?.result;
    },
    async incr(key, { ttlMs } = {}) {
      const encoded = encodeURIComponent(key);
      const data = await read(`/incr/${encoded}`);
      const value = parseKvNumber(data);
      if (value == null) throw new Error('kv incr returned invalid counter');
      if (typeof ttlMs === 'number' && ttlMs > 0) {
        const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
        await read(`/expire/${encoded}/${seconds}`);
      }
      return value;
    },
    async set(key, val, { ttlMs } = {}) {
      // Shared store contract (memory KV + this REST KV):
      //  - VALUES ARE STRINGS. Callers serialize objects themselves; a
      //    non-string is rejected (fail loud) instead of being implicitly
      //    JSON.stringify'd, so memory and REST never diverge on value shape.
      //  - KEYS MUST BE OPAQUE/HMAC ids (no raw license key, email, or token).
      //    The key is URL-encoded into the path while the value travels in the
      //    POST body, so a secret value is never exposed in request URLs/logs.
      //  - TTL granularity: a positive ttlMs is rounded UP to whole seconds
      //    (Redis EX). Contract TTLs are >= 1s, so memory (ms) and REST (s)
      //    agree at second granularity; sub-second TTLs are out of contract.
      if (typeof val !== 'string') throw new TypeError('kv set value must be a string');
      const encoded = encodeURIComponent(key);
      const seconds = (typeof ttlMs === 'number' && ttlMs > 0) ? Math.max(1, Math.ceil(ttlMs / 1000)) : undefined;
      const path = seconds ? `/set/${encoded}?EX=${seconds}` : `/set/${encoded}`;
      await request(path, { method: 'POST', body: val });
    },
  };
}

/**
 * @param {{env?: Record<string,string|undefined>, kv?: any, runWebRewriteStreamImpl?: typeof runWebRewriteStream, enhancedEngine?: {kind?:string, isAvailable:Function, rewrite:Function}, logger?: {info?: Function, warn?: Function, error?: Function, debug?: Function}, now?: () => number}} [options]
 */
export function createRewriteApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), kv: injectedKv, runWebRewriteStreamImpl = runWebRewriteStream, enhancedEngine = createStubEnhancedEngine(), logger = console, now = () => Date.now() } = {}) {
  const restKv = createRestKv(env);
  const kv = injectedKv ?? (isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv()));
  const proMetering = createProMetering({ kv, now });
  /** @param {unknown} v */
  const parseRecord = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch { return null; }
  };
  /** @type {Record<string, number>} */
  const PRO_SESSION_STATUS = { no_session: 401, expired: 401, absolute_expired: 401, entitlement_revoked: 402 };

  // Pro path: gate-on requests (G001 only emits tier 'pro' when the gate is on)
  // are verified by opaque session token (G004) -> entitlement (G003) -> Pro
  // metering (G006) -> the enhanced engine adapter. Every failure is explicit
  // and fail-closed; it never falls back to free/BYOK or the shared LLM.
  async function runProRewrite({ res, request }) {
    const denyMetric = (status) => logger.info?.('rewrite.metric', buildRewriteMetric({
      tier: 'pro', provider: 'enhanced', model: enhancedEngine.kind || 'enhanced', status,
      latencyMs: 0, quotaDecision: 'denied', charCount: typeof request.text === 'string' ? request.text.length : 0,
    }));
    const jsonErr = (status, error) => {
      res.statusCode = status;
      res.setHeader?.('Content-Type', 'application/json');
      res.setHeader?.('Cache-Control', 'no-store');
      res.end?.(JSON.stringify({ error }));
      denyMetric(status);
    };

    const proSecret = env.PATINA_PRO_HMAC_SECRET;
    if (!proSecret) return jsonErr(503, 'pro service unavailable');

    let tokenHash;
    try {
      tokenHash = hashSessionToken(proSecret, request.proSessionToken);
    } catch {
      return jsonErr(401, 'invalid pro session');
    }
    let sessionRecord;
    let entitlement;
    try {
      sessionRecord = parseRecord(await kv.get(sessionKey(tokenHash)));
      entitlement = sessionRecord && typeof /** @type {any} */ (sessionRecord).entitlementId === 'string'
        ? parseRecord(await kv.get(entitlementKey(/** @type {any} */ (sessionRecord).entitlementId)))
        : null;
    } catch {
      // A KV outage during the Pro lookup fails closed as an explicit 503 (the
      // pro path never degrades to a generic 500 or to free/BYOK).
      return jsonErr(503, 'pro session storage unavailable');
    }
    const verdict = verifyProSession({ sessionRecord: /** @type {any} */ (sessionRecord), entitlement, now: now() });
    if (!verdict.ok) return jsonErr(PRO_SESSION_STATUS[verdict.reason ?? 'no_session'] ?? 401, 'pro session not valid');

    const meter = await proMetering.check({ entitlementId: /** @type {any} */ (sessionRecord).entitlementId });
    if (!meter.allowed) {
      const denied = /** @type {{status:number, reason:string}} */ (meter);
      return jsonErr(denied.status, denied.reason);
    }

    if (!enhancedEngine.isAvailable(env)) return jsonErr(503, 'pro engine unavailable');
    let result;
    try {
      result = await enhancedEngine.rewrite({ text: request.text, lang: request.lang, mode: request.mode, original: request.original, history: request.history });
    } catch {
      return jsonErr(503, 'pro engine error');
    }

    res.statusCode = 200;
    res.setHeader?.('Content-Type', 'application/x-ndjson');
    res.setHeader?.('Cache-Control', 'no-store');
    const startedAt = now();
    res.write?.(encodeStreamFrame({ type: STREAM_FRAME_TYPES.START }));
    res.write?.(encodeStreamFrame({ type: STREAM_FRAME_TYPES.DELTA, text: result.text }));
    res.write?.(encodeStreamFrame({ type: STREAM_FRAME_TYPES.DONE, scores: result.scores }));
    res.end?.();
    logger.info?.('rewrite.metric', buildRewriteMetric({
      tier: 'pro', provider: 'enhanced', model: enhancedEngine.kind || 'enhanced', status: 200,
      latencyMs: now() - startedAt, quotaDecision: 'allowed', charCount: typeof request.text === 'string' ? request.text.length : 0,
    }));
  }
  return createRewriteHandler({
    rateLimiter: createRateLimiter({
      kv,
      hmacSecret: env.PATINA_QUOTA_HMAC_SECRET,
      env,
    }),
    runRewrite: async ({ res, request }) => {
      if (request.tier === WEB_TIERS.PRO) return runProRewrite({ res, request });
      // Resolve the effective LLM key server-side: BYOK uses the caller's key;
      // free uses the server's own provider key (never the request, which has
      // no key on the free tier). Fail closed if the free service is unconfigured.
      const apiKey = request.tier === WEB_TIERS.BYOK ? request.apiKey : env.PATINA_FREE_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader?.('Content-Type', 'application/json');
        res.end?.(JSON.stringify({ error: 'rewrite service unavailable' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader?.('Content-Type', 'application/x-ndjson');
      const startedAt = now();
      await runWebRewriteStreamImpl({
        request: { ...request, apiKey },
        emit: (frame) => res.write?.(encodeStreamFrame(frame)),
      });
      res.end?.();
      // Sanitized observability ONLY: route/tier/provider/model/status/bucketed
      // latency + char count. Never the text, prompt, output, key, or full IP.
      logger.info?.('rewrite.metric', buildRewriteMetric({
        tier: request.tier,
        provider: request.provider,
        model: request.model,
        status: 200,
        latencyMs: now() - startedAt,
        quotaDecision: 'allowed',
        charCount: typeof request.text === 'string' ? request.text.length : 0,
      }));
    },
    env,
  });
}

export default async function handler(req, res) {
  return createRewriteApiHandler()(req, res);
}
