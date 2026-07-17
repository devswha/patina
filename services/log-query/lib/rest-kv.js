// @ts-check
// Minimal Upstash-compatible REST adapter for the log-query counters. The
// service owns a dedicated store; it never touches the quota/admission KV or
// the monitor's strict observability store. All multi-key operations use a
// single round trip so ingestion commits all-or-nothing and queries read one
// coherent snapshot.

// Applies every increment and its TTL atomically in one script invocation.
// KEYS = counter keys; ARGV = one count per key followed by the TTL.
const INCR_ALL_SCRIPT = [
  'local ttl = ARGV[#ARGV]',
  'for i = 1, #KEYS do',
  "  redis.call('INCRBY', KEYS[i], ARGV[i])",
  "  redis.call('EXPIRE', KEYS[i], ttl)",
  'end',
  'return #KEYS',
].join(' ');

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
     * Apply every `{key, count}` increment and the TTL in ONE atomic EVAL.
     * Throws on any transport or acknowledgement failure so the caller can
     * refuse the delivery instead of committing a partial batch.
     * @param {Array<{key: string, count: number}>} increments @param {number} ttlSeconds
     */
    async incrAll(increments, ttlSeconds) {
      if (increments.length === 0) return 0;
      const keys = increments.map(({ key }) => key);
      const counts = increments.map(({ count }) => String(count));
      const result = await call(['EVAL', INCR_ALL_SCRIPT, String(keys.length), ...keys, ...counts, String(ttlSeconds)]);
      if (Number(result) !== keys.length) throw new Error('kv_ack');
      return keys.length;
    },
    /**
     * Read all keys in ONE MGET round trip. Returns the raw per-key values
     * (string or null) for strict validation by the caller.
     * @param {string[]} keys
     */
    async getMany(keys) {
      if (keys.length === 0) return [];
      const result = await call(['MGET', ...keys]);
      if (!Array.isArray(result) || result.length !== keys.length) throw new Error('kv_shape');
      return result;
    },
  };
}
