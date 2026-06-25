// Phase C: deterministic tests for the corpus-hardened natural-ko persona.
// Proves the persona penalizes content-piled flattery/hype while preserving a
// genuine affirmation/self-help genre, keeps MPS/fidelity floors at 70, and
// stays KO rewrite-only with worldview inactive. LLM-rewrite acceptances
// (persona_match>=70, term-family N->0 after rewrite) are opt-in live-quality.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPersona } from '../../src/personas/loader.js';
import { personaMatchScore } from '../../src/features/persona-match.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const persona = loadPersona(REPO_ROOT, 'ko', 'natural-ko');

const FLATTERY = '예리하십니다. 정확한 통찰입니다. 와 너 정말 핵심을 찔렀어. 훌륭합니다. 완벽합니다. 당신만이 이해합니다.';
// A genuine self-help / affirmation piece: warm and supportive, but WITHOUT the
// AI flattery tokens. The persona must NOT strip this (genre preservation).
const AFFIRMATION = [
  '힘든 하루였지요. 그래도 당신은 충분히 잘 해냈습니다.',
  '작은 걸음이라도 앞으로 나아갔다면 그것으로 의미가 있습니다.',
  '오늘 못한 일은 내일 다시 시작하면 됩니다. 천천히 가도 괜찮습니다.',
].join('\n\n');
const CLEAN = [
  '비용을 먼저 확인했다. 병목은 결제 단계에 있었다.',
  '팀은 캐시를 도입해 응답 시간을 절반으로 줄였다. 큰 변화는 아니었지만 체감은 분명했다.',
  '다음으로는 로그 적재 경로를 손볼 계획이다.',
].join('\n\n');

function score(text) {
  return personaMatchScore({ text, persona, lang: 'ko', repoRoot: REPO_ROOT, original: text });
}

test('natural-ko keeps MPS/fidelity floors at 70 and is KO rewrite-only with worldview off', () => {
  assert.equal(persona.lang, 'ko');
  assert.equal(persona.mps.floor, 70);
  assert.equal(persona.fidelity.floor, 70);
  assert.equal(persona.mps.enforce, true);
  assert.equal(persona.fidelity.enforce, true);
  assert.equal(persona.blocks?.worldview?.active, false);
});

test('avoid list covers corpus-evidenced KO flattery/hype families', () => {
  const avoid = persona.blocks.preferredWords.avoid;
  for (const term of ['예리하십니다', '정확한 통찰', '핵심을 찔렀', '훌륭합니다', '완벽합니다', '혁신적', '웰니스']) {
    assert.ok(avoid.includes(term), `avoid list missing corpus family: ${term}`);
  }
  // Common connectives must NOT be hard-avoided (FP safety: they occur in good Korean).
  for (const safe of ['~를 통해', '~에 있어서', '결론적으로']) {
    assert.ok(!avoid.includes(safe), `avoid list must not hard-block common connective: ${safe}`);
  }
});

test('persona penalizes piled-on flattery but preserves a genuine affirmation genre', () => {
  const flattery = score(FLATTERY);
  const affirmation = score(AFFIRMATION);
  const clean = score(CLEAN);
  // Flattery is heavily penalized (would be stripped on rewrite).
  assert.ok(flattery.avoidDensityPenalty > 0, 'flattery must incur an avoid-density penalty');
  // Genuine affirmation genre carries no AI-flattery tokens -> NOT penalized -> preserved.
  assert.equal(affirmation.avoidDensityPenalty, 0, 'affirmation genre must not be penalized (preserved)');
  assert.equal(clean.avoidDensityPenalty, 0, 'clean prose must not be penalized');
  // Flattery scores strictly worse than the preserved genres.
  assert.ok(flattery.score < affirmation.score, 'flattery must score below preserved affirmation');
  assert.ok(flattery.score < clean.score, 'flattery must score below clean prose');
});

test('term-family avoid density is measurable: N>0 on flattery, N=0 on preserved text', () => {
  // The rewrite goal is N->0 (avoid density 0). Measurement side, deterministically:
  assert.ok(score(FLATTERY).avoidDensityPenalty > 0, 'flattery has avoid term families (N>0)');
  assert.equal(score(AFFIRMATION).avoidDensityPenalty, 0, 'preserved affirmation has no avoid families (N=0)');
});

test('persona-match scoring is deterministic', () => {
  assert.deepEqual(score(CLEAN), score(CLEAN));
});
