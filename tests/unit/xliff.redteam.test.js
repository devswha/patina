import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanXmlTokens,
  decodeXmlText,
  hasUnsupportedEntity,
  parseXliffDocument,
  selectXliffSegments,
} from '../../src/cli/xliff.js';

const KO_PROSE = '이 문장은 충분히 길어서 산문으로 인정되는 안내 문구입니다.';
const KO_PROSE_2 = '다른 문장도 충분히 길어서 사람이 고칠 수 있는 안내 문구입니다.';
const wrapUnits = (units, attrs = 'target-language="ko"') => `<xliff version="1.2"><file ${attrs}><body>${units}</body></file></xliff>`;
const unit = (id, body, attrs = '') => `<trans-unit id="${id}"${attrs}>${body}</trans-unit>`;
const src = (text = 'source text with enough words') => `<source>${text}</source>`;
const target = (inner, attrs = ' state="translated"') => `<target${attrs}>${inner}</target>`;
const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

function parseAndSelect(units) {
  const doc = parseXliffDocument(wrapUnits(units));
  return { doc, sel: selectXliffSegments(doc) };
}

function assertNoSelectedId(sel, id, reason) {
  assert.equal(byId(sel.selected)[id], undefined, `${id} must not be selected`);
  assert.equal(byId(sel.skipped)[id]?.reason, reason, `${id} skip reason`);
}

test('scanner: truncated tag/comment/CDATA/PI always yields terminal malformed token', () => {
  for (const xml of ['<target', '<target attr="unterminated', '<!-- dangling', '<![CDATA[ dangling', '<?pi dangling']) {
    const tokens = scanXmlTokens(xml);
    assert.equal(tokens.at(-1)?.kind, 'malformed', xml);
  }
});

test('scanner: literal </target> in attributes, comments, and CDATA is not parsed as target close', () => {
  const attrTokens = scanXmlTokens('<target note="literal </target> in attr">body</target>');
  assert.equal(attrTokens.filter((t) => t.kind === 'close' && t.name === 'target').length, 1);

  const commentTokens = scanXmlTokens('<target><!-- literal </target> --></target>');
  assert.equal(commentTokens.filter((t) => t.kind === 'comment').length, 1);
  assert.equal(commentTokens.filter((t) => t.kind === 'close' && t.name === 'target').length, 1);

  const cdataTokens = scanXmlTokens('<target><![CDATA[literal </target>]]></target>');
  assert.equal(cdataTokens.filter((t) => t.kind === 'cdata').length, 1);
  assert.equal(cdataTokens.filter((t) => t.kind === 'close' && t.name === 'target').length, 1);
});

test('fail-closed structure: nested/mismatched tags, unclosed target, and mixed CDATA are never selected', () => {
  const good = unit('good', `${src()}${target(KO_PROSE)}`);
  const nested = unit('nested', `${src()}${target(`${KO_PROSE}<g id="1">inline</g>`)}`);
  const mismatched = unit('mismatch', `${src()}<target state="translated">${KO_PROSE}<b></target></trans-unit>`);
  const unclosed = unit('unclosed', `${src()}<target state="translated">${KO_PROSE}`);
  const mixedCdata = unit('mixed-cdata', `${src()}${target(`앞쪽 텍스트 <![CDATA[${KO_PROSE}]]> 뒤쪽 텍스트`)}`);

  const { doc, sel } = parseAndSelect(good + nested + mismatched + unclosed + mixedCdata);
  assert.equal(byId(sel.selected).good.targetCore, KO_PROSE);
  assertNoSelectedId(sel, 'nested', 'inline_markup');
  assertNoSelectedId(sel, 'mixed-cdata', 'cdata_or_malformed');
  assert.ok(doc.ambiguousCount >= 2, 'mismatched and unclosed units are ambiguous');
  assert.equal(sel.selected.some((row) => ['mismatch', 'unclosed'].includes(row.id)), false);
});

test('entity edge cases: invalid, unknown, malformed, and bare ampersands fail closed; decode never throws', () => {
  const cases = [
    ['nul', `prefix &#0; ${KO_PROSE}`, true],
    ['huge', `prefix &#9999999999; ${KO_PROSE}`, true],
    ['malformed', `prefix &#; ${KO_PROSE}`, true],
    ['unknown', `prefix &unknown; ${KO_PROSE}`, true],
    ['bare', `prefix & ${KO_PROSE}`, true],
  ];

  for (const [id, inner, unsupported] of cases) {
    assert.doesNotThrow(() => decodeXmlText(inner), `${id} decode`);
    assert.equal(hasUnsupportedEntity(inner), unsupported, `${id} unsupported entity classification`);
  }

  const { sel } = parseAndSelect(cases.map(([id, inner]) => unit(id, `${src()}${target(inner)}`)).join(''));
  for (const [id] of cases) assertNoSelectedId(sel, id, 'unsupported_entity');
});

