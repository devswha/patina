import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashText } from '../../scripts/rebaseline-summary.mjs';
import {
  parseArgs,
  processScore,
  renderScoreSummary,
  scoreRows,
  writeScoreOutput,
} from '../../scripts/rebaseline-score.mjs';

const BASE_ROW = {
  sample_id: 'ko-score-unit-001',
  language: 'ko',
  class: 'natural-human',
  register: 'blog',
  model_family: 'human-reference',
  provider: 'unit',
  model: 'human-reference',
  generated_at: '2026-05-21',
  prompt_id: 'unit-score',
  decoding: 'not-applicable',
  postprocess: { editing_pass: 'none' },
  redistribution: 'hash-only',
  source_review: {
    status: 'unit',
    rationale: 'unit test row',
  },
};

test('scoreRows strips local text and adds deterministic outcome metadata', () => {
  const text = '오늘은 문장을 짧게 쓴다. 중간에 쉼표도 넣고, 결론은 천천히 적는다.';
  const result = scoreRows(
    [
      {
        lineNumber: 1,
        value: {
          ...BASE_ROW,
          text,
        },
      },
    ],
    { scoredAt: '2026-05-21' }
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.publicRecords.length, 1);

  const record = result.publicRecords[0];
  assert.equal(record.text, undefined);
  assert.equal(record.text_hash, hashText(text));
  assert.equal(record.expected_hot, false);
  assert.equal(typeof record.predicted_hot, 'boolean');
  assert.equal(typeof record.patina_score, 'number');
  assert.equal(record.score_review.scorer, 'patina deterministic analyzer');
  assert.equal(record.score_review.scored_at, '2026-05-21');
  assert.equal(record.score_review.paragraph_count, 1);
});

test('scoreRows refuses rows without local text', () => {
  const result = scoreRows([
    {
      lineNumber: 1,
      value: {
        ...BASE_ROW,
        text_hash: hashText('missing text'),
      },
    },
  ]);

  assert.match(result.errors.join('\n'), /scoring requires local text/);
});

test('processScore writes a public-safe scored manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-rebaseline-score-'));
  try {
    const input = join(dir, 'private.jsonl');
    const output = join(dir, 'scored.public.jsonl');
    writeFileSync(
      input,
      `${JSON.stringify({
        ...BASE_ROW,
        sample_id: 'ko-score-unit-002',
        text: '문장은 조금씩 다르게 간다. 어떤 문장은 짧다. 어떤 문장은 쉼표를 넣고, 천천히 마무리한다.',
      })}\n`
    );

    const result = processScore({ input, scoredAt: '2026-05-21' });
    assert.deepEqual(result.errors, []);
    const written = writeScoreOutput(result, { output });

    const rows = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, undefined);
    assert.equal(rows[0].score_review.scored_at, '2026-05-21');

    const summary = renderScoreSummary(result, written);
    assert.match(summary, /Validation: \*\*PASS\*\*/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseArgs exposes score input and output paths', () => {
  const args = parseArgs(['--input', 'private.jsonl', '--output', 'public.jsonl', '--scored-at', '2026-05-21', '--json']);
  assert.equal(args.input, 'private.jsonl');
  assert.equal(args.output, 'public.jsonl');
  assert.equal(args.scoredAt, '2026-05-21');
  assert.equal(args.json, true);
});
