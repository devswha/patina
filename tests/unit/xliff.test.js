import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  scanXmlTokens,
  parseAttributesFromTag,
  decodeXmlText,
  hasUnsupportedEntity,
  normalizeLang,
  splitTargetInnerWhitespace,
  hasInlineMarkup,
  isProseLike,
  parseXliffDocument,
  selectXliffSegments,
} from '../../src/cli/xliff.js';
import { htmlEscape } from '../../src/preview/dom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, '../fixtures/xliff/sample.xliff'), 'utf8');

// ---------- scanner (regex-breakers) ----------
test('scanXmlTokens: > inside a quoted attribute does not end the tag', () => {
  const toks = scanXmlTokens('<a b="x>y" c=\'p>q\'>text</a>');
  const open = toks.find((t) => t.kind === 'open');
  assert.equal(open.name, 'a');
  assert.ok(open.raw.includes('b="x>y"'));
  assert.ok(toks.some((t) => t.kind === 'text' && t.raw === 'text'));
  assert.ok(toks.some((t) => t.kind === 'close' && t.name === 'a'));
});

test('scanXmlTokens: comment containing fake </target> is a single comment token', () => {
  const toks = scanXmlTokens('a<!-- </target><target> -->b');
  assert.equal(toks.filter((t) => t.kind === 'comment').length, 1);
  assert.ok(!toks.some((t) => t.kind === 'close' || t.kind === 'open'));
});

test('scanXmlTokens: PI and CDATA are isolated, not parsed as tags/text', () => {
  const pi = scanXmlTokens('<?xml version="1.0"?><r/>');
  assert.equal(pi[0].kind, 'pi');
  assert.equal(pi[1].kind, 'selfclose');
  const cd = scanXmlTokens('<t><![CDATA[ <b>x</b> & > ]]></t>');
  assert.ok(cd.some((t) => t.kind === 'cdata'));
  // the tags inside CDATA are NOT separate tokens
  assert.ok(!cd.some((t) => t.kind === 'open' && t.name === 'b'));
});

test('scanXmlTokens: unterminated constructs become a terminal malformed token', () => {
  assert.equal(scanXmlTokens('<a ').at(-1).kind, 'malformed');
  assert.equal(scanXmlTokens('<!-- open').at(-1).kind, 'malformed');
  assert.equal(scanXmlTokens('<![CDATA[ x').at(-1).kind, 'malformed');
  assert.equal(scanXmlTokens('<?pi').at(-1).kind, 'malformed');
});

// ---------- attributes + entities ----------
test('parseAttributesFromTag: single/double quotes, lower-cased names, decoded values', () => {
  const { name, attrs } = parseAttributesFromTag('<target A=\'1\' State="final" note="a &amp; b">');
  assert.equal(name, 'target');
  assert.equal(attrs.a, '1');
  assert.equal(attrs.state, 'final');
  assert.equal(attrs.note, 'a & b');
});

test('decodeXmlText: named + numeric entities; unknown left intact', () => {
  assert.equal(decodeXmlText('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;'), '&<>"\'AB');
  assert.equal(decodeXmlText('a&nbsp;b'), 'a&nbsp;b');
});

test('hasUnsupportedEntity: bare & and unknown names are unsafe; known/numeric are safe', () => {
  assert.equal(hasUnsupportedEntity('a &amp; b &#39; &#x41;'), false);
  assert.equal(hasUnsupportedEntity('a &nbsp; b'), true);
  assert.equal(hasUnsupportedEntity('a & b'), true);
});

test('replacement text escaped with htmlEscape round-trips through decodeXmlText', () => {
  const raw = 'Tom & Jerry <3 "quote" it\'s';
  assert.equal(htmlEscape(raw), 'Tom &amp; Jerry &lt;3 &quot;quote&quot; it&#39;s');
  assert.equal(decodeXmlText(htmlEscape(raw)), raw);
});

// ---------- lang / whitespace / inline markup ----------
test('normalizeLang: maps regional tags to supported base; rejects unsupported', () => {
  assert.equal(normalizeLang('ko-KR'), 'ko');
  assert.equal(normalizeLang('zh-CN'), 'zh');
  assert.equal(normalizeLang('zh-TW'), 'zh');
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('ja-JP'), 'ja');
  assert.equal(normalizeLang('fr'), null);
  assert.equal(normalizeLang('de-DE'), null);
  assert.equal(normalizeLang(''), null);
});

test('normalizeLang: Object.prototype member names are not language tags', () => {
  for (const tag of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf',
    'constructor-kr', '__proto__-x', 'toString_en']) {
    assert.equal(normalizeLang(tag), null, tag);
  }
});

test('splitTargetInnerWhitespace: preserves leading/trailing without overlap', () => {
  assert.deepEqual(splitTargetInnerWhitespace('  hi there  '), { leading: '  ', core: 'hi there', trailing: '  ' });
  assert.deepEqual(splitTargetInnerWhitespace('\n\t x \t'), { leading: '\n\t ', core: 'x', trailing: ' \t' });
  const allWs = splitTargetInnerWhitespace('   ');
  assert.equal(allWs.core, '');
  assert.equal(allWs.leading + allWs.trailing, '   ');
});

test('hasInlineMarkup: true when any element tag is present', () => {
  assert.equal(hasInlineMarkup('click <g id="1">here</g> now'), true);
  assert.equal(hasInlineMarkup('plain human text with no markup at all'), false);
});

