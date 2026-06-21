import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CARD_WIDTH,
  CARD_HEIGHT,
  MAX_SNIPPET_CHARS,
  buildCard,
  charColumns,
  escapeXml,
  formatScoreLine,
  formatScoreValue,
  normalizeSnippet,
  parseArgs,
  renderShareCard,
  stringColumns,
  truncateSnippet,
  wrapSnippetLines,
} from '../../scripts/share-card.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('renderShareCard emits a 1200x630 brand card with both panels and footer', () => {
  const svg = renderShareCard({
    before: 'Coffee has emerged as a pivotal cultural phenomenon.',
    after: 'Coffee changed how people meet.',
    aiScore: 0,
  });
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes(`width="${CARD_WIDTH}"`));
  assert.ok(svg.includes(`height="${CARD_HEIGHT}"`));
  assert.match(svg, /<title id="title">patina before and after/);
  assert.ok(svg.includes('Before'));
  assert.ok(svg.includes('After'));
  assert.ok(svg.includes('github.com/devswha/patina'));
  // Brand mark + tagline present.
  assert.ok(svg.includes('>patina</text>'));
  assert.ok(svg.includes('Strip the AI packaging. Keep the meaning.'));
});

test('escapeXml neutralizes markup so embedded prose cannot break the SVG', () => {
  assert.equal(escapeXml('a < b & "c" > \'d\''), 'a &lt; b &amp; &quot;c&quot; &gt; &apos;d&apos;');
  const svg = renderShareCard({ before: '<script>alert(1)</script> & "x"', after: 'safe', aiScore: 10 });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('truncateSnippet caps length, adds an ellipsis, and never leaks full text', () => {
  const long = 'word '.repeat(200).trim();
  const out = truncateSnippet(long);
  assert.ok(Array.from(out).length <= MAX_SNIPPET_CHARS + 1); // +1 for the ellipsis
  assert.ok(out.endsWith('\u2026'));
  assert.ok(out.length < long.length);

  const short = 'A short line.';
  assert.equal(truncateSnippet(short), short);
});

test('normalizeSnippet collapses newlines and runs of whitespace', () => {
  assert.equal(normalizeSnippet('a\n\n  b\t c '), 'a b c');
});

test('wrapSnippetLines word-wraps and clips to a bounded line count', () => {
  const lines = wrapSnippetLines('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu');
  assert.ok(lines.length >= 1);
  assert.ok(lines.length <= 6);
});

test('charColumns / stringColumns count CJK as full-width', () => {
  assert.equal(charColumns('a'), 1);
  assert.equal(charColumns('커'), 2);
  assert.equal(charColumns('字'), 2);
  assert.equal(charColumns('あ'), 2);
  assert.equal(stringColumns('a커'), 3);
});

test('wrapSnippetLines hard-breaks spaceless CJK runs within the column budget', () => {
  const cjk = '커피는'.repeat(40);
  const columnBudget = 36;
  const ellipsisSlack = 1;
  const lines = wrapSnippetLines(cjk);
  assert.ok(lines.length >= 1);
  assert.ok(lines.length <= 6);
  for (const line of lines) {
    assert.ok(stringColumns(line) <= columnBudget + ellipsisSlack, `line too wide: ${line} (${stringColumns(line)} cols)`);
  }
});

test('formatScoreValue rounds numbers and renders an em-dash for missing scores', () => {
  assert.equal(formatScoreValue(18.6), '19');
  assert.equal(formatScoreValue(0), '0');
  assert.equal(formatScoreValue(null), '\u2014');
  assert.equal(formatScoreValue(undefined), '\u2014');
  assert.equal(formatScoreValue(Number.NaN), '\u2014');
});

test('formatScoreLine includes MPS only when a finite number is given', () => {
  assert.equal(formatScoreLine({ aiScore: 12, mps: 92 }), 'AI 12  ·  MPS 92');
  assert.equal(formatScoreLine({ aiScore: 12, mps: null }), 'AI 12');
  assert.equal(formatScoreLine({ aiScore: null, mps: undefined }), 'AI \u2014');
});

test('parseArgs reads inline/file inputs and rejects unknown options', () => {
  const opts = parseArgs(['--before', 'x', '--after', 'y', '--out', 'c.svg', '--lang', 'ko', '--mps', '90']);
  assert.equal(opts.before, 'x');
  assert.equal(opts.after, 'y');
  assert.equal(opts.out, 'c.svg');
  assert.equal(opts.lang, 'ko');
  assert.equal(opts.mps, 90);
  assert.throws(() => parseArgs(['--bogus']), /unknown option --bogus/);
});

test('buildCard derives AI score deterministically and renders for CJK input', () => {
  const before = '커피는 사회적 상호작용을 근본적으로 변화시킨 중대한 문화적 현상으로 부상했다. '.repeat(3);
  const after = '커피는 사람들이 만나는 방식을 조용히 바꿔 놓았다.';
  const svg = buildCard({ before, after, lang: 'ko', repoRoot });
  assert.ok(svg.includes(`width="${CARD_WIDTH}"`));
  // Score chip is present and numeric or em-dash (deterministic, never thrown).
  assert.match(svg, /After {2}· {2}AI (\d+|\u2014)/);
});

test('CLI writes a valid SVG file to --out', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-card-'));
  const out = resolve(dir, 'card.svg');
  const result = spawnSync(
    process.execPath,
    ['scripts/share-card.mjs', '--before', 'Coffee has emerged as a pivotal phenomenon.', '--after', 'Coffee changed how people meet.', '--lang', 'en', '--out', out],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const svg = readFileSync(out, 'utf8');
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes(`width="${CARD_WIDTH}"`));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

test('CLI errors when before/after are both missing', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/share-card.mjs', '--before', 'only before'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs both/);
});
