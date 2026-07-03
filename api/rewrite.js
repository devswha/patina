// @ts-check
import { createRateLimiter, createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createRewriteHandler } from '../src/rewrite-handler.js';
import { encodeStreamFrame, QUOTA_REASONS, WEB_TIERS } from '../src/web-rewrite-contract.js';
import { buildRewriteMetric } from '../src/web-observability.js';
import { runWebRewriteStream } from '../src/web-rewrite-stream.js';

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
 * @returns {null|{get(key: string): Promise<unknown>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, decr(key: string): Promise<number>}}
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
  return createRewriteHandler({
    rateLimiter: createRateLimiter({
      kv,
      hmacSecret: env.PATINA_QUOTA_HMAC_SECRET,
      env,
      logger: /** @type {any} */ (logger),
    }),
    runRewrite: async ({ req, res, request }) => {
      // Resolve the effective LLM key server-side: BYOK uses the caller's key;
      // free uses the server's own provider key (never the request, which has
      // no key on the free tier). Fail closed if the free service is unconfigured.
      const apiKey = request.tier === WEB_TIERS.BYOK ? request.apiKey : env.PATINA_FREE_API_KEY;
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
      const envTimeout = Number(env.PATINA_WEB_REWRITE_TIMEOUT_MS);
      const timeout = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : WEB_REWRITE_TIMEOUT_MS;
      const startedAt = now();
      try {
        await runWebRewriteStreamImpl({
          request: { ...request, apiKey },
          emit: (frame) => res.write?.(encodeStreamFrame(frame)),
          signal: controller.signal,
          timeout,
        });
      } finally {
        res.off?.('close', onClose);
        req.off?.('aborted', onClose);
      }
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
