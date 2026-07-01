import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyXliffReplacements,
  encodeXmlText,
  estimateXliffRun,
  parseXliffDocument,
  selectXliffSegments,
} from '../../src/cli/xliff.js';
import { resolveBatchOutputPath, writeAtomicUtf8 } from '../../src/cli/batch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, '../fixtures/xliff/sample.xliff'), 'utf8');
const REPORT_DIR = '/tmp/patina-qa/g002';
const REPORT_PATH = join(REPORT_DIR, 'adversarial-report.txt');
const rows = [];
const tempDirs = [];

function record(name, expected, actual) {
  rows.push(`${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function tempNames(dir) {
  return readdirSync(dir).filter((name) => name.startsWith('.patina-xliff-') && name.endsWith('.tmp'));
}

function identityReplacementsForSelected(xml) {
  const parsed = parseXliffDocument(xml);
  const { selected } = selectXliffSegments(parsed);
  return selected.map((seg) => ({
    start: seg.targetInnerStart,
    end: seg.targetInnerEnd,
    replacement: `${seg.leading}${encodeXmlText(seg.targetCore)}${seg.trailing}`,
  }));
}

after(() => {
  writeFileSync(REPORT_PATH, `${rows.join('\n\n')}\n`, 'utf8');
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

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
  record('apply spans at BOF/EOF, zero-length insertions, adjacent spans, delimiter chars', '<BOF&>abX<&>YZ<EOF&>', 'matched');
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
  record('apply many random-order spans', `length ${expected.length}`, `length ${applyXliffReplacements(base, shuffled).length}`);
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
  record('apply overlap boundary', 'end === next.start ok; end > next.start throws', 'matched');
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
  record('apply invalid spans', `${bad.length} invalid spans throw`, `${bad.length} invalid spans threw`);
});

test('applyXliffReplacements: fixture selected-segment identity write-back is byte-for-byte identical', () => {
  const replacements = identityReplacementsForSelected(FIXTURE);
  assert.ok(replacements.length > 0, 'fixture must have selected segments');
  const out = applyXliffReplacements(FIXTURE, replacements);
  assert.equal(out, FIXTURE);
  record('fixture identity round-trip AC7', 'byte-identical fixture output', `byte-identical with ${replacements.length} replacements`);
});

test('applyXliffReplacements: parser offsets round-trip emoji surrogate pairs and CJK without mojibake', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2"><file source-language="en" target-language="ko"><body><trans-unit id="emoji"><source>This sentence should be humanized because it has enough words.</source><target state="final">  이 문장은 이모지 😀😇와 한자 漢字 및 한국어를 함께 포함합니다  </target></trans-unit></body></file></xliff>`;
  const parsed = parseXliffDocument(xml);
  const { selected } = selectXliffSegments(parsed);
  assert.equal(selected.length, 1);
  const seg = selected[0];
  assert.equal(seg.targetCore, '이 문장은 이모지 😀😇와 한자 漢字 및 한국어를 함께 포함합니다');
  const replacement = `${seg.leading}${encodeXmlText(seg.targetCore)}${seg.trailing}`;
  const out = applyXliffReplacements(xml, [{ start: seg.targetInnerStart, end: seg.targetInnerEnd, replacement }]);
  assert.equal(out, xml);
  assert.match(out, /😀😇/u);
  record('multi-byte/surrogate parser offsets', 'emoji+CJK identity no mojibake', 'byte-identical and emoji preserved');
});

test('writeAtomicUtf8: write then overwrite preserves exact unicode/newline/CRLF content and no temp remains', () => {
  const dir = makeTempDir('patina-xliff-atomic-ok-');
  const dest = join(dir, 'out.xliff');
  const first = 'line1\r\n한글 😀\n';
  const second = 'replacement\r\n中文 😇\nlast';
  assert.equal(writeAtomicUtf8(dest, first), dest);
  assert.equal(readFileSync(dest, 'utf8'), first);
  assert.deepEqual(tempNames(dir), []);
  assert.equal(writeAtomicUtf8(dest, second), dest);
  assert.equal(readFileSync(dest, 'utf8'), second);
  assert.deepEqual(tempNames(dir), []);
  record('writeAtomicUtf8 success/overwrite', 'exact content after atomic replace and no temp', 'matched');
});

test('writeAtomicUtf8: missing parent throws without destination or temp leftovers in existing dir', () => {
  const dir = makeTempDir('patina-xliff-atomic-fail-');
  const missingParent = join(dir, 'missing');
  const dest = join(missingParent, 'out.xliff');
  assert.throws(() => writeAtomicUtf8(dest, 'partial?'), /ENOENT/);
  assert.equal(existsSync(dest), false);
  assert.deepEqual(tempNames(dir), []);
  assert.equal(existsSync(missingParent), false);
  record('writeAtomicUtf8 missing parent failure', 'throws, no dest, no .patina-xliff tmp in existing dir', 'matched');
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
  record('estimateXliffRun dry-run boundaries', '0 ok, cap ok, cap+1 exceeded, attempts clamp to 1, llm/writes 0', 'matched');
});

test('resolveBatchOutputPath: suffix and outdir edge cases', () => {
  assert.equal(resolveBatchOutputPath({ suffix: '' }, '/tmp/input.xlf', { defaultSuffix: '' }), '/tmp/input.xlf');
  assert.equal(resolveBatchOutputPath({ suffix: 'human' }, '/tmp/input.xlf'), '/tmp/inputhuman.xlf');
  assert.equal(resolveBatchOutputPath({ suffix: '.human' }, '/tmp/README'), '/tmp/README.human');
  assert.equal(resolveBatchOutputPath({ outdir: '/tmp/nested/out' }, '/tmp/a/b/input.xlf', { defaultSuffix: '.ignored' }), '/tmp/nested/out/input.xlf');
  record('resolveBatchOutputPath routing', 'empty suffix unchanged; raw suffix accepted; no extension; nested outdir basename', 'matched');
});