test('isProseLike: prose selected, labels/urls/placeholders skipped', () => {
  assert.equal(isProseLike('This is a full sentence with enough words.'), true);
  assert.equal(isProseLike('자세한 내용을 확인하려면 여기를 눌러 주세요'), true); // >=12 CJK
  assert.equal(isProseLike('OK'), false);
  assert.equal(isProseLike('확인'), false);
  assert.equal(isProseLike('https://example.com/path'), false);
  assert.equal(isProseLike('%1$s / {0} / %s'), false);
  assert.equal(isProseLike('12345 67'), false);
});

// ---------- parseXliffDocument ----------
test('parseXliffDocument: detects + normalizes target-language', () => {
  const doc = parseXliffDocument(FIXTURE);
  assert.equal(doc.targetLang, 'ko');
  assert.equal(doc.targetLangRaw, 'ko');
});

test('parseXliffDocument: throws on unsupported target-language', () => {
  const bad = '<xliff version="1.2"><file target-language="fr"><body><trans-unit id="a"><source>x</source><target>y</target></trans-unit></body></file></xliff>';
  assert.throws(() => parseXliffDocument(bad), /unsupported or missing target-language/);
});

test('parseXliffDocument: an Object.prototype member name is rejected like any unknown language', () => {
  const doc = (lang) => `<xliff version="1.2"><file target-language="${lang}"><body><trans-unit id="a"><source>x</source><target>y</target></trans-unit></body></file></xliff>`;
  const unsupported = (lang) => ({ code: 'xliff_unsupported_language', message: `xliff: unsupported or missing target-language: ${lang}` });
  assert.throws(() => parseXliffDocument(doc('xx')), unsupported('xx'));
  for (const lang of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.throws(() => parseXliffDocument(doc(lang)), unsupported(lang), lang);
  }
  // --lang reaches the same lookup through langOverride.
  assert.throws(() => parseXliffDocument(doc('ko'), { langOverride: 'constructor' }), { code: 'xliff_unsupported_language' });
});

test('parseXliffDocument: no units throws fail-closed', () => {
  const empty = '<xliff version="1.2"><file target-language="ko"><body></body></file></xliff>';
  assert.throws(() => parseXliffDocument(empty), /no <trans-unit>/);
});

// ---------- selection + dedup (fixture integration) ----------
test('selectXliffSegments: selects safe prose, skips per rule, dedups identical cores', () => {
  const doc = parseXliffDocument(FIXTURE);
  const sel = selectXliffSegments(doc);
  const byId = (arr) => Object.fromEntries(arr.map((s) => [s.id, s]));
  const selById = byId(sel.selected);
  const skById = byId(sel.skipped);

  // Selected: u1 (final prose), u6 (dup of u1), u7 (translated prose)
  assert.ok(selById.u1, 'u1 should be selected');
  assert.ok(selById.u6, 'u6 (duplicate) should be selected');
  assert.ok(selById.u7, 'u7 (after comment) should be selected');
  assert.equal(sel.selectedCount, 3);
  assert.equal(sel.uniqueCount, 2, 'u1 and u6 share one dedup key');

  // Skips with exact reasons
  assert.equal(skById.u2.reason, 'locked');
  assert.equal(skById.u3.reason, 'state_not_allowlisted');
  assert.equal(skById.u4.reason, 'inline_markup');
  assert.equal(skById.u5.reason, 'not_prose');
  assert.equal(skById.u8.reason, 'cdata_or_malformed');
  assert.equal(skById.u9.reason, 'ambiguous_unit');
});

test('selection: extracted target inner span slices back to the original bytes', () => {
  const doc = parseXliffDocument(FIXTURE);
  const sel = selectXliffSegments(doc);
  const u1 = sel.selected.find((s) => s.id === 'u1');
  const rawInner = FIXTURE.slice(u1.targetInnerStart, u1.targetInnerEnd);
  assert.equal(rawInner.trim(), '계정이 로그인되어 있지 않아, 일정 기간 후 파일을 영구적으로 삭제할 예정입니다.');
  // dedup key is the decoded core after CRLF->LF
  assert.equal(u1.dedupKey, '계정이 로그인되어 있지 않아, 일정 기간 후 파일을 영구적으로 삭제할 예정입니다.');
});

test('state allowlist: processes allowlisted/absent states, skips needs-*/unknown', () => {
  const mk = (state, body) => `<xliff version="1.2"><file target-language="ko"><body><trans-unit id="x"><source>src</source><target${state === null ? '' : ` state="${state}"`}>${body}</target></trans-unit></body></file></xliff>`;
  const prose = '이 문장은 충분히 길어서 산문으로 인정되는 안내 문구입니다.';
  const runOne = (state) => selectXliffSegments(parseXliffDocument(mk(state, prose)));
  for (const ok of [null, 'translated', 'final', 'signed-off', 'needs-review-translation']) {
    assert.equal(runOne(ok).selectedCount, 1, `state ${ok} should be processed`);
  }
  for (const bad of ['', 'needs-translation', 'new', 'needs-adaptation', 'rejected', 'weird-unknown']) {
    assert.equal(runOne(bad).selectedCount, 0, `state ${bad} should be skipped`);
  }
});

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