test('target child ambiguity: multiple children, self-closing, empty, whitespace-only, and source order fail closed', () => {
  const units = [
    unit('multi-target', `${src()}${target(KO_PROSE)}${target(KO_PROSE_2)}`),
    unit('multi-source', `${src('one')}${src('two')}${target(KO_PROSE)}`),
    unit('source-after-target', `${target(KO_PROSE)}${src(KO_PROSE)}`),
    unit('self-close', `${src()}<target state="translated"/>`),
    unit('empty', `${src()}${target('')}`),
    unit('ws', `${src()}${target(' \r\n\t ')}`),
  ].join('');
  const { sel } = parseAndSelect(units);
  assertNoSelectedId(sel, 'multi-target', 'ambiguous_unit');
  assert.equal(byId(sel.selected)['multi-source'], undefined, 'multi-source must not be selected with ambiguous source');
  assertNoSelectedId(sel, 'source-after-target', 'untranslated');
  assertNoSelectedId(sel, 'self-close', 'ambiguous_unit');
  assertNoSelectedId(sel, 'empty', 'empty_target');
  assertNoSelectedId(sel, 'ws', 'empty_target');
});

test('CRLF dedup normalizes core only, while extracted raw span preserves exact leading/trailing bytes', () => {
  const rawA = '\t  첫 번째 줄입니다.\r\n두 번째 줄도 충분히 길어서 산문입니다.  \n';
  const rawB = '\t  첫 번째 줄입니다.\n두 번째 줄도 충분히 길어서 산문입니다.  \n';
  const fixture = wrapUnits(
    unit('crlf', `${src()}${target(rawA)}`) +
    unit('lf', `${src()}${target(rawB)}`)
  );
  const sel = selectXliffSegments(parseXliffDocument(fixture));
  const selected = byId(sel.selected);
  assert.equal(fixture.slice(selected.crlf.targetInnerStart, selected.crlf.targetInnerEnd), rawA);
  assert.equal(fixture.slice(selected.lf.targetInnerStart, selected.lf.targetInnerEnd), rawB);
  assert.equal(selected.crlf.leading, '\t  ');
  assert.equal(selected.crlf.trailing, '  \n');
  assert.equal(selected.crlf.dedupKey, selected.lf.dedupKey);
  assert.equal(sel.uniqueCount, 1);
});

test('nested trans-unit and missing target fail closed without corrupting good unit spans', () => {
  const fixture = wrapUnits(
    unit('outer', `${src()}<trans-unit id="inner">${src()}${target(KO_PROSE_2)}</trans-unit>${target(KO_PROSE)}`) +
    unit('missing-target', `${src()}`) +
    unit('good', `${src()}${target(KO_PROSE_2)}`)
  );
  const doc = parseXliffDocument(fixture);
  const sel = selectXliffSegments(doc);
  assertNoSelectedId(sel, 'missing-target', 'ambiguous_unit');
  assert.equal(byId(sel.selected).good.targetCore, KO_PROSE_2);
  for (const row of sel.selected) {
    assert.equal(fixture.slice(row.targetInnerStart, row.targetInnerEnd).trim(), row.targetCore.trim());
  }
});

test('document-level fail-closed errors are typed; mixed good and broken units return good plus ambiguity counts', () => {
  assert.throws(
    () => parseXliffDocument(wrapUnits(unit('x', `${src()}${target(KO_PROSE)}`), 'target-language="fr"')),
    (err) => err?.code === 'xliff_unsupported_language'
  );
  assert.throws(
    () => parseXliffDocument(wrapUnits(unit('x', `${src()}<target>${KO_PROSE}`))),
    (err) => err?.code === 'xliff_no_parseable_units'
  );

  const doc = parseXliffDocument(wrapUnits(
    unit('bad', `${src()}<target state="translated">${KO_PROSE}`) +
    unit('good', `${src()}${target(KO_PROSE_2)}`)
  ));
  const sel = selectXliffSegments(doc);
  assert.equal(doc.ambiguousCount, 1);
  assert.equal(doc.parseableCount, 1);
  assert.equal(byId(sel.selected).good.targetCore, KO_PROSE_2);
});

test('property-ish span accuracy: every selected segment slices to its raw target inner bytes', () => {
  const raw = '  정확한 시작과 끝 위치를 보존해야 하는 충분히 긴 안내 문장입니다.\r\n';
  const fixture = wrapUnits(
    unit('a', `${src()}${target(raw)}`) +
    unit('skip-inline', `${src()}${target(`${KO_PROSE}<x/>`)}`) +
    unit('b', `${src()}${target(KO_PROSE_2)}`)
  );
  const doc = parseXliffDocument(fixture);
  const sel = selectXliffSegments(doc);
  const expected = { a: raw, b: KO_PROSE_2 };
  for (const row of sel.selected) {
    assert.equal(fixture.slice(row.targetInnerStart, row.targetInnerEnd), expected[row.id]);
    assert.ok(row.targetInnerStart < row.targetInnerEnd);
  }
}
);
