import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../../src/prompt-builder.js';

// The H-RHETORIC edit policy (8.7.0) is the only rhetoric text; the
// PATINA_RHETORIC_POLICY=legacy escape hatch was removed.
const SIMILAR_WEIGHT = /natural phrasing of similar weight/;
const FIDELITY_LENGTH = /the fidelity gate measures character length and full marks require staying within 50-130% of the input/;
const H_POLICY = /do not keep those phrases just because they appear in the source/i;

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

describe('buildPrompt rhetoric text', () => {
  it('strict prompt carries the H-RHETORIC policy and the fidelity-length envelope', () => {
    const prompt = buildPrompt(BASE);
    assert.match(prompt, FIDELITY_LENGTH);
    assert.match(prompt, H_POLICY);
    assert.match(prompt, /Keep the document purpose and register/);
    assert.match(prompt, /If a phrase is the only carrier of intensity/);
    assert.doesNotMatch(prompt, SIMILAR_WEIGHT);
    assert.match(prompt, /CV < 0\.30/);
    assert.match(prompt, /targeting CV ≥ 0\.35/);
  });

  it('English minimal prompt carries the same policy inside the length clause', () => {
    const prompt = buildPrompt({ ...BASE, promptMode: 'minimal' });
    assert.match(prompt, H_POLICY);
    assert.match(prompt, /within roughly ±30%/);
    assert.doesNotMatch(prompt, SIMILAR_WEIGHT);
    assert.ok(prompt.includes('Also fix the sentence rhythm. AI text keeps every sentence nearly the same length'));
  });

  it('Korean minimal prompt carries the PLAN §5 wording', () => {
    const prompt = buildPrompt({ ...BASE, config: { language: 'ko', documentType: 'default' }, promptMode: 'minimal' });
    assert.match(prompt, /정보가 없는 과장·상투적 도입·중복/);
    assert.match(prompt, /원문에 있다는 이유만으로/);
    assert.match(prompt, /강도 정보를 유일하게/);
    assert.doesNotMatch(prompt, /비슷한 무게/);
    assert.ok(prompt.includes('문장 리듬도 반드시 다듬어. AI 글은 문장 길이가 자로 잰 듯 비슷한데'));
  });

  it('ignores PATINA_RHETORIC_POLICY in the environment', () => {
    const prev = process.env.PATINA_RHETORIC_POLICY;
    process.env.PATINA_RHETORIC_POLICY = 'legacy';
    try {
      const prompt = buildPrompt(BASE);
      assert.match(prompt, H_POLICY);
      assert.doesNotMatch(prompt, SIMILAR_WEIGHT);
    } finally {
      if (prev === undefined) delete process.env.PATINA_RHETORIC_POLICY;
      else process.env.PATINA_RHETORIC_POLICY = prev;
    }
  });
});
