import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPersona } from '../../src/personas/loader.js';
import { validatePersona } from '../../src/personas/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function validFrontmatter(overrides = {}) {
  return {
    schema: 'patina.persona.v1',
    id: 'preserve',
    name: '원문 의미 보존',
    lang: 'ko',
    source: 'library',
    depth: 'style-only',
    persona_depth_directive: {
      content_scope: 'emphasis-and-coverage-only',
      mps_advisory: false,
      fidelity_advisory: false,
    },
    mps: { enforce: true, floor: 70 },
    fidelity: { enforce: true, floor: 70 },
    blocks: {
      preferred_words: { active: false, allow: [], avoid: [] },
      preferred_metaphors: { active: false, allow: [], forbid_new_facts: true },
      explanation_habits: { active: false, moves: [], avoid: [] },
      sentence_structure: { active: false },
      worldview: { active: false },
    },
    target_features: {},
    ...overrides,
  };
}

function assertInputError(fn) {
  assert.throws(fn, (err) => err?.exitCode === 2);
}

test('valid preserve persona loads and normalizes without body', () => {
  const persona = loadPersona(REPO_ROOT, 'ko', 'preserve');
  assert.equal(persona.schema, 'patina.persona.v1');
  assert.equal(persona.id, 'preserve');
  assert.equal(persona.depth, 'style-only');
  assert.equal(persona.mps.enforce, true);
  assert.equal(persona.fidelity.enforce, true);
  assert.equal(persona.blocks.worldview.active, false);
  assert.equal(Object.hasOwn(persona, 'body'), false);
});

test('persona schema rejects safety weakening and malformed fields', () => {
  assertInputError(() => validatePersona(validFrontmatter({ disable_mps: true }), { id: 'preserve', lang: 'ko' }));
  assertInputError(() => validatePersona(validFrontmatter({ blocks: { worldview: { active: true } } }), { id: 'preserve', lang: 'ko' }));
  assertInputError(() => validatePersona(validFrontmatter({ mps: { enforce: false, floor: 70 } }), { id: 'preserve', lang: 'ko' }));
  assertInputError(() => validatePersona(validFrontmatter({ mps: { enforce: true, floor: 60 } }), { id: 'preserve', lang: 'ko' }));
  assertInputError(() => validatePersona(validFrontmatter({ depth: 'deep' }), { id: 'preserve', lang: 'ko' }));
  assertInputError(() => validatePersona(validFrontmatter({ id: 'other' }), { id: 'preserve', lang: 'ko' }));
  assertInputError(() => validatePersona(validFrontmatter({
    persona_depth_directive: {
      content_scope: 'emphasis-and-coverage-only',
      mps_advisory: true,
      fidelity_advisory: false,
    },
  }), { id: 'preserve', lang: 'ko' }));
});
