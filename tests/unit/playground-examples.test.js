import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { browserLanguage, initialLanguage, ONBOARDING_COPY } from '../../playground/experience-copy.js';

const languages = ['ko', 'en', 'zh', 'ja'];

test('curated example modules satisfy the shared native-content contract', async () => {
  // Deliberately requires the real worker-owned files at integration time.
  const { EXAMPLES } = await import('../../playground/examples/index.js');
  assert.equal(EXAMPLES.length, 12);
  assert.equal(new Set(EXAMPLES.map((row) => row.id)).size, 12);
  for (const lang of languages) {
    const { default: rows } = await import(`../../playground/examples/${lang}.js`);
    assert.equal(rows.length, 3, `${lang} must have exactly three native examples`);
    assert.deepEqual(EXAMPLES.filter((row) => row.lang === lang), rows);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['id', 'lang', 'label', 'before', 'after', 'caption', 'kind'].sort());
      assert.equal(row.lang, lang);
      assert.equal(row.kind, 'illustrative');
      for (const field of ['id', 'label', 'before', 'after', 'caption']) {
        assert.equal(typeof row[field], 'string');
        assert.ok(row[field].trim(), `${row.id}: ${field} cannot be blank`);
      }
      assert.notEqual(row.before, row.after);
      assert.ok(row.before.length <= 4000, 'examples must fit the default Free request');
      assert.doesNotMatch(row.caption, /MPS\s*\d|Fidelity\s*\d|verified live/i);
    }
  }
});

test('all native first-use dictionaries have the same complete shape', () => {
  for (const lang of languages) {
    const copy = ONBOARDING_COPY[lang];
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(ONBOARDING_COPY.en).sort());
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(Array.isArray(value) || typeof value === 'string' && value.trim(), `${lang}.${key}`);
    }
    assert.equal(copy.steps.length, 3);
    assert.equal(copy.freeFeatures.length, 4);
    // No visible string names an internal metric: a reader who does not build
    // software should still learn what the check does. `steps` nests one level
    // deeper than the rest, so flatten to any depth rather than just one.
    const deep = (v) => (Array.isArray(v) ? v.flatMap(deep) : typeof v === 'object' && v ? Object.values(v).flatMap(deep) : [v]);
    const everyString = Object.values(copy).flatMap(deep).filter((v) => typeof v === 'string').join(' ');
    assert.ok(everyString.includes(copy.steps[1][1]), 'nested step copy must be included in the scan');
    assert.doesNotMatch(everyString, /\bMPS\b|\bfidelity\b|BYOK|deterministic|Hosted API|programmatic/i, `${lang} exposes internal vocabulary`);
    // The disclosure still has to explain the check rather than just name it.
    assert.ok(copy.hint.length > 40, `${lang}.hint must explain the meaning check`);
    assert.ok(copy.meaningLabel.trim(), `${lang}.meaningLabel`);
  }
});

test('browser locale negotiation handles regional tags, order, absent and unsupported values', () => {
  for (const [browser, expected] of [
    [{ languages: ['ko-KR'] }, 'ko'], [{ languages: ['en-GB'] }, 'en'],
    [{ languages: ['zh-Hant-HK'] }, 'zh'], [{ languages: ['ja-JP'] }, 'ja'],
    [{ languages: ['es', 'ja-JP', 'en-US'] }, 'ja'],
    [{ languages: [], language: 'ZH-CN' }, 'zh'],
    [{ languages: ['es'], language: 'ko-KR' }, 'ko'],
    [{ languages: [null, 3, 'constructor', '__proto__', 'korean', 'jaJP'] }, 'en'],
    [{ languages: 'ko-KR' }, 'en'], [{}, 'en'], [undefined, 'en'],
  ]) assert.equal(browserLanguage(browser), expected);
});

test('the entry point uses the deployment root and curated demos contain no guessed live badges', () => {
  const controller = readFileSync(new URL('../../playground/chatgpt.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../playground/index.html', import.meta.url), 'utf8');
  assert.match(controller, /import \{ EXAMPLES \} from '\/examples\/index.js'/);
  assert.doesNotMatch(controller, /const EXAMPLES\s*=|const SAMPLES\s*=/);
  assert.doesNotMatch(html, /MPS\s*90|Fidelity\s*85|hp-meta/);
  assert.match(html, /<details[^>]*>\s*<summary id="meaning-label"/);
});


test('only allowlisted URL languages take precedence over the browser locale', () => {
  for (const lang of languages) assert.equal(initialLanguage({ languages: ['fr', 'ja-JP'] }, `?lang=${lang}`), lang);
  for (const value of ['', 'KO', 'ja-JP', 'en-us', 'constructor', '__proto__', 'fr', '<script>']) {
    assert.equal(initialLanguage({ languages: ['ko-KR'] }, `?lang=${encodeURIComponent(value)}`), 'ko');
    assert.equal(initialLanguage(undefined, `?lang=${encodeURIComponent(value)}`), 'en');
  }
  assert.equal(initialLanguage({ languages: ['zh-TW'] }), 'zh');
  assert.equal(initialLanguage(undefined), 'en');
});
