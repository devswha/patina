import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPPORTED_LANGS,
  collectMdxFiles,
  formatMdxReport,
  runMdxScore,
  scoreMdxText,
  stripMdxEsm,
} from '../../scripts/qa/mdx-score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../scripts/qa/mdx-score.mjs');

const LEXICON_DENSE_PARA =
  'This transformative, seamless platform will empower your ecosystem with curated, cutting-edge workflows.';

function makeDocsDir() {
  return mkdtempSync(resolve(tmpdir(), 'patina-mdx-'));
}

test('stripMdxEsm removes single-line and multi-line ESM statements', () => {
  const raw = [
    '---',
    'title: Demo',
    '---',
    "import { Step, Steps } from 'fumadocs-ui/components/steps';",
    'import {',
    '  Tab,',
    '  Tabs,',
    "} from 'fumadocs-ui/components/tabs';",
    'export const metadata = {',
    "  title: 'Demo',",
    '};',
    '',
    'Real prose stays in the document.',
  ].join('\n');

  const stripped = stripMdxEsm(raw);
  assert.doesNotMatch(stripped, /fumadocs-ui/);
  assert.doesNotMatch(stripped, /metadata/);
  assert.doesNotMatch(stripped, /Tabs,/);
  assert.match(stripped, /Real prose stays in the document\./);
  assert.match(stripped, /title: Demo/); // frontmatter untouched; stripProse owns it
});

test('stripMdxEsm leaves fenced code blocks untouched', () => {
  const raw = [
    'Prose before the example.',
    '',
    '```ts',
    "import { foo } from 'bar';",
    'export const x = 1;',
    '```',
    '',
    'Prose after the example.',
  ].join('\n');

  const stripped = stripMdxEsm(raw);
  assert.match(stripped, /import \{ foo \} from 'bar';/);
  assert.match(stripped, /export const x = 1;/);
  assert.match(stripped, /Prose before/);
  assert.match(stripped, /Prose after/);
});

test('stripMdxEsm ignores brackets inside string literals of ESM lines', () => {
  const raw = [
    'export const description = "Configure the CLI (see below";',
    '',
    'First prose paragraph survives the unbalanced bracket in the string.',
    '',
    'Second prose paragraph (with a stray ) closer) also survives.',
    '',
    'Third prose paragraph stays as well.',
  ].join('\n');

  const stripped = stripMdxEsm(raw);
  assert.doesNotMatch(stripped, /Configure the CLI/);
  assert.match(stripped, /First prose paragraph/);
  assert.match(stripped, /Second prose paragraph/);
  assert.match(stripped, /Third prose paragraph/);
});

test('stripMdxEsm keeps hard-wrapped prose lines starting with import/export words', () => {
  const raw = [
    'When the job finishes you can',
    'export the results to CSV, or keep them in the dashboard for later use.',
    'Some teams also',
    'import older runs, then archive them once the comparison is done.',
  ].join('\n');

  const stripped = stripMdxEsm(raw);
  assert.match(stripped, /export the results to CSV, or keep them in the dashboard for later use\./);
  assert.match(stripped, /import older runs, then archive them once the comparison is done\./);
});

test('stripMdxEsm ends a runaway ESM block at the next blank line', () => {
  const raw = [
    'export const weird = makeThing({', // genuinely open bracket, never closed
    "  label: 'demo',",
    '',
    'Prose after the blank line is never swallowed.',
  ].join('\n');

  const stripped = stripMdxEsm(raw);
  assert.doesNotMatch(stripped, /makeThing/);
  assert.match(stripped, /Prose after the blank line is never swallowed\./);
});

