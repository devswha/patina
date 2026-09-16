import test from 'node:test';
import assert from 'node:assert/strict';

import { assessPortability } from '../../src/features/portability.js';

// #881 (parent #878): a sentence is "portable" when swapping the product, company
// or person would leave it equally true — the no-POV filler the field notes
// describe. Detect-only by design: docs/research/2026-rewrite-efficacy-study4.md
// tested a rewrite-side specificity constraint (H-4b) and it was NOT supported,
// violating the meaning gate at 50/54, so nothing here touches rewrite.

const PORTABLE = [
  'Our platform helps teams move faster and work smarter.',
  'We believe great products come from listening to users.',
  'The result is a better experience for everyone involved.',
  'It is about doing the right thing for the long term.',
].join(' ');

const ANCHORED = [
  'Patina cut our rewrite latency from 4.2s to 1.8s in March.',
  'The Redis quota path now fails closed when KV is unreachable.',
  'We kept 12 audit logs per tenant after the Polar migration.',
  'Three teams moved onto the new smoke check that week.',
].join(' ');

test('a paragraph of portable sentences trips the probe', () => {
  const result = assessPortability(PORTABLE, { lang: 'en' });
  assert.ok(result, 'returns an assessment');
  assert.equal(result.trip, true);
  assert.ok(result.ratio >= 0.6, 'ratio ' + result.ratio);
  assert.ok(result.portableCount >= 3);
});

test('anchored prose with numbers and proper nouns does not trip', () => {
  const result = assessPortability(ANCHORED, { lang: 'en' });
  assert.equal(result?.trip ?? false, false);
});

test('a single generic line never trips (README one-liner false positive)', () => {
  const result = assessPortability('Our platform helps teams move faster.', { lang: 'en' });
  assert.equal(result?.trip ?? false, false, 'one sentence is not a pattern');
});

test('a generic opener inside anchored prose does not trip', () => {
  const mixed = 'Our platform helps teams move faster. ' + ANCHORED;
  assert.equal(assessPortability(mixed, { lang: 'en' })?.trip ?? false, false);
});

test('korean portable prose trips and anchored korean does not', () => {
  const koPortable = [
    '우리는 사용자의 목소리를 듣는 것이 중요하다고 믿습니다.',
    '더 나은 경험을 만드는 것이 목표입니다.',
    '결국 중요한 것은 올바른 방향으로 나아가는 것입니다.',
  ].join(' ');
  const koAnchored = [
    'Patina 는 3월에 재작성 지연을 4.2초에서 1.8초로 줄였습니다.',
    'Redis 쿼터 경로는 KV 가 없을 때 닫힙니다.',
    '테넌트당 감사 로그 12개를 유지했습니다.',
  ].join(' ');
  assert.equal(assessPortability(koPortable, { lang: 'ko' })?.trip, true);
  assert.equal(assessPortability(koAnchored, { lang: 'ko' })?.trip ?? false, false);
});

test('assessPortability never throws on junk input', () => {
  assert.equal(assessPortability(null), null);
  assert.equal(assessPortability(''), null);
  assert.equal(assessPortability(undefined, { lang: 'en' }), null);
});
