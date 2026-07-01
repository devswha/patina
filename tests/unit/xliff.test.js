import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  scanXmlTokens,
  parseAttributesFromTag,
  decodeXmlText,
  encodeXmlText,
  hasUnsupportedEntity,
  normalizeLang,
  splitTargetInnerWhitespace,
  hasInlineMarkup,
  isProseLike,
  parseXliffDocument,
  selectXliffSegments,
} from '../../src/cli/xliff.js';

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

test('encodeXmlText: text context encoding round-trips through decode', () => {
  const raw = 'Tom & Jerry <3 "quote" it\'s';
  assert.equal(encodeXmlText(raw), 'Tom &amp; Jerry &lt;3 &quot;quote&quot; it&#39;s');
  assert.equal(decodeXmlText(encodeXmlText(raw)), raw);
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
