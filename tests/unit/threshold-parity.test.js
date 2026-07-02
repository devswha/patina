// Cross-surface numeric threshold parity gates (issue #383 Stage 4).
//
// Feature-module constants are canonical (post Stage 2/3 the playground imports
// them directly). These tests gate every *other* surface that re-states the same
// numbers — .patina.default.yaml defaults, core/scoring.md, core/stylometry.md,
// SKILL.md prose, docs/TRANSLATIONESE-KO.md prose — against the code constants.
// Every doc extraction asserts that the anchor was actually found, so a reworded
// doc fails loudly instead of letting the gate pass vacuously.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_KO_DIAGNOSTIC_BANDS,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
  DEFAULT_MIN_BURSTINESS_SENTENCES,
} from '../../src/features/stylometry.js';
import {
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
} from '../../src/features/lexicon-core.js';
import { LEAKAGE_SCORE_FLOOR as FEATURE_LEAKAGE_SCORE_FLOOR } from '../../src/features/markup-leakage.js';
import {
  ABS_MIN as TRANSLATIONESE_ABS_MIN,
  DENSITY_MIN as TRANSLATIONESE_DENSITY_MIN,
} from '../../src/features/translationese.js';
import {
  DEFAULT_DETERMINISTIC_DIVERGENCE_THRESHOLD,
  LEAKAGE_SCORE_FLOOR,
  SCORE_INTERPRETATION_BANDS,
  interpretScore,
  scoreText,
} from '../../src/scoring.js';
import { DEFAULT_SEVERITY_POINTS, buildPrompt, buildScoreMathCore } from '../../src/prompt-builder.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const LANGS = ['ko', 'en', 'zh', 'ja'];

const defaultConfig = yaml.load(readFileSync(resolve(REPO_ROOT, '.patina.default.yaml'), 'utf8'));
const scoringDoc = readFileSync(resolve(REPO_ROOT, 'core/scoring.md'), 'utf8');
const stylometryDoc = readFileSync(resolve(REPO_ROOT, 'core/stylometry.md'), 'utf8');
const skillDoc = readFileSync(resolve(REPO_ROOT, 'SKILL.md'), 'utf8');
const translationeseDoc = readFileSync(resolve(REPO_ROOT, 'docs/TRANSLATIONESE-KO.md'), 'utf8');
const featuresIndexSource = readFileSync(resolve(REPO_ROOT, 'src/features/index.js'), 'utf8');
const scoringSource = readFileSync(resolve(REPO_ROOT, 'src/scoring.js'), 'utf8');

// Extract a single capture group and fail loudly when the anchor is missing.
function extract(haystack, re, what) {
  const m = haystack.match(re);
  assert.ok(m, `extraction anchor not found: ${what} (${re})`);
  return m;
}

function extractNumber(haystack, re, what) {
  return Number(extract(haystack, re, what)[1]);
}

// ---------------------------------------------------------------------------
// Gate 1 — .patina.default.yaml defaults == code constants
// ---------------------------------------------------------------------------

test('yaml stylometry defaults match src/features/stylometry.js constants', () => {
  assert.deepEqual(
    defaultConfig.stylometry.burstiness.bands,
    DEFAULT_BURSTINESS_BANDS,
    'stylometry.burstiness.bands drifted from DEFAULT_BURSTINESS_BANDS'
  );
  assert.deepEqual(
    defaultConfig.stylometry.ttr.bands,
    DEFAULT_MATTR_BANDS,
    'stylometry.ttr.bands drifted from DEFAULT_MATTR_BANDS'
  );
  assert.equal(
    defaultConfig.stylometry.ttr.window,
    DEFAULT_MATTR_WINDOW,
    'stylometry.ttr.window drifted from DEFAULT_MATTR_WINDOW'
  );
  assert.deepEqual(
    defaultConfig.stylometry.ko_diagnostics.bands,
    DEFAULT_KO_DIAGNOSTIC_BANDS,
    'stylometry.ko_diagnostics.bands drifted from DEFAULT_KO_DIAGNOSTIC_BANDS'
  );
});

