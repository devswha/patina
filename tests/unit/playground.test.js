import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYGROUND_LEXICONS } from '../../playground/data/lexicons.js';
import {
  analyzePlaygroundText,
  detectTranslationese as detectPlaygroundTranslationese,
  buildCliCommand,
  buildFalsePositiveReportUrl,
  renderAuditDiff,
  renderKoreanAdvisory,
  SUPPORTED_LANGS,
  splitProseSentences,
  countFormatting,
  highlightLexiconHits,
  TRANSLATIONESE_RULES as PLAYGROUND_TRANSLATIONESE_RULES,
  TRANSLATIONESE_ABS_MIN,
  TRANSLATIONESE_DENSITY_MIN,
  TRANSLATIONESE_STRONG_MIN,
  KO_POST_EDITESE_SCHEMA as PLAYGROUND_KO_POST_EDITESE_SCHEMA,
  koreanPostEditeseFeatures as playgroundKoPostEditeseFeatures,
  koreanPosDiversityProxy as playgroundKoreanPosDiversityProxy,
  koreanSpacingFeatures as playgroundKoreanSpacingFeatures,
} from '../../playground/analyzer.js';
import { analyzeText } from '../../src/features/index.js';
import {
  detectTranslationese as detectNodeTranslationese,
  ABS_MIN as NODE_TRANSLATIONESE_ABS_MIN,
  DENSITY_MIN as NODE_TRANSLATIONESE_DENSITY_MIN,
  STRONG_MIN as NODE_TRANSLATIONESE_STRONG_MIN,
} from '../../src/features/translationese.js';
import {
  KO_POST_EDITESE_SCHEMA as NODE_KO_POST_EDITESE_SCHEMA,
  koreanPostEditeseFeatures as nodeKoPostEditeseFeatures,
  koreanPosDiversityProxy as nodeKoreanPosDiversityProxy,
  koreanSpacingFeatures as nodeKoreanSpacingFeatures,
} from '../../src/features/stylometry.js';
import {
  createAnalysisController,
  handleAnalysisRequest,
} from '../../playground/analysis-dispatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const SAMPLES = {
  ko: '이 솔루션은 생산성 향상의 핵심 기반으로 자리매김하고 있습니다.',
  en: 'This transformative solution empowers teams to unlock the full potential of a seamless workflow.',
  zh: '总而言之，这一方案能够全面提升用户体验，并为未来发展提供新的可能。',
  ja: 'まとめると、この仕組みはユーザー体験を向上させ、より良い未来につながります。',
};
const FORBIDDEN_KO_POST_EDITESE_KEYS = new Set([
  'hot',
  'severity',
  'score',
  'zScore',
  'zscore',
  'baseline',
  'percentile',
]);

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}
function cloneForTest(value) {
  return JSON.parse(JSON.stringify(value));
}



function analyzeNodeText(text, lang) {
  return analyzeText(text, { lang, repoRoot: REPO_ROOT });
}

test('playground lexicons are generated for every supported language', () => {
  assert.deepEqual(Object.keys(PLAYGROUND_LEXICONS).sort(), [...SUPPORTED_LANGS].sort());
  for (const lang of SUPPORTED_LANGS) {
    const lexicon = PLAYGROUND_LEXICONS[lang];
    assert.equal(lexicon.lang, lang);
    assert.match(lexicon.source, new RegExp(`lexicon/ai-${lang}\\.md`));
    assert.ok(lexicon.strict.length + lexicon.phrases.length >= 50, `${lang} lexicon is unexpectedly small`);
  }
});

test('playground analyzer returns score, audit items, and diff HTML for ko/en/zh/ja', () => {
  for (const lang of SUPPORTED_LANGS) {
    const analysis = analyzePlaygroundText(SAMPLES[lang], { lang });
    assert.equal(analysis.lang, lang);
    assert.ok(Number.isInteger(analysis.overall));
    assert.ok(analysis.overall > 0, `${lang} sample should surface an editing signal`);
    assert.ok(analysis.auditItems.length >= 1, `${lang} sample should have an audit item`);
    assert.ok(analysis.paragraphs[0].lexicon.matches >= 1, `${lang} sample should hit lexicon`);

    const html = renderAuditDiff(analysis);
    assert.match(html, /diff-card/);
    assert.match(html, /<mark>/);
  }
});

