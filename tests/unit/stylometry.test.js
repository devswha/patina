import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { splitParagraphs, splitSentences, tokenize } from '../../src/features/segment.js';
import {
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
} from '../../src/features/stylometry.js';
import { analyzeText } from '../../src/features/index.js';

test('splitParagraphs returns trimmed non-empty paragraphs', () => {
  assert.deepEqual(splitParagraphs(''), []);
  assert.deepEqual(splitParagraphs('one\n\ntwo\n\n\nthree'), ['one', 'two', 'three']);
});

test('splitSentences handles ., !, ?, 。, … and newlines', () => {
  assert.deepEqual(
    splitSentences('First. Second! Third? Fourth。 Fifth…\nSixth'),
    ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']
  );
  assert.deepEqual(splitSentences('第一句。第二句！第三句？'), ['第一句', '第二句', '第三句']);
});

test('tokenize strips edge punctuation but keeps internal hyphens / apostrophes', () => {
  assert.deepEqual(
    tokenize(`The tool acts like autocomplete.`),
    ['The', 'tool', 'acts', 'like', 'autocomplete']
  );
  assert.deepEqual(tokenize(`don't 좋은-도구`), [`don't`, '좋은-도구']);
  assert.deepEqual(tokenize('이 도구는 자동완성처럼 동작한다'), ['이', '도구는', '자동완성처럼', '동작한다']);
});

test('tokenize uses CJK character fallback for zh/ja without spaces', () => {
  assert.deepEqual(tokenize('这项工具保留原意。', { lang: 'zh' }), ['这', '项', '工', '具', '保', '留', '原', '意']);
  assert.deepEqual(tokenize('この道具は意味を守る。', { lang: 'ja' }), ['こ', 'の', '道', '具', 'は', '意', '味', 'を', '守', 'る']);
});

test('burstinessCV returns 0 when all sentences have identical token counts', () => {
  assert.equal(burstinessCV([5, 5, 5, 5, 5]), 0);
});

test('burstinessCV returns null on degenerate input', () => {
  assert.equal(burstinessCV([]), null);
  assert.equal(burstinessCV([5]), null);
  assert.equal(burstinessCV([0, 0]), null);
});

test('mattr falls back to simple TTR when token count < window', () => {
  // 6 unique tokens out of 6 total → TTR = 1.0
  assert.equal(mattr(['a', 'b', 'c', 'd', 'e', 'f']), 1);
  // 8 unique out of 20 → TTR = 0.4 (matches stylometry.md §10 worked example)
  const tokens = 'the tool is innovative the tool is efficient the tool is reliable the tool is scalable the tool is essential'
    .split(/\s+/);
  const value = mattr(tokens);
  assert.equal(value, 8 / 20);
});

test('classifyBurstiness uses default bands (low<0.30, high>0.50)', () => {
  assert.equal(classifyBurstiness(0.20), 'low');
  assert.equal(classifyBurstiness(0.30), 'mid');
  assert.equal(classifyBurstiness(0.40), 'mid');
  assert.equal(classifyBurstiness(0.50), 'mid');
  assert.equal(classifyBurstiness(0.60), 'high');
  assert.equal(classifyBurstiness(null), null);
});

test('classifyMattr uses default bands (low<0.55, high>0.70)', () => {
  assert.equal(classifyMattr(0.40), 'low');
  assert.equal(classifyMattr(0.55), 'mid');
  assert.equal(classifyMattr(0.70), 'mid');
  assert.equal(classifyMattr(0.80), 'high');
});

test('§10 English worked example: exact CV/MATTR/token counts', () => {
  const text =
    'The tool is innovative. The tool is efficient. The tool is reliable. The tool is scalable. The tool is essential.';
  const result = analyzeText(text, { lang: 'en' });
  const p = result.paragraphs[0];
  // 5 sentences × 4 tokens (the, tool, is, X) → uniform → CV=0
  assert.equal(p.sentenceCount, 5);
  assert.equal(p.tokenCount, 20);
  assert.equal(p.burstiness.cv, 0);
  assert.equal(p.burstiness.band, 'low');
  // 8 unique (the, tool, is, innovative, efficient, reliable, scalable, essential) / 20 = 0.40
  assert.equal(p.mattr.value, 8 / 20);
  assert.equal(p.mattr.band, 'low');
  assert.equal(p.hot, true);
});

test('§10 Korean worked example: exact CV/MATTR/token counts', () => {
  const text =
    '이 도구는 단순한 자동완성을 넘어선다. 이 도구는 사용자의 의도를 이해한다. ' +
    '이 도구는 효율적인 협업을 가능하게 한다. 이 도구는 혁신적인 생산성을 제공한다. ' +
    '이 도구는 다양한 언어를 지원한다.';
  const result = analyzeText(text, { lang: 'ko' });
  const p = result.paragraphs[0];
  // 어절 counts: [5, 5, 6, 5, 5] → mean=5.2, stddev=0.4, CV=0.4/5.2≈0.0769
  assert.equal(p.sentenceCount, 5);
  assert.equal(p.tokenCount, 26);
  assert.ok(Math.abs(p.burstiness.cv - 0.4 / 5.2) < 1e-9);
  assert.equal(p.burstiness.band, 'low');
  // 18 unique tokens / 26 total → 0.6923...
  assert.ok(Math.abs(p.mattr.value - 18 / 26) < 1e-9);
  assert.equal(p.mattr.band, 'mid');
  assert.equal(p.hot, true);
});
