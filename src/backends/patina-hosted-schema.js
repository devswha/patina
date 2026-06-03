// Versioned wire contract shared by the public `patina-hosted` adapter and the
// private hosted server. The adapter only ever knows this schema; it never sees
// the server's internal lexicon entries or pattern rule identifiers.
//
// The response is *isomorphic to the open-baseline scorer*: spans carry an
// offset range, a numeric score, and a GENERAL category that mirrors the
// deterministic signal families in `src/features/*`. The wire format
// deliberately withholds the internal identifiers that would let a client
// reconstruct the private assets — see README "Open Core vs Hosted".

// Bump only on a breaking wire change. A client/server version mismatch is a
// hard failure (no silent best-effort parse), so an old client never silently
// misreads a newer server payload, and a newer client never accepts a stale
// one. See the plan ADR follow-up on a version field + mismatch fail.
export const HOSTED_SCHEMA_VERSION = '1';

// General, non-revealing span categories. These mirror the open-baseline
// deterministic signal families (burstiness, lexical diversity, lexicon
// density, markup leakage, discourse tells, formatting, tone) WITHOUT exposing
// which internal lexicon entry or pattern rule fired. `other` is the catch-all.
export const GENERAL_SPAN_CATEGORIES = Object.freeze([
  'burstiness',
  'lexical-diversity',
  'lexicon-density',
  'markup-leakage',
  'discourse',
  'formatting',
  'tone',
  'other',
]);

// Span keys that would leak the private assets if a server ever attached them.
// The parser rejects any span carrying one of these so a server-side regression
// cannot quietly start shipping internal identifiers to public clients.
export const FORBIDDEN_SPAN_KEYS = Object.freeze([
  'lexiconId',
  'lexicon_id',
  'lexiconEntry',
  'patternId',
  'pattern_id',
  'patternRule',
  'ruleId',
  'rule_id',
  'lexicon',
  'pattern',
  'corpus',
  'corpusId',
]);

/**
 * Error raised when a hosted request/response violates the versioned contract.
 *
 * @param {string} message Human-readable contract violation.
 * @example
 * throw new HostedSchemaError('hosted response is missing schemaVersion');
 */
export class HostedSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostedSchemaError';
  }
}

/**
 * Build a versioned hosted request envelope.
 *
 * @param {object} options Request fields.
 * @param {string} options.text Source text to humanize/score (required, non-empty).
 * @param {string} [options.lang] Optional language hint (ko|en|zh|ja).
 * @param {string} [options.profile] Optional profile name.
 * @param {string} [options.model] Optional model id forwarded to the server.
 * @param {string} [options.mode='humanize'] Request mode.
 * @param {object} [options.options={}] Opaque server options bag.
 * @returns {{schemaVersion: string, mode: string, text: string, lang: string|null, profile: string|null, model: string|null, options: object}} Versioned request body.
 * @throws {HostedSchemaError} When text is missing or not a non-empty string.
 * @example
 * const body = buildHostedRequest({ text: 'draft', lang: 'ko' });
 */
export function buildHostedRequest({ text, lang, profile, model, mode = 'humanize', options = {} } = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new HostedSchemaError('hosted request requires a non-empty text string');
  }
  return {
    schemaVersion: HOSTED_SCHEMA_VERSION,
    mode,
    text,
    lang: lang ?? null,
    profile: profile ?? null,
    model: model ?? null,
    options,
  };
}

/**
 * Validate and normalize a hosted server response.
 *
 * @param {unknown} payload Parsed JSON response from the hosted server.
 * @param {object} [opts] Parse options.
 * @param {string} [opts.expectedVersion=HOSTED_SCHEMA_VERSION] Schema version the client expects.
 * @returns {{schemaVersion: string, text: string, spans: Array<{start: number, end: number, score: number, category: string}>}} Normalized response.
 * @throws {HostedSchemaError} On version mismatch, missing/invalid fields, leaked internal identifiers, or out-of-range spans.
 * @example
 * const { text, spans } = parseHostedResponse(await res.json());
 */
export function parseHostedResponse(payload, { expectedVersion = HOSTED_SCHEMA_VERSION } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HostedSchemaError('hosted response must be a JSON object');
  }
  const version = payload.schemaVersion;
  if (version === undefined || version === null || version === '') {
    throw new HostedSchemaError('hosted response is missing schemaVersion');
  }
  if (String(version) !== String(expectedVersion)) {
    throw new HostedSchemaError(
      `hosted response schemaVersion mismatch: expected ${expectedVersion}, received ${version}`
    );
  }
  if (typeof payload.text !== 'string') {
    throw new HostedSchemaError('hosted response is missing a text string');
  }
  const rawSpans = payload.spans;
  if (rawSpans !== undefined && rawSpans !== null && !Array.isArray(rawSpans)) {
    throw new HostedSchemaError('hosted response spans must be an array when present');
  }
  const spans = Array.isArray(rawSpans) ? rawSpans.map((span, index) => parseSpan(span, index)) : [];
  return { schemaVersion: String(version), text: payload.text, spans };
}

function parseSpan(span, index) {
  if (!span || typeof span !== 'object' || Array.isArray(span)) {
    throw new HostedSchemaError(`hosted span #${index} must be an object`);
  }
  for (const key of FORBIDDEN_SPAN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(span, key)) {
      throw new HostedSchemaError(
        `hosted span #${index} exposes forbidden internal identifier "${key}"`
      );
    }
  }
  const { start, end, score, category } = span;
  if (!Number.isInteger(start) || start < 0) {
    throw new HostedSchemaError(`hosted span #${index} has an invalid start offset`);
  }
  if (!Number.isInteger(end) || end < start) {
    throw new HostedSchemaError(`hosted span #${index} has an invalid end offset`);
  }
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new HostedSchemaError(`hosted span #${index} score must be a number in [0, 1]`);
  }
  if (!GENERAL_SPAN_CATEGORIES.includes(category)) {
    throw new HostedSchemaError(
      `hosted span #${index} category "${category}" is not a recognized general category`
    );
  }
  return { start, end, score, category };
}
