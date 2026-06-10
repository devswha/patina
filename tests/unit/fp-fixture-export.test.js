import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  fixtureSlug,
  parseArgs,
  renderExportSummary,
  runFixtureExport,
  writeFixtureFiles,
} from '../../scripts/fp-fixture-export.mjs';

const BASE_ROW = {
  sample_id: 'ko-fp-nat-001',
  language: 'ko',
  class: 'natural-human',
  register: 'blog',
  model_family: 'human-reference',
  provider: 'user-report',
  model: 'human',
  generated_at: '2026-06-11',
  prompt_id: 'fp-issue-412',
  decoding: { source: 'human-written' },
  postprocess: { editing_pass: 'none' },
  redistribution: 'repo-ok',
  source_doc: 'https://github.com/devswha/patina/issues/412',
  reviewer_notes: 'Encyclopedic register reads natural; score should stay below the gate.',
};
const TEXT = '관측소는 1912년에 문을 열었고, 십 년이 지나기 전에 두 번 증축됐다. 본관 돔에는 굴절 망원경이 있었고 동쪽 별관은 교실과 수장고로 쓰였다.';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-fp-fixture-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeIntake(dir, rows) {
  const input = join(dir, 'intake.jsonl');
  writeFileSync(input, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return input;
}

test('accepted public row becomes a numbered natural fixture', () => {
  withTempDir((dir) => {
    const input = writeIntake(dir, [{ ...BASE_ROW, text: TEXT }]);
    const outDir = join(dir, 'fixtures');

    const result = runFixtureExport({ input, outDir });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.refused, []);
    assert.equal(result.written.length, 1);

    const path = join(outDir, 'ko', 'natural', 'ko-nat-01-fp-issue-412.md');
    const raw = readFileSync(path, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/u);
    assert.ok(match, 'fixture must keep the suspect-zones frontmatter shape');
    assert.deepEqual(yaml.load(match[1]), {
      fixture_id: 'ko-nat-01-fp-issue-412',
      language: 'ko',
      class: 'natural',
      expected_hot: false,
      why_designed_this_way: [
        'Accepted false-positive report promoted to a natural control fixture.',
        `Source: ${BASE_ROW.source_doc}`,
        `Reviewer notes: ${BASE_ROW.reviewer_notes}`,
      ].join('\n'),
      topic: 'blog',
    });
    assert.equal(match[2], `${TEXT}\n`);

    const summary = renderExportSummary(result);
    assert.match(summary, /Validation: \*\*PASS\*\*/);
    assert.match(summary, /npm run benchmark:ranges/);
  });
});

test('numbering continues after the highest existing fixture and accepts class aliases', () => {
  withTempDir((dir) => {
    const outDir = join(dir, 'fixtures');
    mkdirSync(join(outDir, 'ko', 'natural'), { recursive: true });
    writeFileSync(join(outDir, 'ko', 'natural', 'ko-nat-07-existing.md'), '---\n---\n');
    const input = writeIntake(dir, [
      { ...BASE_ROW, text: TEXT },
      { ...BASE_ROW, sample_id: 'ko-fp-nat-002', class: 'human', text: `${TEXT} 별관 기록은 따로 남았다.` },
    ]);

    const result = runFixtureExport({ input, outDir });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.files.map((file) => file.fixtureId), [
      'ko-nat-08-fp-issue-412',
      'ko-nat-09-fp-issue-412',
    ]);
    assert.equal(existsSync(join(outDir, 'ko', 'natural', 'ko-nat-08-fp-issue-412.md')), true);
    assert.equal(existsSync(join(outDir, 'ko', 'natural', 'ko-nat-09-fp-issue-412.md')), true);
  });
});

test('non-redistributable rows are refused and never written', () => {
  withTempDir((dir) => {
    const input = writeIntake(dir, [{ ...BASE_ROW, redistribution: 'no-redistribution', text: TEXT }]);
    const outDir = join(dir, 'fixtures');

    const result = runFixtureExport({ input, outDir });
    assert.deepEqual(result.errors, []);
    assert.equal(result.refused.length, 1);
    assert.match(result.refused[0], /redistribution=no-redistribution/);
    assert.equal(result.written.length, 0);
    assert.equal(existsSync(join(outDir, 'ko')), false);
  });
});

test('non natural-human classes are refused', () => {
  withTempDir((dir) => {
    const input = writeIntake(dir, [{ ...BASE_ROW, class: 'ai-like', text: TEXT }]);
    const outDir = join(dir, 'fixtures');

    const result = runFixtureExport({ input, outDir });
    assert.equal(result.refused.length, 1);
    assert.match(result.refused[0], /class=ai-like is not natural-human/);
    assert.equal(result.written.length, 0);
    assert.equal(existsSync(join(outDir, 'ko')), false);
  });
});

test('dry run plans fixtures without writing files', () => {
  withTempDir((dir) => {
    const input = writeIntake(dir, [{ ...BASE_ROW, text: TEXT }]);
    const outDir = join(dir, 'fixtures');

    const result = runFixtureExport({ input, outDir, dryRun: true });
    assert.deepEqual(result.errors, []);
    assert.equal(result.files.length, 1);
    assert.equal(result.written.length, 0);
    assert.equal(existsSync(join(outDir, 'ko')), false);
    assert.match(renderExportSummary(result, { dryRun: true }), /dry run \(no files written\)/);
  });
});

test('rows missing provenance fail validation and block all writes', () => {
  withTempDir((dir) => {
    const row = { ...BASE_ROW, text: TEXT };
    delete row.source_doc;
    const input = writeIntake(dir, [row]);
    const outDir = join(dir, 'fixtures');

    const result = runFixtureExport({ input, outDir });
    assert.match(result.errors.join('\n'), /missing source_doc/);
    assert.equal(result.written.length, 0);
    assert.equal(existsSync(join(outDir, 'ko')), false);
  });
});

test('writeFixtureFiles enforces the licensing wall even on crafted plans', () => {
  withTempDir((dir) => {
    assert.throws(
      () => writeFixtureFiles([{
        record: { redistribution: 'private' },
        fixtureId: 'ko-nat-99-crafted',
        path: join(dir, 'ko-nat-99-crafted.md'),
        relativePath: 'ko-nat-99-crafted.md',
        content: 'leaked',
      }]),
      /non-redistributable/
    );
    assert.equal(existsSync(join(dir, 'ko-nat-99-crafted.md')), false);
  });
});

test('fixtureSlug prefers explicit slug, then issue number, then sample id', () => {
  assert.equal(fixtureSlug({ ...BASE_ROW, fixture_slug: 'Station Note!' }), 'station-note');
  assert.equal(fixtureSlug(BASE_ROW), 'fp-issue-412');
  assert.equal(fixtureSlug({ ...BASE_ROW, source_doc: 'mail thread' }), 'fp-ko-fp-nat-001');
  assert.equal(fixtureSlug({ source_doc: 'mail thread', sample_id: '한국어만' }), 'fp-report');
});

test('parseArgs exposes out-dir override and dry-run', () => {
  const args = parseArgs(['--input', 'in.jsonl', '--out-dir', 'tmp/fixtures', '--dry-run']);
  assert.equal(args.input, 'in.jsonl');
  assert.equal(args.outDir, 'tmp/fixtures');
  assert.equal(args.dryRun, true);
});
