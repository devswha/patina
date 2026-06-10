import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPrompt } from '../../src/prompt-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(__dirname, '../fixtures/prompt-snapshots');
const UPDATE_SNAPSHOTS = process.env.UPDATE_PROMPT_SNAPSHOTS === '1';

const CASES = [
  { name: 'rewrite strict', file: 'rewrite-strict.md', mode: 'rewrite', promptMode: 'strict' },
  { name: 'rewrite minimal', file: 'rewrite-minimal.md', mode: 'rewrite', promptMode: 'minimal' },
  { name: 'diff', file: 'diff.md', mode: 'diff', promptMode: 'strict' },
  { name: 'audit', file: 'audit.md', mode: 'audit', promptMode: 'strict' },
  { name: 'score', file: 'score.md', mode: 'score', promptMode: 'strict' },
  { name: 'ouroboros', file: 'ouroboros.md', mode: 'ouroboros', promptMode: 'strict' },
];

const config = {
  language: 'en',
  profile: 'default',
  blocklist: ['never say pivotal'],
  allowlist: ['OpenClaw'],
  ouroboros: {
    'target-score': 30,
    'max-iterations': 3,
    'plateau-threshold': 10,
    'fidelity-floor': 70,
    'mps-floor': 70,
    'category-weights': {
      en: {
        content: 0.25,
        style: 0.25,
        structure: 0.25,
        communication: 0.25,
      },
    },
  },
};

const patterns = [
  {
    file: 'en-structure.md',
    isStructure: true,
    isScoreOnly: false,
    frontmatter: { pack: 'en-structure' },
    body: [
      '### 1. Metronomic Paragraph Rhythm',
      '**Watch words:** firstly, secondly, in conclusion',
      '**Fire condition:** adjacent paragraphs share the same sentence count.',
    ].join('\n'),
  },
  {
    file: 'en-content.md',
    isStructure: false,
    isScoreOnly: false,
    frontmatter: { pack: 'en-content' },
    body: [
      '### 4. Promotional Adjectives',
      '**Watch words:** transformative, robust, scalable, pivotal',
      '**Fire condition:** praise words replace concrete evidence.',
    ].join('\n'),
  },
  {
    file: 'en-viral-hook.md',
    isStructure: false,
    isScoreOnly: true,
    frontmatter: { pack: 'en-viral-hook' },
    body: [
      '### 2. Clickbait Mystery Close',
      '**Watch words:** why is everyone, nobody is talking about',
      '**Fire condition:** a cliffhanger substitutes for evidence.',
    ].join('\n'),
  },
];

const profile = {
  body: [
    'voice-overrides:',
    '  specificity: amplify',
    '  hype: reduce',
  ].join('\n'),
};

const voice = {
  body: [
    '- Prefer concrete nouns over broad abstractions.',
    '- Keep claims, polarity, causation, and numbers intact.',
  ].join('\n'),
};

const scoring = {
  body: [
    'Scoring reference:',
    '- Count detected pattern severity per category.',
    '- Preserve the configured category weights exactly.',
  ].join('\n'),
};

const tone = {
  tone: null,
  tone_source: 'profile_only',
  tone_evidence: [],
  tone_confidence: null,
};

const inputText = [
  'AI coding tools represent a transformative leap forward for every team.',
  'They provide a robust and scalable foundation for future work.',
  'OpenClaw reached 250K stars in 60 days without paid promotion.',
  'Why is everyone talking about it now?',
].join('\n\n');