test('collectMdxFiles filters by language suffix without regex interpolation', () => {
  const dir = makeDocsDir();
  try {
    writeFileSync(resolve(dir, 'guide.mdx'), 'en body');
    writeFileSync(resolve(dir, 'guide.ko.mdx'), 'ko body');
    writeFileSync(resolve(dir, 'guide.ja.mdx'), 'ja body');
    writeFileSync(resolve(dir, 'notes.txt'), 'not mdx');

    const en = collectMdxFiles(dir, 'en').map((f) => f.slice(dir.length + 1));
    const ko = collectMdxFiles(dir, 'ko').map((f) => f.slice(dir.length + 1));
    assert.deepEqual(en, ['guide.mdx']);
    assert.deepEqual(ko, ['guide.ko.mdx']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scoreMdxText does not count MDX imports as prose paragraphs', () => {
  const raw = [
    "import { Card } from 'fumadocs-ui/components/card';",
    "import { Callout } from 'fumadocs-ui/components/callout';",
    '',
    'One real paragraph of plain prose that should be the only paragraph counted.',
  ].join('\n');

  const row = scoreMdxText(raw, { file: 'imports.mdx', lang: 'en' });
  assert.equal(row.paragraphCount, 1);
  assert.equal(row.analysisSkipped, true);
});

test('scoreMdxText keeps the lexicon channel wired (issue #398)', () => {
  const raw = [
    LEXICON_DENSE_PARA,
    '',
    LEXICON_DENSE_PARA,
    '',
    LEXICON_DENSE_PARA,
  ].join('\n');

  const row = scoreMdxText(raw, { file: 'sloppy.mdx', lang: 'en' });
  assert.equal(row.paragraphCount, 3);
  assert.ok(row.hotCount > 0, 'lexicon-dense paragraphs must trip hot signals');
});

test('runMdxScore floors leaked files to the top of the ranking', () => {
  const dir = makeDocsDir();
  try {
    writeFileSync(resolve(dir, 'clean.mdx'), [
      'A careful pass over each section catches the slips a checklist misses today.',
      '',
      'Readers forgive a clumsy sentence faster than they forgive a hollow one anyway.',
      '',
      'Nobody edits well at midnight, so schedule the second pass for the morning instead.',
    ].join('\n'));
    writeFileSync(resolve(dir, 'leaky.mdx'), [
      'A short note about sources for this page and where each citation came from.',
      '',
      'See https://example.com/?utm_source=chatgpt.com for the background reading list.',
      '',
      'The grok_card token also appears in this pasted paragraph somehow, unedited.',
    ].join('\n'));

    const { rows } = runMdxScore(dir, 'en');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].f, 'leaky.mdx');
    assert.equal(rows[0].leak, true);
    assert.ok(rows[0].score >= 90, `leak floor must rank first, got ${rows[0].score}`);

    const report = formatMdxReport({ rows, thin: [] }, 'en');
    assert.match(report, /scored 2 files \(lang=en/);
    assert.match(report, /LEAK\s+leaky\.mdx/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runMdxScore routes analyzer-skipped hot files to the thin bucket', () => {
  const dir = makeDocsDir();
  try {
    writeFileSync(resolve(dir, 'thin.mdx'), [
      "import { Card } from 'fumadocs-ui/components/card';",
      '',
      LEXICON_DENSE_PARA,
    ].join('\n'));

    const { rows, thin } = runMdxScore(dir, 'en');
    assert.equal(rows.length, 0);
    assert.equal(thin.length, 1);
    assert.equal(thin[0].total, 1);
    const report = formatMdxReport({ rows, thin }, 'en');
    assert.match(report, /template-intro candidates: 1/);
    assert.match(report, /thin\.mdx/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 1 with usage when lang is missing or invalid', () => {
  const dir = makeDocsDir();
  try {
    const missing = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /usage: node scripts\/qa\/mdx-score\.mjs/);
    assert.doesNotMatch(missing.stdout, /scored \d+ files/);

    const invalid = spawnSync(process.execPath, [SCRIPT, dir, 'xx'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, new RegExp(SUPPORTED_LANGS.join(', ')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI scores a directory when lang is valid', () => {
  const dir = makeDocsDir();
  try {
    writeFileSync(resolve(dir, 'guide.mdx'), [
      'A careful pass over each section catches the slips a checklist misses today.',
      '',
      'Readers forgive a clumsy sentence faster than they forgive a hollow one anyway.',
      '',
      'Nobody edits well at midnight, so schedule the second pass for the morning instead.',
    ].join('\n'));

    const run = spawnSync(process.execPath, [SCRIPT, dir, 'en'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /scored 1 files \(lang=en/);
    assert.match(run.stdout, /guide\.mdx/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
