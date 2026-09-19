// Landing-page benchmark figure parity.
//
// docs/benchmarks/latest.json is the single source of truth: it is what
// `npm run benchmark:report` writes and what the landing page's "Read the full
// report" link points at. The landing page restates those figures in five
// places — three regions of playground/index.html (the stat cards, the language
// table, the closing note) and the benchCards/benchNote strings of each of the
// four I18N locales in playground/chatgpt.js — and nothing regenerated them, so
// they drifted silently every time the fixture corpus grew.
//
// This gate re-reads the real files (no copied constants) and compares numbers.
// Following tests/unit/threshold-parity.test.js, every extraction asserts that
// its anchor was actually found, so reworded copy fails loudly instead of
// letting the gate pass vacuously.
//
// Which copies are load-bearing: applyI18n() rewrites each card's <dd>/<small>,
// the table's <thead>, and .bench__note on load for every locale, so those
// markup strings only reach no-JS visitors and crawlers. The card <dt> numbers
// and the table <tbody> are never localized — they are what every visitor sees.
// All of them are gated here.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const REPORT_PATH = 'docs/benchmarks/latest.json';
const HTML_PATH = 'playground/index.html';
const JS_PATH = 'playground/chatgpt.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const report = JSON.parse(read(REPORT_PATH));
const html = read(HTML_PATH);
const controller = read(JS_PATH);

const LANGS = ['en', 'ko', 'zh', 'ja'];

// Same rounding as the report generator: scripts/benchmark-report.mjs `pct()`
// renders `((value ?? 0) * 100).toFixed(1)`, so latest.md shows 0.932 as 93.2%.
// Numbers (not strings) are compared, because the page drops the trailing
// ".0" that latest.md keeps ("100%" on the page vs "100.0%" in the report).
function pct(value) {
  return Number(((value ?? 0) * 100).toFixed(1));
}

// Locale-proof numeric text. Code points instead of regex escapes so the file
// carries no literal full-width space. Full-width digits become ASCII; the
// dash variants used for ranges (the page uses an en dash), the full-width
// percent/period and the CJK full stop and spaces all normalize to ASCII.
const FULLWIDTH_ZERO = 0xff10;
const FULLWIDTH_NINE = 0xff19;
const FULLWIDTH_OFFSET = 0xfee0;
const PUNCTUATION = new Map([
  [0xff05, '%'], // full-width percent
  [0xff0e, '.'], // full-width full stop
  [0x3002, '.'], // ideographic full stop
  [0x2012, '-'], // figure dash
  [0x2013, '-'], // en dash (what the page uses in ranges)
  [0x2014, '-'], // em dash
  [0x2015, '-'], // horizontal bar
  [0x2212, '-'], // minus sign
  [0xff0d, '-'], // full-width hyphen-minus
  [0x00a0, ' '], // no-break space
  [0x3000, ' '], // ideographic space
]);

function normalize(text) {
  let out = '';
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) out += String.fromCharCode(code - FULLWIDTH_OFFSET);
    else out += PUNCTUATION.get(code) ?? char;
  }
  return out;
}

function extract(haystack, re, what) {
  const m = normalize(haystack).match(re);
  assert.ok(m, `extraction anchor not found: ${what} (${re}) — the landing copy was reworded; update this gate and re-check the figure against ${REPORT_PATH}`);
  return m;
}

function extractNumber(haystack, re, what) {
  return Number(extract(haystack, re, what)[1]);
}

// One consistent failure message: which file, which figure, what it says now,
// what the report says, and what to do about it.
function assertFigure(file, figure, jsonPath, page, expected) {
  const sibling = file === HTML_PATH ? JS_PATH : HTML_PATH;
  assert.equal(
    page,
    expected,
    `${file}: ${figure} reads ${page}, but ${REPORT_PATH} ${jsonPath} says ${expected} — regenerate nothing, just update the figure in ${file} (and the matching copy in ${sibling}) to ${expected}.`
  );
}

// ---------------------------------------------------------------------------
// Report side — fail loudly if latest.json stops carrying a quoted figure
// ---------------------------------------------------------------------------

test('docs/benchmarks/latest.json still carries every figure the landing page quotes', () => {
  assert.ok(Number.isFinite(report.fixtureCount), `${REPORT_PATH} lost .fixtureCount`);
  for (const key of ['accuracy', 'ci_low', 'ci_high']) {
    assert.ok(Number.isFinite(report.overall?.[key]), `${REPORT_PATH} lost .overall.${key}`);
  }
  assert.ok(report.perLanguage && Object.keys(report.perLanguage).length > 0, `${REPORT_PATH} lost .perLanguage`);
  for (const [lang, stats] of Object.entries(report.perLanguage)) {
    for (const key of ['total', 'accuracy', 'ci_low', 'ci_high', 'f1']) {
      assert.ok(Number.isFinite(stats?.[key]), `${REPORT_PATH} lost .perLanguage.${lang}.${key}`);
    }
  }
  const natural = report.slices?.class?.values?.natural;
  assert.ok(natural, `${REPORT_PATH} lost .slices.class.values.natural (the landing page quotes its sample count)`);
  assert.ok(Number.isFinite(natural.n), `${REPORT_PATH} lost .slices.class.values.natural.n`);
  assert.ok(Number.isFinite(natural.fp), `${REPORT_PATH} lost .slices.class.values.natural.fp`);
});

