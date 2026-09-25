import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  applyXliffReplacements,
  estimateXliffRun,
  resolveUniqueCap,
  parseXliffDocument,
  selectXliffSegments,
  DEFAULT_UNIQUE_CAP,
} from '../../src/cli/xliff.js';
import { htmlEscape } from '../../src/preview/dom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, '../fixtures/xliff/sample.xliff'), 'utf8');

// ---------- applyXliffReplacements ----------
test('applyXliffReplacements: empty list returns byte-identical input', () => {
  assert.equal(applyXliffReplacements(FIXTURE, []), FIXTURE);
});

test('applyXliffReplacements: single + multiple (descending) spans', () => {
  const s = '0123456789';
  assert.equal(applyXliffReplacements(s, [{ start: 2, end: 4, replacement: 'XX' }]), '01XX456789');
  // two non-overlapping spans applied right-to-left
  assert.equal(applyXliffReplacements(s, [
    { start: 2, end: 4, replacement: 'A' },
    { start: 6, end: 8, replacement: 'BBB' },
  ]), '01A45BBB89');
});

test('applyXliffReplacements: overlapping or invalid spans throw', () => {
  const s = '0123456789';
  assert.throws(() => applyXliffReplacements(s, [
    { start: 2, end: 6, replacement: 'x' },
    { start: 4, end: 8, replacement: 'y' },
  ]), /overlapping/);
  assert.throws(() => applyXliffReplacements(s, [{ start: 5, end: 3, replacement: 'x' }]), /invalid replacement span/);
  assert.throws(() => applyXliffReplacements(s, [{ start: 0, end: 999, replacement: 'x' }]), /invalid replacement span/);
});

// ---------- round-trip + preservation on the real fixture ----------
function replacementFor(seg, newCore) {
  return {
    start: seg.targetInnerStart,
    end: seg.targetInnerEnd,
    replacement: seg.leading + htmlEscape(newCore ?? seg.targetCore) + seg.trailing,
  };
}

test('round-trip: rewriting a segment to its own core is byte-identical', () => {
  const sel = selectXliffSegments(parseXliffDocument(FIXTURE));
  const u1 = sel.selected.find((s) => s.id === 'u1');
  const out = applyXliffReplacements(FIXTURE, [replacementFor(u1)]);
  assert.equal(out, FIXTURE);
});

test('preservation: a changed segment only mutates its inner span; all other bytes identical', () => {
  const sel = selectXliffSegments(parseXliffDocument(FIXTURE));
  const u1 = sel.selected.find((s) => s.id === 'u1');
  const repl = replacementFor(u1, '계정 로그인이 안 되어 있어 파일이 곧 삭제됩니다.');
  const out = applyXliffReplacements(FIXTURE, [repl]);
  assert.notEqual(out, FIXTURE);
  // bytes before the inner span and after it are untouched
  assert.equal(out.slice(0, u1.targetInnerStart), FIXTURE.slice(0, u1.targetInnerStart));
  assert.equal(out.slice(out.length - (FIXTURE.length - u1.targetInnerEnd)), FIXTURE.slice(u1.targetInnerEnd));
  // the target's own attributes and other units are still present verbatim
  assert.ok(out.includes('<target state="final">'));
  assert.ok(out.includes('translate="no"')); // u2 locked attr preserved
  assert.ok(out.includes('<![CDATA[')); // u8 cdata preserved
});

test('preservation: leading/trailing whitespace around a target core is kept', () => {
  const xml = '<xliff version="1.2"><file target-language="ko"><body><trans-unit id="w"><source>src</source><target state="final">\n   이 문장은 충분히 길어서 산문으로 인정되는 안내 문구입니다.   \n  </target></trans-unit></body></file></xliff>';
  const sel = selectXliffSegments(parseXliffDocument(xml));
  const seg = sel.selected[0];
  assert.equal(seg.leading, '\n   ');
  assert.equal(seg.trailing, '   \n  ');
  const out = applyXliffReplacements(xml, [replacementFor(seg, '짧게 바꾼 문장입니다.')]);
  assert.ok(out.includes('<target state="final">\n   짧게 바꾼 문장입니다.   \n  </target>'));
});