test('playground and node analyzers agree on shared deterministic signals', () => {
  for (const lang of SUPPORTED_LANGS) {
    const nodeAnalysis = analyzeNodeText(SAMPLES[lang], lang);
    const playgroundAnalysis = analyzePlaygroundText(SAMPLES[lang], { lang });
    assert.equal(
      playgroundAnalysis.paragraphs[0].lexicon.matches > 0,
      nodeAnalysis.paragraphs[0].lexicon.matches > 0,
      `${lang} lexicon-hit presence should match node analyzer`,
    );
  }

  const cases = [
    {
      name: 'model-output leakage',
      text: 'This paragraph contains turn0search0 from copied model output.',
      lang: 'en',
      nodeHot: (analysis) => analysis.markupLeakage.leaked,
      playgroundHot: (analysis) => analysis.markupLeakage.leaked,
    },
    {
      name: 'fake-candor opener density',
      text: "Here's the thing. Let's be honest. The rollout still needs one owner and one deadline.",
      lang: 'en',
      nodeHot: (analysis) => analysis.discourseTells.fakeCandor.hot,
      playgroundHot: (analysis) => analysis.discourseTells.fakeCandor.hot,
    },
    {
      name: 'short non-hot control',
      text: 'I changed one parser branch and wrote down the reason.',
      lang: 'en',
      nodeHot: (analysis) => analysis.hot,
      playgroundHot: (analysis) => analysis.hotCount > 0,
    },
  ];

  for (const sample of cases) {
    const nodeAnalysis = analyzeNodeText(sample.text, sample.lang);
    const playgroundAnalysis = analyzePlaygroundText(sample.text, { lang: sample.lang });
    assert.equal(
      sample.playgroundHot(playgroundAnalysis),
      sample.nodeHot(nodeAnalysis),
      `${sample.name} verdict should match node analyzer`,
    );
  }
});
test('playground mirrors ko translationese advisory payload without score coupling', () => {
  const text = '메리는 그녀가 그녀의 책을 갖고 있다. 회의에서의 결정으로의 이동은 에이전트에 의해 처리되었다.';
  const nodeSignal = detectNodeTranslationese(text, { lang: 'ko' });
  const playgroundSignal = detectPlaygroundTranslationese(text, { lang: 'ko' });
  const nodeIds = nodeSignal.byRule.map((x) => x.id).sort();
  const playgroundIds = playgroundSignal.byRule.map((x) => x.id).sort();

  assert.equal(nodeSignal.hot, true);
  assert.equal(playgroundSignal.hot, true);
  assert.deepEqual(playgroundIds, nodeIds);
  assert.equal(playgroundSignal.thresholds.count, nodeSignal.thresholds.count);
  assert.equal(playgroundSignal.thresholds.density, nodeSignal.thresholds.density);
  assert.equal(playgroundSignal.thresholds.strong, nodeSignal.thresholds.strong);

  const analysis = analyzePlaygroundText(text, { lang: 'ko' });
  assert.equal(analysis.translationese.hot, true);
  assert.equal(analysis.hotCount, 0);
  assert.equal(analysis.overall, 0);
  assert.equal(analysis.auditItems.length, 0);

  const nonKo = analyzePlaygroundText(text, { lang: 'en' });
  assert.equal(nonKo.translationese.count, 0);
  assert.equal(nonKo.translationese.hot, false);
});
test('translationese rule catalog stays pinned (shared module)', () => {
  // Playground and node now share one module binding, so a cross-surface
  // deepEqual would compare the object to itself. Pin the catalog as literals
  // instead, so accidental rule deletions/renames in src still fail a test.
  assert.deepEqual(
    PLAYGROUND_TRANSLATIONESE_RULES.map((rule) => rule.id),
    [
      'noun-calque',
      'dummy-subject',
      'direct-address-you',
      'a16-pronoun-literal',
      'a19-double-particle',
      'passive-e-uihae',
      't2-by-passive',
      'a8-double-passive',
      'have-overuse',
      'a7-light-verb',
      'one-of',
      'provides',
      'as-follows',
      'make-easy',
      'c11-connective-comma',
    ],
  );
  assert.deepEqual(
    PLAYGROUND_TRANSLATIONESE_RULES.filter((rule) => rule.strong).map((rule) => rule.id),
    [
      'noun-calque',
      'dummy-subject',
      'direct-address-you',
      'a16-pronoun-literal',
      'a19-double-particle',
      't2-by-passive',
      'a8-double-passive',
    ],
  );
  assert.deepEqual(
    PLAYGROUND_TRANSLATIONESE_RULES.filter((rule) => (rule.minCount ?? 1) !== 1)
      .map((rule) => [rule.id, rule.minCount]),
    [['c11-connective-comma', 2]],
  );
  for (const rule of PLAYGROUND_TRANSLATIONESE_RULES) {
    assert.ok(rule.re() instanceof RegExp, `rule ${rule.id} must expose a regex factory`);
    assert.ok(rule.label, `rule ${rule.id} must have a label`);
    assert.ok(rule.example?.before, `rule ${rule.id} must have a before example`);
  }
  assert.equal(TRANSLATIONESE_ABS_MIN, 4);
  assert.equal(TRANSLATIONESE_DENSITY_MIN, 0.5);
  assert.equal(TRANSLATIONESE_STRONG_MIN, 1);

  for (const rule of PLAYGROUND_TRANSLATIONESE_RULES) {
    const signal = detectPlaygroundTranslationese(rule.example.before, { lang: 'ko' });
    assert.ok(
      signal.byRule.some((hit) => hit.id === rule.id),
      `playground rule ${rule.id} does not match its own before example`,
    );
  }

  const empty = detectPlaygroundTranslationese('', { lang: 'ko' });
  assert.deepEqual(empty.thresholds, {
    count: NODE_TRANSLATIONESE_ABS_MIN,
    density: NODE_TRANSLATIONESE_DENSITY_MIN,
    strong: NODE_TRANSLATIONESE_STRONG_MIN,
  });
});

