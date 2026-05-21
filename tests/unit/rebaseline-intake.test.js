import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashText } from '../../scripts/rebaseline-summary.mjs';
import {
  parseArgs,
  processIntake,
  renderIntakeSummary,
  sanitizeIntakeRows,
  writeIntakeOutputs,
} from '../../scripts/rebaseline-intake.mjs';

const BASE_ROW = {
  language: 'ko',
  class: 'ai-like',
  register: 'blog',
  model_family: 'gpt-family',
  provider: 'fixture',
  model: 'fixture-gpt-family-2026-05',
  generated_at: '2026-05-21',
  prompt_id: 'rb25-ko-blog-001',
  decoding: { temperature: 0.7, top_p: 0.9 },
  postprocess: { editing_pass: 'none' },
};

test('sanitizeIntakeRows strips non-redistributable text into private rows', () => {
  const text = '이 문단은 로컬 원문이라 공개 manifest에는 들어가면 안 된다.';
  const result = sanitizeIntakeRows([
    {
      lineNumber: 1,
      value: {
        ...BASE_ROW,
        sample_id: 'ko-private-ai-001',
        redistribution: 'no-redistribution',
        text,
      },
    },
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.publicRecords.length, 1);
  assert.equal(result.privateRecords.length, 1);
  assert.equal(result.publicRecords[0].text, undefined);
  assert.equal(result.publicRecords[0].text_hash, hashText(text));
  assert.equal(result.privateRecords[0].text, text);
});

test('sanitizeIntakeRows keeps redistributable text public', () => {
  const text = '공개 가능한 예시 문단은 manifest에 그대로 남겨도 된다.';
  const result = sanitizeIntakeRows([
    {
      lineNumber: 1,
      value: {
        ...BASE_ROW,
        sample_id: 'ko-public-ai-001',
        redistribution: 'repo-ok',
        text,
      },
    },
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.publicRecords.length, 1);
  assert.equal(result.privateRecords.length, 0);
  assert.equal(result.publicRecords[0].text, text);
  assert.equal(result.publicRecords[0].text_hash, hashText(text));
});

test('processIntake writes only sanitized public output and ignored private output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-rebaseline-intake-'));
  try {
    const input = join(dir, 'intake.jsonl');
    const publicOutput = join(dir, 'manifest.public.jsonl');
    const privateOutput = join(dir, 'private.jsonl');
    const text = '비공개 원문은 private 파일로만 나간다.';
    writeFileSync(
      input,
      `${JSON.stringify({
        ...BASE_ROW,
        sample_id: 'ko-private-ai-002',
        redistribution: 'metadata-only',
        text,
      })}\n`
    );

    const result = processIntake({ input });
    assert.deepEqual(result.errors, []);
    const written = writeIntakeOutputs(result, { publicOutput, privateOutput });

    const publicRows = readFileSync(publicOutput, 'utf8').trim().split('\n').map(JSON.parse);
    const privateRows = readFileSync(privateOutput, 'utf8').trim().split('\n').map(JSON.parse);

    assert.equal(written.privateOutput.endsWith('private.jsonl'), true);
    assert.equal(publicRows[0].text, undefined);
    assert.equal(publicRows[0].text_hash, hashText(text));
    assert.equal(privateRows[0].text, text);

    const summary = renderIntakeSummary(result, written);
    assert.match(summary, /Validation: \*\*PASS\*\*/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracked KO 25-row pilot template passes strict intake validation', () => {
  const result = processIntake({
    input: 'artifacts/rebaseline-2025/intake.local.example.jsonl',
    requireSourceReview: true,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.publicRecords.length, 25);
  assert.equal(result.privateRecords.length, 0);
  assert.equal(result.publicRecords.filter((record) => record.language === 'ko').length, 25);
});

test('hash mismatches fail before writing intake outputs', () => {
  const result = sanitizeIntakeRows([
    {
      lineNumber: 1,
      value: {
        ...BASE_ROW,
        sample_id: 'ko-mismatch-ai-001',
        redistribution: 'repo-ok',
        text: '현재 본문',
        text_hash: hashText('다른 본문'),
      },
    },
  ]);

  assert.match(result.errors.join('\n'), /text_hash mismatch/);
  assert.throws(() => writeIntakeOutputs(result), /refusing to write/);
});

test('non-public rows warn about missing source review by default', () => {
  const result = sanitizeIntakeRows([
    {
      lineNumber: 1,
      value: {
        ...BASE_ROW,
        sample_id: 'ko-no-review-ai-001',
        redistribution: 'metadata-only',
        text_hash: hashText('placeholder'),
      },
    },
  ]);

  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /source_review or reviewer_notes/);
});

test('strict source-review mode fails non-public rows without provenance notes', () => {
  const result = sanitizeIntakeRows(
    [
      {
        lineNumber: 1,
        value: {
          ...BASE_ROW,
          sample_id: 'ko-strict-no-review-ai-001',
          redistribution: 'metadata-only',
          text_hash: hashText('placeholder'),
        },
      },
    ],
    { requireSourceReview: true }
  );

  assert.match(result.errors.join('\n'), /source_review or reviewer_notes/);
  assert.throws(() => writeIntakeOutputs(result), /refusing to write/);
});

test('strict source-review mode accepts source_review metadata', () => {
  const result = sanitizeIntakeRows(
    [
      {
        lineNumber: 1,
        value: {
          ...BASE_ROW,
          sample_id: 'ko-strict-reviewed-ai-001',
          redistribution: 'metadata-only',
          text_hash: hashText('placeholder'),
          source_review: {
            status: 'hash-only',
            rationale: 'provider terms not reviewed for redistribution',
          },
        },
      },
    ],
    { requireSourceReview: true }
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('parseArgs exposes strict source-review mode', () => {
  const args = parseArgs(['--input', 'in.jsonl', '--require-source-review', '--dry-run']);
  assert.equal(args.input, 'in.jsonl');
  assert.equal(args.requireSourceReview, true);
  assert.equal(args.dryRun, true);
});