// ---------- estimateXliffRun (dry-run, zero calls) ----------
test('estimateXliffRun: 6-call/unique multiplier, dedup savings, cap status, no calls/writes', () => {
  const r = estimateXliffRun({ totalUnits: 9, selectedCount: 3, uniqueCount: 2, cap: 50, backendAttemptsPerCall: 2, provider: 'deepseek', model: 'deepseek-chat' });
  assert.equal(r.callsPerUnique, 6);
  assert.equal(r.worstCaseLlmCalls, 12);
  assert.equal(r.worstCaseBackendAttempts, 24);
  assert.equal(r.duplicateSavings, 1);
  assert.equal(r.capStatus, 'ok');
  assert.equal(r.inputTokensEstimate, 2 * 2 * 12000);
  assert.equal(r.cost, null);
  assert.equal(r.llmCalls, 0);
  assert.equal(r.writes, 0);
});

test('estimateXliffRun: over-cap reports cap_exceeded', () => {
  const r = estimateXliffRun({ totalUnits: 200, selectedCount: 80, uniqueCount: 60, cap: 50 });
  assert.equal(r.capStatus, 'cap_exceeded');
});

test('resolveUniqueCap: default 50, positive override, invalid falls back', () => {
  assert.equal(resolveUniqueCap({}), DEFAULT_UNIQUE_CAP);
  assert.equal(resolveUniqueCap({ maxSegments: 10 }), 10);
  assert.equal(resolveUniqueCap({ maxSegments: 0 }), 50);
  assert.equal(resolveUniqueCap({ maxSegments: -3 }), 50);
  assert.equal(resolveUniqueCap({ maxSegments: 'x' }), 50);
});

test('applyXliffReplacements: adjacent spans, span at 0 and at EOF, astral unicode', () => {
  const s = '0123456789';
  // adjacent (touching, non-overlapping) spans are allowed
  assert.equal(applyXliffReplacements(s, [
    { start: 2, end: 4, replacement: 'AA' },
    { start: 4, end: 6, replacement: 'BB' },
  ]), '01AABB6789');
  // span at index 0 and at EOF
  assert.equal(applyXliffReplacements(s, [
    { start: 0, end: 1, replacement: 'X' },
    { start: 9, end: 10, replacement: 'Y' },
  ]), 'X12345678Y');
  // zero-length insertion span
  assert.equal(applyXliffReplacements(s, [{ start: 5, end: 5, replacement: '_' }]), '01234_56789');
  // astral (surrogate-pair) content: offsets from the same JS string round-trip
  const astral = 'pre 😀 [CORE] 😺 post';
  const start = astral.indexOf('[CORE]');
  const out = applyXliffReplacements(astral, [{ start, end: start + '[CORE]'.length, replacement: '바뀜' }]);
  assert.equal(out, 'pre 😀 바뀜 😺 post');
});

function identityReplacementsForSelected(xml) {
  const parsed = parseXliffDocument(xml);
  const { selected } = selectXliffSegments(parsed);
  return selected.map((seg) => ({
    start: seg.targetInnerStart,
    end: seg.targetInnerEnd,
    replacement: `${seg.leading}${htmlEscape(seg.targetCore)}${seg.trailing}`,
  }));
}

test('applyXliffReplacements: adversarial span boundaries and delimiter payloads', () => {
  const s = 'abcdef';
  assert.equal(
    applyXliffReplacements(s, [
      { start: 6, end: 6, replacement: '<EOF&>' },
      { start: 0, end: 0, replacement: '<BOF&>' },
      { start: 2, end: 4, replacement: 'X<&>Y' },
      { start: 4, end: 6, replacement: 'Z' },
    ]),
    '<BOF&>abX<&>YZ<EOF&>'
  );
});