test('playground mirrors weak-only and overlap de-duplication translationese semantics', () => {
  const cases = [
    {
      name: 'weak-only advisory density',
      text: '사용법은 다음과 같습니다. 다양한 기능을 제공합니다. 설치를 쉽게 만들어 줍니다. 가장 빠른 도구 중 하나입니다.',
      expectedCount: 4,
      expectedHot: false,
    },
    {
      name: 'overlapping raw rules',
      text: '그것은 중요하다. 그것은 필요하다. 이 작업은 에이전트에 의해 처리되었다.',
      expectedCount: 3,
      expectedHot: false,
    },
  ];

  for (const sample of cases) {
    const nodeSignal = detectNodeTranslationese(sample.text, { lang: 'ko' });
    const playgroundSignal = detectPlaygroundTranslationese(sample.text, { lang: 'ko' });

    assert.deepEqual(
      {
        ids: playgroundSignal.byRule.map((x) => x.id).sort(),
        count: playgroundSignal.count,
        density: playgroundSignal.density,
        hot: playgroundSignal.hot,
        thresholds: playgroundSignal.thresholds,
      },
      {
        ids: nodeSignal.byRule.map((x) => x.id).sort(),
        count: nodeSignal.count,
        density: nodeSignal.density,
        hot: nodeSignal.hot,
        thresholds: nodeSignal.thresholds,
      },
      `${sample.name} should mirror node`,
    );
    assert.equal(playgroundSignal.count, sample.expectedCount, sample.name);
    assert.equal(playgroundSignal.hot, sample.expectedHot, sample.name);
  }
});
test('playground normalizes NFD Korean once before shared analysis', () => {
  const text = '이 솔루션은 생산성 향상의 핵심 기반으로 자리매김하고 있습니다.';
  const nfd = text.normalize('NFD');
  const nodeAnalysis = analyzeNodeText(nfd, 'ko');
  const playgroundAnalysis = analyzePlaygroundText(nfd, { lang: 'ko' });

  assert.equal(playgroundAnalysis.paragraphs[0].text, text);
  assert.equal(playgroundAnalysis.paragraphs[0].lexicon.matches, nodeAnalysis.paragraphs[0].lexicon.matches);
  assert.equal(playgroundAnalysis.translationese.count, detectNodeTranslationese(nfd, { lang: 'ko' }).count);
  assert.equal(playgroundAnalysis.koPostEditese.eojeolCount, nodeAnalysis.koPostEditese.eojeolCount);
});

test('playground Korean spacing payload matches node field names', () => {
  const text = '한 두 사람은 오늘의 작업을 차분하게 검토합니다.';
  const playgroundSpacing = playgroundKoreanSpacingFeatures(text);
  const nodeSpacing = nodeKoreanSpacingFeatures(text);

  assert.deepEqual(playgroundSpacing, nodeSpacing);
  assert.equal(Object.hasOwn(playgroundSpacing, 'singleSyllableRatio'), true);
  assert.equal(Object.hasOwn(playgroundSpacing, 'shortEojeolRatio'), false);
});

test('playground Korean POS diversity proxy uses longest suffix parity with node', () => {
  const text = '회의에서의 결정으로의 전환은 사용자에게서 나온 자료로써 기준으로서 작동합니다.';
  const playgroundProxy = playgroundKoreanPosDiversityProxy(text);
  const nodeProxy = nodeKoreanPosDiversityProxy(text);

  assert.deepEqual(playgroundProxy, nodeProxy);
  assert.equal(playgroundProxy.matchedCount, 7);
  assert.deepEqual(playgroundProxy.classes, [
    'formal_ending',
    'genitive',
    'instrument',
    'source',
    'standard',
    'topic',
  ]);
});
test('playground mirrors ko post-editese schema and metrics in parity with node', () => {
  const text = [
    '그녀는 회의에서의 결정을 검토하고 있다.',
    '이 작업은 에이전트에 의해 처리되어진다.',
    '',
    '우리는 회의를 가졌고, 결정을 내렸다.',
    '그것은 중요한 자료이다.',
  ].join('\n');
  const nodePayload = nodeKoPostEditeseFeatures(text, { lang: 'ko' });
  const playgroundPayload = playgroundKoPostEditeseFeatures(text, { lang: 'ko' });

  assert.equal(PLAYGROUND_KO_POST_EDITESE_SCHEMA, NODE_KO_POST_EDITESE_SCHEMA);
  assert.equal(playgroundPayload.schema, 'koPostEditese.v1');
  assert.deepEqual(playgroundPayload, nodePayload);
});

test('playground ko post-editese implementation is the shared node implementation (issue #395)', () => {
  assert.equal(playgroundKoPostEditeseFeatures, nodeKoPostEditeseFeatures);
});

test('playground mirrors stacked-particle pronoun literal counts (issue #395)', () => {
  const text = [
    '그들에게는 선택지가 없었다.',
    '그녀에게도 같은 통지가 갔다.',
    '그들과의 협상은 결렬되었다.',
    '그것도 모자라 그것만 반복했다.',
    '그들처럼 행동했고 그녀보다 빨랐다.',
  ].join(' ');
  const nodePayload = nodeKoPostEditeseFeatures(text, { lang: 'ko' });
  const playgroundPayload = playgroundKoPostEditeseFeatures(text, { lang: 'ko' });

  assert.deepEqual(playgroundPayload, nodePayload);
  assert.equal(playgroundPayload.metrics.interference.pronounLiteralCount, 7);
});

