import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  METRIC_FIELDS,
  latencyBucket,
  charBucket,
  buildRewriteMetric,
  sanitizeMetric,
} from '../../src/web-observability.js';

test('latencyBucket and charBucket map to coarse bands (no raw values)', () => {
  assert.equal(latencyBucket(10), '<250ms');
  assert.equal(latencyBucket(500), '250ms-1s');
  assert.equal(latencyBucket(2000), '1s-3s');
  assert.equal(latencyBucket(5000), '3s-10s');
  assert.equal(latencyBucket(99999), '>10s');
  assert.equal(latencyBucket(-1), 'unknown');
  assert.equal(latencyBucket('x'), 'unknown');

  assert.equal(charBucket(100), '<500');
  assert.equal(charBucket(1500), '500-2k');
  assert.equal(charBucket(3000), '2k-4k');
  assert.equal(charBucket(9000), '4k-20k');
  assert.equal(charBucket(50000), '>20k');
  assert.equal(charBucket(-5), 'unknown');
});

test('buildRewriteMetric emits ONLY allowlisted sanitized fields', () => {
  const m = buildRewriteMetric({
    tier: 'byok', provider: 'openai', model: 'gpt-5.5', status: 200, latencyMs: 1200, quotaDecision: 'allowed', charCount: 1800,
  });
  assert.deepEqual(Object.keys(m).sort(), [...METRIC_FIELDS].sort());
  assert.equal(m.tier, 'byok');
  assert.equal(m.latencyBucket, '1s-3s');
  assert.equal(m.charBucket, '500-2k');
  assert.equal(m.status, 200);
});

test('buildRewriteMetric NEVER leaks text/prompt/output/apiKey/Authorization/full-IP even if passed', () => {
  const m = buildRewriteMetric(/** @type {any} */ ({
    tier: 'free', provider: 'openai', model: 'gpt-5.5', status: 200, latencyMs: 100, charCount: 50,
    // hostile extras that must be ignored:
    text: 'the user pasted secret prose',
    prompt: 'full patina prompt with the document',
    output: 'the rewritten text',
    apiKey: 'sk-should-not-appear-123456',
    authorization: 'Bearer sk-should-not-appear-123456',
    ip: '203.0.113.42',
    headers: { authorization: 'Bearer sk-x' },
  }));
  const json = JSON.stringify(m);
  for (const leak of ['secret prose', 'patina prompt', 'rewritten text', 'sk-should-not-appear', '203.0.113.42']) {
    assert.doesNotMatch(json, new RegExp(leak), `${leak} must not appear in the metric`);
  }
  // Only allowlisted keys exist.
  for (const k of Object.keys(m)) assert.ok(METRIC_FIELDS.includes(k), `unexpected metric field ${k}`);
});

test('buildRewriteMetric normalizes unknown tier/provider/model/status defensively', () => {
  const m = buildRewriteMetric({});
  assert.equal(m.tier, 'unknown');
  assert.equal(m.provider, 'unknown');
  assert.equal(m.model, 'unknown');
  assert.equal(m.status, 0);
  assert.equal(m.latencyBucket, 'unknown');
  assert.equal(m.charBucket, 'unknown');
  assert.equal(m.quotaDecision, 'n/a');
});

test('sanitizeMetric drops any non-allowlisted field', () => {
  const out = sanitizeMetric(/** @type {any} */ ({ tier: 'free', status: 200, apiKey: 'sk-x', text: 'secret', evil: 1 }));
  assert.deepEqual(Object.keys(out).sort(), ['status', 'tier']);
  assert.doesNotMatch(JSON.stringify(out), /sk-x|secret/);
});