test('yaml skip thresholds match the hardcoded analyzer skip gates', () => {
  // NOTE: yaml `stylometry.skip.min_sentences` (document-level skip, ==2) and
  // DEFAULT_MIN_BURSTINESS_SENTENCES (per-paragraph CV banding gate, ==3) are
  // different knobs — do not equate them. The yaml skip numbers are consumed
  // nowhere; they document the advisory gate hardcoded in src/features/index.js.
  const paragraphGate = extractNumber(
    featuresIndexSource,
    /paragraphs\.length <= (\d+) \? 'paragraphs<=\d+'/,
    'features/index.js paragraph skip gate'
  );
  const sentenceGate = extractNumber(
    featuresIndexSource,
    /totalSentences <= (\d+) \? 'sentences<=\d+'/,
    'features/index.js sentence skip gate'
  );
  assert.equal(defaultConfig.stylometry.skip.min_paragraphs, paragraphGate);
  assert.equal(defaultConfig.stylometry.skip.min_sentences, sentenceGate);
  assert.deepEqual(
    defaultConfig.lexicon.skip,
    defaultConfig.stylometry.skip,
    'lexicon.skip must mirror stylometry.skip (same analyzer pass)'
  );
});

test('yaml lexicon density threshold matches lexicon-core constant', () => {
  // yaml deliberately carries no min-hot-matches key (not a config surface yet);
  // DEFAULT_LEXICON_MIN_HOT_MATCHES is gated against core/stylometry.md below.
  assert.equal(defaultConfig.lexicon.density_threshold, DEFAULT_LEXICON_DENSITY_THRESHOLD);
});

test('yaml severity-points match the prompt-builder defaults', () => {
  assert.deepEqual(
    defaultConfig.ouroboros['severity-points'],
    { ...DEFAULT_SEVERITY_POINTS },
    'ouroboros.severity-points drifted from DEFAULT_SEVERITY_POINTS'
  );
});

test('yaml deterministic divergence threshold matches scoring constant', () => {
  assert.equal(
    defaultConfig.scoring.deterministic['divergence-threshold'],
    DEFAULT_DETERMINISTIC_DIVERGENCE_THRESHOLD
  );
});

test('yaml default combined-score weights match the combinedScore fallbacks', () => {
  const aiFallback = extractNumber(
    scoringSource,
    /profileWeights\?\.\['ai-likeness'\] \?\? ([0-9.]+)/,
    'combinedScore ai-likeness fallback'
  );
  const fidelityFallback = extractNumber(
    scoringSource,
    /profileWeights\?\.fidelity \?\? ([0-9.]+)/,
    'combinedScore fidelity fallback'
  );
  const defaults = defaultConfig.ouroboros['combined-weights'].default;
  assert.equal(defaults['ai-likeness'], aiFallback);
  assert.equal(defaults.fidelity, fidelityFallback);
});

// ---------------------------------------------------------------------------
// Gate 2 — core/scoring.md == yaml weights / severity points / interpretation
// (the pattern-count column is gated by pattern-docs.test.js; weights only here)
// ---------------------------------------------------------------------------

test('core/scoring.md per-language weight columns match yaml category weights', () => {
  for (const lang of LANGS) {
    const section = extract(
      scoringDoc,
      new RegExp(`### .*\\(${lang}\\)\\n([\\s\\S]*?)(?=\\n### |\\n---)`, 'm'),
      `core/scoring.md ${lang} weights table`
    )[1];
    const docWeights = {};
    for (const line of section.split('\n')) {
      const m = line.match(/^\|\s*([^|*][^|]*?)\s*\|\s*([0-9.]+)\s*\|\s*\d+\s*\|/);
      if (m) docWeights[m[1].trim()] = Number(m[2]);
    }
    const yamlWeights = defaultConfig.ouroboros['category-weights'][lang];
    assert.ok(Object.keys(docWeights).length > 0, `${lang} weights table extracted no rows`);
    assert.deepEqual(docWeights, yamlWeights, `${lang} weight column drifted from yaml`);

    const total = extractNumber(
      section,
      /^\|\s*\*\*Total\*\*\s*\|\s*\*\*([0-9.]+)\*\*/m,
      `core/scoring.md ${lang} Total weight`
    );
    const sum = Object.values(yamlWeights).reduce((a, b) => a + b, 0);
    assert.equal(total, Math.round(sum * 100) / 100, `${lang} Total weight drifted`);
  }
});