test('playground returns stable skipped ko post-editese payloads in parity with node', () => {
  for (const sample of [
    { text: 'This is plain English.', lang: 'en' },
    { text: '   ', lang: 'ko' },
    { text: '... !!!', lang: 'ko' },
    { text: 'This English-labeled text mentions 그녀 and 그것.', lang: 'en' },
  ]) {
    const nodePayload = nodeKoPostEditeseFeatures(sample.text, { lang: sample.lang });
    const playgroundPayload = playgroundKoPostEditeseFeatures(sample.text, { lang: sample.lang });
    assert.deepEqual(playgroundPayload, nodePayload);
    assert.equal(playgroundPayload.analyzed, false);
    assert.equal(playgroundPayload.paragraphCount, 0);
    assert.deepEqual(playgroundPayload.paragraphs, []);
  }
});

test('playground surfaces ko post-editese without score, hot, or audit coupling', () => {
  const text = '그녀는 회의에서의 결정을 검토하고 있다. 이 작업은 에이전트에 의해 처리되어진다.';
  const analysis = analyzePlaygroundText(text, { lang: 'ko' });
  const expectedHotRatio = analysis.paragraphCount === 0
    ? 0
    : Math.round((analysis.hotCount / analysis.paragraphCount) * 100);
  const expectedOverall = analysis.markupLeakage.leaked
    ? Math.max(expectedHotRatio, 90)
    : expectedHotRatio;

  assert.equal(analysis.koPostEditese.schema, 'koPostEditese.v1');
  assert.equal(analysis.koPostEditese.analyzed, true);
  assert.ok(analysis.koPostEditese.metrics.interference.pronounLiteralCount >= 1);
  assert.equal(analysis.hotCount, analysis.paragraphs.filter((paragraph) => paragraph.hot).length);
  assert.equal(analysis.overall, expectedOverall);
  assert.deepEqual(
    analysis.auditItems,
    analysis.paragraphs.filter((paragraph) => paragraph.hot || paragraph.lexicon.matches > 0),
  );
  assert.equal(analysis.paragraphs.some((paragraph) => paragraph.reasons.some((reason) => reason.code.includes('post'))), false);

  const forbidden = collectObjectKeys(analysis.koPostEditese)
    .filter((key) => FORBIDDEN_KO_POST_EDITESE_KEYS.has(key));
  assert.deepEqual(forbidden, []);
});

test('playground renders Korean advisory panel separately from audit and diff', () => {
  const text = '메리는 그녀의 책을 갖고 있다. 회의에서의 결정은 에이전트에 의해 처리되어진다.';
  const analysis = analyzePlaygroundText(text, { lang: 'ko' });
  const before = {
    overall: analysis.overall,
    hotCount: analysis.hotCount,
    auditItems: cloneForTest(analysis.auditItems),
    paragraphHot: analysis.paragraphs.map((paragraph) => paragraph.hot),
    reasons: analysis.paragraphs.map((paragraph) => cloneForTest(paragraph.reasons)),
  };

  const html = renderKoreanAdvisory(analysis);

  assert.match(html, /advisory-grid/);
  assert.match(html, /Translationese hints/);
  assert.match(html, /Korean post-editese metadata/);
  assert.match(html, /count 1/);
  assert.match(html, /Density/);
  assert.match(html, /Samples:/);
  assert.match(html, /koPostEditese\.v1/);
  assert.match(html, /Paragraphs/);
  assert.match(html, /pronoun literal count/);
  assert.match(html, /suffix diversity/);
  assert.doesNotMatch(html, /diff-card/);
  assert.doesNotMatch(html, /<mark>/);
  assert.equal(analysis.overall, before.overall);
  assert.equal(analysis.hotCount, before.hotCount);
  assert.deepEqual(analysis.auditItems, before.auditItems);
  assert.deepEqual(analysis.paragraphs.map((paragraph) => paragraph.hot), before.paragraphHot);
  assert.deepEqual(analysis.paragraphs.map((paragraph) => paragraph.reasons), before.reasons);
});

test('playground advisory rendering escapes labels, examples, and samples', () => {
  const analysis = analyzePlaygroundText('그것은 중요하다.', { lang: 'ko' });
  analysis.translationese = {
    count: 1,
    density: 1,
    sentences: 1,
    byRule: [{
      id: '<rule>',
      label: '<img src=x onerror=alert(1)>',
      count: 1,
      strong: true,
      example: { before: '<script>bad()</script>', after: '"safe" & revised' },
    }],
    hits: ['<b>sample</b>'],
  };

  const html = renderKoreanAdvisory(analysis);

  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>sample/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /&quot;safe&quot; &amp; revised/);
  assert.match(html, /&lt;b&gt;sample&lt;\/b&gt;/);
});

