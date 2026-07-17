// @ts-check
// Vercel log-drain receiver. Counts closed patina.web.v1 outcomes into
// per-quarter counters and discards everything else. Never stores or echoes
// raw log content. Fail-closed: malformed deliveries and store failures are
// rejected with non-2xx so the drain redelivers instead of losing evidence.

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
    // Vercel drain-endpoint verification: respond with the operator-configured
    // team verification code (from GET /v1/verify-endpoint) when the platform
    // presents its verification request. The request's own header value is a
    // trigger only and is NEVER echoed; without the configured code there is
    // no pre-authentication response path at all.
    const verifyCode = env?.LOGQ_VERCEL_VERIFY;
    const hasCode = typeof verifyCode === 'string' && verifyCode.length > 0;
    if (hasCode) res.setHeader('x-vercel-verify', verifyCode);
    if (hasCode && req.headers['x-vercel-verify'] !== undefined) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = 200;
      res.end(verifyCode);
      return;
    }
    if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"method_not_allowed"}'); return; }
    const secret = env?.LOGQ_DRAIN_SECRET;
    if (typeof secret !== 'string' || secret.length === 0 || !kv) { res.statusCode = 503; res.end('{"error":"ingest_unavailable"}'); return; }
    let body;
    try { body = await readBody(req); } catch { res.statusCode = 413; res.end('{"error":"body_too_large"}'); return; }
    if (!signatureValid(secret, body, req.headers['x-vercel-signature'])) { res.statusCode = 403; res.end('{"error":"signature"}'); return; }
    const parsed = parseDrainDelivery(body.toString('utf8'), { now: now() });
    if (parsed.ok !== true) {
      // Reject the whole malformed delivery before any write; the reason is a
      // closed enum, never delivery content.
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'malformed_delivery', reason: 'reason' in parsed ? parsed.reason : 'unknown' }));
      return;
    }
    try {
      await kv.incrAll(parsed.increments, LOGQ_TTL_SECONDS);
    } catch {
      // All-or-nothing: nothing was committed (single atomic script), so a
      // non-2xx makes the drain redeliver instead of silently losing counts.
      try { logger?.warn?.({ logq: 'store_failed' }); } catch { /* logging must not mask the 503 */ }
      res.statusCode = 503;
      res.end('{"error":"store_failed"}');
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, counters: parsed.increments.length }));
  };
}

export default createIngestHandler();
