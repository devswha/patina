import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.svg')) out.push(path);
  }
  return out;
}

test('brand and social SVGs keep accessible image metadata', () => {
  for (const file of walk(resolve(REPO_ROOT, 'assets'))) {
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /role="img"/, `${file}: missing role="img"`);
    const hasTitleAndDesc = /<title\b[^>]*>/.test(svg) && /<desc\b[^>]*>/.test(svg);
    const hasAriaLabel = /aria-label="[^"]+"/.test(svg);
    assert.ok(hasTitleAndDesc || hasAriaLabel, `${file}: missing title/desc or aria-label`);
  }
});

test('README uses the canonical transparent mark asset, not a duplicate README-only SVG', () => {
  const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /assets\/brand\/patina-mark\.svg/);
  assert.doesNotMatch(readme, /patina-readme-logo\.svg/);
});

const README_FILES = ['README.md', 'README_KR.md', 'README_ZH.md', 'README_JA.md'];

function extractLocalImageRefs(markdown) {
  const refs = [];
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
    refs.push(match[1]);
  }
  for (const match of markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    refs.push(match[1].split(/\s+/)[0]);
  }
  return refs.filter((ref) => !/^(?:https?:|#)/.test(ref));
}

test('localized README hero excerpts come from the matching language showcase', async () => {
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const languages = { 'README.md': 'en', 'README_KR.md': 'ko', 'README_ZH.md': 'zh', 'README_JA.md': 'ja' };
  for (const [file, lang] of Object.entries(languages)) {
    const hero = readFileSync(resolve(REPO_ROOT, file), 'utf8').split(/^```/m)[0];
    const quotes = [...hero.matchAll(/^>[^\n]*(?:\n>[^\n]*)*/gm)].map(match => normalize(match[0].replace(/^>\s?/gm, '')));
    assert.ok(quotes.length >= 2, `${file}: expected a before/after hero pair before setup commands`);
    const { default: rows } = await import(pathToFileURL(resolve(REPO_ROOT, `playground/examples/${lang}.js`)));
    assert.ok(quotes.some((before, index) => quotes[index + 1] && rows.some(row => normalize(row.before).includes(before) && normalize(row.after).includes(quotes[index + 1]))), `${file}: excerpts must match one native source pair`);
  }
});

test('prepared README examples are labeled and do not claim recorded quality scores', () => {
  for (const file of README_FILES) {
    const hero = readFileSync(resolve(REPO_ROOT, file), 'utf8').split(/^```/m)[0];
    assert.match(hero, /illustrative|설명용|虚构|说明性|説明用/iu, `${file}: missing illustrative label`);
    assert.doesNotMatch(hero, /(?:MPS|Fidelity)\s*[:：]?\s*\d/i, `${file}: prepared examples cannot claim measured scores`);
    assert.doesNotMatch(hero, /<img\b[^>]*assets\/demo\//, `${file}: a historical recording must not substitute for the native example`);
  }
});

test('localized READMEs have no broken local image references', () => {
  for (const file of README_FILES) {
    const markdown = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    for (const ref of extractLocalImageRefs(markdown)) {
      const cleanRef = ref.replace(/[#?].*$/, '');
      assert.ok(existsSync(resolve(REPO_ROOT, cleanRef)), `${file}: missing image ${ref}`);
    }
  }
});

test('README demo GIFs stay small enough for GitHub rendering', () => {
  const files = ['assets/demo/patina-demo-live-en.gif', 'assets/demo/patina-playground-en.gif'];
  for (const file of files) {
    const size = statSync(resolve(REPO_ROOT, file)).size;
    assert.ok(size > 0, `${file}: empty asset`);
    assert.ok(size < 10 * 1024 * 1024, `${file}: keep README GIF under 10 MB`);
  }
});