test('core/scoring.md §1 severity table and §6 formula match severity-point defaults', () => {
  const section = extract(
    scoringDoc,
    /## 1\. Severity Scale[\s\S]*?(?=\n## )/,
    'core/scoring.md §1 Severity Scale section'
  )[0];
  for (const [level, points] of [
    ['High', DEFAULT_SEVERITY_POINTS.high],
    ['Medium', DEFAULT_SEVERITY_POINTS.medium],
    ['Low', DEFAULT_SEVERITY_POINTS.low],
  ]) {
    const docPoints = extractNumber(
      section,
      new RegExp(`^\\|\\s*${level}\\s*\\|\\s*(\\d+)\\s*\\|`, 'm'),
      `core/scoring.md §1 ${level} row`
    );
    assert.equal(docPoints, points, `§1 ${level} severity points drifted`);
  }
  const formulaMax = extractNumber(
    scoringDoc,
    /category_score = \(sum of adjusted severities \/ \(pattern_count × (\d+)\)\) × 100/,
    'core/scoring.md §6 per-category formula'
  );
  assert.equal(formulaMax, DEFAULT_SEVERITY_POINTS.high, '§6 formula max-severity drifted');
});

test('core/scoring.md severity-cap prose restatements match DEFAULT_SEVERITY_POINTS.high', () => {
  // §5 amplify override row: severity × 1.5 is capped at the High point value.
  assert.equal(
    extractNumber(scoringDoc, /^\| amplify \| × 1\.5 \(cap at (\d+)\) \|/m, '§5 amplify cap row'),
    DEFAULT_SEVERITY_POINTS.high,
    '§5 amplify cap drifted'
  );
  // §6 denominator prose under the formula block.
  assert.equal(
    extractNumber(scoringDoc, /`pattern_count × (\d+)`: maximum possible score/, '§6 denominator prose'),
    DEFAULT_SEVERITY_POINTS.high,
    '§6 denominator prose drifted'
  );
  // §6 worked-example table header re-states the denominator multiplier.
  assert.equal(
    extractNumber(scoringDoc, /\| Max \(count×(\d+)\) \|/, '§6 worked-example Max header'),
    DEFAULT_SEVERITY_POINTS.high,
    '§6 worked-example Max header drifted'
  );
  // §8 short-text boost caps the 1.5x multiplier at the High point value.
  assert.equal(
    extractNumber(
      scoringDoc,
      /severity multiplier \(capped at (\d+) per detection\)/,
      '§8 short-text boost cap prose'
    ),
    DEFAULT_SEVERITY_POINTS.high,
    '§8 short-text boost cap drifted'
  );
});

