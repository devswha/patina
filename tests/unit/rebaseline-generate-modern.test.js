import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  buildPrivateRecord,
  buildPrompt,
  generateModernSamples,
  parseArgs,
  parseModelItems,
  SUPPORTED_LANGUAGES,
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

test('buildPrompt supports zh and ja with language-specific name + length rule (#W0.5)', () => {
  const zh = buildPrompt({ language: 'zh', family: 'gpt-family', start: 1, count: 2, generatedAt: '2026-06-14' });
  assert.match(zh, /Simplified Chinese/u);
  assert.match(zh, /Chinese characters/u);
  assert.match(zh, /rb26-zh-gpt-001/u);
  assert.match(zh, /Return exactly one syntactically valid JSON array/u);

  const ja = buildPrompt({ language: 'ja', family: 'claude-family', start: 1, count: 2, generatedAt: '2026-06-14' });
  assert.match(ja, /Japanese/u);
  assert.match(ja, /Japanese characters/u);
  assert.match(ja, /rb26-ja-claude-001/u);
});

test('parseArgs accepts zh/ja and rejects unsupported languages (#W0.5)', () => {
  assert.deepEqual(parseArgs(['--languages', 'zh,ja']).languages, ['zh', 'ja']);
  assert.throws(() => parseArgs(['--languages', 'xx']), /Unsupported generation language/u);
  assert.ok(SUPPORTED_LANGUAGES.includes('zh'));
  assert.ok(SUPPORTED_LANGUAGES.includes('ja'));
  // ko/en defaults preserved.
  assert.deepEqual(parseArgs([]).languages, ['ko', 'en']);
});

test('generateModernSamples dry-run plans zh/ja tasks without invoking a CLI (#W0.5)', async () => {
  const out = '/tmp/w05-generate-dryrun.private.jsonl';
  const res = await generateModernSamples({
    languages: ['zh', 'ja'],
    families: ['gpt-family'],
    perCell: 1,
    batchSize: 1,
    dryRun: true,
    output: out,
  });
  assert.deepEqual(res.errors, []);
  assert.ok(res.tasks.length >= 2);
  assert.deepEqual([...new Set(res.tasks.map((t) => t.language))].sort(), ['ja', 'zh']);
  assert.deepEqual(res.appended, []); // dry-run writes nothing
});
