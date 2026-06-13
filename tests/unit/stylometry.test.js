import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { splitParagraphs, splitSentences, splitProseSentences, tokenize } from '../../src/features/segment.js';
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

test('splitSentences keeps CJK terminators inside closing quotes attached (#441)', () => {
  // Quote-internal 。 no longer splits mid-quote: this is one sentence.
  assert.deepEqual(
    splitSentences('彼は「やめろ。」と言った。'),
    ['彼は「やめろ。」と言った']
  );
  // A trailing closing bracket after the terminator is never stranded as its
  // own zero-token "sentence" (old behavior produced a lone 」).
  assert.deepEqual(splitSentences('と言った。」'), ['と言った。」']);
  // A real terminator followed by a non-closer still splits.
  assert.deepEqual(splitSentences('そうだ。次の文。'), ['そうだ', '次の文']);
});

test('splitSentences does not split on intra-sentence ellipsis in en/ko (#441)', () => {
  assert.deepEqual(splitSentences('Well… maybe not.'), ['Well… maybe not']);
  assert.deepEqual(splitSentences('글쎄… 아닐지도.'), ['글쎄… 아닐지도']);
});

test('splitProseSentences excludes Markdown list blocks from prose rhythm samples', () => {
  const bulleted = `Here is what the tool does for you:
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models
- distribute work across Codex, Claude, and Gemini`;
  assert.deepEqual(splitProseSentences(bulleted), ['Here is what the tool does for you:']);

  const plain = `The tool does four things:
send hook events to external gateways
discover and invoke MCP servers
hand bounded sub-questions to other CLIs and models
distribute work across Codex, Claude, and Gemini`;
  assert.deepEqual(splitProseSentences(plain), ['The tool does four things:']);
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

test('analyzeText does not hot-classify burstiness with fewer than three sentences', () => {
  const short = analyzeText('Alpha beta gamma. Delta epsilon zeta.', { lang: 'en' });
  assert.equal(short.paragraphs[0].sentenceCount, 2);
  assert.equal(short.paragraphs[0].burstiness.cv, 0);
  assert.equal(short.paragraphs[0].burstiness.band, null);
  assert.equal(short.paragraphs[0].hot, false);

  const enough = analyzeText('Alpha beta. Gamma delta. Epsilon zeta.', { lang: 'en' });
  assert.equal(enough.paragraphs[0].sentenceCount, 3);
  assert.equal(enough.paragraphs[0].burstiness.band, 'low');
  assert.equal(enough.paragraphs[0].hot, true);
});

test('analyzeText does not hot-classify Markdown lists as low-burstiness prose', () => {
  const bulleted = `Here is what the tool does for you:
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models
- distribute work across Codex, Claude, and Gemini`;
  const bulletParagraph = analyzeText(bulleted, { lang: 'en' }).paragraphs[0];
  assert.equal(bulletParagraph.sentenceCount, 1);
  assert.equal(bulletParagraph.burstiness.band, null);
  assert.equal(bulletParagraph.hot, false);

  const twoSentenceResidue = `This intro names the list. It stays under the burstiness gate.
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models`;
  const residueParagraph = analyzeText(twoSentenceResidue, { lang: 'en' }).paragraphs[0];
  assert.equal(residueParagraph.sentenceCount, 2);
  assert.equal(residueParagraph.burstiness.band, null);
  assert.equal(residueParagraph.hot, false);

  const plain = `The tool does four things:
send hook events to external gateways
discover and invoke MCP servers
hand bounded sub-questions to other CLIs and models
distribute work across Codex, Claude, and Gemini`;
  const plainParagraph = analyzeText(plain, { lang: 'en' }).paragraphs[0];
  assert.equal(plainParagraph.sentenceCount, 1);
  assert.equal(plainParagraph.burstiness.band, null);
  assert.equal(plainParagraph.hot, false);
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

test('analyzeText accepts Chinese text and returns paragraph hot fields', () => {
  let result;
  assert.doesNotThrow(() => {
    result = analyzeText('这个工具支持写作。 这个工具支持编辑。', { lang: 'zh' });
  });

  assert.equal(result.lang, 'zh');
  assert.equal(typeof result.hot, 'boolean');
  assert.ok(Array.isArray(result.paragraphs));
  assert.equal(result.paragraphs.length, 1);
  assert.equal(typeof result.paragraphs[0].hot, 'boolean');
});

test('analyzeText accepts Japanese text and returns paragraph hot fields', () => {
  let result;
  assert.doesNotThrow(() => {
    result = analyzeText('このツールは文章を支援する。 このツールは編集を支援する。', { lang: 'ja' });
  });

  assert.equal(result.lang, 'ja');
  assert.equal(typeof result.hot, 'boolean');
  assert.ok(Array.isArray(result.paragraphs));
  assert.equal(result.paragraphs.length, 1);
  assert.equal(typeof result.paragraphs[0].hot, 'boolean');
});

test('Chinese uniform sentence block has low burstiness', () => {
  const text =
    '工具 提升 写作。 模型 提升 编辑。 系统 提升 审阅。 流程 提升 协作。 页面 提升 发布。';
  const result = analyzeText(text, { lang: 'zh' });
  const p = result.paragraphs[0];

  assert.equal(p.sentenceCount, 5);
  assert.deepEqual(p.burstiness, { cv: 0, band: 'low' });
  assert.equal(p.hot, true);
});

test('Chinese/Japanese text without spaces keeps burstiness end-to-end', () => {
  const zh = analyzeText('工具写作。模型编辑。系统审阅。流程协作。页面发布。', { lang: 'zh' });
  assert.equal(zh.paragraphs[0].sentenceCount, 5);
  assert.equal(zh.paragraphs[0].tokenCount, 20);
  assert.deepEqual(zh.paragraphs[0].burstiness, { cv: 0, band: 'low' });
  assert.equal(zh.hot, true);

  const ja = analyzeText('道具が書く。模型が直す。体系が見る。流れが組む。画面が出す。', { lang: 'ja' });
  assert.equal(ja.paragraphs[0].sentenceCount, 5);
  assert.equal(ja.paragraphs[0].tokenCount, 25);
  assert.deepEqual(ja.paragraphs[0].burstiness, { cv: 0, band: 'low' });
  assert.equal(ja.hot, true);
});
