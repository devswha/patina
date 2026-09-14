import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, resolveRhetoricPolicy } from '../../src/prompt-builder.js';

const SIMILAR_WEIGHT = 'replace it with natural phrasing of similar weight';
const FIDELITY_LENGTH = 'the fidelity gate measures character length and full marks require staying within 50-130% of the input';
const H_POLICY = /do not keep those phrases just because they appear in the source/i;
const BURSTINESS_RE = /4\. Burstiness —[\s\S]*?\n\n\*\*Skip if\*\*/;
const MINIMAL_RHYTHM_EN = 'Also fix the sentence rhythm. AI text keeps every sentence nearly the same length';
const MINIMAL_RHYTHM_KO = '문장 리듬도 반드시 다듬어. AI 글은 문장 길이가 자로 잰 듯 비슷한데';

const patterns = [
  {
    file: 'en-structure.md',
    isStructure: true,
    isScoreOnly: false,
    frontmatter: { pack: 'en-structure' },
    body: '### 1. Metronomic Paragraph Rhythm\n**Watch words:** firstly, secondly\n',
  },
  {
    file: 'en-content.md',
    isStructure: false,
    isScoreOnly: false,
    frontmatter: { pack: 'en-content' },
    body: '### 4. Promotional Adjectives\n**Watch words:** transformative, robust\n',
  },
];

const BASE = {
  config: { language: 'en', documentType: 'default' },
  patterns,
  documentType: null,
  voice: null,
  scoring: null,
  text: 'Last month users grew from 100 to 300.',
  mode: 'rewrite',
};

function burstinessBlock(prompt) {
  const match = prompt.match(BURSTINESS_RE);
  assert.ok(match, 'expected the CV/burstiness instruction block');
  return match[0];
}

describe('resolveRhetoricPolicy', () => {
  it('defaults unless PATINA_RHETORIC_POLICY is exactly h-rhetoric', () => {
    assert.equal(resolveRhetoricPolicy({}), 'default');
    assert.equal(resolveRhetoricPolicy({ PATINA_RHETORIC_POLICY: 'default' }), 'default');
    assert.equal(resolveRhetoricPolicy({ PATINA_RHETORIC_POLICY: 'other' }), 'default');
    assert.equal(resolveRhetoricPolicy({ PATINA_RHETORIC_POLICY: 'h-rhetoric' }), 'h-rhetoric');
  });
});

describe('buildPrompt rhetoricPolicy', () => {
  it('keeps the similar-weight / fidelity-length sentence on the default path', () => {
    const omitted = buildPrompt(BASE);
    const explicit = buildPrompt({ ...BASE, rhetoricPolicy: 'default' });
    assert.equal(omitted, explicit);
    assert.match(omitted, new RegExp(FIDELITY_LENGTH));
    assert.match(omitted, new RegExp(SIMILAR_WEIGHT));
    assert.doesNotMatch(omitted, H_POLICY);
  });

  it('replaces only the rhetoric edit policy when rhetoricPolicy is h-rhetoric', () => {
    const prompt = buildPrompt({ ...BASE, rhetoricPolicy: 'h-rhetoric' });
    assert.match(prompt, new RegExp(FIDELITY_LENGTH));
    assert.match(prompt, H_POLICY);
    assert.match(prompt, /Keep the document purpose and register/);
    assert.match(prompt, /If a phrase is the only carrier of intensity/);
    assert.doesNotMatch(prompt, new RegExp(SIMILAR_WEIGHT));
    assert.doesNotMatch(prompt, /폭발적으로/);
  });

  it('leaves CV/burstiness text unchanged between default and h-rhetoric', () => {
    const def = buildPrompt(BASE);
    const variant = buildPrompt({ ...BASE, rhetoricPolicy: 'h-rhetoric' });
    assert.equal(burstinessBlock(def), burstinessBlock(variant));
    assert.match(def, /CV < 0\.30/);
    assert.match(def, /targeting CV ≥ 0\.35/);
    assert.match(variant, /CV < 0\.30/);
    assert.match(variant, /targeting CV ≥ 0\.35/);
  });

  it('applies the same isolated swap on the English minimal prompt', () => {
    const def = buildPrompt({ ...BASE, promptMode: 'minimal' });
    const variant = buildPrompt({ ...BASE, promptMode: 'minimal', rhetoricPolicy: 'h-rhetoric' });
    assert.match(def, /natural phrasing of similar weight/);
    assert.match(def, /within roughly ±30%/);
    assert.doesNotMatch(variant, /natural phrasing of similar weight/);
    assert.match(variant, H_POLICY);
    assert.ok(def.includes(MINIMAL_RHYTHM_EN));
    assert.ok(variant.includes(MINIMAL_RHYTHM_EN));
    const defRhythm = def.slice(def.indexOf(MINIMAL_RHYTHM_EN), def.indexOf('##'));
    const variantRhythm = variant.slice(variant.indexOf(MINIMAL_RHYTHM_EN), variant.indexOf('##'));
    assert.equal(defRhythm, variantRhythm);
  });

  it('emits the Korean PLAN §5 meaning on the Korean minimal path', () => {
    const koBase = { ...BASE, config: { language: 'ko', documentType: 'default' } };
    const def = buildPrompt({ ...koBase, promptMode: 'minimal' });
    const variant = buildPrompt({ ...koBase, promptMode: 'minimal', rhetoricPolicy: 'h-rhetoric' });
    assert.match(def, /비슷한 무게/);
    assert.doesNotMatch(variant, /비슷한 무게/);
    assert.match(variant, /정보가 없는 과장·상투적 도입·중복/);
    assert.match(variant, /원문에 있다는 이유만으로/);
    assert.match(variant, /강도 정보를 유일하게/);
    assert.doesNotMatch(variant, /폭발적으로/);
    assert.ok(def.includes(MINIMAL_RHYTHM_KO));
    assert.ok(variant.includes(MINIMAL_RHYTHM_KO));
  });

  it('does not read PATINA_RHETORIC_POLICY from the environment', () => {
    const prev = process.env.PATINA_RHETORIC_POLICY;
    process.env.PATINA_RHETORIC_POLICY = 'h-rhetoric';
    try {
      const prompt = buildPrompt(BASE);
      assert.match(prompt, new RegExp(SIMILAR_WEIGHT));
      assert.doesNotMatch(prompt, H_POLICY);
    } finally {
      if (prev === undefined) delete process.env.PATINA_RHETORIC_POLICY;
      else process.env.PATINA_RHETORIC_POLICY = prev;
    }
  });

  it('rejects an unknown rhetoricPolicy', () => {
    assert.throws(() => buildPrompt({ ...BASE, rhetoricPolicy: 'unknown' }), /unknown rhetoricPolicy/);
  });
});
