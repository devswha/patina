import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('README uses the canonical logo asset, not a duplicate README-only SVG', () => {
  const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /assets\/brand\/patina-logo\.svg/);
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

function extractDemoHero(file) {
  const markdown = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  const match = markdown.match(/<img\b[^>]*\bsrc="(assets\/demo\/[^"]+)"[^>]*\balt="([^"]+)"/);
  assert.ok(match, `${file}: missing demo hero image`);
  return { src: match[1], alt: match[2] };
}

test('localized READMEs point at language-suffixed demo GIFs that exist', () => {
  const expected = {
    'README.md': 'assets/demo/patina-demo-en.gif',
    'README_KR.md': 'assets/demo/patina-demo-ko.gif',
    'README_ZH.md': 'assets/demo/patina-demo-en.gif',
    'README_JA.md': 'assets/demo/patina-demo-en.gif',
  };

  for (const file of README_FILES) {
    const { src } = extractDemoHero(file);
    assert.equal(src, expected[file], `${file}: unexpected demo hero`);
    assert.match(src, /assets\/demo\/patina-demo-(?:en|ko|zh|ja)\.gif$/);
    assert.ok(existsSync(resolve(REPO_ROOT, src)), `${file}: missing ${src}`);
  }
});

test('English demo hero copy does not describe a Korean recording', () => {
  const koreanTerms = /Korean|한국|韓国|韩文|韓文/u;
  const english = extractDemoHero('README.md');
  assert.doesNotMatch(english.alt, koreanTerms);
  assert.doesNotMatch(english.alt, /[\u3130-\u318f\uac00-\ud7af]/u);

  for (const file of ['README_ZH.md', 'README_JA.md']) {
    const { src, alt } = extractDemoHero(file);
    assert.equal(src, 'assets/demo/patina-demo-en.gif');
    assert.doesNotMatch(alt, koreanTerms, `${file}: fallback alt should say English, not Korean`);
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
  for (const file of ['assets/demo/patina-demo-en.gif', 'assets/demo/patina-demo-ko.gif']) {
    const size = statSync(resolve(REPO_ROOT, file)).size;
    assert.ok(size > 0, `${file}: empty asset`);
    assert.ok(size < 10 * 1024 * 1024, `${file}: keep README GIF under 10 MB`);
  }
});
