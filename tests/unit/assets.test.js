import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
