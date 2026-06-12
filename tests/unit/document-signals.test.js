import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildPrompt } from '../../src/prompt-builder.js';

const BASE = {
  config: { language: 'ko', profile: 'default' },
  patterns: [],
  profile: null,
  voice: null,
  voiceSample: null,
  scoring: null,
  text: '본문 텍스트입니다.',
  mode: 'rewrite',
};

const SIGNALS = ['지배 어투: 해요체 — 합쇼체 10% · 해요체 80% · -다체 10% (문장 20개 기준). 재작성 문장 전체를 이 어투로 통일할 것'];

test('strict rewrite prompt renders document signals as ground truth for the Phase 0 brief', () => {
  const prompt = buildPrompt({ ...BASE, documentSignals: SIGNALS });
  assert.ok(prompt.includes('## Document Signals (deterministic measurements)'));
  assert.ok(prompt.includes(SIGNALS[0]));
  assert.ok(prompt.includes('Phase 0: Document Brief'));
  // Signals section precedes the instructions that consume it.
  assert.ok(prompt.indexOf('Document Signals') < prompt.indexOf('## Instructions'));
});

test('minimal rewrite prompt carries the brief and the signals section', () => {
  const prompt = buildPrompt({ ...BASE, promptMode: 'minimal', documentSignals: SIGNALS });
  assert.ok(prompt.includes('고치기 전에 글 전체를 먼저 읽고'));
  assert.ok(prompt.includes('## 문서 신호 (결정론 측정값)'));
  assert.ok(prompt.includes(SIGNALS[0]));
});

test('non-rewrite modes and empty signals render no signals section', () => {
  const audit = buildPrompt({ ...BASE, mode: 'audit', documentSignals: SIGNALS });
  assert.ok(!audit.includes('Document Signals'));
  const none = buildPrompt({ ...BASE, documentSignals: [] });
  assert.ok(!none.includes('Document Signals'));
  // The brief itself is unconditional for rewrites — signals only sharpen it.
  assert.ok(none.includes('Phase 0: Document Brief'));
});
