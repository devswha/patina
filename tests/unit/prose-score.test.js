import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  countPatternWatchHits,
  detectLanguage,
  extractPatternWatchTerms,
  formatMarkdownReport,
  paragraphSignalStrength,
  parseFileList,
  scoreFiles,
  scoreText,
  stripNonProse,
  stripProse,
  summarizeSignalStrength,
} from '../../scripts/prose-score.mjs';
import { analyzeText } from '../../src/features/index.js';
import { LEAKAGE_SCORE_FLOOR } from '../../src/scoring.js';

test('parseFileList accepts newline and comma separated paths', () => {
  assert.deepEqual(parseFileList('README.md, docs/a.md\nnotes.mdx'), ['README.md', 'docs/a.md', 'notes.mdx']);
});

test('stripNonProse keeps prose while removing code and tables', () => {
  const stripped = stripNonProse('# Title\n\nReal prose stays.\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|');
  assert.match(stripped, /Real prose stays/);
  assert.doesNotMatch(stripped, /Title/);
  assert.doesNotMatch(stripped, /const x/);
  assert.doesNotMatch(stripped, /\| a \|/);
});

test('stripNonProse removes table rows before p-value text can look like HTML', () => {
  const stripped = stripNonProse([
    '| Input type | AI packaging removed | Preserved meaning |',
    '|---|---|---|',
    '| Academic | broad claims | 60 projects, p<0.01, limits noted |',
    '',
    'Real prose stays.',
  ].join('\n'));

  assert.equal(stripped, 'Real prose stays.');
  assert.doesNotMatch(stripped, /Academic/);
  assert.doesNotMatch(stripped, /p<0\.01/);
});

test('stripNonProse strips paired emphasis markers down to the inner text', () => {
  assert.equal(
    stripNonProse('**bold** and *ital* and __bold2__ and _ital2_ remain words'),
    'bold and ital and bold2 and ital2 remain words'
  );
  assert.equal(
    stripNonProse('**bold with *inner* emphasis** stays readable'),
    'bold with inner emphasis stays readable'
  );
});

test('stripNonProse strips emphasis spanning a soft line break, not a paragraph break', () => {
  // CommonMark emphasis legitimately spans hard-wrapped lines (soft breaks).
  assert.equal(
    stripNonProse('This is **bold text\nthat wraps lines** in a paragraph.'),
    'This is bold text\nthat wraps lines in a paragraph.'
  );
  assert.equal(
    stripNonProse('A _quiet aside\nacross two lines_ ends here.'),
    'A quiet aside\nacross two lines ends here.'
  );
  // A blank line is a paragraph boundary: no emphasis pair across it.
  const acrossParagraphs = stripNonProse('An asterisk pair **never\n\ncrosses** paragraphs.');
  assert.match(acrossParagraphs, /\*\*never/);
  assert.match(acrossParagraphs, /crosses\*\*/);
});

test('stripNonProse keeps non-emphasis underscores and asterisks intact (issue #396)', () => {
  const stripped = stripNonProse(
    'Visit https://example.com/?utm_source=chatgpt.com and grok_card plus user_id and 2*3.'
  );
  assert.match(stripped, /utm_source=chatgpt\.com/);
  assert.match(stripped, /grok_card/);
  assert.match(stripped, /user_id/);
  assert.match(stripped, /2\*3/);
});

test('markup-leakage tokens survive stripNonProse end-to-end (issue #396)', () => {
  const raw = [
    'Some intro prose for context here.',
    '',
    'See https://example.com/?utm_source=chatgpt.com for the **details**.',
    '',
    'The grok_card token appears in this paragraph.',
  ].join('\n');

  const result = analyzeText(stripNonProse(raw), { lang: 'en' });
  assert.equal(result.markupLeakage.leaked, true);
  const hitIds = result.markupLeakage.hits.map((hit) => hit.id);
  assert.ok(hitIds.includes('ai-tracking-param'));
  assert.ok(hitIds.includes('model-tool-token'));
});

test('scoreText surfaces leakage and the canonical LEAKAGE floor (issue #396/#398)', () => {
  const row = scoreText(
    [
      'Some intro prose for context here.',
      '',
      'See https://example.com/?utm_source=chatgpt.com for details.',
      '',
      'The grok_card token appears in this paragraph.',
    ].join('\n'),
    { file: 'leak.md', lang: 'en' }
  );

  assert.equal(row.markupLeakage.leaked, true);
  assert.ok(row.markupLeakage.hits >= 2);
  assert.ok(row.flooredScore >= LEAKAGE_SCORE_FLOOR);
  // Gate semantics stay ratio-based; the floor lives in flooredScore.
  assert.ok(row.flooredScore >= row.score);
});

