import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  buildFixtureFile,
  fixtureSlug,
  parseArgs,
  renderExportSummary,
  runFixtureExport,
  writeFixtureFiles,
} from '../../scripts/fp-fixture-export.mjs';
import { parseFixture } from '../../scripts/update-benchmark-ranges.mjs';

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
      // B2 slice metadata (Wave 0.2): register passes through; generator/edited
      // resolved by the mapper (model_family alias -> generator, un-edited -> none);
      // model_family retained as provenance.
      register: 'blog',
      generator: 'human-reference',
      edited: 'none',
      model_family: 'human-reference',
      why_designed_this_way: [
        'Accepted false-positive report promoted to a natural control fixture.',
        `Source: ${BASE_ROW.source_doc}`,
        `Reviewer notes: ${BASE_ROW.reviewer_notes}`,
      ].join('\n'),
      topic: 'false-positive report (register: blog)',
    });
    assert.equal(match[2], `${TEXT}\n`);

    const summary = renderExportSummary(result);
    assert.match(summary, /Validation: \*\*PASS\*\*/);
    assert.match(summary, /npm run benchmark:ranges/);
  });
});

test('exported fixtures parse through the update-benchmark-ranges parse path', () => {
  withTempDir((dir) => {
    const input = writeIntake(dir, [{ ...BASE_ROW, text: TEXT }]);
    const outDir = join(dir, 'fixtures');

    const result = runFixtureExport({ input, outDir });
    assert.equal(result.written.length, 1);

    // Same parseFixture the ranges refresh runs: FP row → fixture → ranges is a contract.
    const parsed = parseFixture(join(outDir, 'ko', 'natural', 'ko-nat-01-fp-issue-412.md'));
    assert.equal(parsed.meta.fixture_id, 'ko-nat-01-fp-issue-412');
    assert.equal(parsed.meta.language, 'ko');
    assert.equal(parsed.meta.class, 'natural');
    assert.equal(parsed.meta.expected_hot, false);
    assert.equal(parsed.body, TEXT);
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

test('re-running against the same intake writes nothing and reports rows as already exported', () => {
  withTempDir((dir) => {
    const input = writeIntake(dir, [{ ...BASE_ROW, text: TEXT }]);
    const outDir = join(dir, 'fixtures');

    const first = runFixtureExport({ input, outDir });
    assert.deepEqual(first.alreadyExported, []);
    assert.equal(first.written.length, 1);

    const second = runFixtureExport({ input, outDir });
    assert.deepEqual(second.errors, []);
    assert.deepEqual(second.refused, []);
    assert.equal(second.files.length, 0);
    assert.equal(second.written.length, 0);
    assert.equal(second.alreadyExported.length, 1);
    assert.match(second.alreadyExported[0], /ko-fp-nat-001: body text already exported as `.*ko-nat-01-fp-issue-412\.md`/);
    assert.deepEqual(readdirSync(join(outDir, 'ko', 'natural')), ['ko-nat-01-fp-issue-412.md']);

    const summary = renderExportSummary(second);
    assert.match(summary, /## Already exported/);
    assert.doesNotMatch(summary, /## Refused/);
    assert.match(summary, /Validation: \*\*PASS\*\*/);
  });
});

test('rows whose source issue already produced a fixture are skipped even when the text was edited', () => {
  withTempDir((dir) => {
    const outDir = join(dir, 'fixtures');
    runFixtureExport({ input: writeIntake(dir, [{ ...BASE_ROW, text: TEXT }]), outDir });

    const edited = { ...BASE_ROW, text: `${TEXT} 관측 일지는 별관에 남았다.` };
    const result = runFixtureExport({ input: writeIntake(dir, [edited]), outDir });
    assert.equal(result.written.length, 0);
    assert.equal(result.alreadyExported.length, 1);
    assert.match(result.alreadyExported[0], /source_doc already exported as `.*ko-nat-01-fp-issue-412\.md`/);
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
    assert.match(result.refused[0], /class=ai-like does not become a public fixture/);
    assert.match(result.refused[0], /lightly-edited reports stay manifest-only/);
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

test('parseArgs rejects value flags without a value instead of falling back to defaults', () => {
  assert.throws(() => parseArgs(['--input']), /Missing value for --input/);
  assert.throws(() => parseArgs(['--out-dir']), /Missing value for --out-dir/);
  assert.throws(() => parseArgs(['--out-dir', '--dry-run']), /Missing value for --out-dir/);
});

test('topic prefers the intake topic field and self-describes the register fallback', () => {
  const explicit = buildFixtureFile({ ...BASE_ROW, text: TEXT, topic: '관측소 역사' }, 'ko-nat-01-fp-issue-412');
  assert.match(explicit, /topic: 관측소 역사\n/);

  const noRegister = { ...BASE_ROW, text: TEXT };
  delete noRegister.register;
  assert.match(buildFixtureFile(noRegister, 'ko-nat-01-fp-issue-412'), /topic: false-positive report\n/);
});

test('exported fixture retains B2 slice metadata: register/domain/generator/edited (#W0.2)', () => {
  withTempDir((dir) => {
    // Natural-human row with a domain and NO model_family -> generator defaults
    // to the human-control value, edited to none; register/domain pass through.
    const row = {
      ...BASE_ROW,
      model_family: undefined,
      domain: 'encyclopedia',
      sample_id: 'ko-fp-nat-002',
      prompt_id: 'fp-issue-500',
      source_doc: 'https://github.com/devswha/patina/issues/500',
      text: TEXT,
    };
    const input = writeIntake(dir, [row]);
    const outDir = join(dir, 'fixtures');
    const result = runFixtureExport({ input, outDir });
    assert.deepEqual(result.errors, []);
    assert.equal(result.written.length, 1);

    const path = join(outDir, 'ko', 'natural', 'ko-nat-01-fp-issue-500.md');
    const meta = yaml.load(readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/u)[1]);
    assert.equal(meta.register, 'blog');
    assert.equal(meta.domain, 'encyclopedia');
    assert.equal(meta.generator, 'human'); // no model_family -> human-control default
    assert.equal(meta.edited, 'none'); // natural-human is un-edited
    assert.equal('model_family' in meta, false); // absent provenance is not written
    assert.equal('edit_depth' in meta, false);

    // The exported fixture still parses through the benchmark ranges path.
    const parsed = parseFixture(path);
    assert.equal(parsed.meta.generator, 'human');
    assert.equal(parsed.meta.edited, 'none');
  });
});
