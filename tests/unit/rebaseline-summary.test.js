import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  hashText,
  loadManifest,
  renderMarkdownReport,
  summarizeManifest,
  validateRecord,
} from '../../scripts/rebaseline-summary.mjs';

test('example rebaseline manifest validates and keeps public claims blocked', () => {
  const manifest = loadManifest('tests/quality/rebaseline-manifest.example.jsonl');
  assert.deepEqual(manifest.errors, []);
  assert.equal(manifest.records.length, 5);

  const summary = summarizeManifest(manifest.records, { input: manifest.relativePath });
  assert.equal(summary.totalRecords, 5);
  assert.equal(summary.byLanguage.en, 2);
  assert.equal(summary.byModelFamily['gpt-family'], 1);
  assert.equal(summary.claimGate.ready, false);
  assert.match(summary.claimGate.blockers.join('\n'), /expected_hot and predicted_hot/);

  const markdown = renderMarkdownReport(summary, manifest);
  assert.match(markdown, /Public performance claim: \*\*BLOCKED\*\*/);
  assert.match(markdown, /Protocol matrix/);
});

test('private or metadata-only rows cannot carry full text', () => {
  const checked = validateRecord({
    sample_id: 'unit-private-text',
    language: 'en',
    class: 'ai-like',
    register: 'blog',
    model_family: 'gpt-family',
    provider: 'fixture',
    model: 'fixture-model',
    generated_at: '2026-05-21',
    prompt_id: 'unit-prompt',
    decoding: { temperature: 0 },
    postprocess: { editing_pass: 'none' },
    redistribution: 'metadata-only',
    text: 'private text should not be checked in',
    text_hash: hashText('private text should not be checked in'),
  });

  assert.match(checked.errors.join('\n'), /text is not allowed/);
});

test('repo-ok text must match its sha256 digest', () => {
  const checked = validateRecord({
    sample_id: 'unit-hash-mismatch',
    language: 'ko',
    class: 'natural/human',
    register: 'product-doc',
    model_family: 'human-reference',
    provider: 'fixture',
    model: 'human-reference',
    generated_at: '2026-05-21',
    prompt_id: 'unit-prompt',
    decoding: 'not-applicable',
    postprocess: { editing_pass: 'copyedit' },
    redistribution: 'repo-ok',
    text: '본문',
    text_hash: hashText('다른 본문'),
  });

  assert.match(checked.errors.join('\n'), /text_hash mismatch/);
});

test('complete outcome rows produce deterministic confusion metrics', () => {
  const base = {
    register: 'blog',
    provider: 'fixture',
    model: 'fixture-model',
    generated_at: '2026-05-21',
    prompt_id: 'unit-prompt',
    decoding: { temperature: 0 },
    postprocess: { editing_pass: 'none' },
    redistribution: 'metadata-only',
    text_hash: hashText('placeholder'),
  };
  const records = [
    { ...base, sample_id: 'tp', language: 'en', class: 'ai-like', model_family: 'gpt-family', expected_hot: true, predicted_hot: true },
    { ...base, sample_id: 'tn', language: 'ko', class: 'natural-human', model_family: 'human-reference', expected_hot: false, predicted_hot: false },
    { ...base, sample_id: 'fp', language: 'ja', class: 'natural-human', model_family: 'human-reference', expected_hot: false, predicted_hot: true },
    { ...base, sample_id: 'fn', language: 'zh', class: 'ai-like', model_family: 'claude-family', expected_hot: true, predicted_hot: false },
  ].map((record) => validateRecord(record).record);

  const summary = summarizeManifest(records);
  assert.equal(summary.metrics.tp, 1);
  assert.equal(summary.metrics.tn, 1);
  assert.equal(summary.metrics.fp, 1);
  assert.equal(summary.metrics.fn, 1);
  assert.equal(summary.metrics.accuracy, 0.5);
});
