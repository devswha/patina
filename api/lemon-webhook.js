// @ts-check
// Lemon Squeezy webhook endpoint. Thin glue over src/lemon-webhook.js.
//
// CRITICAL: the signature is computed over the RAW request bytes, so this
// handler must read the unparsed body (do not rely on a framework JSON parse,
// which would re-serialize and break verification). Configure the platform to
// disable body parsing for this route.

import { createRestKv } from './rewrite.js';
import { createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createLemonWebhookProcessor } from '../src/lemon-webhook.js';
import { hashLicenseKey } from '../src/pro-entitlements.js';
import { byteLength } from '../src/web-rewrite-contract.js';

/** Case-insensitive single header lookup. */
function headerValue(headers, name) {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Read the raw request body (string or stream), capped to bound abuse.
 * @param {any} req
 * @returns {Promise<string|Buffer>}
 */
async function readRawBody(req) {
  const MAX_BODY_BYTES = 64 * 1024;
  if (typeof req.body === 'string') {
    if (byteLength(req.body) > MAX_BODY_BYTES) throw new Error('payload too large');
    return req.body;
  }
  if (Buffer.isBuffer(req.rawBody)) {
    if (req.rawBody.length > MAX_BODY_BYTES) throw new Error('payload too large');
    return req.rawBody;
  }
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {{env?: Record<string,string|undefined>, kv?: any, logger?: {info?: Function, warn?: Function}, now?: () => number}} [options]
 */
export function createLemonWebhookApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), kv: injectedKv, logger = console, now = () => Date.now() } = {}) {
  const restKv = createRestKv(env);
  const kv = injectedKv ?? (isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv()));

  return async function handler(req, res) {
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader?.('Content-Type', 'application/json');
      res.setHeader?.('Cache-Control', 'no-store');
      res.end?.(JSON.stringify(payload));
      logger.info?.('lemon.webhook', { route: '/api/lemon-webhook', status });
    };

    if (req.method && req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (!kv) return send(503, { error: 'webhook storage unavailable' });

    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch {
      return send(413, { error: 'payload too large' });
    }

    const processor = createLemonWebhookProcessor({
      kv,
      webhookSecret: env.PATINA_LEMON_WEBHOOK_SECRET || '',
      licenseHmacSecret: env.PATINA_PRO_HMAC_SECRET || '',
      hashKey: hashLicenseKey,
      now,
      logger,
    });

    let result;
    try {
      result = await processor.process({ rawBody, signature: headerValue(req.headers, 'x-signature') });
    } catch {
      return send(503, { error: 'webhook processing unavailable' });
    }

    if ('applied' in result) return send(200, { ok: true, applied: result.applied });
    return send(result.status, { error: result.reason });
  };
}

export default async function handler(req, res) {
  return createLemonWebhookApiHandler()(req, res);
}
