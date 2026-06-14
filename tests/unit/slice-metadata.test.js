import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { mapGenerator, mapEdited, resolveSliceFields } from '../quality/slice-metadata.mjs';
import { UNSPECIFIED } from '../quality/slice-metrics.mjs';

test('mapGenerator: explicit field wins, then model_family alias, then class default', () => {
  // model_family alias maps through.
  assert.equal(mapGenerator({ class: 'ai-like', model_family: 'gpt-family' }), 'gpt-family');
  // explicit B2-native generator wins over the alias.
  assert.equal(mapGenerator({ class: 'ai-like', generator: 'claude-family', model_family: 'gpt-family' }), 'claude-family');
  // human controls default to 'human'.
  assert.equal(mapGenerator({ class: 'natural-human' }), 'human');
  assert.equal(mapGenerator({ class: 'natural' }), 'human');
  // AI row with no recorded model stays unknown (not a fabricated model).
  assert.equal(mapGenerator({ class: 'ai-like' }), UNSPECIFIED);
  assert.equal(mapGenerator({}), UNSPECIFIED);
});

test('mapEdited: explicit field wins, then edit_depth alias, then class default', () => {
  assert.equal(mapEdited({ class: 'ai-like', edit_depth: 'light' }), 'light');
  assert.equal(mapEdited({ class: 'ai-like', edit_depth: 'heavy' }), 'heavy');
  // explicit B2-native edited wins over the alias.
  assert.equal(mapEdited({ class: 'ai-like', edited: 'heavy', edit_depth: 'light' }), 'heavy');
  // un-edited classes default to 'none' (a natural row never fabricates edited-AI support).
  assert.equal(mapEdited({ class: 'natural-human' }), 'none');
  assert.equal(mapEdited({ class: 'ai-like' }), 'none');
  // genuinely unknown class stays unspecified.
  assert.equal(mapEdited({ class: 'mystery' }), UNSPECIFIED);
  assert.equal(mapEdited({}), UNSPECIFIED);
});

test('resolveSliceFields maps generator/edited and passes register/domain through', () => {
  assert.deepEqual(
    resolveSliceFields({ class: 'ai-like', register: 'product-doc', model_family: 'gpt-family', edit_depth: 'light' }),
    { register: 'product-doc', domain: UNSPECIFIED, generator: 'gpt-family', edited: 'light' },
  );
  // natural-human fixture with no provenance -> human / none, register/domain unspecified.
  assert.deepEqual(
    resolveSliceFields({ class: 'natural-human' }),
    { register: UNSPECIFIED, domain: UNSPECIFIED, generator: 'human', edited: 'none' },
  );
  // explicit B2-native fields are preserved verbatim.
  assert.deepEqual(
    resolveSliceFields({ class: 'ai-like', register: 'blog', domain: 'news', generator: 'open-weight', edited: 'heavy' }),
    { register: 'blog', domain: 'news', generator: 'open-weight', edited: 'heavy' },
  );
});
