import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  HOSTED_SCHEMA_VERSION,
  GENERAL_SPAN_CATEGORIES,
  FORBIDDEN_SPAN_KEYS,
  HostedSchemaError,
  buildHostedRequest,
  parseHostedResponse,
} from '../../src/backends/patina-hosted-schema.js';

function validResponse(overrides = {}) {
  return {
    schemaVersion: HOSTED_SCHEMA_VERSION,
    text: 'rewritten text',
    spans: [
      { start: 0, end: 5, score: 0.8, category: 'lexicon-density' },
      { start: 6, end: 12, score: 0.3, category: 'burstiness' },
    ],
    ...overrides,
  };
}

describe('patina-hosted schema: request envelope', () => {
  it('builds a versioned request with the current schema version', () => {
    const body = buildHostedRequest({ text: 'draft', lang: 'ko', profile: 'default', model: 'gpt-4o' });
    assert.strictEqual(body.schemaVersion, HOSTED_SCHEMA_VERSION);
    assert.strictEqual(body.text, 'draft');
    assert.strictEqual(body.lang, 'ko');
    assert.strictEqual(body.profile, 'default');
    assert.strictEqual(body.model, 'gpt-4o');
    assert.strictEqual(body.mode, 'humanize');
    assert.deepStrictEqual(body.options, {});
  });

  it('defaults optional fields to null without inventing data', () => {
    const body = buildHostedRequest({ text: 'draft' });
    assert.strictEqual(body.lang, null);
    assert.strictEqual(body.profile, null);
    assert.strictEqual(body.model, null);
  });

  it('rejects an empty or non-string text', () => {
    assert.throws(() => buildHostedRequest({ text: '' }), HostedSchemaError);
    assert.throws(() => buildHostedRequest({ text: null }), HostedSchemaError);
    assert.throws(() => buildHostedRequest({}), HostedSchemaError);
  });
});

describe('patina-hosted schema: response parsing (scorer-isomorphic)', () => {
  it('parses a valid response into text + offset/score/category spans', () => {
    const parsed = parseHostedResponse(validResponse());
    assert.strictEqual(parsed.text, 'rewritten text');
    assert.strictEqual(parsed.schemaVersion, HOSTED_SCHEMA_VERSION);
    assert.strictEqual(parsed.spans.length, 2);
    assert.deepStrictEqual(parsed.spans[0], { start: 0, end: 5, score: 0.8, category: 'lexicon-density' });
  });

  it('treats missing spans as an empty list (text-only humanize response)', () => {
    const parsed = parseHostedResponse({ schemaVersion: HOSTED_SCHEMA_VERSION, text: 'ok' });
    assert.deepStrictEqual(parsed.spans, []);
  });

  it('only normalizes the contract fields and drops unknown extras on spans', () => {
    const parsed = parseHostedResponse(
      validResponse({ spans: [{ start: 0, end: 3, score: 0.5, category: 'tone', confidence: 0.9 }] })
    );
    assert.deepStrictEqual(Object.keys(parsed.spans[0]).sort(), ['category', 'end', 'score', 'start']);
  });

  it('accepts every documented general category', () => {
    for (const category of GENERAL_SPAN_CATEGORIES) {
      const parsed = parseHostedResponse(validResponse({ spans: [{ start: 0, end: 1, score: 0, category }] }));
      assert.strictEqual(parsed.spans[0].category, category);
    }
  });
});

describe('patina-hosted schema: version mismatch is a hard failure', () => {
  it('fails when schemaVersion is missing', () => {
    const body = validResponse();
    delete body.schemaVersion;
    assert.throws(() => parseHostedResponse(body), /missing schemaVersion/);
  });

  it('fails when the server reports a different schema version', () => {
    assert.throws(
      () => parseHostedResponse(validResponse({ schemaVersion: '2' })),
      /schemaVersion mismatch: expected 1, received 2/
    );
  });

  it('honors an explicit expectedVersion override', () => {
    assert.throws(
      () => parseHostedResponse(validResponse({ schemaVersion: '1' }), { expectedVersion: '9' }),
      /mismatch: expected 9, received 1/
    );
  });
});

describe('patina-hosted schema: internal identifiers stay private', () => {
  for (const key of FORBIDDEN_SPAN_KEYS) {
    it(`rejects a span that leaks "${key}"`, () => {
      const span = { start: 0, end: 4, score: 0.7, category: 'lexicon-density', [key]: 'secret-internal-id' };
      assert.throws(() => parseHostedResponse(validResponse({ spans: [span] })), /forbidden internal identifier/);
    });
  }
});

describe('patina-hosted schema: structural validation', () => {
  it('rejects non-object payloads', () => {
    assert.throws(() => parseHostedResponse(null), /must be a JSON object/);
    assert.throws(() => parseHostedResponse([]), /must be a JSON object/);
  });

  it('rejects a missing text field', () => {
    assert.throws(() => parseHostedResponse({ schemaVersion: HOSTED_SCHEMA_VERSION }), /missing a text string/);
  });

  it('rejects non-array spans', () => {
    assert.throws(() => parseHostedResponse(validResponse({ spans: { start: 0 } })), /spans must be an array/);
  });

  it('rejects an unknown category', () => {
    assert.throws(
      () => parseHostedResponse(validResponse({ spans: [{ start: 0, end: 1, score: 0.5, category: 'lexicon:ko-001' }] })),
      /not a recognized general category/
    );
  });

  it('rejects negative or non-integer offsets', () => {
    assert.throws(
      () => parseHostedResponse(validResponse({ spans: [{ start: -1, end: 1, score: 0.5, category: 'tone' }] })),
      /invalid start offset/
    );
    assert.throws(
      () => parseHostedResponse(validResponse({ spans: [{ start: 1.5, end: 2, score: 0.5, category: 'tone' }] })),
      /invalid start offset/
    );
  });

  it('rejects an end offset before the start', () => {
    assert.throws(
      () => parseHostedResponse(validResponse({ spans: [{ start: 5, end: 2, score: 0.5, category: 'tone' }] })),
      /invalid end offset/
    );
  });

  it('rejects scores outside the [0, 1] range', () => {
    assert.throws(
      () => parseHostedResponse(validResponse({ spans: [{ start: 0, end: 1, score: 1.5, category: 'tone' }] })),
      /score must be a number in \[0, 1\]/
    );
    assert.throws(
      () => parseHostedResponse(validResponse({ spans: [{ start: 0, end: 1, score: -0.1, category: 'tone' }] })),
      /score must be a number in \[0, 1\]/
    );
  });
});
