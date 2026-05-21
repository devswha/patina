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
  summarizeSignalStrength,
} from '../../scripts/prose-score.mjs';

test('parseFileList accepts newline and comma separated paths', () => {
  assert.deepEqual(parseFileList('README.md, docs/a.md\nnotes.mdx'), ['README.md', 'docs/a.md', 'notes.mdx']);
});

test('stripNonProse keeps prose while removing code and tables', () => {
  const stripped = stripNonProse('# Title\n\nReal prose stays.\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|');
  assert.match(stripped, /Real prose stays/);
  assert.doesNotMatch(stripped, /const x/);
  assert.doesNotMatch(stripped, /\| a \|/);
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
  assert.equal(summarizeSignalStrength([]), 0);
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
