import test from 'node:test';
import assert from 'node:assert';
import {
  clamp03,
  combinedScore,
  interpretScore,
  lengthRatioPoints,
  scoreFidelity,
  scoreMPS,
  scoreDeterministicSignals,
  scoreText,
} from '../../src/scoring.js';
import { getRepoRoot, loadConfig } from '../../src/config.js';
import { loadPatterns } from '../../src/loader.js';

test('interpretScore maps documented AI-likeness boundaries', () => {
  const cases = [
    [0, 'human'],
    [15, 'human'],
    [16, 'mostly human'],
    [30, 'mostly human'],
    [31, 'mixed'],
    [50, 'mixed'],
    [51, 'AI-like'],
    [70, 'AI-like'],
    [71, 'heavily AI'],
    [100, 'heavily AI'],
  ];

  for (const [score, expected] of cases) {
    assert.strictEqual(interpretScore(score), expected, String(score));
  }
});

test('lengthRatioPoints scores bucket boundaries and empty original text', () => {
  const original = 'a'.repeat(100);
  const cases = [
    [29, 0],
    [30, 1],
    [49, 1],
    [50, 2],
    [69, 2],
    [70, 3],
    [130, 3],
    [131, 2],
    [150, 2],
    [151, 1],
    [200, 1],
    [201, 0],
  ];

  for (const [length, expected] of cases) {
    assert.strictEqual(
      lengthRatioPoints(original, 'b'.repeat(length)),
      expected,
      `${length}%`
    );
  }

  assert.strictEqual(lengthRatioPoints('', 'rewritten'), 3);
});

test('clamp03 clamps out-of-range values and rounds fractions', () => {
  const cases = [
    [-1, 0],
    [0, 0],
    [1.4, 1],
    [1.5, 2],
    [2.6, 3],
    [3, 3],
    [4, 3],
    [Number.NaN, 0],
  ];

  for (const [value, expected] of cases) {
    assert.strictEqual(clamp03(value), expected, String(value));
  }
});

test('combinedScore uses default and profile-specific config weights', () => {
  const config = loadConfig();

  assert.strictEqual(
    combinedScore({ aiLikeness: 40, fidelity: 80, profile: 'missing', config }),
    32
  );

  assert.strictEqual(
    combinedScore({ aiLikeness: 40, fidelity: 80, profile: 'legal', config }),
    27
  );

  assert.strictEqual(
    combinedScore({ aiLikeness: 40, fidelity: 80, profile: 'marketing', config }),
    33
  );

  assert.strictEqual(
    combinedScore({
      aiLikeness: 40,
      fidelity: 80,
      deterministicScore: { overall: 90 },
      profile: 'legal',
      config: {
        ...config,
        scoring: { deterministic: { 'combined-weight': 0.25 } },
      },
    }),
    39.6
  );
});

