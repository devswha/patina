import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyXliffReplacements,
  estimateXliffRun,
  resolveUniqueCap,
  encodeXmlText,
  parseXliffDocument,
  selectXliffSegments,
  DEFAULT_UNIQUE_CAP,
} from '../../src/cli/xliff.js';
import { writeAtomicUtf8, resolveBatchOutputPath } from '../../src/cli/batch.js';

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
    replacement: seg.leading + encodeXmlText(newCore ?? seg.targetCore) + seg.trailing,
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

// ---------- writeAtomicUtf8 ----------
test('writeAtomicUtf8: writes content and leaves no temp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-xliff-'));
  try {
    const dest = join(dir, 'out.xliff');
    writeAtomicUtf8(dest, 'hello <ko> & 안녕');
    assert.equal(readFileSync(dest, 'utf8'), 'hello <ko> & 안녕');
    const leftover = readdirSync(dir).filter((f) => f.includes('.patina-xliff-') && f.endsWith('.tmp'));
    assert.deepEqual(leftover, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAtomicUtf8: failure (bad dir) throws and leaves no output at destination', () => {
  const dest = join(tmpdir(), 'no-such-dir-patina', 'nested', 'out.xliff');
  assert.throws(() => writeAtomicUtf8(dest, 'x'));
  assert.equal(existsSync(dest), false);
});

// ---------- resolveBatchOutputPath ----------
test('resolveBatchOutputPath: in-place / outdir / suffix / default suffix', () => {
  assert.equal(resolveBatchOutputPath({ inPlace: true }, '/a/b/f.xliff'), '/a/b/f.xliff');
  assert.equal(resolveBatchOutputPath({ outdir: '/out' }, '/a/b/f.xliff'), '/out/f.xliff');
  assert.equal(resolveBatchOutputPath({ suffix: '.humanized' }, '/a/b/f.xliff'), '/a/b/f.humanized.xliff');
  assert.equal(resolveBatchOutputPath({}, '/a/b/f.xliff', { defaultSuffix: '.humanized' }), '/a/b/f.humanized.xliff');
});

// ---------- hardening: atomic rename-failure cleanup + string-index edges ----------
test('writeAtomicUtf8: rename onto an existing directory fails, cleans temp, leaves dest intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-xliff-'));
  try {
    const destDir = join(dir, 'occupied'); // an existing directory at the dest path
    mkdirSync(destDir);
    assert.throws(() => writeAtomicUtf8(destDir, 'x')); // rename(file -> dir) fails
    assert.equal(existsSync(destDir), true); // existing dest untouched
    const leftover = readdirSync(dir).filter((f) => f.includes('.patina-xliff-') && f.endsWith('.tmp'));
    assert.deepEqual(leftover, [], 'temp file must be cleaned up after rename failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
