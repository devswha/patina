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

function extractDemoHero(file) {
  const markdown = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  const match = markdown.match(/<img\b[^>]*\bsrc="([^"]*assets\/demo\/[^"]+)"[^>]*\balt="([^"]+)"/);
  assert.ok(match, `${file}: missing demo hero image`);
  return { src: match[1], localSrc: localizeDemoSrc(match[1]), alt: match[2] };
}

function localizeDemoSrc(src) {
  const match = src.match(/assets\/demo\/[^"?]+/);
  assert.ok(match, `unexpected demo hero path: ${src}`);
  return match[0];
}

test('localized READMEs point at a demo hero GIF that exists', () => {
  // The English README (the launch-facing one) leads with the live, production-
  // hosted capture; the localized KR/ZH/JA READMEs keep the playground demo hero.
  const liveGif = 'https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-demo-live-en.gif';
  const playgroundGif = 'https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-playground-en.gif';
  const expected = {
    'README.md': liveGif,
    'README_KR.md': playgroundGif,
    'README_ZH.md': playgroundGif,
    'README_JA.md': playgroundGif,
  };

  for (const file of README_FILES) {
    const { src, localSrc } = extractDemoHero(file);
    assert.equal(src, expected[file], `${file}: unexpected demo hero`);
    assert.ok(existsSync(resolve(REPO_ROOT, localSrc)), `${file}: missing ${localSrc}`);
  }
});

test('English demo hero copy does not describe a Korean recording', () => {
  const koreanTerms = /Korean|한국|韓国|韩文|韓文/u;
  const english = extractDemoHero('README.md');
  assert.doesNotMatch(english.alt, koreanTerms);
  assert.doesNotMatch(english.alt, /[\u3130-\u318f\uac00-\ud7af]/u);

  for (const file of ['README_ZH.md', 'README_JA.md']) {
    const { localSrc, alt } = extractDemoHero(file);
    assert.equal(localSrc, 'assets/demo/patina-playground-en.gif');
    assert.doesNotMatch(alt, koreanTerms, `${file}: preview alt should not describe a Korean recording`);
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
  const files = ['assets/demo/patina-demo-live-en.gif', 'assets/demo/patina-playground-en.gif', 'assets/demo/patina-preview-en.gif', 'assets/demo/patina-preview-ko.gif'];
  for (const file of files) {
    const size = statSync(resolve(REPO_ROOT, file)).size;
    assert.ok(size > 0, `${file}: empty asset`);
    assert.ok(size < 10 * 1024 * 1024, `${file}: keep README GIF under 10 MB`);
  }
});
