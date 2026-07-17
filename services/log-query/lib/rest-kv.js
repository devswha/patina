// @ts-check
// Minimal Upstash-compatible REST adapter for the log-query counters. The
// service owns a dedicated store; it never touches the quota/admission KV or
// the monitor's strict observability store.

/** @param {Record<string, string|undefined>} env */
export function createLogqKv(env) {
  const url = typeof env.LOGQ_REST_API_URL === 'string' ? env.LOGQ_REST_API_URL : '';
  const token = typeof env.LOGQ_REST_API_TOKEN === 'string' ? env.LOGQ_REST_API_TOKEN : '';
  let origin;
  try { origin = new URL(url); } catch { return null; }
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.upstash.io') || token.length === 0) return null;
  /** @param {unknown[]} command */
  const call = async (command) => {
    const response = await fetch(origin, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: globalThis.AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`kv_status_${response.status}`);
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('result' in payload)) throw new Error('kv_shape');
    return /** @type {{result: unknown}} */ (payload).result;
  };
  return {
    /**
     * Atomically add `count` and (re)apply the TTL in one EVAL round trip.
     * @param {string} key @param {number} count @param {number} ttlSeconds
     */
    async incrBy(key, count, ttlSeconds) {
      const result = await call([
        'EVAL',
        "local v = redis.call('INCRBY', KEYS[1], ARGV[1]) redis.call('EXPIRE', KEYS[1], ARGV[2]) return v",
        '1', key, String(count), String(ttlSeconds),
      ]);
      if (!Number.isSafeInteger(Number(result))) throw new Error('kv_ack');
      return Number(result);
    },
    /** @param {string} key */
    async get(key) {
      const result = await call(['GET', key]);
      return result == null ? 0 : Number(result);
    },
  };
}