test('playground advisory rendering handles skipped and non-Korean states', () => {
  const emptyKo = analyzePlaygroundText('   ', { lang: 'ko' });
  const emptyHtml = renderKoreanAdvisory(emptyKo);
  assert.match(emptyHtml, /skipped: empty/);
  assert.match(emptyHtml, /No Korean translationese rules surfaced/);

  const en = analyzePlaygroundText('This transformative solution empowers teams.', { lang: 'en' });
  const enHtml = renderKoreanAdvisory(en);
  assert.match(enHtml, /unavailable for this language/);
  assert.doesNotMatch(enHtml, /advisory-grid/);
});

test('playground ports thematic-break discourse tells from the node analyzer', () => {
  const text = [
    '---',
    '# First section',
    'This practical note uses a plain sentence with uneven length.',
    '',
    '***',
    '# Second section',
    'The middle paragraph records the concrete tradeoff before the recommendation.',
    '',
    '___',
    '# Third section',
    'The final paragraph names the owner and the next review window.',
  ].join('\n');

  const nodeAnalysis = analyzeNodeText(text, 'en');
  const playgroundAnalysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(nodeAnalysis.discourseTells.thematicBreaks.hot, true);
  assert.equal(
    playgroundAnalysis.discourseTells.thematicBreaks.count,
    nodeAnalysis.discourseTells.thematicBreaks.count,
  );
  assert.equal(
    playgroundAnalysis.discourseTells.thematicBreaks.adjacentToHeading,
    nodeAnalysis.discourseTells.thematicBreaks.adjacentToHeading,
  );
  assert.equal(
    playgroundAnalysis.discourseTells.thematicBreaks.hot,
    nodeAnalysis.discourseTells.thematicBreaks.hot,
  );
  assert.ok(playgroundAnalysis.paragraphs.some((paragraph) => paragraph.thematicBreaks.hot));
  assert.ok(playgroundAnalysis.paragraphs.some((paragraph) => paragraph.reasons.some((reason) => reason.code === 'thematic-break')));
});

test('playground excludes Markdown list blocks from prose rhythm samples', () => {
  const text = `Here is what the tool does for you:
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models
- distribute work across Codex, Claude, and Gemini`;

  assert.deepEqual(splitProseSentences(text), ['Here is what the tool does for you:']);

  const nodeAnalysis = analyzeNodeText(text, 'en');
  const playgroundAnalysis = analyzePlaygroundText(text, { lang: 'en' });
  assert.equal(playgroundAnalysis.paragraphs[0].sentenceCount, nodeAnalysis.paragraphs[0].sentenceCount);
  assert.equal(playgroundAnalysis.paragraphs[0].burstiness.band, nodeAnalysis.paragraphs[0].burstiness.band);
  assert.equal(playgroundAnalysis.hotCount > 0, nodeAnalysis.hot);

  const twoSentenceResidue = `This intro names the list. It stays under the burstiness gate.
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models`;
  const residueNode = analyzeNodeText(twoSentenceResidue, 'en');
  const residuePlayground = analyzePlaygroundText(twoSentenceResidue, { lang: 'en' });
  assert.equal(residuePlayground.paragraphs[0].sentenceCount, residueNode.paragraphs[0].sentenceCount);
  assert.equal(residuePlayground.paragraphs[0].burstiness.band, residueNode.paragraphs[0].burstiness.band);
  assert.equal(residuePlayground.hotCount > 0, residueNode.hot);
});

test('playground flags a single emoji marker because pattern 17 is any-hit', () => {
  const text = 'Status update 🙂 the deploy finished on time.';
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 1);
  assert.equal(analysis.paragraphs[0].formatting.docEmoji, 1);
  assert.ok(analysis.paragraphs[0].reasons.some((reason) => reason.code === 'emoji-overuse'));
});

test('playground counts joined emoji by visible glyph and still flags them once', () => {
  const text = `Status update 👩‍💻 the deploy finished on time.

Budget note 👨‍👩‍👧‍👦 the team stayed within plan.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.paragraphs[0].formatting.docEmoji, 2);
  assert.equal(analysis.hotCount, 2);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.some((reason) => reason.code === 'emoji-overuse')));

  assert.deepEqual(countFormatting('👩‍💻 👨‍👩‍👧‍👦', { segmenter: null }), { emDash: 0, bold: 0, emoji: 2 });
});

test('playground marks repeated em dashes as a document-level formatting tell', () => {
  const text = `Status update — the deploy finished on time.

Budget note — the team stayed within plan.

Support review — response time dropped this week.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 3);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.formatting.docEmDash === 3));
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.some((reason) => reason.code === 'em-dash-overuse')));
});

test('playground does not hot-classify em dashes below the threshold', () => {
  const text = `Status update — the deploy finished on time.

Budget note — the team stayed within plan.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 0);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.every((reason) => reason.code !== 'em-dash-overuse')));
});

test('playground marks repeated bold spans as a document-level formatting tell', () => {
  const text = `**Status** update for the deploy.

**Budget** note for the team.

**Support** review from this week.

**Latency** trend from the dashboard.

**Owner** list for the rollout.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 5);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.formatting.docBold === 5));
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.some((reason) => reason.code === 'bold-overuse')));
});

test('playground marks 3 bold spans in one paragraph even below the document threshold', () => {
  const text = '**Status** update with a **Budget** note and a **Support** review.';
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 1);
  assert.ok(analysis.paragraphs[0].reasons.some((reason) => reason.code === 'bold-overuse'));
});