test('score helpers accept an injected callLLM implementation', async () => {
  const seen = [];
  const now = () => 123;
  const sleep = async () => {};
  const callLLM = async (args) => {
    seen.push(args);
    assert.strictEqual(args.now, now);
    assert.strictEqual(args.sleep, sleep);

    if (args.prompt.includes('AI-likeness scoring engine')) {
      return '{ "overall": 22, "interpretation": "mostly human" }';
    }
    if (args.prompt.includes('Meaning Preservation evaluator')) {
      return '{ "anchors": [], "pass_count": 1, "total_count": 1, "polarity_pass_count": 0, "polarity_total_count": 0, "mps": 91 }';
    }
    return '{ "claims_preserved": 3, "no_fabrication": 3, "tone_match": 3, "rationale": "ok" }';
  };

  const config = loadConfig();
  const common = {
    apiKey: 'test-key',
    baseURL: 'https://example.com/v1',
    model: 'test-model',
    callLLM,
    now,
    sleep,
  };

  const score = await scoreText({
    text: 'Example text.',
    config,
    patterns: [],
    ...common,
  });
  const mps = await scoreMPS({
    original: 'Example text.',
    rewritten: 'Example text.',
    ...common,
  });
  const fidelity = await scoreFidelity({
    original: 'Example text.',
    rewritten: 'Example text.',
    ...common,
  });

  assert.strictEqual(score.overall, 22);
  assert.strictEqual(score.llmScore.overall, 22);
  assert.equal(typeof score.deterministicScore.overall, 'number');
  assert.strictEqual(mps.mps, 91);
  assert.strictEqual(fidelity.fidelity, 100);
  assert.strictEqual(seen.length, 3);
});
test('scoreText prompt includes score instructions, pattern counts, and catalog digest', async () => {
  let prompt = '';
  await scoreText({
    text: 'Short sample text.',
    config: {
      ...loadConfig(),
      language: 'en',
      scoring: { deterministic: { enabled: false } },
    },
    patterns: [
      {
        file: 'en-content.md',
        frontmatter: { pack: 'en-content', patterns: 2 },
        body: '### 1. Promotional Adjectives\n**Watch words:** robust\n\n### 2. Empty Contrast\nExample',
      },
      {
        file: 'en-viral-hook.md',
        frontmatter: { pack: 'en-viral-hook', patterns: 1 },
        body: '### 1. Clickbait Mystery Close\n**Watch words:** nobody is talking about',
      },
    ],
    callLLM: async (args) => {
      prompt = args.prompt;
      return '{ "overall": 12, "interpretation": "human" }';
    },
  });

  assert.match(prompt, /AI-likeness scoring engine/);
  assert.match(prompt, /Short-text boost/);
  assert.match(prompt, /content: 0\.2/);
  assert.match(prompt, /Pattern counts from pack frontmatter/);
  assert.match(prompt, /- en-content: 2 patterns/);
  assert.match(prompt, /- en-viral-hook: 1 patterns/);
  assert.match(prompt, /Compact pattern catalog digest/);
  assert.match(prompt, /en-content: Promotional Adjectives; Empty Contrast/);
  assert.match(prompt, /en-viral-hook: Clickbait Mystery Close/);
  assert.match(prompt, /Interpretation: 0-15 human/);

  // Issue #397: the scoreText prompt must carry exactly ONE output contract —
  // the strict-JSON one. The markdown-table tail belongs to the skill surface.
  assert.match(prompt, /## Output Format \(strict JSON\)/);
  assert.match(prompt, /Return ONLY a JSON object/);
  assert.doesNotMatch(prompt, /Output format \(the Weight column/);
  assert.doesNotMatch(prompt, /\| Category \| Weight \| Detected \| Raw Score \| Weighted \|/);
  assert.strictEqual((prompt.match(/Output [Ff]ormat/g) || []).length, 1);
});

test('scoreText prompt digest lists every pattern and matches the stated denominators', async () => {
  const patterns = loadPatterns(getRepoRoot(), 'ko');
  assert.ok(patterns.length > 0, 'expected real ko pattern packs');

  let prompt = '';
  await scoreText({
    text: 'Sample text.',
    config: {
      ...loadConfig(),
      language: 'ko',
      scoring: { deterministic: { enabled: false } },
    },
    patterns,
    callLLM: async (args) => {
      prompt = args.prompt;
      return '{ "overall": 12, "interpretation": "human" }';
    },
  });

  const countsSection = prompt
    .split('Pattern counts from pack frontmatter (use as pattern_count denominators):\n')[1]
    .split('\n\n')[0];
  const digestSection = prompt
    .split('Compact pattern catalog digest:\n')[1]
    .split('\n\n')[0];

  const statedCounts = new Map(
    countsSection.split('\n').map((line) => {
      const match = line.match(/^- (\S+): (\d+) patterns$/);
      assert.ok(match, `unparseable pattern-count line: ${line}`);
      return [match[1], Number(match[2])];
    })
  );
  assert.strictEqual(statedCounts.size, patterns.length);

  const digestLines = digestSection.split('\n');
  assert.strictEqual(digestLines.length, patterns.length);
  for (const line of digestLines) {
    const match = line.match(/^- (\S+): (.+)$/);
    assert.ok(match, `unparseable digest line: ${line}`);
    const [, pack, entries] = match;
    assert.ok(statedCounts.has(pack), `digest pack ${pack} missing from pattern counts`);
    // Issue #397: the digest must show as many catalog entries as the
    // pattern_count denominator the same prompt instructs the model to use.
    assert.strictEqual(
      entries.split('; ').length,
      statedCounts.get(pack),
      `digest entries for ${pack} must equal its stated pattern_count denominator`
    );
  }
});

test('scoreText warns on deterministic divergence and keeps the pessimistic score', async () => {
  const warnings = [];
  const score = await scoreText({
    text: [
      'The tool is useful. The model is helpful. The system is reliable. The page is stable. The flow is simple.',
      'The draft is useful. The note is helpful. The copy is reliable. The line is stable. The page is simple.',
      'The output is useful. The result is helpful. The answer is reliable. The plan is stable. The text is simple.',
    ].join('\n\n'),
    config: loadConfig(),
    patterns: [],
    callLLM: async () => '{ "overall": 10, "interpretation": "human" }',
    logger: { warn: (event, fields) => warnings.push({ event, ...fields }) },
  });

  assert.strictEqual(score.llmScore.overall, 10);
  assert.strictEqual(score.deterministicScore.overall, 100);
  assert.ok(score.deterministicScore.signalScore > 0);
  assert.strictEqual(score.overall, 100);
  assert.strictEqual(score.scorePreference.selected, 'deterministic');
  assert.ok(warnings.some((entry) => entry.event === 'score.deterministic_divergence'));
});

test('deterministic signal score is additive and does not replace hot-ratio overall', () => {
  const deterministic = scoreDeterministicSignals({
    text: [
      'The tool is useful. The model is helpful. The system is reliable.',
      'The draft is useful. The note is helpful. The copy is reliable.',
    ].join('\n\n'),
    config: loadConfig(),
  });

  assert.strictEqual(deterministic.overall, 100);
  assert.equal(typeof deterministic.signalScore, 'number');
  assert.ok(deterministic.signalScore > 0);
});

test('deterministic markup-leakage short-circuits the score into the heavily-AI band', () => {
  const leakedText = [
    'I rewrote the parser this morning and it finally handles nested quotes without choking on them. The previous version tripped over one rare edge case that took the better part of two days to track down and reproduce.',
    'Reviewers wanted another pass on the error copy, so I split the longest messages into a short summary plus a separate hint. According to turn0search1 the phrasing still needs work, yet the overall structure holds together fine.',
    'We shipped it behind a flag and watched the logs over lunch. Nothing broke. The on-call engineer shrugged and went back to her coffee.',
  ].join('\n\n');
  const leaked = scoreDeterministicSignals({ text: leakedText, config: loadConfig() });
  // Every paragraph is ordinary human prose, so the hot ratio alone would be 0;
  // the near-proof-grade leakage token is what lifts the score.
  assert.strictEqual(leaked.hotParagraphs, 0);
  assert.strictEqual(leaked.bands.markupLeakage.leaked, true);
  assert.ok(leaked.overall >= 90, `expected leakage floor, got ${leaked.overall}`);
  assert.strictEqual(leaked.interpretation, 'heavily AI');

  const cleanText = leakedText.replace('According to turn0search1 the phrasing', 'According to the reviewer the phrasing');
  const clean = scoreDeterministicSignals({ text: cleanText, config: loadConfig() });
  assert.strictEqual(clean.bands.markupLeakage.leaked, false);
  assert.ok(clean.overall < 90, `clean prose should not hit the leakage floor, got ${clean.overall}`);
});
test('configured structural-model load failure warns and preserves deterministic leakage floor', () => {
  const warnings = [];
  const leaked = scoreDeterministicSignals({
    text: [
      'I rewrote the parser this morning and it finally handles nested quotes without choking on them.',
      'According to turn0search1 the phrasing still needs work, yet the overall structure holds together fine.',
      'We shipped it behind a flag and watched the logs over lunch. Nothing broke.',
    ].join('\n\n'),
    config: {
      ...loadConfig(),
      stylometry: {
        ...loadConfig().stylometry,
        structural_model: { path: './does-not-exist-structural-model.json' },
      },
    },
    logger: { warn: (event, fields) => warnings.push({ event, ...fields }) },
  });

  assert.strictEqual(leaked.bands.markupLeakage.leaked, true);
  assert.ok(leaked.overall >= 90, `expected leakage floor, got ${leaked.overall}`);
  assert.notStrictEqual(leaked.skipReason, 'deterministic-failure');
  assert.ok(warnings.some((entry) => entry.event === 'score.structural_model_load_failure'));
});

test('discourse tells are attributed to the paragraphs that carry them (#391)', () => {
  const deterministic = scoreDeterministicSignals({
    text: [
      "Here's the thing about this parser, Mira rewrote one branch after lunch and left the comments alone.",
      'And the truth is, Dae kept the rollout notes short because the team already knew the risks.',
    ].join('\n\n'),
    config: {
      ...loadConfig(),
      language: 'en',
    },
  });

  // Both paragraphs carry a fake-candor opener and the document gate (>=2)
  // fired, so both become hot and the hot ratio carries the whole score —
  // no document-level floor involved.
  assert.strictEqual(deterministic.hotParagraphs, 2);
  assert.strictEqual(deterministic.paragraphCount, 2);
  assert.strictEqual(deterministic.overall, 100);
  assert.strictEqual(deterministic.bands.discourseTells.hot, true);
  assert.strictEqual(deterministic.bands.discourseTells.fakeCandor.hot, true);
  // A discourse-hot paragraph carries signal strength: overall and signalScore
  // must not contradict each other (hot paragraphs with strength 0).
  assert.ok(deterministic.signalScore > 0, `expected nonzero signalScore, got ${deterministic.signalScore}`);
});

test('a single rhetorical candor opener stays below the density gate (#391)', () => {
  const deterministic = scoreDeterministicSignals({
    text: [
      "Let's be honest, the migration took longer than the estimate we gave in March.",
      'Mira split the remaining work into two short branches and reviewed both before Friday.',
      'The rollout notes stayed short because the team already knew the risks involved.',
    ].join('\n\n'),
    config: {
      ...loadConfig(),
      language: 'en',
    },
  });

  assert.strictEqual(deterministic.bands.discourseTells.hot, false);
  assert.strictEqual(deterministic.hotParagraphs, 0);
  assert.strictEqual(deterministic.overall, 0);
});

test('deterministic skipped and failure payloads pin signalScore to zero', () => {
  const disabled = scoreDeterministicSignals({
    text: 'Example.',
    config: {
      ...loadConfig(),
      language: 'ko',
      stylometry: { languages: ['en'] },
    },
  });
  assert.strictEqual(disabled.skipped, true);
  assert.strictEqual(disabled.signalScore, 0);

  const failed = scoreDeterministicSignals({
    text: 'Example.',
    config: loadConfig(),
    analyzer: () => {
      throw new Error('boom');
    },
  });
  assert.strictEqual(failed.skipped, true);
  assert.strictEqual(failed.signalScore, 0);
});
// --- C2: opt-in structured output ------------------------------------------

test('scoreText forwards responseFormat to callLLM on both attempts and keeps strict-JSON fallback (#C2)', async () => {
  const calls = [];
  const callLLM = async (args) => {
    calls.push(args);
    // First attempt returns non-JSON to force the temperature-0 retry.
    return calls.length === 1
      ? 'sorry, here is the answer'
      : '{ "categories": {}, "overall": 20, "interpretation": "mostly human" }';
  };
  const result = await scoreText({
    text: 'A sample draft to score.',
    config: loadConfig(),
    patterns: [],
    responseFormat: { type: 'json_object' },
    callLLM,
  });
  assert.equal(calls.length, 2); // garbage -> retry preserves the fallback
  assert.deepEqual(calls[0].responseFormat, { type: 'json_object' });
  assert.deepEqual(calls[1].responseFormat, { type: 'json_object' });
  assert.equal(calls[1].temperature, 0); // retry runs at temperature 0
  assert.ok(result.overall != null);
});

test('scoreText omits responseFormat when the opt-in is unset (#C2)', async () => {
  const calls = [];
  const callLLM = async (args) => {
    calls.push(args);
    return '{ "categories": {}, "overall": 10, "interpretation": "human" }';
  };
  await scoreText({ text: 'x', config: loadConfig(), patterns: [], callLLM });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].responseFormat, undefined);
});

test('scoreText runs exactly two LLM attempts then yields a schema-failure result on persistent bad JSON (#C3)', async () => {
  let calls = 0;
  const result = await scoreText({
    text: 'draft to score',
    config: loadConfig(),
    patterns: [],
    callLLM: async () => {
      calls += 1;
      return 'definitely not json';
    },
    logger: { warn() {} },
  });
  // Schema retry is owned by callAndParseJson: exactly 1 attempt + 1 temp-0 retry.
  assert.equal(calls, 2);
  assert.equal(result.overall, null);
  assert.equal(result.error, 'schema-failure');
});