test('scoreText carries discourse tells through the hot ratio, not a floor (#391)', () => {
  const row = scoreText(
    [
      "Here's the thing about deterministic detectors and why they matter for editors.",
      '',
      "Let's be honest, most drafts read fine until the third paragraph slips.",
      '',
      'A careful pass over each section catches the slips a checklist misses.',
    ].join('\n'),
    { file: 'candor.md', lang: 'en' }
  );

  assert.equal(row.discourseTells.hot, true);
  assert.equal(row.discourseTells.fakeCandor, true);
  // Per-paragraph attribution (#391): the two opener-carrying paragraphs are
  // hot, the clean one is not, and the score is the plain hot ratio. The old
  // DISCOURSE_TELLS_SCORE_FLOOR no longer exists, so flooredScore tracks the
  // ratio exactly when nothing leaked.
  assert.equal(row.hotCount, 2);
  assert.equal(row.paragraphCount, 3);
  assert.ok(Math.abs(row.score - (2 / 3) * 100) < 0.01);
  assert.equal(row.flooredScore, row.score);
});

test('scoreText exposes the analyzer skip verdict for thin prose', () => {
  const row = scoreText('One short line of prose.', { file: 'thin.md', lang: 'en' });
  assert.equal(row.analysisSkipped, true);
  assert.equal(row.skipReason, 'paragraphs<=2');
  assert.ok(row.proseLength > 0);
});

test('stripProse supports MDX scoring policy without a second stripper', () => {
  const mdx = [
    '# Heading',
    '',
    '- uniform list item should disappear',
    '',
    '`A` and `B` intercept the request.',
    '',
    '[Related](/docs)',
    '',
    'Real prose stays.',
  ].join('\n');
  const stripped = stripProse(mdx, {
    dropListItems: true,
    dropStandaloneLinks: true,
    keepInlineCode: true,
  });

  assert.doesNotMatch(stripped, /uniform list item/);
  assert.doesNotMatch(stripped, /Related/);
  assert.match(stripped, /A and B intercept/);
  assert.match(stripped, /Real prose stays/);
});

test('detectLanguage uses filename and Unicode signals', () => {
  assert.equal(detectLanguage('README_KR.md', '', 'auto'), 'ko');
  assert.equal(detectLanguage('guide.md', '이 문장은 한국어 문장입니다. 자연스러운 신호를 확인합니다.', 'auto'), 'ko');
  assert.equal(detectLanguage('guide.md', 'これは日本語の文章です。かなを含みます。', 'auto'), 'ja');
  assert.equal(detectLanguage('guide.md', '这是中文内容，用来确认语言推断。', 'auto'), 'zh');
  assert.equal(detectLanguage('guide.md', 'plain English prose', 'auto'), 'en');
});

test('scoreText flags repetitive AI-lexicon prose as over gate', () => {
  const row = scoreText(
    'This innovative solution is pivotal. This innovative solution is pivotal. This innovative solution is pivotal.',
    { file: 'sample.md', gate: 30 }
  );
  assert.equal(row.lang, 'en');
  assert.equal(row.overGate, true);
  assert.ok(row.score > 30);
  assert.ok(row.signalScore > 0);
  assert.ok(row.patternHits > 0);
});

test('signal score exposes strength changes without changing hot-ratio gate', () => {
  const strong = scoreText(
    'The tool is useful. The model is helpful. The system is stable. The page is simple.',
    { file: 'strong.md', gate: 30 }
  );
  const milder = scoreText(
    'The tool is useful today. The model remains helpful for small teams. The system is stable for careful readers.',
    { file: 'milder.md', gate: 30 }
  );

  assert.equal(strong.score, milder.score);
  assert.ok(strong.signalScore > milder.signalScore);
  assert.ok(milder.signalScore > 0);
});

test('paragraph signal strength uses the strongest deterministic signal', () => {
  assert.equal(
    paragraphSignalStrength({
      burstiness: { cv: 0, band: 'low' },
      mattr: { value: 0.54, band: 'low' },
      lexicon: { density: 0, hot: false },
    }),
    100
  );
  assert.equal(
    paragraphSignalStrength({
      burstiness: { cv: 0.5, band: 'mid' },
      mattr: { value: 0.8, band: 'high' },
      lexicon: { density: 0, hot: false },
      koDiagnostics: { hot: true, strength: 17 },
    }),
    17
  );
  assert.equal(summarizeSignalStrength([]), 0);
});