test('playground does not hot-classify bold spans below both thresholds', () => {
  const text = '**Status** update with a **Budget** note for the deploy.';
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 0);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.every((reason) => reason.code !== 'bold-overuse')));
});

test('playground keeps one Korean lexicon hit as an audit hint', () => {
  const analysis = analyzePlaygroundText('이 문서는 다음 작업의 자리매김을 설명한다.', { lang: 'ko' });
  assert.equal(analysis.paragraphs[0].lexicon.matches, 1);
  assert.equal(analysis.paragraphs[0].lexicon.hot, false);
  assert.equal(analysis.paragraphs[0].hot, false);
  assert.equal(analysis.auditItems.length, 1);
});

test('playground short-circuits the score when markup leakage is present', () => {
  const text = `This paragraph reads like ordinary notes about the deploy and the on-call rotation.

The middle paragraph mentions turn0search1 copied straight out of a model response.

The closing paragraph stays calm and human, with uneven sentence lengths and no tells.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.markupLeakage.leaked, true);
  assert.ok(analysis.overall >= 90, `expected leakage floor, got ${analysis.overall}`);

  const clean = analyzePlaygroundText(text.replace('turn0search1 copied straight out of a model response', 'a quote copied straight out of the meeting notes'), { lang: 'en' });
  assert.equal(clean.markupLeakage.leaked, false);
  assert.ok(clean.overall < 90, `clean prose should not hit the leakage floor, got ${clean.overall}`);
});

test('playground diff escapes pasted HTML before highlighting', () => {
  const analysis = analyzePlaygroundText('<script>alert(1)</script> This transformative workflow is seamless.', { lang: 'en' });
  const html = renderAuditDiff(analysis);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<mark>transformative<\/mark>/);
});

test('Open in CLI command preserves input and avoids heredoc delimiter collisions', () => {
  const command = buildCliCommand('first line\nPATINA_TEXT\nlast line', 'ko');
  assert.match(command, /cat > patina-input\.txt <<'PATINA_TEXT_2'/);
  assert.match(command, /first line\nPATINA_TEXT\nlast line/);
  assert.match(command, /npx patina-cli --lang ko --score patina-input\.txt/);
  assert.match(command, /npx patina-cli --lang ko --audit patina-input\.txt/);
});

test('Report false positive pre-fills the GitHub false-positive form from the audit', () => {
  const text = SAMPLES.ko;
  const analysis = analyzePlaygroundText(text, { lang: 'ko' });
  const url = buildFalsePositiveReportUrl(text, 'ko', analysis);
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://github.com/devswha/patina/issues/new');
  assert.equal(parsed.searchParams.get('template'), 'false_positive.yml');
  assert.equal(parsed.searchParams.get('language'), 'ko');
  assert.match(parsed.searchParams.get('fired_paragraph'), /자리매김/);
  const out = parsed.searchParams.get('score_output');
  assert.match(out, /patina playground/);
  assert.match(out, /Score: \d+\/100/);
  assert.match(out, /Hot paragraphs: \d+\/\d+/);
});

test('Report false positive caps the pasted paragraph and tolerates empty input', () => {
  const long = 'A'.repeat(10000);
  const longUrl = buildFalsePositiveReportUrl(long, 'en');
  const fired = new URL(longUrl).searchParams.get('fired_paragraph');
  assert.ok(longUrl.length < 8000, 'report URL should be truncated to stay under the GitHub budget');
  assert.match(fired, /truncated/);

  const empty = new URL(buildFalsePositiveReportUrl('', 'ja')).searchParams;
  assert.equal(empty.get('language'), 'ja');
  assert.equal(empty.get('template'), 'false_positive.yml');
});

test('Report false positive caps long Korean by encoded URL budget', () => {
  const longKo = `${'자리매김 '.repeat(3000)}마지막 문장입니다.`;
  const url = buildFalsePositiveReportUrl(longKo, 'ko');
  const parsed = new URL(url);
  const fired = parsed.searchParams.get('fired_paragraph');

  assert.ok(url.length < 8000, `expected URL below GitHub budget, got ${url.length}`);
  assert.equal(parsed.searchParams.get('template'), 'false_positive.yml');
  assert.equal(parsed.searchParams.get('language'), 'ko');
  assert.match(fired, /truncated/);
  assert.match(fired, /^자리매김/);
});

test('playground HTML exposes the false-positive report button', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  assert.match(html, /id="report-fp"/);
  assert.match(html, /Report false positive/);
});

test('playground HTML exposes the Korean advisory container with advisory-only copy', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  assert.match(html, /id="korean-advisory"/);
  assert.match(html, /Korean editing hints/);
  assert.match(html, /advisory-only revision hints/);
  assert.match(html, /never change score, hotspots, or audit rows/);
});

test('playground HTML points canonical and OG metadata at patina.vibetip.help', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  assert.match(html, /https:\/\/patina\.vibetip\.help\//);
  assert.match(html, /assets\/social\/patina-og\.svg/);
  assert.match(html, /audit-only playground/);
});

test('playground HTML wires Vercel analytics without inline script', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  const analytics = readFileSync(resolve(REPO_ROOT, 'playground/analytics.js'), 'utf8');
  assert.match(html, /<script defer src="\/analytics\.js"><\/script>/);
  assert.match(html, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>/);
  assert.doesNotMatch(html, /window\.va\s*=/);
  assert.match(analytics, /window\.va/);
  assert.match(analytics, /window\.vaq/);
});


test('Vercel config exposes the playground at the domain root', () => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/' && rule.destination === '/playground'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/analytics.js' && rule.destination === '/playground/analytics.js'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/data/:path*' && rule.destination === '/playground/data/:path*'));
  const csp = config.headers[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value;
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /connect-src 'self'(?:;|$)/);
});

// Single-pass scanner producing two views of a JS source: comments removed with
// string contents kept (for reading import specifiers), and comments removed with
// string/template contents blanked (for detecting dynamic import()/require()
// without false-positives from words inside literals). Regex literals are not
// modeled; an unescaped `//` can only appear inside one via a character class,
// which none of the walked files use.
function scanJsSource(source) {
  let withStrings = '';
  let codeOnly = '';
  let state = 'code';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block'; i += 2; continue; }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      withStrings += ch;
      codeOnly += ch;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; withStrings += ch; codeOnly += ch; }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 2; } else i += 1;
      continue;
    }
    // Inside a string or template literal.
    if (ch === '\\') {
      withStrings += ch + (next ?? '');
      i += 2;
      continue;
    }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'template' && ch === '`')
    ) {
      state = 'code';
      withStrings += ch;
      codeOnly += ch;
      i += 1;
      continue;
    }
    withStrings += ch;
    if (ch === '\n') codeOnly += ch;
    i += 1;
  }
  return { withStrings, codeOnly };
}

