import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPersona } from '../../src/personas/loader.js';
import { extractPersonaFeatureVector, personaMatchScore } from '../../src/features/persona-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function personaWithAvoid() {
  const persona = loadPersona(REPO_ROOT, 'ko', 'preserve');
  return {
    ...persona,
    blocks: {
      ...persona.blocks,
      preferredWords: {
        active: true,
        allow: ['현실적으로'],
        avoid: ['혁신적인'],
        density: { targetPer1000Tokens: 1, maxPerParagraph: 1 },
      },
    },
    targetFeatures: {
      burstiness_cv: { target: 0.5, tolerance: 0.3, weight: 0.1 },
      mattr: { target: 0.7, tolerance: 0.3, weight: 0.1 },
      lexicon_density_avoid: { target: 0, tolerance: 1, weight: 0.2 },
      sentence_opener_diversity: { target: 0.6, tolerance: 0.3, weight: 0.1 },
      ko_register_plain_ratio: { target: 0.5, tolerance: 0.5, weight: 0.1 },
      ko_register_polite_ratio: { target: 0.5, tolerance: 0.5, weight: 0.1 },
      comma_per_sentence: { target: 0.2, tolerance: 0.5, weight: 0.1 },
      suffix_class_diversity: { target: 0.4, tolerance: 0.3, weight: 0.1 },
      overEditChurn: { max: 0.45, weight: 0.1 },
    },
  };
}

test('persona match score is deterministic and exposes expected features', () => {
  const persona = personaWithAvoid();
  const text = '현실적으로 먼저 확인합니다. 비용을 줄이고 병목을 봅니다. 다음 액션을 정합니다.';
  const first = personaMatchScore({ text, persona, lang: 'ko', repoRoot: REPO_ROOT, original: text });
  const second = personaMatchScore({ text, persona, lang: 'ko', repoRoot: REPO_ROOT, original: text });
  assert.deepEqual(second, first);
  for (const key of [
    'burstiness_cv',
    'mattr',
    'sentence_opener_diversity',
    'comma_per_sentence',
    'suffix_class_diversity',
    'ko_register_plain_ratio',
    'ko_register_polite_ratio',
    'lexicon_density_preferred',
    'lexicon_density_avoid',
  ]) {
    assert.ok(Object.hasOwn(first.featureVector, key), `missing ${key}`);
  }
});

test('avoid lexicon overuse produces a persona-match penalty', () => {
  const persona = personaWithAvoid();
  const text = '혁신적인 혁신적인 혁신적인 혁신적인 결과입니다. 혁신적인 방향입니다.';
  const result = personaMatchScore({ text, persona, lang: 'ko', repoRoot: REPO_ROOT });
  assert.ok(result.avoidDensityPenalty > 0);
});

test('persona-match module imports stylometry API through feature index', () => {
  const vector = extractPersonaFeatureVector('문장을 씁니다. 설명합니다. 마무리합니다.', {
    lang: 'ko',
    repoRoot: REPO_ROOT,
    persona: personaWithAvoid(),
  });
  assert.equal(typeof vector.ko_register_polite_ratio, 'number');
});