test('core/scoring.md §7 interpretation table matches SCORE_INTERPRETATION_BANDS', () => {
  const section = extract(
    scoringDoc,
    /## 7\. Score Interpretation\n([\s\S]*?)(?=\n---)/,
    'core/scoring.md §7 Score Interpretation section'
  )[1];
  const rows = [...section.matchAll(/^\|\s*(\d+)-(\d+)\s*\|/gm)].map((m) => ({
    low: Number(m[1]),
    high: Number(m[2]),
  }));
  assert.equal(
    rows.length,
    SCORE_INTERPRETATION_BANDS.length,
    '§7 table row count differs from SCORE_INTERPRETATION_BANDS'
  );
  rows.forEach((row, index) => {
    const expectedLow = index === 0 ? 0 : SCORE_INTERPRETATION_BANDS[index - 1].max + 1;
    assert.equal(row.low, expectedLow, `§7 band ${index} lower bound drifted`);
    assert.equal(row.high, SCORE_INTERPRETATION_BANDS[index].max, `§7 band ${index} upper bound drifted`);
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — core/stylometry.md prose numbers == code constants
// ---------------------------------------------------------------------------

test('core/stylometry.md burstiness numbers match stylometry constants', () => {
  assert.equal(
    extractNumber(stylometryDoc, /^\| low \| CV < ([0-9.]+) \|/m, 'burstiness low band row'),
    DEFAULT_BURSTINESS_BANDS.low
  );
  const mid = extract(
    stylometryDoc,
    /^\| mid \| ([0-9.]+) ≤ CV ≤ ([0-9.]+) \|/m,
    'burstiness mid band row'
  );
  assert.equal(Number(mid[1]), DEFAULT_BURSTINESS_BANDS.low);
  assert.equal(Number(mid[2]), DEFAULT_BURSTINESS_BANDS.high);
  assert.equal(
    extractNumber(stylometryDoc, /^\| high \| CV > ([0-9.]+) \|/m, 'burstiness high band row'),
    DEFAULT_BURSTINESS_BANDS.high
  );
  assert.equal(
    extractNumber(stylometryDoc, /단락 문장이 (\d+)개 미만이면 CV 값은 기록하되/, 'burstiness min-sentence prose'),
    DEFAULT_MIN_BURSTINESS_SENTENCES
  );
  assert.equal(
    extractNumber(stylometryDoc, /^\| 단락 내 문장 수 < (\d+) \|/m, 'burstiness min-sentence skip row'),
    DEFAULT_MIN_BURSTINESS_SENTENCES
  );
});

test('core/stylometry.md MATTR numbers match stylometry constants', () => {
  assert.equal(
    extractNumber(stylometryDoc, /^window = (\d+)\s+# tokens$/m, 'MATTR window pseudo-code'),
    DEFAULT_MATTR_WINDOW
  );
  assert.equal(
    extractNumber(stylometryDoc, /window=(\d+)은 문헌 권장값/, 'MATTR window literature note'),
    DEFAULT_MATTR_WINDOW
  );
  assert.equal(
    extractNumber(stylometryDoc, /^\| low \| MATTR < ([0-9.]+) \|/m, 'MATTR low band row'),
    DEFAULT_MATTR_BANDS.low
  );
  const mid = extract(
    stylometryDoc,
    /^\| mid \| ([0-9.]+) ≤ MATTR ≤ ([0-9.]+) \|/m,
    'MATTR mid band row'
  );
  assert.equal(Number(mid[1]), DEFAULT_MATTR_BANDS.low);
  assert.equal(Number(mid[2]), DEFAULT_MATTR_BANDS.high);
  assert.equal(
    extractNumber(stylometryDoc, /^\| high \| MATTR > ([0-9.]+) \|/m, 'MATTR high band row'),
    DEFAULT_MATTR_BANDS.high
  );
});

test('core/stylometry.md ko-diagnostic defaults match DEFAULT_KO_DIAGNOSTIC_BANDS', () => {
  const checks = [
    [/`minSentences=(\d+)`/, DEFAULT_KO_DIAGNOSTIC_BANDS.minSentences, 'minSentences'],
    [/`minEojeols=(\d+)`/, DEFAULT_KO_DIAGNOSTIC_BANDS.minEojeols, 'minEojeols'],
    [
      /`spacing\.eojeolLengthCV < ([0-9.]+)`/,
      DEFAULT_KO_DIAGNOSTIC_BANDS.spacing.maxEojeolLengthCV,
      'spacing.maxEojeolLengthCV',
    ],
    [/`comma\.perSentence < (\d+)`/, DEFAULT_KO_DIAGNOSTIC_BANDS.comma.maxPerSentence, 'comma.maxPerSentence'],
    [
      /`posProxy\.matchedCount >= (\d+)`/,
      DEFAULT_KO_DIAGNOSTIC_BANDS.posProxy.minMatchedCount,
      'posProxy.minMatchedCount',
    ],
    [
      /`posProxy\.classDiversity < ([0-9.]+)`/,
      DEFAULT_KO_DIAGNOSTIC_BANDS.posProxy.maxClassDiversity,
      'posProxy.maxClassDiversity',
    ],
  ];
  for (const [re, expected, what] of checks) {
    assert.equal(extractNumber(stylometryDoc, re, `ko-diagnostic ${what}`), expected, `${what} drifted`);
  }
});

test('core/stylometry.md lexicon numbers match lexicon-core constants', () => {
  assert.equal(
    extractNumber(stylometryDoc, /기본 threshold = `([0-9.]+)` \(1,000 토큰당/, '§16 density threshold'),
    DEFAULT_LEXICON_DENSITY_THRESHOLD
  );
  assert.equal(
    extractNumber(stylometryDoc, /`density_threshold = ([0-9.]+)` 채택/, '§16 calibration adoption'),
    DEFAULT_LEXICON_DENSITY_THRESHOLD
  );
  const minHot = extract(
    stylometryDoc,
    /기본 `min_hot_matches`는 영어 (\d+), 한국어\/중국어\/일본어 (\d+)다/,
    '§16 min_hot_matches prose'
  );
  assert.equal(Number(minHot[1]), DEFAULT_LEXICON_MIN_HOT_MATCHES.default, 'en/default min-hot drifted');
  for (const lang of ['ko', 'zh', 'ja']) {
    assert.equal(Number(minHot[2]), DEFAULT_LEXICON_MIN_HOT_MATCHES[lang], `${lang} min-hot drifted`);
  }
  assert.equal(
    extractNumber(stylometryDoc, /CJK 기본 `lexicon_min_hits`는 (\d+)다/, '§6 CJK lexicon_min_hits prose'),
    DEFAULT_LEXICON_MIN_HOT_MATCHES.ko
  );
});

// ---------------------------------------------------------------------------
// Gate 4 — SKILL.md inline numbers == code constants
// ---------------------------------------------------------------------------

test('SKILL.md burstiness band line matches DEFAULT_BURSTINESS_BANDS', () => {
  const m = extract(
    skillDoc,
    /밴드: `low < ([0-9.]+)` \/ `([0-9.]+) ≤ mid ≤ ([0-9.]+)` \/ `high > ([0-9.]+)`\. \(v3\.5\.1 calibration\)/,
    'SKILL.md burstiness band line'
  );
  assert.equal(Number(m[1]), DEFAULT_BURSTINESS_BANDS.low);
  assert.equal(Number(m[2]), DEFAULT_BURSTINESS_BANDS.low);
  assert.equal(Number(m[3]), DEFAULT_BURSTINESS_BANDS.high);
  assert.equal(Number(m[4]), DEFAULT_BURSTINESS_BANDS.high);
});

test('SKILL.md MATTR lines match DEFAULT_MATTR_BANDS and window', () => {
  const m = extract(
    skillDoc,
    /밴드: `low < ([0-9.]+)` \/ `([0-9.]+) ≤ mid ≤ ([0-9.]+)` \/ `high > ([0-9.]+)`\. lowercase 외 추가 정규화 없음/,
    'SKILL.md MATTR band line'
  );
  assert.equal(Number(m[1]), DEFAULT_MATTR_BANDS.low);
  assert.equal(Number(m[2]), DEFAULT_MATTR_BANDS.low);
  assert.equal(Number(m[3]), DEFAULT_MATTR_BANDS.high);
  assert.equal(Number(m[4]), DEFAULT_MATTR_BANDS.high);
  assert.equal(
    extractNumber(skillDoc, /^window = (\d+) tokens$/m, 'SKILL.md MATTR window line'),
    DEFAULT_MATTR_WINDOW
  );
  assert.equal(
    extractNumber(skillDoc, /sliding_window\(lower_tokens, (\d+)\)/, 'SKILL.md sliding_window literal'),
    DEFAULT_MATTR_WINDOW
  );
  assert.equal(
    extractNumber(skillDoc, /len\(tokens\) < (\d+) 이면 simple TTR/, 'SKILL.md simple-TTR fallback line'),
    DEFAULT_MATTR_WINDOW
  );
});

test('SKILL.md lexicon threshold line matches lexicon-core constant', () => {
  const m = extract(
    skillDoc,
    /기본 threshold = `([0-9.]+)`, `min_hot_matches` 기본값 = \*\*en (\d+), ko\/zh\/ja (\d+)\*\*/,
    'SKILL.md lexicon threshold line'
  );
  assert.equal(Number(m[1]), DEFAULT_LEXICON_DENSITY_THRESHOLD, 'density threshold drifted');
  assert.equal(Number(m[2]), DEFAULT_LEXICON_MIN_HOT_MATCHES.default, 'en/default min-hot drifted');
  for (const lang of ['ko', 'zh', 'ja']) {
    assert.equal(Number(m[3]), DEFAULT_LEXICON_MIN_HOT_MATCHES[lang], `${lang} min-hot drifted`);
  }
  // The integrated hot-OR block must carry the min-hot clause so SKILL readers
  // never fall back to the density-only rule (inspection 2026-07, HIGH).
  assert.match(
    skillDoc,
    /AND matches >= lexicon\.min_hot_matches/,
    'SKILL.md lexicon hot rule lost the min_hot_matches clause'
  );
  assert.match(
    skillDoc,
    /AND lexicon_matches >= lexicon\.min_hot_matches/,
    'SKILL.md integrated hot OR lost the min_hot_matches clause'
  );
});

test('SKILL.md score-mode severity numbers match DEFAULT_SEVERITY_POINTS', () => {
  // Step 2: amplify override caps adjusted severity at the High point value.
  assert.equal(
    extractNumber(skillDoc, /`amplify`: 심각도 × 1\.5 \(최대 (\d+)\)/, 'SKILL.md amplify cap line'),
    DEFAULT_SEVERITY_POINTS.high,
    'SKILL.md amplify cap drifted'
  );
  // Step 3: category formula denominator is pattern_count × High.
  assert.equal(
    extractNumber(
      skillDoc,
      /카테고리 점수 = \(조정된 심각도 합계 \/ \(패턴 수 × (\d+)\)\) × 100/,
      'SKILL.md category formula line'
    ),
    DEFAULT_SEVERITY_POINTS.high,
    'SKILL.md category formula denominator drifted'
  );
});

test('SKILL.md interpretation band line matches SCORE_INTERPRETATION_BANDS', () => {
  // Korean band labels are SKILL.md-only; the numeric bounds are gated against
  // the code constant. A band count change breaks the anchor and fails loudly.
  const skillBandLabels = ['사람다움', '거의 사람다움', '혼재', 'AI 느낌', 'AI 생성'];
  assert.equal(
    skillBandLabels.length,
    SCORE_INTERPRETATION_BANDS.length,
    'SKILL.md band label list out of sync with SCORE_INTERPRETATION_BANDS — update this test'
  );
  const m = extract(
    skillDoc,
    new RegExp(`점수 해석: ${skillBandLabels.map((label) => `(\\d+)-(\\d+) ${label}`).join(' / ')}`),
    'SKILL.md interpretation band line'
  );
  const bounds = m.slice(1).map(Number);
  SCORE_INTERPRETATION_BANDS.forEach((band, index) => {
    const expectedLow = index === 0 ? 0 : SCORE_INTERPRETATION_BANDS[index - 1].max + 1;
    assert.equal(bounds[2 * index], expectedLow, `SKILL.md band ${index} lower bound drifted`);
    assert.equal(bounds[2 * index + 1], band.max, `SKILL.md band ${index} upper bound drifted`);
  });
});

// ---------------------------------------------------------------------------
// Gate 5 — score floors stay single-sourced
// (No doc in core/*.md, SKILL.md, or README states 90/70 floor values today;
// if one is added, extend this gate with a doc extraction.)
// ---------------------------------------------------------------------------

test('leakage score floor is single-sourced from the feature constant', () => {
  assert.equal(LEAKAGE_SCORE_FLOOR, FEATURE_LEAKAGE_SCORE_FLOOR, 'scoring.js re-export drifted');
  // Documented semantic: a leakage hit short-circuits into the 'heavily AI' band.
  assert.equal(interpretScore(LEAKAGE_SCORE_FLOOR), 'heavily AI');
});

// ---------------------------------------------------------------------------
// Gate 6 — prompt text derives from config/constants (refactor regression gate)
// ---------------------------------------------------------------------------

test('score prompt derives severity scale and interpretation line from one source', () => {
  const defaults = buildScoreMathCore({}, 'ko');
  assert.match(
    defaults,
    new RegExp(
      `Severity scale: Low=${DEFAULT_SEVERITY_POINTS.low}, Medium=${DEFAULT_SEVERITY_POINTS.medium}, High=${DEFAULT_SEVERITY_POINTS.high} points per detection\\.`
    )
  );
  assert.match(defaults, new RegExp(`pattern_count × ${DEFAULT_SEVERITY_POINTS.high}`));

  const expectedInterpretation = SCORE_INTERPRETATION_BANDS
    .map((band, index) => {
      const lower = index === 0 ? 0 : SCORE_INTERPRETATION_BANDS[index - 1].max + 1;
      return `${lower}-${band.max} ${band.label}`;
    })
    .join(' | ');
  assert.ok(
    defaults.includes(`Interpretation: ${expectedInterpretation}\n`),
    'prompt interpretation line must be derived from SCORE_INTERPRETATION_BANDS'
  );
  for (const band of SCORE_INTERPRETATION_BANDS) {
    assert.equal(interpretScore(band.max), band.label, `interpretScore(${band.max})`);
  }

  // Config override must reach the prompt (the pre-Stage-4 bug: hardcoded string).
  const overridden = buildScoreMathCore(
    { ouroboros: { 'severity-points': { high: 4, medium: 2, low: 1 } } },
    'ko'
  );
  assert.match(overridden, /Severity scale: Low=1, Medium=2, High=4 points per detection\./);
  assert.match(overridden, /pattern_count × 4/);
});

test('score prompt embedding core/scoring.md states precedence under a severity override', () => {
  // core/scoring.md hardcodes the default scale (gated above). When a config
  // override is active, buildPrompt must establish precedence inside the same
  // prompt instead of emitting two contradictory severity scales.
  const baseArgs = {
    patterns: [],
    profile: null,
    voice: null,
    scoring: { body: scoringDoc },
    text: 'Sample text.',
    mode: 'score',
  };

  const defaultPrompt = buildPrompt({ ...baseArgs, config: { language: 'ko' } });
  assert.ok(
    !defaultPrompt.includes('Severity-scale override active'),
    'no override note expected when severity points match the documented defaults'
  );

  const overriddenPrompt = buildPrompt({
    ...baseArgs,
    config: { language: 'ko', ouroboros: { 'severity-points': { high: 5, medium: 3, low: 1 } } },
  });
  assert.match(overriddenPrompt, /Severity-scale override active/);
  assert.match(overriddenPrompt, /Low=1, Medium=3, High=5 points per detection/);
  assert.match(overriddenPrompt, /pattern_count × 5/);
  assert.ok(
    overriddenPrompt.indexOf('Severity-scale override active')
      < overriddenPrompt.indexOf('## 1. Severity Scale'),
    'override note must precede the embedded core/scoring.md reference'
  );
});

test('scoreText strict-JSON contract derives example max and interpretation enum', async () => {
  const prompts = [];
  const callLLM = async ({ prompt }) => {
    prompts.push(prompt);
    return '{"categories": {}, "overall": 0, "interpretation": "human"}';
  };
  const patterns = [
    { file: 'ko-content.md', frontmatter: { pack: 'ko-content', patterns: 6 }, body: '### 1. Sample' },
  ];
  const baseConfig = { language: 'ko', scoring: { deterministic: { enabled: false } } };

  await scoreText({ text: 'Sample.', config: baseConfig, patterns, callLLM });
  const expectedEnum = SCORE_INTERPRETATION_BANDS.map((band) => band.label).join(' | ');
  assert.ok(
    prompts[0].includes(`"interpretation": "${expectedEnum}"`),
    'contract interpretation enum must be derived from SCORE_INTERPRETATION_BANDS'
  );
  assert.ok(
    prompts[0].includes(
      `"content": {"detected": 0, "sum": 0, "max": ${6 * DEFAULT_SEVERITY_POINTS.high},`
    ),
    'contract example max must equal pattern_count × default High points'
  );

  await scoreText({
    text: 'Sample.',
    config: { ...baseConfig, ouroboros: { 'severity-points': { high: 5, medium: 3, low: 1 } } },
    patterns,
    callLLM,
  });
  assert.ok(
    prompts[1].includes(`"content": {"detected": 0, "sum": 0, "max": ${6 * 5},`),
    'contract example max must follow a severity-points override'
  );
});

// ---------------------------------------------------------------------------
// Gate 7 — docs/TRANSLATIONESE-KO.md prose == translationese constants
// (STRONG_MIN has no numeric restatement in the doc; Node↔playground constant
// parity for all three thresholds is gated in playground.test.js.)
// ---------------------------------------------------------------------------

test('docs/TRANSLATIONESE-KO.md density-gate prose matches translationese constants', () => {
  assert.equal(
    extractNumber(
      translationeseDoc,
      /absolute floor \(≥(\d+) hits\)/,
      'TRANSLATIONESE-KO.md absolute floor prose'
    ),
    TRANSLATIONESE_ABS_MIN,
    'translationese absolute floor prose drifted from ABS_MIN'
  );
  assert.equal(
    extractNumber(
      translationeseDoc,
      /per-prose-sentence density \(≥([0-9.]+)\)/,
      'TRANSLATIONESE-KO.md density prose'
    ),
    TRANSLATIONESE_DENSITY_MIN,
    'translationese density prose drifted from DENSITY_MIN'
  );
});