function collectStaticImports(relativeEntry) {
  const seen = new Set();
  const pending = [resolve(REPO_ROOT, relativeEntry)];
  const violations = [];

  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const { withStrings: source, codeOnly } = scanJsSource(readFileSync(file, 'utf8'));

    // The browser graph must stay fully static: dynamic import()/require()
    // would be invisible to this walker, so their mere presence is a violation.
    for (const dynamic of codeOnly.matchAll(/(?<![.\w])(?:import|require)\s*\(/g)) {
      violations.push(
        `${relative(REPO_ROOT, file)} -> ${dynamic[0].replace(/\s+/g, '')}...) (graph must be static)`,
      );
    }

    const importPattern = /\b(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier.startsWith('node:') || (!specifier.startsWith('.') && !specifier.startsWith('/'))) {
        violations.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        continue;
      }

      const child = specifier.startsWith('/')
        ? resolve(REPO_ROOT, `.${specifier}`)
        : resolve(dirname(file), specifier);
      if (!child.startsWith(REPO_ROOT) || !child.endsWith('.js')) {
        violations.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        continue;
      }
      pending.push(child);
    }
  }

  return { seen, violations };
}

test('playground static module graph stays browser-pure', () => {
  const { seen, violations } = collectStaticImports('playground/app.js');
  assert.deepEqual(violations, []);
  assert.ok([...seen].some((file) => file.endsWith('/src/features/segment.js')));
});

test('generated playground lexicon bundle is in sync with markdown lexicons', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-playground-data.mjs', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('playground emoji tell ignores text-presentation symbols ™/©/® (#450)', () => {
  assert.equal(countFormatting('Acme\u2122 \u00a9 2026 \u00ae', { segmenter: null }).emoji, 0);
  // A default-emoji-presentation pictograph still counts.
  assert.equal(countFormatting('Ship it \u{1F680}', { segmenter: null }).emoji, 1);
  // A text-default pictograph forced to emoji presentation with U+FE0F counts.
  assert.equal(countFormatting('mark \u2122\uFE0F', { segmenter: null }).emoji, 1);
});

test('highlightLexiconHits falls back to plain escaping when lowercasing changes length (#450)', () => {
  // 'İ' (U+0130) lowercases to 2 UTF-16 units, so index math against the
  // lowercased copy would drift and mark the wrong substring.
  assert.equal(highlightLexiconHits('\u0130stanbul tool', ['tool']).includes('<mark>'), false);
  // A same-length string still highlights the hit.
  assert.ok(highlightLexiconHits('great tool here', ['tool']).includes('<mark>tool</mark>'));
});
// --- A4: playground analysis worker dispatch --------------------------------

function makeFakeWorker() {
  return {
    posted: [],
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(message) { this.posted.push(message); },
    terminate() { this.terminated = true; },
    respond(requestId, analysis) { this.onmessage?.({ data: { requestId, analysis } }); },
    fail(error) { this.onerror?.(error ?? new Error('worker boom')); },
  };
}

const fakeAnalyze = (text, { lang } = {}) => ({ text, lang, source: 'analyze' });

test('handleAnalysisRequest echoes the request id and analyzes text+lang', () => {
  const out = handleAnalysisRequest({ requestId: 7, text: 'hi', lang: 'en' }, fakeAnalyze);
  assert.deepEqual(out, { requestId: 7, analysis: { text: 'hi', lang: 'en', source: 'analyze' } });
  // Missing fields coerce safely (structured-clone-safe, no throw).
  const empty = handleAnalysisRequest(undefined, fakeAnalyze);
  assert.equal(empty.requestId, undefined);
  assert.deepEqual(empty.analysis, { text: '', lang: undefined, source: 'analyze' });
});

