import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  endingDistribution,
  cosineSimilarity,
  registerStability,
  dominantRegister,
} from '../../src/features/register-stability.js';

test('endingDistribution classifies 합쇼체 / 평어체 / 해요체', () => {
  assert.deepEqual(endingDistribution('설치합니다. 호출합니다.'), { hapsho: 2 });
  assert.deepEqual(endingDistribution('끝까지 끌고 간다. 가둘 수 없다.'), { haera: 2 });
  assert.deepEqual(endingDistribution('이렇게 하면 돼요. 참 좋네요.'), { haeyo: 2 });
});

test('identical register mix scores RSS 100', () => {
  const t = '설치합니다. 호출합니다. 검증합니다.';
  assert.equal(registerStability(t, t), 100);
});

test('switching 평어체 -> 존댓말 drops RSS toward 0', () => {
  const plain = '끝까지 끌고 간다. 모델에 묶이지 않는다. 알아서 돈다.';
  const polite = '끝까지 끌고 갑니다. 모델에 묶이지 않습니다. 알아서 돕니다.';
  const rss = registerStability(plain, polite);
  assert.equal(rss, 0, `expected full switch -> 0, got ${rss}`);
});

test('a partial register switch yields a known intermediate RSS', () => {
  // baseline {haera:2}; candidate {haera:1, hapsho:1} -> cosine 2/(2*sqrt2)=0.7071
  const baseline = '간다. 없다.';
  const candidate = '간다. 없습니다.';
  const rss = registerStability(baseline, candidate);
  assert.ok(Math.abs(rss - 70.71) < 0.5, `expected ~70.71, got ${rss}`);
});

test('dominantRegister returns the most frequent bucket', () => {
  assert.equal(dominantRegister('합니다. 합니다. 간다.'), 'hapsho');
  assert.equal(dominantRegister('간다. 없다. 합니다.'), 'haera');
});

test('cosineSimilarity is 0 when a distribution is empty', () => {
  assert.equal(cosineSimilarity({}, { haera: 1 }), 0);
});

test('known limitation: "아니다" classifies as 합쇼체 (~니다), inherited from RSS regex', () => {
  // "아니다" ends in 니다 so the 합쇼체 pattern matches first. This is the same
  // ambiguity patina-max/composite.py has; documented so it is not a surprise.
  assert.deepEqual(endingDistribution('그것은 사실이 아니다.'), { hapsho: 1 });
});
