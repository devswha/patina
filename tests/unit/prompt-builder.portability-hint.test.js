import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, buildPortabilityHint } from '../../src/prompt-builder.js';

// A portable-majority source with one anchored sentence: 3 generic sentences
// plus one carrying a number and a proper noun — the hint's target shape.
const PORTABLE_WITH_ANCHOR = [
  'AI coding tools represent a transformative leap forward for every team.',
  'They provide a robust and scalable foundation for future work.',
  'Why is everyone talking about it now?',
  'OpenClaw reached 250K stars in 60 days without paid promotion.',
].join('\n\n');

// Fully anchor-free: nothing legitimate to restore onto, so no hint — the
// MPS/fidelity floors own the no-invention contract and the hint never invites it.
const FULLY_PORTABLE = [
  'This tool changes how teams work together.',
  'It opens the door to new possibilities.',
  'Everyone can benefit from this approach.',
].join('\n\n');

// Anchored throughout: nothing portable-majority to pull back.
const ANCHORED = [
  'OpenClaw reached 250K stars in 60 days.',
  'The team shipped 14 releases in Q3.',
  'Downtime fell to 0.2% after the migration.',
].join('\n\n');

const baseOptions = (text, overrides = {}) => ({
  config: { language: 'en', documentType: 'default' },
  patterns: [],
  documentType: { frontmatter: {}, body: '' },
  voice: { body: '' },
  scoring: { body: '' },
  text,
  mode: 'rewrite',
  ...overrides,
});

test('buildPortabilityHint fires only for portable-majority sources with their own anchors', () => {
  assert.ok(buildPortabilityHint(PORTABLE_WITH_ANCHOR, { lang: 'en', documentTypeName: 'default' }));
  assert.equal(buildPortabilityHint(FULLY_PORTABLE, { lang: 'en', documentTypeName: 'default' }), null);
  assert.equal(buildPortabilityHint(ANCHORED, { lang: 'en', documentTypeName: 'default' }), null);
});

test('the hint always carries the never-invent clause (unit-pinned failure case)', () => {
  // #881: "원문에 구체성이 없으면 새 사실을 만들지 않는다" — the hint must never
  // read as permission to mint detail, in either language.
  const en = buildPortabilityHint(PORTABLE_WITH_ANCHOR, { lang: 'en', documentTypeName: 'default' });
  assert.match(en, /never invent/i);
  const koSource = [
    '이 도구는 모든 팀에게 획기적인 전환을 가져다줍니다.',
    '미래의 작업을 위한 견고한 기반을 제공합니다.',
    '지금 왜 다들 이야기하는 걸까요?',
    '오픈클로는 유료 홍보 없이 60일 만에 25만 스타에 도달했습니다.',
  ].join('\n\n');
  const ko = buildPortabilityHint(koSource, { lang: 'ko', documentTypeName: 'default' });
  assert.ok(ko && ko.includes('만들지 않는다'), String(ko));
});

test('registers where impersonal prose is correct suppress the hint', () => {
  for (const documentTypeName of ['academic', 'medical', 'technical', 'legal', 'formal']) {
    assert.equal(
      buildPortabilityHint(PORTABLE_WITH_ANCHOR, { lang: 'en', documentTypeName }),
      null,
      `${documentTypeName} must suppress the hint`,
    );
  }
});

test('the rewrite prompt carries the hint line; diff/audit/score prompts do not', () => {
  const rewrite = buildPrompt(baseOptions(PORTABLE_WITH_ANCHOR));
  assert.match(rewrite, /never invent/i);
  for (const mode of ['diff', 'audit', 'score']) {
    const prompt = buildPrompt(baseOptions(PORTABLE_WITH_ANCHOR, { mode }));
    assert.doesNotMatch(prompt, /never invent/i, `${mode} prompt must not carry the hint`);
  }
});

test('a fully portable source gets no hint line in the rewrite prompt', () => {
  const prompt = buildPrompt(baseOptions(FULLY_PORTABLE));
  assert.doesNotMatch(prompt, /never invent/i);
});
