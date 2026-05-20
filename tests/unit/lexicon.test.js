import test from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { computeDensity, loadLexicon } from '../../src/features/lexicon.js';
import { tokenize } from '../../src/features/segment.js';
import { analyzeText } from '../../src/features/index.js';
import { scoreDeterministicSignals } from '../../src/scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

test('loads zh and ja AI lexicons with at least 50 entries each', () => {
  for (const lang of ['zh', 'ja']) {
    const lexicon = loadLexicon(lang, REPO_ROOT);
    assert.ok(lexicon.path?.endsWith(`lexicon/ai-${lang}.md`));
    assert.strictEqual(lexicon.strict.length, 0);
    assert.ok(lexicon.phrases.length >= 50, `${lang} lexicon should have at least 50 phrases`);
  }
});

test('matches Chinese and Japanese phrase entries under character-token fallback', () => {
  const zh = loadLexicon('zh', REPO_ROOT);
  const zhText = '总而言之，在数字时代，工具不仅提升效率而且改善体验。';
  const zhDensity = computeDensity(zhText, tokenize(zhText, { lang: 'zh' }), zh);
  assert.ok(zhDensity.hits.includes('总而言之'));
  assert.ok(zhDensity.hits.includes('在数字时代'));
  assert.ok(zhDensity.hits.includes('不仅~而且'));
  assert.ok(zhDensity.density > 2);

  const ja = loadLexicon('ja', REPO_ROOT);
  const jaText = 'まとめると、デジタル時代において、この仕組みすることが重要です。';
  const jaDensity = computeDensity(jaText, tokenize(jaText, { lang: 'ja' }), ja);
  assert.ok(jaDensity.hits.includes('まとめると'));
  assert.ok(jaDensity.hits.includes('デジタル時代において'));
  assert.ok(jaDensity.hits.includes('~することが重要です'));
  assert.ok(jaDensity.density > 2);
});

test('uses substring fallback for CJK strict entries in custom lexicons', () => {
  const lexicon = {
    lang: 'ja',
    path: 'custom',
    strict: ['まとめると'],
    phrases: [],
  };
  const text = '本文を短く整理します。まとめると、駅前の店は雨の日に混みます。';
  const density = computeDensity(text, tokenize(text, { lang: 'ja' }), lexicon);
  assert.deepStrictEqual(density.hits, ['まとめると']);
});

test('analyzeText exposes zh/ja lexicon hits as a hot signal', () => {
  const text = '综上所述，在当今社会，写作工具发挥着重要作用。它为远程协作提供了新的可能。';
  const result = analyzeText(text, { lang: 'zh', repoRoot: REPO_ROOT });
  assert.strictEqual(result.hot, true);
  assert.ok(result.paragraphs[0].lexicon.hot);
  assert.ok(result.paragraphs[0].lexicon.hits.includes('综上所述'));
});

test('scoreDeterministicSignals respects lexicon.languages gating', () => {
  const text = '综上所述，在当今社会，写作工具发挥着重要作用。它为远程协作提供了新的可能。';
  const enabled = scoreDeterministicSignals({
    text,
    config: {
      language: 'zh',
      stylometry: { languages: ['zh'] },
      lexicon: { enabled: true, languages: ['zh'], density_threshold: 2.0 },
    },
    repoRoot: REPO_ROOT,
  });
  assert.ok(enabled.bands.lexicon.hot > 0);

  const disabled = scoreDeterministicSignals({
    text,
    config: {
      language: 'zh',
      stylometry: { languages: ['zh'] },
      lexicon: { enabled: true, languages: ['en', 'ko'], density_threshold: 2.0 },
    },
    repoRoot: REPO_ROOT,
  });
  assert.strictEqual(disabled.bands.lexicon.hot, 0);
});
