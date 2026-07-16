// @ts-check
import { createRateLimiter, createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createRewriteHandler } from '../src/rewrite-handler.js';
import { encodeStreamFrame, QUOTA_REASONS, resolveTierLimits, WEB_TIERS } from '../src/web-rewrite-contract.js';
import { createWebObserver } from '../src/web-observability.js';
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
 * Dedicated, bounded transport for aggregate observability. It deliberately
 * does not share the quota adapter or its credentials.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {null|{increment(key: string, options: {ttlSeconds: number}): Promise<void>}}
 */
export function createObservabilityRestKv(env = {}) {
  const base = env.PATINA_OBSERVABILITY_REST_API_URL;
  const token = env.PATINA_OBSERVABILITY_REST_API_TOKEN;
  if (!base || !token) return null;

  let url;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/i.test(url.hostname)
    || url.pathname !== '/' || url.search || url.hash) return null;

  const INCREMENT_WITH_TTL = "local v = redis.call('INCRBY', KEYS[1], ARGV[1]) redis.call('PEXPIRE', KEYS[1], ARGV[2]) return v";
  const root = url.origin;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  return {
    async increment(key, { ttlSeconds }) {
      const ttlMs = Math.max(1, Math.ceil(Number(ttlSeconds) * 1000));
      if (!Number.isSafeInteger(ttlMs)) throw new Error('invalid observability ttl');

      const controller = new AbortController();
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('observability deadline exceeded'));
        }, 45);
      });
      const request = (async () => {
        const response = await globalThis.fetch(root, {
          method: 'POST',
          headers,
          body: JSON.stringify(['EVAL', INCREMENT_WITH_TTL, '1', key, '1', String(ttlMs)]),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('observability request failed');
        const data = await response.json();
        if (!Number.isSafeInteger(data?.result) || data.result <= 0) {
          throw new Error('observability increment returned invalid counter');
        }
      })();
      try {
        await Promise.race([request, deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Create a dependency-free Upstash/Vercel KV REST adapter.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {null|{get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, incrBy(key: string, amount: number, options?: {ttlMs?: number}): Promise<number>, decr(key: string): Promise<number>, acquireLease(registryKey: string, lease: string, maxConcurrent: number, options: {ttlMs: number}): Promise<boolean>, releaseLease(registryKey: string, lease: string): Promise<boolean>}}
 */
export function createRestKv(env = {}) {
  const base = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!base || !token) return null;

  let url;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (isProductionPosture(env) && (!url.hostname.endsWith('.upstash.io') || url.port || url.pathname !== '/'))) return null;

  const root = url.toString().replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const deadlineMs = 2_000;

  async function request(url, init, failureMessage) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('kv request deadline exceeded'));
      }, deadlineMs);
    });
    const response = (async () => {
      const result = await globalThis.fetch(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!result.ok) throw new Error(failureMessage);
      return result.json();
    })();
    try {
      return await Promise.race([response, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function read(path) {
    return request(`${root}${path}`, { headers }, 'kv request failed');
  }

  // Upstash/Vercel KV also accepts a command as a JSON array POSTed to the
  // root; this is how we issue an ATOMIC "SET key value PX ttl" — a GET-path SET
  // followed by a separate EXPIRE would leave a crash window that drops the TTL
  // and leaks a permanent entitlement-cache entry.
  async function command(args) {
    return request(root, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }, 'kv command failed');
  }

  // Quota identities use one sorted-set registry: scores are server-time expiry
  // instants and members are opaque lease capabilities.  Both operations are one
  // EVAL so no crash or client-clock window can create phantom occupancy.
  const INCRBY_PEXPIRE_SCRIPT = "local v = redis.call('INCRBY', KEYS[1], ARGV[1]) redis.call('PEXPIRE', KEYS[1], ARGV[2]) return v";
  const ACQUIRE_LEASE_SCRIPT = "local t = redis.call('TIME') local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000) local ttl = tonumber(ARGV[1]) redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now) if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end redis.call('ZADD', KEYS[1], now + ttl, ARGV[3]) redis.call('PEXPIRE', KEYS[1], ttl) return 1";
  const RELEASE_LEASE_SCRIPT = "local t = redis.call('TIME') local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000) local expiry = redis.call('ZSCORE', KEYS[1], ARGV[1]) if not expiry or tonumber(expiry) <= now then return 0 end return redis.call('ZREM', KEYS[1], ARGV[1])";

  async function leaseCommand(script, registryKey, lease, maxConcurrent, ttlMs) {
    const args = ['EVAL', script, '1', registryKey];
    if (maxConcurrent != null) args.push(String(Math.max(1, Math.ceil(ttlMs))), String(maxConcurrent), lease);
    else args.push(lease);
    const value = parseKvNumber(await command(args));
    if (value !== 0 && value !== 1) throw new Error('kv lease command returned invalid result');
    return value === 1;
  }

  async function incrByAtomic(key, amount, ttlMs) {
    const data = await command([
      'EVAL', INCRBY_PEXPIRE_SCRIPT, '1', key,
      String(amount), String(Math.max(1, Math.ceil(ttlMs))),
    ]);
    const value = parseKvNumber(data);
    if (value == null) throw new Error('kv incr returned invalid counter');
    return value;
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
      if (typeof ttlMs === 'number' && ttlMs > 0) return incrByAtomic(key, 1, ttlMs);
      const data = await read(`/incr/${encodeURIComponent(key)}`);
      const value = parseKvNumber(data);
      if (value == null) throw new Error('kv incr returned invalid counter');
      return value;
    },
    async incrBy(key, amount, { ttlMs } = {}) {
      // Upstash/Vercel KV INCRBY: atomic add-N, returned as the new total. Used
      // for the pro monthly character counter (add textLength per request).
      if (typeof ttlMs === 'number' && ttlMs > 0) return incrByAtomic(key, amount, ttlMs);
      const data = await read(`/incrby/${encodeURIComponent(key)}/${encodeURIComponent(String(amount))}`);
      const value = parseKvNumber(data);
      if (value == null) throw new Error('kv incrby returned invalid counter');
      return value;
    },
    async decr(key) {
      const data = await read(`/decr/${encodeURIComponent(key)}`);
      const value = parseKvNumber(data);
      if (value == null) throw new Error('kv decr returned invalid counter');
      return value;
    },
    async acquireLease(registryKey, lease, maxConcurrent, { ttlMs }) {
      return leaseCommand(ACQUIRE_LEASE_SCRIPT, registryKey, lease, maxConcurrent, ttlMs);
    },
    async releaseLease(registryKey, lease) {
      return leaseCommand(RELEASE_LEASE_SCRIPT, registryKey, lease);
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
 * @param {{env?: Record<string,string|undefined>, runWebRewriteStreamImpl?: typeof runWebRewriteStream, logger?: {info?: Function, warn?: Function, error?: Function, debug?: Function}, now?: () => number, observabilityKv?: {increment: (key: string, options: {ttlSeconds: number}) => unknown}}} [options]
 */
export function createRewriteApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), runWebRewriteStreamImpl = runWebRewriteStream, logger = console, now = () => Date.now(), observabilityKv } = {}) {
  const restKv = createRestKv(env);
  const kv = isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv());
  // One stream budget, computed once: bounds upstream work (provider + scoring)
  // and keeps a free-tier lease live for at least a full stream. Floor at 5m.
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
  // The observer owns its channel and emits only its closed aggregate schema.
  // Aggregate telemetry uses an isolated, short-deadline Upstash transport.
  // Tests and local callers may still inject the narrow increment interface.
  const channel = env.PATINA_DEPLOYMENT_CHANNEL;
  const observabilityRestKv = createObservabilityRestKv(env);
  const observer = (channel === 'production' || channel === 'staging')
    ? createWebObserver({
      channel,
      logger,
      kv: observabilityKv ?? observabilityRestKv ?? undefined,
      now,
    })
    : null;
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
    runRewrite: async ({ req, res, request, observe, beforeResponseEnd }) => {
      let terminalObserved = false;
      let legacyStartedAt;
      if (typeof observe === 'function') {
        try {
          legacyStartedAt = Number(now());
        } catch {
          // Do not fabricate an epoch latency when the telemetry clock fails.
        }
      }
      const observeTerminal = (outcome, status) => {
        if (terminalObserved || typeof observe !== 'function' || !Number.isFinite(legacyStartedAt)) return false;
        let endedAt;
        try {
          endedAt = Number(now());
        } catch {
          return false;
        }
        if (!Number.isFinite(endedAt)) return false;
        terminalObserved = true;
        try {
          const result = observe({
            tier: request.tier,
            outcome,
            status,
            latencyMs: Math.max(0, endedAt - legacyStartedAt),
          });
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch {
          // Closed telemetry must not change a customer response.
        }
        return true;
      };
      const observeGuarded = (input) => {
        if (terminalObserved || typeof observe !== 'function') return undefined;
        terminalObserved = true;
        try {
          const result = observe(input);
          if (result && typeof result.catch === 'function') result.catch(() => {});
          return result;
        } catch {
          return undefined;
        }
      };
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
        observeTerminal('service_disabled', 503);
        res.statusCode = 503;
        res.setHeader?.('Content-Type', 'application/json');
        await beforeResponseEnd?.();
        res.end?.(JSON.stringify({ error: QUOTA_REASONS.SERVICE_UNAVAILABLE }));
        return;
      }
      res.statusCode = 200;
      res.setHeader?.('Content-Type', 'application/x-ndjson');
      const controller = new AbortController();
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.on?.('close', onClose);
      req.on?.('aborted', onClose);
      let streamCompleted = false;
      try {
        const result = await runWebRewriteStreamImpl({
          request: { ...request, apiKey },
          emit: (frame) => res.write?.(encodeStreamFrame(frame)),
          signal: controller.signal,
          timeout: streamTimeoutMs,
          observe: observeGuarded,
          now,
        });
        if (!terminalObserved) {
          observeTerminal(
            result?.ok === false && result.code === 'number_safety_failed' ? 'number_safety_failed'
              : result?.ok === false ? 'terminal_failed' : 'completed',
            res.statusCode,
          );
        }
        streamCompleted = true;
        return result;
      } catch (err) {
        observeTerminal('terminal_failed', 500);
        throw err;
      } finally {
        res.off?.('close', onClose);
        req.off?.('aborted', onClose);
        if (streamCompleted) {
          await beforeResponseEnd?.();
          res.end?.();
        }
      }
    },
    env,
    now,
    observe: observer?.observe,
  });
}

export default async function handler(req, res) {
  return createRewriteApiHandler()(req, res);
}
