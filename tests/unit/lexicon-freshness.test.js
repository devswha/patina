import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkLexiconProvenance,
  loadJsonlRows,
  mineLexiconLift,
  parseArgs,
  parseFrontmatterFile,
  parseLexiconEntries,
  renderLiftMarkdown,
  writeLiftReport,
} from '../../scripts/lexicon-freshness.mjs';

const SAMPLE_ENTRIES = [
  { kind: 'strict', entry: 'transformative' },
  { kind: 'phrase', entry: 'on the other hand' },
];

test('repo lexicons have exact per-entry provenance sidecars', () => {
  const result = checkLexiconProvenance();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(
    result.files.map((file) => [file.file, file.entries, file.provenanceRows]),
    [
      ['lexicon/ai-en.md', 88, 88],
      ['lexicon/ai-ko.md', 102, 102],
      ['lexicon/ai-zh.md', 60, 60],
      ['lexicon/ai-ja.md', 60, 60],
    ]
  );
});

test('English frontmatter count matches retained remine entries', () => {
  const parsed = parseFrontmatterFile('lexicon/ai-en.md');
  const entries = parseLexiconEntries(parsed.body).all;
  assert.equal(parsed.meta.entries, 88);
  assert.equal(entries.length, 88);
  assert.equal(entries.some((entry) => entry.entry === 'state-of-the-art'), false);
  assert.equal(entries.some((entry) => entry.entry === 'transformative'), true);
});

test('mineLexiconLift keeps high-lift entries and drops low-lift entries', () => {
  const rows = [
    { value: { language: 'en', class: 'ai-like', register: 'blog', text: 'This is a transformative update.' } },
    { value: { language: 'en', class: 'ai-like', register: 'docs', text: 'A transformative release changes the defaults.' } },
    { value: { language: 'en', class: 'natural-human', register: 'blog', text: 'On the other hand, the older note stayed.' } },
    { value: { language: 'en', class: 'natural-human', register: 'docs', text: 'On the other hand, the draft was still useful.' } },
  ];

  const result = mineLexiconLift(rows, SAMPLE_ENTRIES, {
    lang: 'en',
    sourceId: 'unit',
    validatedAt: '2026-05-22',
  });

  const decisions = Object.fromEntries(result.decisions.map((row) => [row.entry, row]));
  assert.equal(decisions.transformative.decision, 'keep');
  assert.equal(decisions['on the other hand'].decision, 'drop');
  assert.equal(result.gate.ready, false);
});

test('lift reports stay public-safe when written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-lexicon-freshness-'));
  try {
    const input = join(dir, 'private.jsonl');
    writeFileSync(
      input,
      `${JSON.stringify({ language: 'en', class: 'ai-like', register: 'blog', text: 'A transformative moment.' })}\n` +
        `${JSON.stringify({ language: 'en', class: 'natural-human', register: 'blog', text: 'A plain note.' })}\n`
    );

    const loaded = loadJsonlRows(input);
    const result = mineLexiconLift(loaded.rows, [{ kind: 'strict', entry: 'transformative' }], {
      lang: 'en',
      input: loaded.input,
      sourceId: 'unit-private',
      sourceUrls: ['https://example.test/corpus'],
      validatedAt: '2026-05-22',
    });
    const outputJson = join(dir, 'report.json');
    const outputMd = join(dir, 'report.md');
    const written = writeLiftReport(result, { outputJson, outputMd });
    assert.ok(written.json.endsWith('report.json'));
    assert.ok(written.markdown.endsWith('report.md'));

    const markdown = renderLiftMarkdown(result);
    assert.match(markdown, /unit-private/);
    assert.match(markdown, /https:\/\/example.test\/corpus/);
    assert.doesNotMatch(markdown, /transformative moment/i);
    assert.doesNotMatch(markdown, /plain note/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseArgs defaults to provenance check', () => {
  assert.equal(parseArgs([]).check, true);
  assert.equal(parseArgs(['--input', 'rows.jsonl']).check, false);
  assert.equal(parseArgs(['--check', '--input', 'rows.jsonl']).check, true);
  assert.deepEqual(parseArgs(['--source-url', 'https://example.test']).sourceUrls, ['https://example.test']);
});
