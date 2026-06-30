// @ts-check
// Pro session exchange endpoint: POST a raw Lemon license key ONCE, receive an
// opaque short-lived Pro session token. Thin glue over src/pro-session.js — the
// security logic lives there; this wires request/response, KV selection,
// production fail-closed posture, no-store headers, and sanitized logging.

import { createRestKv } from './rewrite.js';
import { createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createProSessionExchange } from '../src/pro-session.js';
import { hashLicenseKey } from '../src/pro-entitlements.js';
import { byteLength } from '../src/web-rewrite-contract.js';

/**
 * Read and JSON-parse a request body. Honors a pre-parsed `req.body` (Vercel)
 * and otherwise drains the stream. Caps the payload so a giant body cannot DoS.
 *
 * @param {any} req
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req) {
  const MAX_BODY_BYTES = 16 * 1024;
  if (req && typeof req.body === 'string') {
    if (byteLength(req.body) > MAX_BODY_BYTES) throw new Error('payload too large');
    return req.body.length > 0 ? JSON.parse(req.body) : {};
  }
  // A pre-parsed object body (Vercel) is returned as-is; the exchange reads only
  // an OWN `licenseKey` string, so a polluted prototype cannot smuggle a key.
  if (req && req.body != null && typeof req.body === 'object') return req.body;
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 16 * 1024) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * @param {{env?: Record<string,string|undefined>, kv?: any, verifyLicense?: (raw:string)=>Promise<object|null>, logger?: {info?: Function, warn?: Function}, now?: () => number}} [options]
 */
export function createProSessionApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), kv: injectedKv, verifyLicense, logger = console, now = () => Date.now() } = {}) {
  const restKv = createRestKv(env);
  // Production must use the durable REST KV; never silently fall back to the
  // in-memory store (which would lose sessions and fail open across instances).
  const kv = injectedKv ?? (isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv()));

  return async function handler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    res.setHeader?.('Content-Type', 'application/json');

    const send = (status, payload) => {
      res.statusCode = status;
      res.end?.(JSON.stringify(payload));
      // Sanitized log ONLY: status code, never the raw key/email/token/body.
      logger.info?.('pro-session.exchange', { route: '/api/pro-session', status });
    };

    if (req.method && req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (!kv) return send(503, { error: 'pro session storage unavailable' });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return send(400, { error: 'invalid request body' });
    }

    const exchange = createProSessionExchange({
      kv,
      hmacSecret: env.PATINA_PRO_HMAC_SECRET || '',
      verifyLicense,
      hashKey: hashLicenseKey,
      now,
    });

    let result;
    try {
      result = await exchange.exchange(/** @type {any} */ (body));
    } catch {
      // A KV/provider outage must fail closed as a sanitized 503, never an
      // uncaught framework error that leaks a stack or skips the no-store path.
      return send(503, { error: 'pro session storage unavailable' });
    }
    if ('proSessionToken' in result) {
      return send(200, { proSessionToken: result.proSessionToken, expiresAt: result.expiresAt, status: result.status });
    }
    return send(result.status, { error: result.reason });
  };
}

export default async function handler(req, res) {
  return createProSessionApiHandler()(req, res);
}
