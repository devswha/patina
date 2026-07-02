import test from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { computeDensity, phraseToRegex, loadLexicon } from '../../src/features/lexicon.js';
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

test('single CJK lexicon hits remain audit hints instead of hot zones', () => {
  const single = analyzeText('이 문서는 다음 작업의 자리매김을 설명한다.', { lang: 'ko', repoRoot: REPO_ROOT });
  assert.equal(single.paragraphs[0].lexicon.matches, 1);
  assert.equal(single.paragraphs[0].lexicon.hot, false);
  assert.equal(single.hot, false);

  const clustered = analyzeText('이 문서는 핵심 가치를 자리매김하고 변화 양상을 설명한다.', { lang: 'ko', repoRoot: REPO_ROOT });
  assert.ok(clustered.paragraphs[0].lexicon.matches >= 2);
  assert.equal(clustered.paragraphs[0].lexicon.hot, true);
  assert.equal(clustered.hot, true);
});

test('Korean technical common words do not hot-classify as AI lexicon hits', () => {
  const samples = [
    '각 워커는 독립된 환경 변수로 공유 상태 루트를 가리킨다.',
    '이 기능은 이벤트 기반으로 동작하며 인증 흐름을 그대로 따른다.',
    '이 설계는 안정성 측면에서 견고한 토대를 제공한다.',
  ];

  for (const text of samples) {
    const paragraph = analyzeText(text, { lang: 'ko', repoRoot: REPO_ROOT }).paragraphs[0];
    assert.equal(paragraph.lexicon.hot, false, text);
    assert.equal(paragraph.hot, false, text);
  }
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

test('non-CJK strict entries match whole-word, not inside a larger token (#441)', () => {
  const lexicon = { lang: 'en', strict: ['cutting-edge', 'game changer'], phrases: [] };
  // Whole-word hits land via the token set and the boundary-anchored fallback.
  const hyphen = computeDensity('our cutting-edge approach', tokenize('our cutting-edge approach'), lexicon);
  assert.ok(hyphen.hits.includes('cutting-edge'));
  const multi = computeDensity('a real game changer here', tokenize('a real game changer here'), lexicon);
  assert.ok(multi.hits.includes('game changer'));
  // Boundary-anchored: no longer a bare substring inside a bigger token.
  const inside = computeDensity('precutting-edged thing', tokenize('precutting-edged thing'), lexicon);
  assert.equal(inside.hits.includes('cutting-edge'), false);
  assert.equal(inside.matches, 0);
});

test('phrase regex matches across a soft line wrap and through the wildcard (#441)', () => {
  // Inter-word whitespace tolerates a single newline inside a paragraph.
  assert.ok(phraseToRegex('in the digital age').test('seen in the\ndigital age today'));
  // `~` wildcard spans newlines too.
  assert.ok(phraseToRegex('not only~but also').test('not only fast\nbut also cheap'));
  // Still does not match when the words are absent.
  assert.equal(phraseToRegex('in the digital age').test('in the analog era'), false);
});
// --- A3: per-lexicon regex cache --------------------------------------------

test('computeDensity is stable across repeated calls (cache consistency)', () => {
  const lexicon = {
    lang: 'en',
    strict: ['cutting-edge', 'game changer', 'delve'],
    phrases: ['in the digital age', 'not only~but also'],
  };
  const text = 'We delve into a cutting-edge, real game changer in the digital age; not only fast but also cheap.';
  const tokens = tokenize(text);
  const first = computeDensity(text, tokens, lexicon);
  // Functional correctness on the first (cache-populating) call.
  assert.deepEqual(
    [...first.hits].sort(),
    ['cutting-edge', 'delve', 'game changer', 'in the digital age', 'not only~but also'].sort(),
  );
  assert.equal(first.matches, 5);
  // 50 further calls must return byte-identical results (no cache drift).
  for (let i = 0; i < 50; i++) {
    const again = computeDensity(text, tokens, lexicon);
    assert.deepEqual(again, first);
  }
  // A non-matching paragraph through the same (now warm) lexicon stays correct.
  const cold = computeDensity('nothing to see here', tokenize('nothing to see here'), lexicon);
  assert.deepEqual(cold.hits, []);
  assert.equal(cold.matches, 0);
});

test('cached phrase/strict regexes are non-global and non-sticky', () => {
  // The cache reuses these regex objects, so /g or /y would corrupt lastIndex
  // across repeated .test() calls.
  const re = phraseToRegex('in the digital age');
  assert.equal(re.global, false);
  assert.equal(re.sticky, false);
  // Behavioral proof: a matching phrase keeps matching on every repeat.
  const lexicon = { lang: 'en', strict: [], phrases: ['delve into'] };
  for (let i = 0; i < 10; i++) {
    assert.equal(computeDensity('we delve into it', tokenize('we delve into it'), lexicon).matches, 1);
  }
});

test('computeDensity does not mutate lexicon object shape (WeakMap cache)', () => {
  const lexicon = { lang: 'en', strict: ['game changer'], phrases: ['in the digital age'] };
  const keysBefore = Object.keys(lexicon);
  const jsonBefore = JSON.stringify(lexicon);
  for (let i = 0; i < 5; i++) {
    computeDensity('a real game changer in the digital age', tokenize('a real game changer in the digital age'), lexicon);
  }
  assert.deepEqual(Object.keys(lexicon), keysBefore);
  assert.equal(JSON.stringify(lexicon), jsonBefore);
  // Cache internals are not enumerable on the lexicon.
  assert.deepEqual(Object.keys(lexicon), ['lang', 'strict', 'phrases']);
});

test('regex cache is keyed per lexicon object (no cross-contamination)', () => {
  const a = { lang: 'en', strict: [], phrases: ['alpha signal'] };
  const b = { lang: 'en', strict: [], phrases: ['beta signal'] };
  const text = 'this beta signal only';
  const tokens = tokenize(text);
  assert.deepEqual(computeDensity(text, tokens, a).hits, []);
  assert.deepEqual(computeDensity(text, tokens, b).hits, ['beta signal']);
  // Re-querying a must still see only its own phrase, not b's.
  assert.deepEqual(computeDensity(text, tokens, a).hits, []);
});

test('cache preserves language-aware strict semantics (EN whole-word vs CJK substring)', () => {
  // EN multi-token strict entry is boundary-anchored, never a bare substring.
  const en = { lang: 'en', strict: ['cutting-edge'], phrases: [] };
  assert.equal(computeDensity('precutting-edged thing', tokenize('precutting-edged thing'), en).matches, 0);
  assert.ok(computeDensity('a cutting-edge idea', tokenize('a cutting-edge idea'), en).hits.includes('cutting-edge'));
  // CJK strict entries keep substring matching (inflection/character fallback).
  for (const [lang, entry, text] of [
    ['ko', '자리매김', '시장에서 자리매김했다'],
    ['zh', '可以说', '可以说这很重要'],
    ['ja', 'まとめると', 'まとめるとこうなる'],
  ]) {
    const lex = { lang, strict: [entry], phrases: [] };
    const hot = computeDensity(text, tokenize(text, { lang }), lex);
    assert.ok(hot.hits.includes(entry), `${lang} substring entry should hit`);
    // Repeated call identical through the warm cache.
    assert.deepEqual(computeDensity(text, tokenize(text, { lang }), lex), hot);
  }
});

test('EN strict entries accept documented trailing s/ing inflections (#566)', () => {
  const lexicon = { lang: 'en', strict: ['unlock'], phrases: [] };
  for (const text of [
    'This update unlocks a smaller workflow.',
    'This update is unlocking a smaller workflow.',
    'This update will unlock a smaller workflow.',
  ]) {
    assert.deepEqual(computeDensity(text, tokenize(text), lexicon).hits, ['unlock'], text);
  }
  // Entry-level dedup still holds when base and inflected forms co-occur.
  const both = computeDensity('unlock unlocks unlocking', tokenize('unlock unlocks unlocking'), lexicon);
  assert.equal(both.matches, 1);
  // Only the two documented suffixes count — other derivations stay cold.
  const align = { lang: 'en', strict: ['align'], phrases: [] };
  assert.equal(computeDensity('the alignment shifted', tokenize('the alignment shifted'), align).matches, 0);
});