const EXPECTED = {
  accuracyPct: pct(report.overall.accuracy),
  ciLowPct: pct(report.overall.ci_low),
  ciHighPct: pct(report.overall.ci_high),
  fixtures: report.fixtureCount,
  languages: Object.keys(report.perLanguage).length,
  naturalSamples: report.slices.class.values.natural.n,
  naturalFalsePositives: report.slices.class.values.natural.fp,
};

test('the landing page "0 wrongly flagged at a 1-in-100 false-alarm target" claim still holds', () => {
  // The card's headline number is the natural-labeled slice's false positives;
  // the "1-in-100 target" clause is the 1% low-FPR operating point. Both must
  // stay at zero for the sentence to be true. NOTE: that operating point is
  // computed over every expected_hot=false fixture (27 today), a wider
  // denominator than the samples labeled `class: natural` the sentence counts.
  assert.equal(
    EXPECTED.naturalFalsePositives,
    0,
    `${REPORT_PATH} .slices.class.values.natural.fp is no longer 0 — the landing "0 natural writing wrongly flagged" card is now false; fix the copy, not this test`
  );
  const point = report.ranking?.overall?.low_fpr?.find((row) => row.target_fpr === 0.01);
  assert.ok(point, `${REPORT_PATH} lost .ranking.overall.low_fpr[target_fpr=0.01] — the landing "1-in-100 false-alarm target" clause has no evidence`);
  assert.equal(point.supported, true, `${REPORT_PATH} 1% low-FPR point is unsupported — the landing "1-in-100 false-alarm target" clause is no longer backed`);
  assert.equal(point.actual_fpr, 0, `${REPORT_PATH} 1% low-FPR point now has actual_fpr ${point.actual_fpr} — the landing "0 wrongly flagged" card is now false`);
});

// ---------------------------------------------------------------------------
// playground/index.html — the copy every visitor sees plus the no-JS fallback
// ---------------------------------------------------------------------------

