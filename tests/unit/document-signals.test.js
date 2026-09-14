import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildDocumentSignals } from '../../src/features/document-signals.js';
import { buildPrompt } from '../../src/prompt-builder.js';

const KO_FORMAL = '주제만 주면 한 세트가 나옵니다. 직접 디자인할 필요가 없습니다. 캐러셀을 완성합니다. 바로 시작합니까?';
const KO_MIXED = '어떤 글은 해요체예요. 다른 문장은 평서체다. 또 어떤 건 합니다. 이렇게 섞이면 어색해요. 그렇지만 다양하다. 혼합이다.';
const EN_TEXT = 'Welcome home. This draft is English only. It has no Korean endings.';

test('same Korean text and lang yield identical document signals', () => {
  const first = buildDocumentSignals({ text: KO_FORMAL, lang: 'ko' });
  const second = buildDocumentSignals({ text: KO_FORMAL, lang: 'ko' });
  assert.deepEqual(first, second);
  assert.deepEqual(first.signals, [
    '지배 어투: 합쇼체(-습니다) — 합쇼체 100% · 해요체 0% · -다체 0% (문장 4개 기준). 재작성 문장 전체를 이 어투로 통일할 것',
  ]);
  assert.equal(first.register.register, 'formal');
});

test('mixed Korean register is measured, not guessed', () => {
  const { signals, register } = buildDocumentSignals({ text: KO_MIXED, lang: 'ko' });
  assert.equal(register.register, 'mixed');
  assert.match(signals[0], /^어미 분포:/);
  assert.match(signals[0], /지배 어투 없음\(혼합\)/);
});

test('non-Korean languages emit empty document signals', () => {
  for (const lang of ['en', 'zh', 'ja']) {
    assert.deepEqual(buildDocumentSignals({ text: KO_FORMAL, lang }), { signals: [], register: null }, lang);
    assert.deepEqual(buildDocumentSignals({ text: EN_TEXT, lang }), { signals: [], register: null }, lang);
  }
  assert.deepEqual(buildDocumentSignals({ text: EN_TEXT, lang: 'ko' }), { signals: [], register: null });
});

const BASE = {
  config: { language: 'ko', documentType: 'default' },
  patterns: [],
  documentType: null,
  voice: null,
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
  // C1 cache-friendly layout: the per-document signals sit AFTER the stable
  // instruction prefix and immediately before the input, so the large
  // pattern-pack/document-policy/voice/instruction prefix stays cacheable across a batch.
  assert.ok(prompt.indexOf('Document Signals') > prompt.indexOf('## Instructions'));
  assert.ok(prompt.indexOf('Document Signals') < prompt.indexOf('## Input Text'));
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
