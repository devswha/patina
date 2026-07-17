// @ts-check
// Vercel log-drain receiver. Counts closed patina.web.v1 outcomes into
// per-quarter counters and discards everything else. Never stores or echoes
// raw log content.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { LOGQ_TTL_SECONDS, parseDrainDelivery } from '../lib/log-aggregate.js';
import { createLogqKv } from '../lib/rest-kv.js';

const MAX_BODY_BYTES = 1024 * 1024;

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @param {string} secret @param {Buffer} body @param {unknown} signature */
function signatureValid(secret, body, signature) {
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const expected = createHmac('sha1', secret).update(body).digest('hex');
  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

/**
 * @param {{env?: Record<string, string|undefined>, kv?: ReturnType<typeof createLogqKv>, now?: () => number, logger?: {warn?: Function}}} [options]
 */
export function createIngestHandler({ env = process.env, kv = createLogqKv(env ?? process.env), now = Date.now, logger = console } = {}) {
  /**
   * @param {import('node:http').IncomingMessage & {headers: Record<string, string|string[]|undefined>}} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function ingest(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    // Vercel verifies drain endpoints by expecting the team's endpoint
    // verification code (GET /v1/verify-endpoint) in the x-vercel-verify
    // response header before any drain traffic flows. Sending it on every
    // response only asserts "this endpoint consents to receive this team's
    // drain deliveries" — it authorizes nothing else.
    const verifyCode = env?.LOGQ_VERCEL_VERIFY;
    const hasCode = typeof verifyCode === 'string' && verifyCode.length > 0;
    if (hasCode) res.setHeader('x-vercel-verify', verifyCode);
    const challenge = req.headers['x-vercel-verify'];
    if (typeof challenge === 'string' && challenge.length > 0 && challenge.length <= 256 && /^[A-Za-z0-9._-]+$/.test(challenge)) {
      if (!hasCode) res.setHeader('x-vercel-verify', challenge);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = 200;
      res.end(typeof verifyCode === 'string' && verifyCode.length > 0 ? verifyCode : challenge);
      return;
    }
    if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"method_not_allowed"}'); return; }
    const secret = env?.LOGQ_DRAIN_SECRET;
    if (typeof secret !== 'string' || secret.length === 0 || !kv) { res.statusCode = 503; res.end('{"error":"ingest_unavailable"}'); return; }
    let body;
    try { body = await readBody(req); } catch { res.statusCode = 413; res.end('{"error":"body_too_large"}'); return; }
    if (!signatureValid(secret, body, req.headers['x-vercel-signature'])) { res.statusCode = 403; res.end('{"error":"signature"}'); return; }
    let stored = 0;
    try {
      const increments = parseDrainDelivery(body.toString('utf8'), { now: now() });
      for (const { key, count } of increments) {
        await kv.incrBy(key, count, LOGQ_TTL_SECONDS);
        stored += 1;
      }
    } catch {
      // A partial store is acceptable: drains redeliver, counters are coarse,
      // and the monitor fails closed on unavailability rather than trusting
      // silence. Never echo delivery content back.
      try { logger?.warn?.({ logq: 'ingest_partial' }); } catch { /* logging must not fail ingest */ }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, counters: stored }));
  };
}

export default createIngestHandler();