test('applyXliffReplacements: many random-order spans sort and apply against original offsets', () => {
  const base = Array.from({ length: 240 }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
  const spans = [];
  for (let start = 0; start < base.length; start += 3) {
    spans.push({ start, end: start + 2, replacement: `[${start}]` });
  }
  const shuffled = spans
    .map((span, i) => ({ span, key: (i * 37) % spans.length }))
    .sort((a, b) => a.key - b.key)
    .map(({ span }) => span);
  let expected = base;
  for (const r of [...spans].sort((a, b) => b.start - a.start)) {
    expected = expected.slice(0, r.start) + r.replacement + expected.slice(r.end);
  }
  assert.equal(applyXliffReplacements(base, shuffled), expected);
});

test('applyXliffReplacements: exact-boundary overlap is allowed but one-char overlap throws', () => {
  assert.equal(
    applyXliffReplacements('012345', [
      { start: 2, end: 4, replacement: 'AA' },
      { start: 4, end: 6, replacement: 'BB' },
    ]),
    '01AABB'
  );
  assert.throws(() => applyXliffReplacements('012345', [
    { start: 2, end: 5, replacement: 'AA' },
    { start: 4, end: 6, replacement: 'BB' },
  ]), /overlapping replacement spans/);
});

test('applyXliffReplacements: invalid spans throw before corrupting output', () => {
  const bad = [
    { start: -1, end: 1, replacement: 'x' },
    { start: 2, end: 1, replacement: 'x' },
    { start: 0, end: 7, replacement: 'x' },
    { start: 0.5, end: 1, replacement: 'x' },
    { start: 0, end: 1.5, replacement: 'x' },
  ];
  for (const span of bad) {
    assert.throws(() => applyXliffReplacements('abcdef', [span]), /invalid replacement span/);
  }
});

test('applyXliffReplacements: fixture selected-segment identity write-back is byte-for-byte identical', () => {
  const replacements = identityReplacementsForSelected(FIXTURE);
  assert.ok(replacements.length > 0, 'fixture must have selected segments');
  const out = applyXliffReplacements(FIXTURE, replacements);
  assert.equal(out, FIXTURE);
});

test('applyXliffReplacements: parser offsets round-trip emoji surrogate pairs and CJK without mojibake', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2"><file source-language="en" target-language="ko"><body><trans-unit id="emoji"><source>This sentence should be humanized because it has enough words.</source><target state="final">  이 문장은 이모지 😀😇와 한자 漢字 및 한국어를 함께 포함합니다  </target></trans-unit></body></file></xliff>`;
  const parsed = parseXliffDocument(xml);
  const { selected } = selectXliffSegments(parsed);
  assert.equal(selected.length, 1);
  const seg = selected[0];
  assert.equal(seg.targetCore, '이 문장은 이모지 😀😇와 한자 漢字 및 한국어를 함께 포함합니다');
  const replacement = `${seg.leading}${htmlEscape(seg.targetCore)}${seg.trailing}`;
  const out = applyXliffReplacements(xml, [{ start: seg.targetInnerStart, end: seg.targetInnerEnd, replacement }]);
  assert.equal(out, xml);
  assert.match(out, /😀😇/u);
});

test('estimateXliffRun: dry-run cap boundaries, clamped attempts, no calls or writes', () => {
  const zero = estimateXliffRun({ uniqueCount: 0, selectedCount: 0, cap: 2 });
  assert.equal(zero.capStatus, 'ok');
  assert.equal(zero.worstCaseLlmCalls, 0);
  const atCap = estimateXliffRun({ uniqueCount: 2, selectedCount: 2, cap: 2, backendAttemptsPerCall: 0 });
  assert.equal(atCap.capStatus, 'ok');
  assert.equal(atCap.worstCaseBackendAttempts, 12);
  const overCap = estimateXliffRun({ uniqueCount: 3, selectedCount: 3, cap: 2, backendAttemptsPerCall: Number.NaN });
  assert.equal(overCap.capStatus, 'cap_exceeded');
  assert.equal(overCap.worstCaseBackendAttempts, 18);
  for (const report of [zero, atCap, overCap]) {
    assert.equal(report.llmCalls, 0);
    assert.equal(report.writes, 0);
  }
});
