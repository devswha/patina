import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  buildPrivateRecord,
  buildPrompt,
  parseArgs,
  parseModelItems,
} from '../../scripts/rebaseline-generate-modern.mjs';

test('modern rebaseline prompt assigns deterministic IDs and registers', () => {
  const prompt = buildPrompt({ language: 'ko', family: 'gpt-family', start: 1, count: 3, generatedAt: '2026-05-22' });

  assert.match(prompt, /rb26-ko-gpt-001/);
  assert.match(prompt, /rb26-ko-gpt-003/);
  assert.match(prompt, /Return exactly one syntactically valid JSON array/);
  assert.match(prompt, /blog/);
});

test('parseModelItems extracts fenced JSON and filters unexpected rows', () => {
  const raw = '```json\n[{"id":"rb26-en-gpt-001","register":"blog","text":"One paragraph. No newline."},{"id":"unexpected","register":"blog","text":"skip"}]\n```';
  const items = parseModelItems(raw, { expectedIds: ['rb26-en-gpt-001'] });

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'rb26-en-gpt-001');
  assert.equal(items[0].text, 'One paragraph. No newline.');
});

test('buildPrivateRecord marks generated rows as private hash-only inputs', () => {
  const record = buildPrivateRecord(
    { id: 'rb26-en-gpt-001', register: 'blog', text: 'Generated text.' },
    {
      language: 'en',
      family: 'gpt-family',
      generatedAt: '2026-05-22',
      config: { provider: 'codex-cli', model: 'gpt-5.5' },
      rawMeta: { reportedModel: 'gpt-5.5' },
    }
  );

  assert.equal(record.sample_id, 'rb26-en-gpt-001');
  assert.equal(record.class, 'ai-like');
  assert.equal(record.redistribution, 'hash-only');
  assert.equal(record.text, 'Generated text.');
});

test('parseArgs keeps generation defaults claim-sized', () => {
  const args = parseArgs([]);
  assert.equal(args.perCell, 100);
  assert.deepEqual(args.languages, ['ko', 'en']);
  assert.deepEqual(args.families, ['gpt-family', 'claude-family', 'gemini-family']);
});
