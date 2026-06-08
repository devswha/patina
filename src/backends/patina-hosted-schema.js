// Public wire contract for optional hosted Patina services. This file is safe to
// publish: it contains only schema validation and generic signal categories, not
// service code, corpora, model weights, lexicon internals, or private IDs.

export const HOSTED_SCHEMA_VERSION = '1';

export const GENERAL_SPAN_CATEGORIES = Object.freeze([
  'burstiness',
  'lexical-diversity',
  'lexicon-density',
  'markup-leakage',
  'discourse',
  'other',
]);

export const FORBIDDEN_SPAN_KEYS = Object.freeze([
  'patternId',
  'patternIds',
  'pattern',
  'patterns',
  'ruleId',
  'ruleIds',
  'lexiconId',
  'lexiconIds',
  'lexicon',
  'match',
  'matches',
  'matchedText',
  'sample',
  'samples',
  'sourceText',
  'debug',
  'internal',
  '_internal',
]);

const CATEGORY_SET = new Set(GENERAL_SPAN_CATEGORIES);
const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_SPAN_KEYS);

export class HostedSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostedSchemaError';
  }
}

function fail(message) {
  throw new HostedSchemaError(message);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertText(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
}

function assertOffset(value, label, textLength) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  if (value < 0 || value > textLength) fail(`${label} must be within text bounds`);
}

function assertScore(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${label} must be a number between 0 and 1`);
  }
}

/**
 * Build a versioned hosted request envelope.
 *
 * @param {{text: string, lang?: string | null, mode?: string}} input Request fields.
 * @returns {{schemaVersion: string, mode: string, text: string, lang?: string}}
 */
export function buildHostedRequest({ text, lang = null, mode = 'humanize' } = {}) {
  assertText(text, 'text');
  if (text.length === 0) fail('text must be non-empty');
  if (typeof mode !== 'string' || mode.length === 0) fail('mode must be a non-empty string');
  if (lang != null && (typeof lang !== 'string' || lang.length === 0)) fail('lang must be a non-empty string when provided');

  const request = {
    schemaVersion: HOSTED_SCHEMA_VERSION,
    mode,
    text,
  };
  if (lang != null) request.lang = lang;
  return request;
}

/**
 * Validate and normalize a hosted response.
 *
 * The response exposes only generic spans. Internal pattern IDs, matched text,
 * lexicon entries, and debug payloads are rejected to keep public API responses
 * decoupled from private implementation details.
 *
 * @param {unknown} body Response JSON body.
 * @returns {{schemaVersion: string, text: string, spans: Array<{start: number, end: number, score: number, category: string}>}}
 */
export function parseHostedResponse(body) {
  assertPlainObject(body, 'hosted response');
  if (String(body.schemaVersion) !== HOSTED_SCHEMA_VERSION) {
    fail(`unsupported schemaVersion: ${body.schemaVersion}`);
  }
  assertText(body.text, 'text');
  if (!Array.isArray(body.spans)) fail('spans must be an array');

  const textLength = body.text.normalize('NFC').length;
  const spans = body.spans.map((span, index) => {
    assertPlainObject(span, `spans[${index}]`);
    for (const key of Object.keys(span)) {
      if (FORBIDDEN_KEY_SET.has(key)) fail(`spans[${index}] contains forbidden internal key: ${key}`);
    }

    assertOffset(span.start, `spans[${index}].start`, textLength);
    assertOffset(span.end, `spans[${index}].end`, textLength);
    if (span.end <= span.start) fail(`spans[${index}].end must be greater than start`);
    assertScore(span.score, `spans[${index}].score`);
    if (!CATEGORY_SET.has(span.category)) fail(`spans[${index}].category is not supported: ${span.category}`);

    return {
      start: span.start,
      end: span.end,
      score: span.score,
      category: span.category,
    };
  });

  return {
    schemaVersion: HOSTED_SCHEMA_VERSION,
    text: body.text,
    spans,
  };
}
