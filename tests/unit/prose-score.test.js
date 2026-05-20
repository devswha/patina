import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  detectLanguage,
  formatMarkdownReport,
  parseFileList,
  scoreFiles,
  scoreText,
  stripNonProse,
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
});
