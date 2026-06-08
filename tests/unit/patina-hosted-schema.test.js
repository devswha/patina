import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  HOSTED_SCHEMA_VERSION,
  GENERAL_SPAN_CATEGORIES,
  HostedSchemaError,
  buildHostedRequest,
  parseHostedResponse,
} from '../../src/backends/patina-hosted-schema.js';

test('buildHostedRequest emits a versioned envelope', () => {
  const body = buildHostedRequest({ text: '초안 텍스트', lang: 'ko' });
  assert.equal(body.schemaVersion, HOSTED_SCHEMA_VERSION);
  assert.equal(body.mode, 'humanize');
  assert.equal(body.text, '초안 텍스트');
  assert.equal(body.lang, 'ko');
});

test('parseHostedResponse accepts a valid scored span', () => {
  const { spans } = parseHostedResponse({
    schemaVersion: HOSTED_SCHEMA_VERSION,
    text: 'x',
    spans: [{ start: 0, end: 1, score: 0.5, category: 'burstiness' }],
  });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].category, 'burstiness');
});

test('parseHostedResponse rejects forbidden internal identifiers', () => {
  assert.throws(
    () =>
      parseHostedResponse({
        schemaVersion: HOSTED_SCHEMA_VERSION,
        text: 'x',
        spans: [{ start: 0, end: 1, score: 0.5, category: 'other', lexiconId: 'secret' }],
      }),
    HostedSchemaError,
  );
});

test('parseHostedResponse rejects out-of-range score, bad offset, unknown category, and version mismatch', () => {
  assert.throws(
    () => parseHostedResponse({ schemaVersion: HOSTED_SCHEMA_VERSION, text: 'x', spans: [{ start: 0, end: 1, score: 1.5, category: 'other' }] }),
    HostedSchemaError,
  );
  assert.throws(
    () => parseHostedResponse({ schemaVersion: HOSTED_SCHEMA_VERSION, text: 'x', spans: [{ start: -1, end: 1, score: 0.5, category: 'other' }] }),
    HostedSchemaError,
  );
  assert.throws(
    () => parseHostedResponse({ schemaVersion: HOSTED_SCHEMA_VERSION, text: 'x', spans: [{ start: 0, end: 1, score: 0.5, category: 'nope' }] }),
    HostedSchemaError,
  );
  assert.throws(
    () => parseHostedResponse({ schemaVersion: '2', text: 'x', spans: [] }),
    HostedSchemaError,
  );
});

test('parseHostedResponse preserves only public span fields', () => {
  const parsed = parseHostedResponse({
    schemaVersion: HOSTED_SCHEMA_VERSION,
    text: 'xx',
    spans: [{ start: 0, end: 1, score: 0.7, category: 'other', note: 'public metadata is stripped' }],
  });
  assert.deepEqual(parsed.spans[0], { start: 0, end: 1, score: 0.7, category: 'other' });
});

test('buildHostedRequest rejects malformed input explicitly', () => {
  assert.throws(() => buildHostedRequest({ text: '' }), HostedSchemaError);
  assert.throws(() => buildHostedRequest({ text: 'x', lang: '' }), HostedSchemaError);
  assert.throws(() => buildHostedRequest(), HostedSchemaError);
});

test('every general category is accepted', () => {
  for (const category of GENERAL_SPAN_CATEGORIES) {
    const { spans } = parseHostedResponse({
      schemaVersion: HOSTED_SCHEMA_VERSION,
      text: 'x',
      spans: [{ start: 0, end: 1, score: 0.1, category }],
    });
    assert.equal(spans[0].category, category);
  }
});