test('controller falls back to same-thread analysis when no worker is available', () => {
  const results = [];
  const controller = createAnalysisController({
    analyze: fakeAnalyze,
    createWorker: () => null,
    onResult: (analysis, id) => results.push([id, analysis]),
  });
  const r = controller.request('alpha', 'en');
  assert.equal(r.mode, 'sync');
  assert.equal(controller.usingWorker, false);
  assert.deepEqual(results, [[1, { text: 'alpha', lang: 'en', source: 'analyze' }]]);
});

test('controller uses the worker and applies only the latest (non-stale) response', () => {
  const worker = makeFakeWorker();
  const results = [];
  const controller = createAnalysisController({
    analyze: fakeAnalyze,
    createWorker: () => worker,
    onResult: (analysis, id) => results.push([id, analysis]),
  });
  assert.equal(controller.request('first', 'en').mode, 'worker');
  assert.equal(controller.request('second', 'ko').mode, 'worker');
  assert.equal(controller.usingWorker, true);
  assert.deepEqual(worker.posted, [
    { requestId: 1, text: 'first', lang: 'en' },
    { requestId: 2, text: 'second', lang: 'ko' },
  ]);
  // A stale response for the superseded request id is dropped.
  worker.respond(1, { stale: true });
  assert.deepEqual(results, []);
  assert.equal(controller.isStale(1), true);
  // The latest response renders.
  worker.respond(2, { fresh: true });
  assert.deepEqual(results, [[2, { fresh: true }]]);
});

test('controller falls back to same-thread when worker construction throws', () => {
  const results = [];
  const controller = createAnalysisController({
    analyze: fakeAnalyze,
    createWorker: () => { throw new Error('no worker'); },
    onResult: (analysis) => results.push(analysis),
  });
  assert.equal(controller.request('x', 'en').mode, 'sync');
  assert.deepEqual(results, [{ text: 'x', lang: 'en', source: 'analyze' }]);
});

test('controller falls back and terminates the worker when postMessage throws', () => {
  const worker = makeFakeWorker();
  worker.postMessage = () => { throw new Error('detached'); };
  const results = [];
  const controller = createAnalysisController({
    analyze: fakeAnalyze,
    createWorker: () => worker,
    onResult: (analysis) => results.push(analysis),
  });
  assert.equal(controller.request('y', 'ko').mode, 'sync');
  assert.equal(worker.terminated, true);
  assert.deepEqual(results, [{ text: 'y', lang: 'ko', source: 'analyze' }]);
});

test('controller recovers the in-flight request and falls back after a worker runtime error', () => {
  const worker = makeFakeWorker();
  const errors = [];
  const results = [];
  const controller = createAnalysisController({
    analyze: fakeAnalyze,
    createWorker: () => worker,
    onResult: (analysis, id) => results.push([id, analysis]),
    onError: (e) => errors.push(e),
  });
  controller.request('one', 'en'); // worker path, id 1
  worker.fail(new Error('crash')); // worker dies -> recover id 1 same-thread
  assert.equal(errors.length, 1);
  assert.equal(controller.usingWorker, false);
  assert.deepEqual(results, [[1, { text: 'one', lang: 'en', source: 'analyze' }]]);
  // Subsequent requests stay on the main thread.
  assert.equal(controller.request('two', 'en').mode, 'sync');
  assert.deepEqual(results, [
    [1, { text: 'one', lang: 'en', source: 'analyze' }],
    [2, { text: 'two', lang: 'en', source: 'analyze' }],
  ]);
});

test('controller does not re-render after a worker error following a completed response', () => {
  const worker = makeFakeWorker();
  const results = [];
  const controller = createAnalysisController({
    analyze: fakeAnalyze,
    createWorker: () => worker,
    onResult: (analysis, id) => results.push([id, analysis]),
  });
  controller.request('one', 'en'); // id 1, worker path
  worker.respond(1, { done: true }); // accepted -> rendered exactly once
  assert.deepEqual(results, [[1, { done: true }]]);
  // A late worker crash must NOT re-run the already-completed latest request.
  worker.fail(new Error('late crash'));
  assert.deepEqual(results, [[1, { done: true }]]);
  assert.equal(controller.usingWorker, false);
});

test('playground worker module graph stays browser-pure and loads by relative URL', () => {
  const { seen, violations } = collectStaticImports('playground/analyzer-worker.js');
  assert.deepEqual(violations, []);
  assert.ok([...seen].some((file) => file.endsWith('/playground/analysis-dispatch.js')));
  const workerSrc = readFileSync(resolve(REPO_ROOT, 'playground/analyzer-worker.js'), 'utf8');
  assert.match(workerSrc, /from '\.\/analyzer\.js'/);
  assert.match(workerSrc, /globalThis\.onmessage/);
  assert.match(workerSrc, /globalThis\.postMessage/);
  // app.js must load the worker by relative URL so static hosting keeps working.
  const appSrc = readFileSync(resolve(REPO_ROOT, 'playground/app.js'), 'utf8');
  assert.match(appSrc, /new URL\('\.\/analyzer-worker\.js', import\.meta\.url\)/);
});
