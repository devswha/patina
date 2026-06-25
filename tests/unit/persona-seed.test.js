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