// The four .bstat cards are positional: markup order is the same contract that
// applyI18n() relies on when it zips I18N benchCards onto these nodes.
const CARDS = [...normalize(html).matchAll(/<div class="bstat">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

test('index.html benchmark stat cards match the report', () => {
  assert.equal(
    CARDS.length,
    4,
    `${HTML_PATH}: expected 4 .bstat cards (accuracy, fixtures, languages, false positives), found ${CARDS.length} — the card set changed; update this gate`
  );

  const figure = (index, what) => extractNumber(CARDS[index], /<dt>([\d.]+)%?<\/dt>/, `${HTML_PATH} .bstat[${index}] <dt> (${what})`);

  assertFigure(HTML_PATH, 'card 1 overall accuracy', '.overall.accuracy', figure(0, 'overall accuracy'), EXPECTED.accuracyPct);
  const ci = extract(CARDS[0], /<small>[^<]*CI\s*([\d.]+)\s*-\s*([\d.]+)\s*%/, `${HTML_PATH} .bstat[0] <small> confidence interval`);
  assertFigure(HTML_PATH, 'card 1 CI lower bound', '.overall.ci_low', Number(ci[1]), EXPECTED.ciLowPct);
  assertFigure(HTML_PATH, 'card 1 CI upper bound', '.overall.ci_high', Number(ci[2]), EXPECTED.ciHighPct);

  assertFigure(HTML_PATH, 'card 2 writing-sample count', '.fixtureCount', figure(1, 'writing samples'), EXPECTED.fixtures);
  assertFigure(HTML_PATH, 'card 3 language count', '.perLanguage (key count)', figure(2, 'languages'), EXPECTED.languages);
  assertFigure(HTML_PATH, 'card 4 wrongly-flagged count', '.slices.class.values.natural.fp', figure(3, 'natural writing wrongly flagged'), EXPECTED.naturalFalsePositives);
  assertFigure(
    HTML_PATH,
    'card 4 natural-labeled sample count',
    '.slices.class.values.natural.n',
    extractNumber(CARDS[3], /<small>[^<]*in\s*(\d+)\s*natural-labeled samples/, `${HTML_PATH} .bstat[3] <small> natural-sample count`),
    EXPECTED.naturalSamples
  );
});

test('index.html language table matches the report per-language rows', () => {
  const body = extract(normalize(html), /<table class="bench__table">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/, `${HTML_PATH} .bench__table <tbody>`)[1];
  const rows = new Map(
    [...body.matchAll(/<tr><td>([A-Za-z]{2})<\/td><td>(\d+)<\/td><td>([\d.]+)%<\/td><td>([\d.]+)\s*-\s*([\d.]+)%<\/td><td>([\d.]+)<\/td><\/tr>/g)]
      .map((m) => [m[1].toLowerCase(), m])
  );
  assert.deepEqual(
    [...rows.keys()].sort(),
    Object.keys(report.perLanguage).sort(),
    `${HTML_PATH}: the .bench__table language rows are not the languages in ${REPORT_PATH} .perLanguage — add, remove, or fix the rows to match`
  );

  for (const [lang, stats] of Object.entries(report.perLanguage)) {
    const row = rows.get(lang);
    const label = lang.toUpperCase();
    assertFigure(HTML_PATH, `${label} table row: samples`, `.perLanguage.${lang}.total`, Number(row[2]), stats.total);
    assertFigure(HTML_PATH, `${label} table row: accuracy`, `.perLanguage.${lang}.accuracy`, Number(row[3]), pct(stats.accuracy));
    assertFigure(HTML_PATH, `${label} table row: CI lower bound`, `.perLanguage.${lang}.ci_low`, Number(row[4]), pct(stats.ci_low));
    assertFigure(HTML_PATH, `${label} table row: CI upper bound`, `.perLanguage.${lang}.ci_high`, Number(row[5]), pct(stats.ci_high));
    assertFigure(HTML_PATH, `${label} table row: F1`, `.perLanguage.${lang}.f1`, Number(row[6]), stats.f1);
  }
});

test('index.html benchmark note matches the report fixture count', () => {
  const note = extract(normalize(html), /<p class="bench__note">([\s\S]*?)<\/p>/, `${HTML_PATH} .bench__note`)[1];
  assertFigure(
    HTML_PATH,
    '.bench__note sample count',
    '.fixtureCount',
    extractNumber(note, /those\s*(\d+)\s*samples/, `${HTML_PATH} .bench__note sample count`),
    EXPECTED.fixtures
  );
});

// ---------------------------------------------------------------------------
// playground/chatgpt.js — the localized strings applyI18n() paints over the markup
// ---------------------------------------------------------------------------

// Per-locale anchors. Each captures one figure out of its own sentence, so a
// shared "all numbers in the string" scan cannot confuse the sample count with
// the "1-in-100" / "100분의 1" / "百分之一" / "100 分の 1" target in the same line.
const LOCALE_ANCHORS = {
  en: { natural: /in\s*(\d+)\s*natural-labeled samples/, note: /those\s*(\d+)\s*samples/ },
  ko: { natural: /자연 라벨\s*(\d+)\s*개에서/, note: /그\s*(\d+)\s*개 글에서/ },
  zh: { natural: /在\s*(\d+)\s*篇自然标注文章中/, note: /那\s*(\d+)\s*篇文章/ },
  ja: { natural: /自然と分類した\s*(\d+)\s*件中/, note: /先ほどの\s*(\d+)\s*件/ },
};

const I18N_BLOCK = extract(controller, /const I18N = \{\n([\s\S]*?)\n\};/, `${JS_PATH} I18N object literal`)[1];

function langBlock(lang) {
  return extract(I18N_BLOCK, new RegExp(`(?:^|\\n)  ${lang}: \\{\\n([\\s\\S]*?)\\n  \\},`), `${JS_PATH} I18N.${lang} block`)[1];
}

// A key's source text, up to the next key on its own line: tolerant of reflow
// and of key reordering, loud when the key itself disappears.
function field(block, key, lang) {
  return extract(block, new RegExp(`\\n?\\s{4}${key}:\\s*([\\s\\S]*?)(?=\\n\\s{4}[A-Za-z_$][\\w$]*:)`), `${JS_PATH} I18N.${lang}.${key}`)[1];
}

for (const lang of LANGS) {
  test(`chatgpt.js I18N.${lang} benchmark strings match the report`, () => {
    const block = langBlock(lang);
    const cards = field(block, 'benchCards', lang);
    const note = field(block, 'benchNote', lang);
    const where = `${JS_PATH} I18N.${lang}`;

    const ci = extract(cards, /CI\s*([\d.]+)\s*-\s*([\d.]+)\s*%/, `${where}.benchCards confidence interval`);
    assertFigure(where, 'benchCards CI lower bound', '.overall.ci_low', Number(ci[1]), EXPECTED.ciLowPct);
    assertFigure(where, 'benchCards CI upper bound', '.overall.ci_high', Number(ci[2]), EXPECTED.ciHighPct);
    assertFigure(
      where,
      'benchCards natural-labeled sample count',
      '.slices.class.values.natural.n',
      extractNumber(cards, LOCALE_ANCHORS[lang].natural, `${where}.benchCards natural-sample count`),
      EXPECTED.naturalSamples
    );
    assertFigure(
      where,
      'benchNote sample count',
      '.fixtureCount',
      extractNumber(note, LOCALE_ANCHORS[lang].note, `${where}.benchNote sample count`),
      EXPECTED.fixtures
    );
  });
}
