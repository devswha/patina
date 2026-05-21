import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashText, summarizeManifest } from '../../scripts/rebaseline-summary.mjs';
import {
  buildClaimManifest,
  selectHapeEnglishControls,
  selectKoControls,
  writeClaimManifest,
} from '../../scripts/rebaseline-build-claim-manifest.mjs';

const GENERATED_ROW = {
  sample_id: 'rb26-en-gpt-001',
  language: 'en',
  class: 'ai-like',
  register: 'blog',
  model_family: 'gpt-family',
  provider: 'codex-cli',
  model: 'gpt-5.5',
  generated_at: '2026-05-22',
  prompt_id: 'rb26-en-gpt-001-prompt',
  decoding: { surface: 'codex-cli' },
  postprocess: { editing_pass: 'none' },
  redistribution: 'hash-only',
  source_review: { status: 'unit', rationale: 'unit' },
  text: 'This implementation therefore provides a consistent workflow. It also ensures each output remains structured, traceable, and easy to review.',
};

function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

test('selectKoControls takes a balanced scored subset from tracked controls', () => {
  const rows = selectKoControls('artifacts/rebaseline-2025/human-controls.public.jsonl', 10);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((row) => row.register)).size, 5);
  assert.equal(rows.every((row) => row.text === undefined), true);
});

test('selectHapeEnglishControls maps HAP-E rows to public-safe control schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-hape-unit-'));
  try {
    const input = join(dir, 'hape.jsonl');
    writeJsonl(input, [
      { sample_id: 'h1', language: 'en', class: 'natural-human', register: 'acad', generated_at: '2024', prompt_id: 'acad_1', text: 'Human academic paragraph.' },
      { sample_id: 'h2', language: 'en', class: 'natural-human', register: 'blog', generated_at: '2024', prompt_id: 'blog_1', text: 'Human blog paragraph.' },
    ]);
    const rows = selectHapeEnglishControls(input, 2);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.register).sort(), ['academic-summary', 'blog']);
    assert.equal(rows[0].redistribution, 'hash-only');
    assert.match(rows[0].text_hash, /^sha256:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildClaimManifest scores generated and English control rows without leaking text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-claim-unit-'));
  try {
    const generated = join(dir, 'generated.private.jsonl');
    const koControls = join(dir, 'ko.public.jsonl');
    const hape = join(dir, 'hape.private.jsonl');
    const output = join(dir, 'claim.public.jsonl');

    writeJsonl(generated, [GENERATED_ROW]);
    writeJsonl(koControls, [{
      sample_id: 'ko-control-unit-001',
      language: 'ko',
      class: 'natural-human',
      register: 'blog',
      model_family: 'human-reference',
      provider: 'unit',
      model: 'human-reference',
      generated_at: '2026-05-22',
      prompt_id: 'unit',
      decoding: 'not-applicable',
      postprocess: { editing_pass: 'none' },
      redistribution: 'hash-only',
      text_hash: hashText('ko'),
      expected_hot: false,
      predicted_hot: false,
      patina_score: 0,
      score_review: { scorer: 'unit' },
    }]);
    writeJsonl(hape, [{
      sample_id: 'h1',
      language: 'en',
      class: 'natural-human',
      register: 'blog',
      generated_at: '2024',
      prompt_id: 'blog_1',
      text: 'Human control text with a few sentences. It is copied only inside the private fixture.',
    }]);

    const result = buildClaimManifest({ generated, koControls, hape, koControlTotal: 1, enControlTotal: 1, scoredAt: '2026-05-22' });
    assert.deepEqual(result.errors, []);
    assert.equal(result.records.length, 3);
    assert.equal(result.records.every((row) => row.text === undefined), true);
    assert.equal(result.records.filter((row) => row.expected_hot).length, 1);

    const written = writeClaimManifest(result, output);
    const rows = readFileSync(written.output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 3);
    const summary = summarizeManifest(rows);
    assert.equal(summary.catchByLanguageFamily['en|gpt-family'].n, 1);
    assert.equal(summary.falsePositiveByLanguage.en.n, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
