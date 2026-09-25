// @ts-check
import { reservationArgs, RESERVE_QUOTA_LUA, settlementArgs, SETTLE_QUOTA_LUA } from '../src/quota-reservation.js';
import { createRateLimiter, createMemoryKv } from '../src/rate-limit.js';
import { createRewriteHandler } from '../src/rewrite-handler.js';
import { encodeStreamFrame, isProductionPosture, QUOTA_REASONS, resolveTierLimits, WEB_TIERS } from '../src/web-rewrite-contract.js';
import { createWebObserver, emitTelemetry, startTelemetryClock } from '../src/web-observability.js';
import { runWebRewriteStream } from '../src/web-rewrite-stream.js';
import { createPolarLicenseValidator } from '../src/entitlement-polar.js';
import { INCRBY_PEXPIRE_LUA, upstashFetch, upstashOrigin } from '../src/upstash-rest.js';

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
  const origin = upstashOrigin(env.PATINA_OBSERVABILITY_REST_API_URL);
  const token = env.PATINA_OBSERVABILITY_REST_API_TOKEN;
  if (!origin || !token) return null;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  return {
    async increment(key, { ttlSeconds }) {
      const ttlMs = Math.max(1, Math.ceil(Number(ttlSeconds) * 1000));
      if (!Number.isSafeInteger(ttlMs)) throw new Error('invalid observability ttl');
      const data = await upstashFetch(origin, {
        method: 'POST',
        headers,
        body: JSON.stringify(['EVAL', INCRBY_PEXPIRE_LUA, '1', key, '1', String(ttlMs)]),
      }, { failureMessage: 'observability request failed', deadlineMs: 45, deadlineMessage: 'observability deadline exceeded' });
      if (!Number.isSafeInteger(data?.result) || data.result <= 0) {
        throw new Error('observability increment returned invalid counter');
      }
    },
  };
}

