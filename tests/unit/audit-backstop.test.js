import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildDeterministicAuditBackstop } from '../../src/output.js';

const CALQUE = '이것은 강력한 도구입니다. 다양한 기능을 제공합니다. 이 작업은 에이전트에 의해 처리됩니다. 당신은 이것을 매우 쉽게 사용할 수 있습니다.';

function koPostEditeseSection(md) {
  return md.split('### koPostEditese.v1 편집 참고 원시 지표')[1] ?? '';
}
function translationeseSection(md) {
  return md.split('### Korean translationese editing hints')[1]?.split('### koPostEditese.v1')[0] ?? '';
}



test('audit backstop surfaces ko translationese even when an LLM would miss it', () => {
  const md = buildDeterministicAuditBackstop(CALQUE, { lang: 'ko' });
  assert.ok(md.includes('deterministic backstop'), 'has backstop header');
  assert.ok(md.includes('번역투: passive-e-uihae'), '~에 의해 passive');
  assert.ok(md.includes('번역투: direct-address-you'), '당신');
  assert.ok(md.includes('번역투: dummy-subject'), '이것은');
  assert.ok(md.includes('번역투: provides'), '제공합니다');
  assert.ok(md.includes('### Korean translationese editing hints'));
  assert.equal(md.includes('| 신호 | 설명 | 심각도 | 위치 |'), false, 'translationese-only backstop stays out of severity table');
  // matched location should show the actual offending substring
  assert.ok(md.includes('에 의해'));
});

test('audit backstop keeps ko translationese advisory hints separate from true severity rows', () => {
  const md = buildDeterministicAuditBackstop(`${CALQUE} :contentReference[oaicite:1]{index=1}`, { lang: 'ko' });
  const severityTable = md.slice(md.indexOf('| 신호 | 설명 | 심각도 | 위치 |'), md.indexOf('### Korean translationese editing hints'));
  const section = translationeseSection(md);

  assert.ok(severityTable.includes('markup-leakage'));
  assert.equal(severityTable.includes('번역투:'), false);
  assert.ok(section.includes('번역투: passive-e-uihae'));
  assert.equal(section.includes('심각도'), false);
  assert.equal(/\b(?:LOW|MEDIUM|HIGH)\b/.test(section), false);
});

test('audit backstop escapes markdown table-breaking characters in advisory samples', () => {
  const md = buildDeterministicAuditBackstop('이 작업은 에 의해 |처리되었다. :contentReference[oaicite:1]{index=1}', { lang: 'ko' });
  const section = translationeseSection(md);

  assert.match(section, /에 의해 \\\|처리/);
  assert.doesNotMatch(section, /\| 에 의해 \|처리/);
});

test('audit backstop surfaces ko post-editese advisory raw metrics separately', () => {
  const md = buildDeterministicAuditBackstop(CALQUE, { lang: 'ko' });
  const section = koPostEditeseSection(md);

  assert.ok(section, 'has separate koPostEditese advisory section');
  assert.ok(section.includes('| metric | value | editing hint |'), 'uses metric/value/editing-hint framing');
  assert.ok(section.includes('interference.pronounLiteralCount'), 'includes raw interference metric');
  assert.ok(section.includes('rhythm.meanSentenceEojeols'), 'includes raw rhythm metric');
  assert.ok(md.indexOf('### Korean translationese editing hints') < md.indexOf('### koPostEditese.v1'), 'koPostEditese section follows translationese advisory section');
});

test('audit backstop keeps ko post-editese metrics out of severity framing', () => {
  const md = buildDeterministicAuditBackstop(`${CALQUE} :contentReference[oaicite:1]{index=1}`, { lang: 'ko' });
  const severityTable = md.slice(md.indexOf('| 신호 | 설명 | 심각도 | 위치 |'), md.indexOf('### Korean translationese editing hints'));
  const section = koPostEditeseSection(md);

  assert.equal(severityTable.includes('koPostEditese'), false);
  assert.equal(severityTable.includes('interference.pronounLiteralCount'), false);
  assert.equal(section.includes('심각도'), false);
  assert.equal(/\b(?:LOW|MEDIUM|HIGH)\b/.test(section), false);
});

test('audit backstop does not turn clean native ko into severity rows', () => {
  const clean = '어제는 비가 많이 왔다. 그래서 집에 있었다. 라면 먹고 영화 봤다. 나쁘지 않았다.';
  const md = buildDeterministicAuditBackstop(clean, { lang: 'ko' });
  assert.ok(md.includes('koPostEditese.v1'), 'clean ko can still show advisory raw metrics');
  assert.equal(md.includes('| 신호 | 설명 | 심각도 | 위치 |'), false);
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

test('audit backstop omits ko post-editese section for skipped inputs', () => {
  const nonKo = buildDeterministicAuditBackstop('A short plain English note.', { lang: 'en' });
  const emptyKo = buildDeterministicAuditBackstop('', { lang: 'ko' });

  assert.equal(nonKo.includes('koPostEditese.v1'), false);
  assert.equal(emptyKo.includes('koPostEditese.v1'), false);
});
