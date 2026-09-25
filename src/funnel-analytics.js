// @ts-check

export const FUNNEL_SCHEMA_VERSION = 'v1';

// A separate compact projection avoids multiplying the detailed rewrite keys
// by acquisition dimensions. At most 4 * 5 * 2 * 3 = 120 keys per UTC day.
export const FUNNEL_PROGRESS_SCHEMA = Object.freeze({
  lang: Object.freeze(['en', 'ko', 'zh', 'ja']),
  channel: Object.freeze(['unattributed', 'github', 'blog', 'social', 'community']),
  campaign: Object.freeze(['none', 'multilingual-20260907']),
  stage: Object.freeze(['arrival', 'first-success', 'reuse']),
});

const eventSchemas = {
  'Funnel Progress': FUNNEL_PROGRESS_SCHEMA,
  'Input Started': { surface: ['hero', 'chat'], lang: ['en', 'ko', 'zh', 'ja'] },
  'Rewrite Requested': { surface: ['hero', 'chat'], lang: ['en', 'ko', 'zh', 'ja'], tier: ['free', 'pro', 'byok'], mode: ['first', 'refine', 'verify'], inputBucket: ['0-99', '100-499', '500-1999', '2000+'] },
  'Rewrite Completed': { surface: ['hero', 'chat'], lang: ['en', 'ko', 'zh', 'ja'], tier: ['free', 'pro', 'byok'], mode: ['first', 'refine', 'verify'], inputBucket: ['0-99', '100-499', '500-1999', '2000+'], latencyBucket: ['<5s', '5-10s', '10-30s', '30s+'], mpsBand: ['failed', '70-79', '80-89', '90-100'], fidelityBand: ['failed', '70-79', '80-89', '90-100'] },
  'Rewrite Failed': { surface: ['hero', 'chat'], lang: ['en', 'ko', 'zh', 'ja'], tier: ['free', 'pro', 'byok'], mode: ['first', 'refine', 'verify'], inputBucket: ['0-99', '100-499', '500-1999', '2000+'], latencyBucket: ['<5s', '5-10s', '10-30s', '30s+'], outcome: ['preflight', 'stream', 'number-safety', 'scoring', 'floor', 'cancelled', 'quota', 'concurrency', 'service', 'input', 'auth', 'unknown'] },
  'Result Action': { action: ['copy', 'download', 'export', 'audit'] },
  'Checkout Started': { surface: ['pricing', 'quota'], lang: ['en', 'ko', 'zh', 'ja'] },
  'Tier Selected': { tier: ['free', 'pro', 'byok'], surface: ['pricing', 'controls'] },
};

const eventSlugs = {
  'Funnel Progress': 'funnel-progress',
  'Input Started': 'input-started',
  'Rewrite Requested': 'rewrite-requested',
  'Rewrite Completed': 'rewrite-completed',
  'Rewrite Failed': 'rewrite-failed',
  'Result Action': 'result-action',
  'Checkout Started': 'checkout-started',
  'Tier Selected': 'tier-selected',
};

/** @param {unknown} value */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Returns true only for a complete, exact allowlisted categorical event.
 * @param {unknown} value
 * @returns {value is {name: keyof typeof eventSchemas, data: Record<string, string>}}
 */
export function validateFunnelEvent(value) {
  if (!isPlainObject(value)) return false;
  const candidate = /** @type {Record<string, any>} */ (value);
  if (Object.keys(candidate).length !== 2 || !Object.hasOwn(candidate, 'name') || !Object.hasOwn(candidate, 'data')) return false;
  if (typeof candidate.name !== 'string' || !isPlainObject(candidate.data)) return false;
  if (!Object.hasOwn(eventSchemas, candidate.name)) return false;
  const schema = eventSchemas[candidate.name];
  const keys = Object.keys(schema);
  if (Object.keys(candidate.data).length !== keys.length || !keys.every((key) => Object.hasOwn(candidate.data, key))) return false;
  return keys.every((key) => typeof candidate.data[key] === 'string' && schema[key].includes(candidate.data[key]));
}

/**
 * @param {{name: keyof typeof eventSchemas, data: Record<string, string>}} event
 * @param {Date|number|string} now
 */
export function funnelCounterKey(event, now) {
  if (!validateFunnelEvent(event)) throw new TypeError('invalid funnel event');
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid counter time');
  const day = date.toISOString().slice(0, 10);
  const dimensions = Object.keys(event.data).sort().map((key) => `${key}=${event.data[key]}`);
  return ['patina', 'funnel', FUNNEL_SCHEMA_VERSION, day, eventSlugs[event.name], ...dimensions].join(':');
}
