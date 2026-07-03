import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPersonas, loadPersona } from '../../src/personas/loader.js';
import { PERSONA_DEPTHS } from '../../src/personas/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const SEED_PERSONAS = [
  'blog-essay',
  'pragmatic-founder',
  'technical-explainer',
  'soft-professional',
  'natural-ko',
];

test('ko persona library includes preserve plus five v1 seeds', () => {
  const personas = listPersonas(REPO_ROOT, 'ko');

  assert.equal(personas.length, 6);
  assert.deepEqual(personas, [
    'blog-essay',
    'natural-ko',
    'pragmatic-founder',
    'preserve',
    'soft-professional',
    'technical-explainer',
  ]);
});

test('seed personas load through schema validation with safe depth and inactive worldview', () => {
  for (const id of SEED_PERSONAS) {
    const persona = loadPersona(REPO_ROOT, 'ko', id);

    assert.equal(persona.schema, 'patina.persona.v1');
    assert.equal(persona.id, id);
    assert.equal(persona.lang, 'ko');
    assert.equal(persona.source, 'library');
    assert.ok(PERSONA_DEPTHS.includes(persona.depth));
    assert.equal(persona.mps.enforce, true);
    assert.equal(persona.mps.floor, 70);
    assert.equal(persona.fidelity.enforce, true);
    assert.equal(persona.fidelity.floor, 70);
    assert.equal(persona.blocks.worldview.active, false);
  }
});

const NON_KO_SEEDS = {
  en: ['blog-essay', 'natural-en', 'technical-explainer'],
  zh: ['blog-essay', 'natural-zh'],
  ja: ['blog-essay', 'natural-ja'],
};

// Language-neutral persona-match feature keys. en/zh/ja seeds MUST draw target
// features ONLY from this set — the ko-specific keys (ko_register_plain_ratio,
// ko_register_polite_ratio, suffix_class_diversity) degrade on non-ko text.
const NEUTRAL_TARGET_FEATURES = new Set([
  'burstiness_cv',
  'mattr',
  'sentence_opener_diversity',
  'comma_per_sentence',
  'lexicon_density_preferred',
  'lexicon_density_avoid',
  'over_edit_churn',
  'overEditChurn',
]);

const KO_SPECIFIC_TARGET_FEATURES = ['ko_register_plain_ratio', 'ko_register_polite_ratio', 'suffix_class_diversity'];

for (const [lang, seeds] of Object.entries(NON_KO_SEEDS)) {
  test(`${lang} persona library includes preserve plus its v1 seeds`, () => {
    const personas = listPersonas(REPO_ROOT, lang);
    assert.deepEqual(personas, [...seeds, 'preserve'].sort());
  });

  test(`${lang} seed personas load through schema validation with safe depth and inactive worldview`, () => {
    for (const id of seeds) {
      const persona = loadPersona(REPO_ROOT, lang, id);
      assert.equal(persona.schema, 'patina.persona.v1');
      assert.equal(persona.id, id);
      assert.equal(persona.lang, lang);
      assert.equal(persona.source, 'library');
      assert.ok(PERSONA_DEPTHS.includes(persona.depth));
      assert.equal(persona.mps.enforce, true);
      assert.equal(persona.mps.floor >= 70, true);
      assert.equal(persona.fidelity.enforce, true);
      assert.equal(persona.fidelity.floor >= 70, true);
      assert.equal(persona.blocks.worldview.active, false);
    }
  });

  test(`${lang} seeds use only language-neutral target_features (no ko-specific keys)`, () => {
    for (const id of seeds) {
      const persona = loadPersona(REPO_ROOT, lang, id);
      const keys = Object.keys(persona.targetFeatures ?? {});
      assert.ok(keys.length > 0, `${lang}/${id} should declare target_features`);
      for (const key of keys) {
        assert.ok(
          NEUTRAL_TARGET_FEATURES.has(key),
          `${lang}/${id} target_features key "${key}" is not language-neutral`
        );
        assert.ok(
          !KO_SPECIFIC_TARGET_FEATURES.includes(key),
          `${lang}/${id} target_features key "${key}" is ko-specific and degrades on non-ko text`
        );
      }
    }
  });
}