test('paragraph signal strength covers discourse-tell attribution (#391)', () => {
  // One fake-candor opener normalized by the >=2 document gate.
  assert.equal(paragraphSignalStrength({ candorHot: true, candorCount: 1 }), 50);
  // Enough openers to clear the gate alone saturates at 100.
  assert.equal(paragraphSignalStrength({ candorHot: true, candorCount: 2 }), 100);
  // One divider line normalized by the >=3 document gate.
  assert.ok(Math.abs(paragraphSignalStrength({ thematicBreakHot: true, thematicBreakCount: 1 }) - 100 / 3) < 0.01);
  // Cold tells contribute nothing, even with counts present.
  assert.equal(paragraphSignalStrength({ candorHot: false, candorCount: 1 }), 0);
  assert.equal(paragraphSignalStrength({ thematicBreakHot: false, thematicBreakCount: 2 }), 0);
});

test('scoreText keeps the prose gate on prose while dividers stay visible to ranking (#391)', () => {
  const row = scoreText(
    [
      'The standup ran long because the staging database fell over mid-demo again today.',
      '---',
      'Kwon restored it fast. Six minutes, snapshot from Tuesday, slow storage tier and all.',
      '---',
      'We still lost the seed data for the pricing experiment, which nobody mourned much.',
      '---',
    ].join('\n\n'),
    { file: 'dividers.md', lang: 'en' }
  );

  // Divider-only pseudo-paragraphs are markup, not prose: the gate ratio
  // (score/overGate) only counts the three human paragraphs, all cold.
  assert.equal(row.paragraphCount, 3);
  assert.equal(row.hotCount, 0);
  assert.equal(row.score, 0);
  assert.equal(row.overGate, false);
  // The gated dividers still rank: the attributed ratio over all analyzer
  // paragraphs (3 hot of 6) reaches flooredScore so mdx-score surfaces the doc.
  assert.ok(Math.abs(row.flooredScore - 50) < 0.01);
  assert.equal(row.discourseTells.hot, true);
  assert.equal(row.discourseTells.thematicBreaks, true);
  assert.equal(row.discourseTells.fakeCandor, false);
});

test('pattern watch hits expose pattern-level prose cleanup outside the gate', () => {
  const terms = extractPatternWatchTerms([
    {
      body: [
        '### 28. 불필요한 외래어 남발',
        '**Watch words:** 패러프레이저, 바이패스, detector-bypass 약속',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(terms, ['패러프레이저', '바이패스', 'detector-bypass 약속']);
  assert.equal(
    countPatternWatchHits('블랙박스 패러프레이저도, detector-bypass 약속도 아닙니다.', terms, 'ko'),
    2
  );
  assert.equal(
    countPatternWatchHits('블랙박스형 재작성 도구도, AI 탐지기 우회 도구도 아닙니다.', terms, 'ko'),
    0
  );
});

test('pattern watch extraction stays wired to checked-in pattern packs', () => {
  const koTerms = extractPatternWatchTerms([
    { body: readFileSync(resolve('patterns/ko-structure.md'), 'utf8') },
  ]);
  const enTerms = extractPatternWatchTerms([
    { body: readFileSync(resolve('patterns/en-structure.md'), 'utf8') },
  ]);

  assert.ok(koTerms.includes('패러프레이저'));
  assert.ok(enTerms.includes('was conducted'));
});

test('scoreFiles filters non-prose files and formats a markdown report', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-score-'));
  writeFileSync(resolve(dir, 'hot.md'), 'This innovative solution is pivotal. This innovative solution is pivotal.');
  writeFileSync(resolve(dir, 'script.js'), 'const pivotal = true;');
  const rows = scoreFiles(['hot.md', 'script.js'], { cwd: dir, gate: 0 });
  assert.equal(rows.length, 1);
  const report = formatMarkdownReport(rows, { gate: 0 });
  assert.match(report, /hot\.md/);
  assert.match(report, /fail/);
  assert.match(report, /signal/);
  assert.match(report, /pattern hits/);
});

test('formatMarkdownReport keeps legacy rows renderable after diagnostic columns', () => {
  const report = formatMarkdownReport([
    {
      file: 'legacy.md',
      lang: 'en',
      paragraphCount: 1,
      hotCount: 0,
      score: 0,
      overGate: false,
      skipped: false,
    },
  ]);

  assert.match(report, /legacy\.md/);
  assert.match(report, /\| 0\.0 \| 0 \|/);
});
