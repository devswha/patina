// @ts-check
// Aggregate-only query endpoint for the private Pro monitor. Returns only the
// exact closed integer keys for the requested window; anything else is an
// error. Reads the whole window in one snapshot and fails closed (503) on any
// store or validation failure — never a fabricated zero. Never proxies or
// exposes raw Vercel logs.

import { timingSafeEqual } from 'node:crypto';
import { answerQuery } from '../lib/log-aggregate.js';
import { createLogqKv } from '../lib/rest-kv.js';

/** @param {string} expected @param {unknown} header */
function bearerValid(expected, header) {
  if (typeof header !== 'string') return false;
  const provided = Buffer.from(header, 'utf8');
  const wanted = Buffer.from(`Bearer ${expected}`, 'utf8');
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

/**
 * @param {{env?: Record<string, string|undefined>, kv?: ReturnType<typeof createLogqKv>, now?: () => number}} [options]
 */
export function createQueryHandler({ env = process.env, kv = createLogqKv(env ?? process.env), now = Date.now } = {}) {
  /**
   * @param {import('node:http').IncomingMessage & {headers: Record<string, string|string[]|undefined>, url?: string}} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function query(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET') { res.statusCode = 405; res.end('{"error":"method_not_allowed"}'); return; }
    const token = env?.LOGQ_QUERY_TOKEN;
    if (typeof token !== 'string' || token.length === 0 || !kv) { res.statusCode = 503; res.end('{"error":"query_unavailable"}'); return; }
    if (Array.isArray(req.headers.authorization) || !bearerValid(token, req.headers.authorization)) {
      res.statusCode = 401;
      res.end('{"error":"unauthorized"}');
      return;
    }
    let params;
    try { params = new URL(req.url ?? '/', 'https://logq.invalid').searchParams; } catch { res.statusCode = 400; res.end('{"error":"bad_request"}'); return; }
    const channel = params.get('channel');
    const tier = params.get('tier');
    const window = params.get('window');
    if (
      (channel !== 'production' && channel !== 'staging')
      || tier !== 'pro'
      || (window !== '15m' && window !== '30m')
      || params.get('aggregate_only') !== 'true'
    ) { res.statusCode = 400; res.end('{"error":"scope"}'); return; }
    try {
      const values = await answerQuery({ channel, tier, window, readCounters: (keys) => kv.getMany(keys), now: now() });
      res.statusCode = 200;
      res.end(JSON.stringify(values));
    } catch {
      res.statusCode = 503;
      res.end('{"error":"aggregate_unavailable"}');
    }
  };
}

export default createQueryHandler();