export function redactInputSection(prompt) {
  const sections = [
    ['## Input Text', '## Output'],
    ['## Input', '## Output'],
  ];

  for (const [start, end] of sections) {
    const pattern = new RegExp(`${escapeRegExp(start)}\\n\\n[\\s\\S]*?\\n\\n${escapeRegExp(end)}\\n\\n`, 'u');
    if (pattern.test(prompt)) {
      return prompt.replace(pattern, `${start}\n\n<INPUT REDACTED>\n\n${end}\n\n`);
    }
  }

  throw new Error('Prompt snapshot redaction failed: input/output section not found');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSnapshot({ mode, promptMode }) {
  const prompt = buildPrompt({
    config,
    patterns,
    profile,
    voice,
    scoring,
    text: inputText,
    mode,
    tone,
    promptMode,
  });
  return `${redactInputSection(prompt).trim()}\n`;
}

describe('buildPrompt golden snapshots', () => {
  for (const testCase of CASES) {
    it(`matches ${testCase.name} snapshot`, () => {
      const snapshotPath = resolve(SNAPSHOT_DIR, testCase.file);
      const actual = buildSnapshot(testCase);

      if (UPDATE_SNAPSHOTS) {
        mkdirSync(SNAPSHOT_DIR, { recursive: true });
        writeFileSync(snapshotPath, actual);
      }

      assert.ok(
        existsSync(snapshotPath),
        `Missing prompt snapshot ${testCase.file}; run UPDATE_PROMPT_SNAPSHOTS=1 node --test tests/unit/prompt-builder.snapshot.test.js`
      );

      const expected = readFileSync(snapshotPath, 'utf8');
      assert.equal(actual, expected);
    });
  }
});

describe('CJK clause-level rewrite guard', () => {
  const koConfig = {
    ...config,
    language: 'ko',
    ouroboros: {
      ...config.ouroboros,
      'category-weights': {
        ...config.ouroboros['category-weights'],
        ko: { content: 1 },
      },
    },
  };

  it('is present in strict Korean rewrite prompts', () => {
    const prompt = buildPrompt({
      config: koConfig,
      patterns,
      profile,
      voice,
      scoring,
      text: '완전 자율, 무 TUI 세팅을 원한다면 자율 모드 플래그를 추가합니다.',
      mode: 'rewrite',
      tone,
      promptMode: 'strict',
    });

    assert.match(prompt, /CJK clause-level rewrite guard/);
    assert.match(prompt, /do not fix AI tells by swapping punctuation or single tokens in place/);
    assert.match(prompt, /TUI 없이 완전 자율로 설치하려면/);
  });

  it('is present in minimal Korean rewrite prompts', () => {
    const prompt = buildPrompt({
      config: koConfig,
      patterns,
      profile,
      voice,
      scoring,
      text: '"끝난 것 같아요"로는 부족한 열린 작업에 쓰세요.',
      mode: 'rewrite',
      tone,
      promptMode: 'minimal',
    });

    assert.match(prompt, /CJK clause-level rewrite guard/);
    assert.match(prompt, /"끝난 것 같아요"만으로는 부족한/);
  });

  it('does not add the CJK guard to English prompts', () => {
    const prompt = buildPrompt({
      config,
      patterns,
      profile,
      voice,
      scoring,
      text: inputText,
      mode: 'rewrite',
      tone,
      promptMode: 'strict',
    });

    assert.doesNotMatch(prompt, /CJK clause-level rewrite guard/);
  });
});

describe('Korean advisory rewrite metadata wording', () => {
  const koConfig = {
    ...config,
    language: 'ko',
    ouroboros: {
      ...config.ouroboros,
      'category-weights': {
        ...config.ouroboros['category-weights'],
        ko: { content: 1 },
      },
    },
  };

  function buildTestPrompt({ language = 'ko', mode = 'rewrite', promptMode = 'strict' } = {}) {
    return buildPrompt({
      config: language === 'ko' ? koConfig : config,
      patterns,
      profile,
      voice,
      scoring,
      text: language === 'ko'
        ? '그것은 사용자에 의해 선택되었으며, 결과적으로 더 나은 경험을 제공합니다.'
        : inputText,
      mode,
      tone,
      promptMode,
    });
  }

  it('is present in strict Korean rewrite prompts', () => {
    const prompt = buildTestPrompt({ language: 'ko', mode: 'rewrite', promptMode: 'strict' });

    assert.match(prompt, /koPostEditese\.v1/);
    assert.match(prompt, /advisory editing context only/);
    assert.match(prompt, /not score, gate, hot-spot, severity, benchmark, z-score, baseline, percentile, prompt\/rewrite gate, or authorship-verdict evidence/);
    assert.match(prompt, /calques, literal pronouns, by-passives, double particles/);
    assert.match(prompt, /suffix-diversity proxies/);
    assert.match(prompt, /Preserve claims, numbers, polarity, causation, and register/);
  });

  it('is present in minimal Korean rewrite prompts', () => {
    const prompt = buildTestPrompt({ language: 'ko', mode: 'rewrite', promptMode: 'minimal' });

    assert.match(prompt, /koPostEditese\.v1/);
    assert.match(prompt, /advisory editing context only/);
    assert.match(prompt, /not score, gate, hot-spot, severity, benchmark, z-score, baseline, percentile, prompt\/rewrite gate, or authorship-verdict evidence/);
  });

  it('does not add Korean advisory wording to English rewrite prompts', () => {
    const strictPrompt = buildTestPrompt({ language: 'en', mode: 'rewrite', promptMode: 'strict' });
    const minimalPrompt = buildTestPrompt({ language: 'en', mode: 'rewrite', promptMode: 'minimal' });

    assert.doesNotMatch(strictPrompt, /koPostEditese\.v1/);
    assert.doesNotMatch(strictPrompt, /advisory editing context only/);
    assert.doesNotMatch(minimalPrompt, /koPostEditese\.v1/);
    assert.doesNotMatch(minimalPrompt, /advisory editing context only/);
  });

  it('does not include koPostEditese in score prompts', () => {
    const prompt = buildTestPrompt({ language: 'ko', mode: 'score', promptMode: 'strict' });

    assert.doesNotMatch(prompt, /koPostEditese/);
  });

  it('does not include Korean advisory wording in Korean non-rewrite prompts', () => {
    for (const mode of ['diff', 'audit', 'score', 'ouroboros']) {
      const prompt = buildTestPrompt({ language: 'ko', mode, promptMode: 'strict' });
      assert.doesNotMatch(prompt, /koPostEditese\.v1/, mode);
      assert.doesNotMatch(prompt, /advisory editing context only/, mode);
    }
  });

  it('preserves ouroboros formula and termination language', () => {
    const prompt = buildTestPrompt({ language: 'en', mode: 'ouroboros', promptMode: 'strict' });

    assert.match(prompt, /If score ≤ 30, stop immediately/);
    assert.match(prompt, /delta = previous - current \(positive = improvement\)/);
    assert.match(prompt, /0 ≤ delta ≤ 10 → plateau/);
    assert.match(prompt, /fidelity < 70 → fidelity violation → rollback/);
    assert.match(prompt, /MPS < 70 → MPS violation → rollback/);
  });
});
