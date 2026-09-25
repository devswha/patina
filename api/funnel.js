// @ts-check
import { funnelCounterKey, validateFunnelEvent } from '../src/funnel-analytics.js';
import { upstashFetch, upstashOrigin } from '../src/upstash-rest.js';

export const config = { api: { bodyParser: false } };

const BODY_LIMIT = 4096;
const TTL_SECONDS = 35 * 24 * 60 * 60;
const DEFAULT_EVENTS_PER_DAY = 10_000;
const DAILY_LIMIT_CODE = 'FUNNEL_DAILY_LIMIT';
const INCREMENT_WITH_DAILY_LIMIT = "local total = redis.call('INCRBY', KEYS[1], ARGV[1]) redis.call('PEXPIRE', KEYS[1], ARGV[2]) if total > tonumber(ARGV[3]) then return -1 end local v = redis.call('INCRBY', KEYS[2], ARGV[1]) redis.call('PEXPIRE', KEYS[2], ARGV[2]) return v";

/** @param {unknown} value */
function headerValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return typeof value === 'string' ? value : null;
}

/** @param {any} req @param {string} name */
function header(req, name) {
  const headers = req?.headers;
  if (headers?.get) return headerValue(headers.get(name));
  if (!headers || typeof headers !== 'object') return null;
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
  return key ? headerValue(headers[key]) : null;
}

/** @param {any} res @param {number} status */
function respond(res, status) {
  res.statusCode = status;
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('Content-Length', '0');
  res.end?.();
}

/** @param {any} req */
function isSameOriginRequest(req) {
  const origin = header(req, 'origin');
  const forwardedProto = header(req, 'x-forwarded-proto');
  const forwardedHost = header(req, 'x-forwarded-host');
  if (!origin || !forwardedProto || !forwardedHost || header(req, 'sec-fetch-site') !== 'same-origin') return false;
  if (!/^(https?|HTTPS?)$/.test(forwardedProto) || /[\s,]/.test(forwardedHost)) return false;
  try {
    const parsed = new URL(origin);
    return origin === parsed.origin && parsed.protocol === `${forwardedProto.toLowerCase()}:` && parsed.host.toLowerCase() === forwardedHost.toLowerCase();
  } catch {
    return false;
  }
}

/** @param {any} req @param {Record<string,string|undefined>} env */
function isAllowedDeploymentHost(req, env) {
  if (env.VERCEL !== '1' && env.NODE_ENV !== 'production') return true;
  const allowed = new Set();
  for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const value = env[name];
    if (value && !/[/?#@\s,]/.test(value)) allowed.add(value.toLowerCase());
  }
  if (env.PATINA_PUBLIC_BASE_URL) {
    try {
      const url = new URL(env.PATINA_PUBLIC_BASE_URL);
      if (url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash) allowed.add(url.host.toLowerCase());
    } catch {
      return false;
    }
  }
  const host = header(req, 'x-forwarded-host');
  return Boolean(host && allowed.size > 0 && allowed.has(host.toLowerCase()));
}

/** @param {any} req */
async function requestBody(req) {
  if (req?.body !== undefined) {
    const body = req.body;
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > BODY_LIMIT) return { tooLarge: true };
      return { text: body };
    }
    if (body instanceof Uint8Array) {
      if (body.byteLength > BODY_LIMIT) return { tooLarge: true };
      return { text: Buffer.from(body).toString('utf8') };
    }
    try {
      const text = JSON.stringify(body);
      if (typeof text !== 'string') return { invalid: true };
      if (Buffer.byteLength(text) > BODY_LIMIT) return { tooLarge: true };
      return { text };
    } catch {
      return { invalid: true };
    }
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return { invalid: true };
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > BODY_LIMIT) return { tooLarge: true };
    chunks.push(bytes);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Dedicated aggregate-only Upstash REST adapter. It cannot read values or
 * accept arbitrary commands, so this endpoint cannot persist request context.
 * @param {Record<string, string|undefined>} env
 * @param {typeof fetch} fetchImpl
 */
export function createFunnelAggregateStore(env = process.env, fetchImpl = globalThis.fetch) {
  const origin = upstashOrigin(env.PATINA_OBSERVABILITY_REST_API_URL);
  const token = env.PATINA_OBSERVABILITY_REST_API_TOKEN;
  if (!origin || !token || typeof fetchImpl !== 'function') return null;
  const configuredLimit = Number(env.PATINA_FUNNEL_EVENTS_PER_DAY || DEFAULT_EVENTS_PER_DAY);
  if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 1_000_000) return null;

  return {
    async increment(key, { ttlSeconds }) {
      const ttlMs = Math.ceil(ttlSeconds * 1000);
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error('invalid ttl');
      const parts = key.split(':');
      if (parts.length < 5 || parts[0] !== 'patina' || parts[1] !== 'funnel' || parts[2] !== 'v1') throw new Error('invalid aggregate key');
      const budgetKey = `${parts.slice(0, 4).join(':')}:budget`;
      const result = await upstashFetch(origin, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(['EVAL', INCREMENT_WITH_DAILY_LIMIT, '2', budgetKey, key, '1', String(ttlMs), String(configuredLimit)]),
      }, { failureMessage: 'aggregate storage unavailable', fetchImpl });
      if (result?.result === -1) {
        const error = /** @type {Error & {code: string}} */ (new Error('aggregate daily limit reached'));
        error.code = DAILY_LIMIT_CODE;
        throw error;
      }
      if (!Number.isSafeInteger(result?.result) || result.result < 1) throw new Error('invalid aggregate counter');
    },
  };
}

/**
 * @param {{env?: Record<string, string|undefined>, aggregateStore?: {increment(key: string, options: {ttlSeconds: number}): Promise<void>|void}|null, now?: () => Date|number|string, fetchImpl?: typeof fetch}} options
 */
export function createFunnelApiHandler({ env = process.env, aggregateStore, now = () => new Date(), fetchImpl = globalThis.fetch } = {}) {
  const store = aggregateStore === undefined ? createFunnelAggregateStore(env, fetchImpl) : aggregateStore;
  return async (req, res) => {
    if (req?.method !== 'POST') return respond(res, 405);
    if (!isSameOriginRequest(req)) return respond(res, 403);
    if (!isAllowedDeploymentHost(req, env)) return respond(res, 403);
    const contentType = header(req, 'content-type');
    if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return respond(res, 400);
    const body = await requestBody(req);
    if (body.tooLarge) return respond(res, 413);
    if (body.invalid || typeof body.text !== 'string') return respond(res, 400);
    let event;
    try {
      event = JSON.parse(body.text);
    } catch {
      return respond(res, 400);
    }
    if (!validateFunnelEvent(event)) return respond(res, 400);
    if (!store) return respond(res, 503);
    try {
      await store.increment(funnelCounterKey(event, now()), { ttlSeconds: TTL_SECONDS });
    } catch (error) {
      if (/** @type {any} */ (error)?.code === DAILY_LIMIT_CODE) return respond(res, 429);
      return respond(res, 503);
    }
    return respond(res, 204);
  };
}

export default createFunnelApiHandler();
