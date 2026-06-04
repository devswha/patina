import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildDeterministicAuditBackstop } from '../../src/output.js';

const CALQUE = '이것은 강력한 도구입니다. 다양한 기능을 제공합니다. 이 작업은 에이전트에 의해 처리됩니다. 당신은 이것을 매우 쉽게 사용할 수 있습니다.';

test('audit backstop surfaces ko translationese even when an LLM would miss it', () => {
  const md = buildDeterministicAuditBackstop(CALQUE, { lang: 'ko' });
  assert.ok(md.includes('deterministic backstop'), 'has backstop header');
  assert.ok(md.includes('번역투: passive-e-uihae'), '~에 의해 passive');
  assert.ok(md.includes('번역투: direct-address-you'), '당신');
  assert.ok(md.includes('번역투: dummy-subject'), '이것은');
  assert.ok(md.includes('번역투: provides'), '제공합니다');
  // matched location should show the actual offending substring
  assert.ok(md.includes('에 의해'));
});

test('audit backstop is empty for clean native ko (no false positives)', () => {
  const clean = '어제는 비가 많이 왔다. 그래서 집에 있었다. 라면 먹고 영화 봤다. 나쁘지 않았다.';
  assert.equal(buildDeterministicAuditBackstop(clean, { lang: 'ko' }), '');
});

test('audit backstop catches markup leakage regardless of language', () => {
  const leaked = 'This is fine text :contentReference[oaicite:1]{index=1} and more.';
  const md = buildDeterministicAuditBackstop(leaked, { lang: 'en' });
  assert.ok(md.includes('markup-leakage'), 'flags pasted model-output markup');
});

test('audit backstop skips ko translationese rows for non-ko languages', () => {
  const md = buildDeterministicAuditBackstop('You can use this. It is provided by the agent.', { lang: 'en' });
  assert.equal(md.includes('번역투:'), false);
});
