import test from 'node:test';
import assert from 'node:assert';

import { parseArgs } from '../../src/cli/args.js';
import { buildPrompt } from '../../src/prompt-builder.js';

// #473: Markdown ATX headings are document structure (TOC + #anchor slugs). The
// rewrite prompt must tell the model to preserve them verbatim by default, on
// both the strict path (openai-http) and the minimal path (local CLI backends),
// and drop that instruction only when --rewrite-headings opts in.

const EN_BASE = {
  config: { language: 'en', profile: 'default' },
  patterns: [],
  profile: null,
  voice: null,
  scoring: null,
  text: 'Sample body text for prompt construction.',
};
const KO_BASE = { ...EN_BASE, config: { language: 'ko', profile: 'default' } };

const EN_RULE = 'preserve headings (required)';
const KO_RULE = '제목 보존(필수)';

test('parseArgs exposes --rewrite-headings as an opt-in flag (default off)', () => {
  assert.equal(parseArgs(['draft.md']).rewriteHeadings, undefined);
  assert.equal(parseArgs(['--rewrite-headings', 'draft.md']).rewriteHeadings, true);
  // It is a boolean switch: `--rewrite-headings=1` must be rejected.
  assert.throws(() => parseArgs(['--rewrite-headings=1', 'draft.md']), /rewrite-headings/);
});

test('strict rewrite prompt preserves headings by default and drops the rule on opt-in (#473)', () => {
  const def = buildPrompt({ ...EN_BASE, mode: 'rewrite' });
  assert.ok(def.includes(EN_RULE), 'default strict rewrite must carry the heading-preservation rule');

  const optIn = buildPrompt({ ...EN_BASE, mode: 'rewrite', rewriteHeadings: true });
  assert.ok(!optIn.includes(EN_RULE), '--rewrite-headings must drop the rule');
});

test('minimal rewrite prompt preserves headings by default and drops the rule on opt-in (#473)', () => {
  const def = buildPrompt({ ...EN_BASE, mode: 'rewrite', promptMode: 'minimal' });
  assert.ok(def.includes(EN_RULE), 'default minimal rewrite must carry the heading-preservation rule');

  const optIn = buildPrompt({ ...EN_BASE, mode: 'rewrite', promptMode: 'minimal', rewriteHeadings: true });
  assert.ok(!optIn.includes(EN_RULE), '--rewrite-headings must drop the rule on the minimal path too');
});

test('the heading rule is localized for Korean on both paths (#473)', () => {
  assert.ok(buildPrompt({ ...KO_BASE, mode: 'rewrite' }).includes(KO_RULE));
  assert.ok(buildPrompt({ ...KO_BASE, mode: 'rewrite', promptMode: 'minimal' }).includes(KO_RULE));
});

test('non-rewrite modes never carry the heading-preservation rule (#473)', () => {
  for (const mode of ['audit', 'score', 'diff']) {
    assert.ok(!buildPrompt({ ...EN_BASE, mode }).includes(EN_RULE), `${mode} must not carry the rule`);
  }
});
