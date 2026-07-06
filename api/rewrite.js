// @ts-check
import { createRateLimiter, createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createRewriteHandler } from '../src/rewrite-handler.js';
import { encodeStreamFrame, QUOTA_REASONS, resolveTierLimits, WEB_TIERS } from '../src/web-rewrite-contract.js';
import { buildRewriteMetric } from '../src/web-observability.js';
import { runWebRewriteStream } from '../src/web-rewrite-stream.js';
import { createLemonSqueezyLicenseValidator } from '../src/entitlement.js';

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
 * @returns {null|{get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, incrBy(key: string, amount: number, options?: {ttlMs?: number}): Promise<number>, decr(key: string): Promise<number>}}
 */
export function createRestKv(env = {}) {
  const base = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!base || !token) return null;
  const root = base.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };

  async function read(path) {
    const response = await globalThis.fetch(`${root}${path}`, { headers });
    if (!response.ok) throw new Error('kv request failed');
    return response.json();
  }

  // Upstash/Vercel KV also accepts a command as a JSON array POSTed to the
  // root; this is how we issue an ATOMIC "SET key value PX ttl" — a GET-path SET
  // followed by a separate EXPIRE would leave a crash window that drops the TTL
  // and leaks a permanent entitlement-cache entry.
  async function command(args) {
    const response = await globalThis.fetch(root, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error('kv command failed');
    return response.json();
  }

  return {
    async get(key) {
      const data = await read(`/get/${encodeURIComponent(key)}`);
      const result = data?.result;
      // Round-trip objects exactly like the in-memory KV: Upstash returns the
      // stored value as a JSON string, so parse it back (object in -> object
      // out) for the entitlement cache. null/missing -> undefined; a non-JSON
      // string (a legacy/plain value) is returned verbatim; an already-parsed
      // object passes through. incr/decr never call this, so the counter paths
      // keep reading the raw numeric REST result via parseKvNumber unchanged.
      if (result == null) return undefined;
      if (typeof result === 'string') {
        try {
          return JSON.parse(result);
        } catch {
          return result;
        }
      }
      return result;
    },
    async set(key, val, { ttlMs } = {}) {
      const value = JSON.stringify(val);
      // Atomic SET (+ PX expiry): one command, so a crash can't leave a
      // TTL-less permanent entry. PX is milliseconds; floor at 1ms.
      if (typeof ttlMs === 'number' && ttlMs > 0) {
        await command(['SET', key, value, 'PX', String(Math.max(1, Math.ceil(ttlMs)))]);
      } else {
        await command(['SET', key, value]);
      }
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
    async incrBy(key, amount, { ttlMs } = {}) {
      const encoded = encodeURIComponent(key);
      // Upstash/Vercel KV INCRBY: atomic add-N, returned as the new total. Used
      // for the pro monthly character counter (add textLength per request).
      const data = await read(`/incrby/${encoded}/${encodeURIComponent(String(amount))}`);
      const value = parseKvNumber(data);
      if (value == null) throw new Error('kv incrby returned invalid counter');
      if (typeof ttlMs === 'number' && ttlMs > 0) {
        const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
        await read(`/expire/${encoded}/${seconds}`);
      }
      return value;
    },
    async decr(key) {
      const data = await read(`/decr/${encodeURIComponent(key)}`);
      const value = parseKvNumber(data);
      if (value == null) throw new Error('kv decr returned invalid counter');
      return value;
    },
  };
}

/**
 * Default server-side budget for one rewrite stream (provider call + scoring).
 * Bounds upstream work even when the client stays connected; override with
 * env.PATINA_WEB_REWRITE_TIMEOUT_MS.
 */
const WEB_REWRITE_TIMEOUT_MS = 180_000;

/**
 * @param {{env?: Record<string,string|undefined>, runWebRewriteStreamImpl?: typeof runWebRewriteStream, logger?: {info?: Function, warn?: Function, error?: Function, debug?: Function}, now?: () => number}} [options]
 */
export function createRewriteApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), runWebRewriteStreamImpl = runWebRewriteStream, logger = console, now = () => Date.now() } = {}) {
  const restKv = createRestKv(env);
  const kv = isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv());
  // One stream budget, computed once: bounds upstream work (provider + scoring)
  // and, via concurrencyTtlMs, keeps a free-tier slot alive for at least a full
  // stream so an operator-extended timeout can't expire the slot mid-stream and
  // desync the counter (a later decr would drive it negative). Floor at 5m.
  const envTimeout = Number(env.PATINA_WEB_REWRITE_TIMEOUT_MS);
  const streamTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : WEB_REWRITE_TIMEOUT_MS;
  const concurrencyTtlMs = Math.max(5 * 60 * 1000, streamTimeoutMs + 30_000);
  // The pro tier's revenue gate: a fail-closed Lemon Squeezy validate-only
  // license validator sharing the rate limiter's KV. It turns the caller's
  // Authorization: Bearer license into an HMAC subject; the raw license never
  // leaves entitlement.js (never a return value, log line, or KV key).
  const licenseValidator = createLemonSqueezyLicenseValidator({
    kv,
    hmacSecret: env.PATINA_LICENSE_HMAC_SECRET || env.PATINA_QUOTA_HMAC_SECRET,
    env,
    logger: /** @type {any} */ (logger),
  });
  return createRewriteHandler({
    rateLimiter: createRateLimiter({
      kv,
      hmacSecret: env.PATINA_QUOTA_HMAC_SECRET,
      env,
      concurrencyTtlMs,
      limits: resolveTierLimits(env),
      logger: /** @type {any} */ (logger),
    }),
    licenseValidator,
    runRewrite: async ({ req, res, request }) => {
      // Resolve the effective LLM key server-side, per tier:
      //   - byok → the caller's own key (from the validated request).
      //   - pro  → the server's dedicated pro key (PATINA_PRO_API_KEY). Outside
      //            production, or when PATINA_PRO_ALLOW_FREE_KEY==='true', fall
      //            back to the free key so local/dev pro flows work; production
      //            without a pro key fails closed (never silently spends the free
      //            key on paid traffic).
      //   - free → the server's own free key.
      // The request never carries a key on free/pro (the pro license is an
      // Authorization: Bearer entitlement resolved to a subject upstream, never a
      // provider key). Fail closed when no usable key is configured.
      let apiKey;
      if (request.tier === WEB_TIERS.BYOK) {
        apiKey = request.apiKey;
      } else if (request.tier === WEB_TIERS.PRO) {
        const allowFreeKey = !isProductionPosture(env) || env.PATINA_PRO_ALLOW_FREE_KEY === 'true';
        apiKey = env.PATINA_PRO_API_KEY || (allowFreeKey ? env.PATINA_FREE_API_KEY : undefined);
      } else {
        apiKey = env.PATINA_FREE_API_KEY;
      }
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader?.('Content-Type', 'application/json');
        res.end?.(JSON.stringify({ error: QUOTA_REASONS.SERVICE_UNAVAILABLE }));
        return;
      }
      res.statusCode = 200;
      res.setHeader?.('Content-Type', 'application/x-ndjson');
      // Server-side cancellation: when the client disconnects mid-stream,
      // abort provider/scoring work so the upstream request and the free-tier
      // concurrency slot are released promptly (the handler's finally still
      // runs releaseConcurrency). 'close' with an unfinished response means a
      // premature disconnect on Node/Vercel; after a clean end the guard is
      // false and the abort is skipped. Runtimes whose req/res mocks lack
      // emitter methods degrade gracefully (optional calls) to the timeout.
      const controller = new AbortController();
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.on?.('close', onClose);
      req.on?.('aborted', onClose);
      const startedAt = now();
      let result;
      try {
        result = await runWebRewriteStreamImpl({
          request: { ...request, apiKey },
          emit: (frame) => res.write?.(encodeStreamFrame(frame)),
          signal: controller.signal,
          timeout: streamTimeoutMs,
        });
      } finally {
        res.off?.('close', onClose);
        req.off?.('aborted', onClose);
      }
      res.end?.();
      // Sanitized observability ONLY: route/tier/provider/model/status/outcome/
      // bucketed latency + char count. Never the text, prompt, output, key, or
      // full IP. The HTTP status is a genuine 200 (frames already committed), so
      // `outcome` — not `status` — carries whether the stream itself failed, so
      // abuse/provider-failure/floor-failure spikes stay observable.
      logger.info?.('rewrite.metric', buildRewriteMetric({
        tier: request.tier,
        provider: request.provider,
        model: request.model,
        status: 200,
        latencyMs: now() - startedAt,
        quotaDecision: 'allowed',
        outcome: result && result.ok === false ? String(result.code || 'failed') : 'ok',
        charCount: typeof request.text === 'string' ? request.text.length : 0,
      }));
    },
    env,
  });
}

export default async function handler(req, res) {
  return createRewriteApiHandler()(req, res);
}