/**
 * Create a dependency-free Upstash/Vercel KV REST adapter.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {null|{get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, acquireLease(registryKey: string, lease: string, maxConcurrent: number, options: {ttlMs: number}): Promise<boolean>, releaseLease(registryKey: string, lease: string): Promise<boolean>, reserveQuota(plan: import('../src/quota-reservation.js').ReservationPlan): Promise<number[]>, settleQuota(plan: import('../src/quota-reservation.js').ReservationPlan, refund: boolean): Promise<number>}}
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

  /**
   * @param {string} target
   * @param {{method?: string, headers?: Record<string, string>, body?: string}} init
   * @param {string} failureMessage
   */
  function request(target, init, failureMessage) {
    return upstashFetch(target, init, { failureMessage, deadlineMs: 2_000, deadlineMessage: 'kv request deadline exceeded' });
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

  return {
    async reserveQuota(plan) {
      const data = await command(['EVAL', RESERVE_QUOTA_LUA, '5', ...plan.keys, ...reservationArgs(plan)]);
      if (!Array.isArray(data?.result)) throw new Error('invalid quota reservation response');
      return data.result;
    },
    async settleQuota(plan, refund) {
      const data = await command(['EVAL', SETTLE_QUOTA_LUA, '5', ...plan.keys, ...settlementArgs(plan, refund)]);
      const value = parseKvNumber(data);
      if (![0, 1, -1].includes(value)) throw new Error('invalid quota settlement response');
      return value;
    },
    async get(key) {
      const data = await read(`/get/${encodeURIComponent(key)}`);
      const result = data?.result;
      // Round-trip objects exactly like the in-memory KV: Upstash returns the
      // stored value as a JSON string, so parse it back (object in -> object
      // out) for the entitlement cache. null/missing -> undefined; a non-JSON
      // string (a plain value) is returned verbatim; an already-parsed object
      // passes through. Counters never read through here; incr parses its own
      // numeric result.
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
    // Every counter is a fixed window, so the increment and its expiry are
    // one EVAL: a counter without a TTL would never reset.
    async incr(key, { ttlMs } = {}) {
      if (!(typeof ttlMs === 'number' && ttlMs > 0)) throw new Error('kv incr requires a ttl');
      const value = parseKvNumber(await command(['EVAL', INCRBY_PEXPIRE_LUA, '1', key, '1', String(Math.max(1, Math.ceil(ttlMs)))]));
      if (value == null) throw new Error('kv incr returned invalid counter');
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
 * Default server-side budget for one rewrite stream — the TOTAL across the
 * rewrite attempt(s) AND both scorers, enforced as one absolute deadline inside
 * runWebRewriteStream (each stage draws from the same remaining budget and a
 * single abort fires at exhaustion; previously every stage received the full
 * window, so the worst case ran ~3x over). Bounds upstream work even when the
 * client stays connected; override with env.PATINA_WEB_REWRITE_TIMEOUT_MS up
 * to 240s, retaining at least 60s for response finalization and lease cleanup
 * beneath Vercel's 300s function ceiling.
 */
const WEB_REWRITE_TIMEOUT_MS = 180_000;
const WEB_REWRITE_MAX_TIMEOUT_MS = 240_000;

/**
 * The playground's default is NDJSON. JSON is an explicit opt-in for API
 * clients that prefer one completed response. Parses the Accept header as
 * exact comma-separated media types (parameters such as q are honored; a
 * q=0 entry excludes), so lookalikes like application/json-seq never match.
 * @param {Record<string, string|string[]|undefined>} headers
 */
function wantsJsonResponse(headers = {}) {
  const accept = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === 'accept')
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string')
    .join(',');
  /** @type {Set<string>} */
  const accepted = new Set();
  /** @type {Set<string>} */
  const refused = new Set();
  for (const entry of accept.split(',')) {
    const [rawType, ...params] = entry.split(';').map((part) => part.trim());
    const type = rawType.toLowerCase();
    if (type === '') continue;
    const qParam = params.find((param) => param.toLowerCase().startsWith('q='));
    const refusedByQ = qParam !== undefined && Number(qParam.slice(2)) === 0;
    (refusedByQ ? refused : accepted).add(type);
  }
  return accepted.has('application/json') && !accepted.has('application/x-ndjson') && !refused.has('application/json');
}

/**
 * `runWebRewriteStreamImpl` is typed by what this handler consumes, not by the
 * full implementation signature: the frames are delivered through `emit`, and
 * the resolved value is only read for `ok`/`code` (and forwarded to
 * `beforeResponseEnd`), which is why the reads here are already optional.
 * Requiring the whole result shape would force every injected stand-in to
 * fabricate fields this handler never looks at.
 *
 * @param {{env?: Record<string,string|undefined>, runWebRewriteStreamImpl?: (options: Parameters<typeof runWebRewriteStream>[0]) => Promise<{ok?: boolean, code?: string}|void>, logger?: {info?: Function, warn?: Function, error?: Function, debug?: Function}, now?: () => number, observabilityKv?: {increment: (key: string, options: {ttlSeconds: number}) => unknown}}} [options]
 */
export function createRewriteApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), runWebRewriteStreamImpl = runWebRewriteStream, logger = console, now = () => Date.now(), observabilityKv } = {}) {
  const restKv = createRestKv(env);
  const kv = isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv());
  // One stream budget, computed once: bounds upstream work (provider + scoring)
  // and keeps a free-tier lease live for at least a full stream. Floor at 5m.
  let streamTimeoutMs = WEB_REWRITE_TIMEOUT_MS;
  if (env.PATINA_WEB_REWRITE_TIMEOUT_MS !== undefined) {
    const envTimeout = Number(env.PATINA_WEB_REWRITE_TIMEOUT_MS);
    if (!Number.isSafeInteger(envTimeout) || envTimeout <= 0 || envTimeout > WEB_REWRITE_MAX_TIMEOUT_MS) {
      throw new TypeError(`PATINA_WEB_REWRITE_TIMEOUT_MS must be an integer from 1 to ${WEB_REWRITE_MAX_TIMEOUT_MS}`);
    }
    streamTimeoutMs = envTimeout;
  }
  const concurrencyTtlMs = Math.max(5 * 60 * 1000, streamTimeoutMs + 30_000);
  // The pro tier's revenue gate: a fail-closed validate-only license validator
  // sharing the rate limiter's KV. It turns the caller's Authorization: Bearer
  // license into an HMAC subject; the raw license never leaves the entitlement
  // module (never a return value, log line, or KV key).
  //
  // Polar is the only license provider.
  const licenseValidator = createPolarLicenseValidator({
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
      const jsonResponse = wantsJsonResponse(req.headers);
      /** @type {Record<string, unknown>[]} */
      /** @type {Record<string, any>[]} */
      const bufferedFrames = [];
      /** @type {string|undefined} */
      let bufferedBody;
      // Exactly one terminal event per request: the stream reports its own,
      // and this runner reports only the paths the stream never reached.
      let terminalObserved = false;
      const elapsed = typeof observe === 'function' ? startTelemetryClock(now) : undefined;
      const observeTerminal = (/** @type {string} */ outcome, /** @type {number} */ status) => {
        const latencyMs = terminalObserved ? undefined : elapsed?.();
        if (latencyMs === undefined) return;
        terminalObserved = true;
        emitTelemetry(/** @type {Function} */ (observe), { tier: request.tier, outcome, status, latencyMs });
      };
      const observeStream = (/** @type {Record<string, unknown>} */ event) => {
        if (terminalObserved || typeof observe !== 'function') return;
        terminalObserved = true;
        emitTelemetry(observe, event);
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
        await beforeResponseEnd?.({ ok: false, code: 'service_disabled' });
        res.end?.(JSON.stringify({ error: QUOTA_REASONS.SERVICE_UNAVAILABLE }));
        return;
      }
      res.statusCode = 200;
      res.setHeader?.('Content-Type', jsonResponse ? 'application/json' : 'application/x-ndjson');
      const controller = new AbortController();
      let clientClosed = req.aborted === true || (res.destroyed === true && !res.writableEnded);
      const onClose = () => { clientClosed = true; if (!res.writableEnded) controller.abort(); };
      res.on?.('close', onClose);
      req.on?.('aborted', onClose);
      if (clientClosed) controller.abort();
      let streamCompleted = false;
      let terminalOutcome;
      try {
        const result = await runWebRewriteStreamImpl({
          request: { ...request, apiKey },
          emit: (frame) => {
            if (jsonResponse) bufferedFrames.push(frame);
            else res.write?.(encodeStreamFrame(frame));
          },
          signal: controller.signal,
          timeout: streamTimeoutMs,
          observe: observeStream,
          now,
        });
        // The seam's return type is `void`-tolerant so an injected stand-in
        // need not fabricate a result this handler never reads; narrow once
        // here to the two fields it does read.
        const outcome = /** @type {{ok?: boolean, code?: string}|undefined} */ (result);
        terminalOutcome = outcome;
        observeTerminal(
          outcome?.ok === false && outcome.code === 'number_safety_failed' ? 'number_safety_failed'
            : outcome?.ok === false ? 'terminal_failed' : 'completed',
          res.statusCode,
        );
        if (jsonResponse) {
          const done = [...bufferedFrames].reverse().find((frame) => frame.type === 'done');
          if (outcome?.ok !== false && done) {
            const { type: _type, ...body } = done;
            bufferedBody = JSON.stringify({ ok: true, ...body });
          } else {
            // Preserve the runner's terminal semantics: safety-gate refusals
            // (floor_failed, number_safety_failed) are 422 — the request was
            // processed and deliberately rejected — while stream/scoring
            // failures are 500. The stable machine-readable `code` lets API
            // clients branch without parsing prose.
            const code = outcome?.ok === false && typeof outcome.code === 'string'
              ? outcome.code
              : ([...bufferedFrames].reverse().find((frame) => frame.type === 'error')?.code ?? 'rewrite_failed');
            const errorFrame = bufferedFrames.find((frame) => frame.type === 'error' && typeof frame.error === 'string');
            res.statusCode = code === 'invalid_unicode' ? 400
              : ['floor_failed', 'number_safety_failed', 'protected_text_failed', 'edit_output_too_long', 'output_invalid_unicode'].includes(code) ? 422 : 500;
            // Mirror the NDJSON frame exactly: the runner already chose a
            // tier-safe `error` string, and a BYOK frame may also carry the
            // coarse upstream status.
            const upstreamStatus = errorFrame?.upstreamStatus;
            bufferedBody = JSON.stringify({
              ok: false,
              code,
              error: errorFrame?.error ?? code,
              ...(Number.isInteger(upstreamStatus) ? { upstreamStatus } : {}),
            });
          }
        }
        streamCompleted = true;
        return result;
      } catch (err) {
        observeTerminal('terminal_failed', 500);
        await beforeResponseEnd?.({ ok: false, code: clientClosed ? 'client_closed' : 'runner_failed' });
        throw err;
      } finally {
        res.off?.('close', onClose);
        req.off?.('aborted', onClose);
        if (streamCompleted) {
          await beforeResponseEnd?.(clientClosed ? { ok: false, code: 'client_closed' } : terminalOutcome);
          // The lease is released above regardless; after a premature client
          // close the response may already be destroyed — never write to it.
          if (!clientClosed && !res.writableEnded && !res.destroyed) {
            res.end?.(bufferedBody);
          }
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
