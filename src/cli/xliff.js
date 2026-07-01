// @ts-check
// XLIFF localization humanize mode — dependency-free core (parse / scan / select).
//
// This module is PURE and LLM-free: it scans XLIFF 1.2 text with a small
// quote/comment/PI/CDATA-aware forward scanner, isolates each trans-unit's
// direct <target> inner span unambiguously (rejecting anything it cannot
// isolate safely), and classifies which targets are safe prose to humanize.
// It never mutates src/features/* and adds no runtime dependencies.
//
// Write-back, dry-run/cost estimation, caps, atomic writes, and the CLI wiring
// live in later stories (applyXliffReplacements/estimateXliffRun in this file's
// G002 additions, and runXliffMode/CLI in G003). This story ships the analysis
// core + tests only.

import { SUPPORTED_LANGS } from '../web-rewrite-contract.js';

/** Named XML entities patina decodes/encodes. Unknown names are treated as unsafe. */
const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

/** target `state` values considered "already translated" and safe to polish. */
export const TARGET_STATE_ALLOWLIST = Object.freeze(['translated', 'final', 'signed-off', 'needs-review-translation']);

/** Language-tag normalization onto patina's supported set. */
const LANG_ALIASES = Object.freeze({
  ko: 'ko', 'ko-kr': 'ko',
  en: 'en', 'en-us': 'en', 'en-gb': 'en',
  zh: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh',
  ja: 'ja', 'ja-jp': 'ja',
});

/** Prose thresholds (below these, patina abstains anyway → skip as non-prose). */
const MIN_WORDS = 5;
const MIN_CJK_CHARS = 12;

/**
 * Normalize an XLIFF language tag onto patina's supported languages, or null.
 * @param {unknown} tag
 * @returns {string|null}
 */
export function normalizeLang(tag) {
  if (typeof tag !== 'string') return null;
  const key = tag.trim().toLowerCase();
  if (!key) return null;
  if (LANG_ALIASES[key]) return LANG_ALIASES[key];
  const base = key.split(/[-_]/)[0];
  const mapped = LANG_ALIASES[base];
  return mapped && SUPPORTED_LANGS.includes(mapped) ? mapped : null;
}

/**
 * Scan XLIFF/XML text into a flat token stream in a single forward pass.
 * Recognizes comments, processing instructions, CDATA, declarations, tags
 * (open/close/self-close) with quote-aware attribute scanning, and text.
 * Unterminated constructs produce a terminal `malformed` token.
 *
 * @param {string} xml
 * @returns {Array<{kind:string,start:number,end:number,raw:string,name?:string}>}
 */
export function scanXmlTokens(xml) {
  const s = String(xml);
  const n = s.length;
  const tokens = [];
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) {
      tokens.push({ kind: 'text', start: i, end: n, raw: s.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ kind: 'text', start: i, end: lt, raw: s.slice(i, lt) });

    if (s.startsWith('<!--', lt)) {
      const c = s.indexOf('-->', lt + 4);
      if (c === -1) { tokens.push({ kind: 'malformed', start: lt, end: n, raw: s.slice(lt) }); break; }
      const end = c + 3; tokens.push({ kind: 'comment', start: lt, end, raw: s.slice(lt, end) }); i = end; continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const c = s.indexOf(']]>', lt + 9);
      if (c === -1) { tokens.push({ kind: 'malformed', start: lt, end: n, raw: s.slice(lt) }); break; }
      const end = c + 3; tokens.push({ kind: 'cdata', start: lt, end, raw: s.slice(lt, end) }); i = end; continue;
    }
    if (s.startsWith('<?', lt)) {
      const c = s.indexOf('?>', lt + 2);
      if (c === -1) { tokens.push({ kind: 'malformed', start: lt, end: n, raw: s.slice(lt) }); break; }
      const end = c + 2; tokens.push({ kind: 'pi', start: lt, end, raw: s.slice(lt, end) }); i = end; continue;
    }
    const isDecl = s.startsWith('<!', lt);
    const isClose = !isDecl && s[lt + 1] === '/';
    const scanFrom = lt + (isDecl ? 2 : (isClose ? 2 : 1));
    const end = scanToTagEnd(s, scanFrom, n);
    if (end === -1) { tokens.push({ kind: 'malformed', start: lt, end: n, raw: s.slice(lt) }); break; }
    const raw = s.slice(lt, end);
    if (isDecl) tokens.push({ kind: 'decl', start: lt, end, raw });
    else if (isClose) tokens.push({ kind: 'close', start: lt, end, raw, name: tagName(raw) });
    else if (raw.endsWith('/>')) tokens.push({ kind: 'selfclose', start: lt, end, raw, name: tagName(raw) });
    else tokens.push({ kind: 'open', start: lt, end, raw, name: tagName(raw) });
    i = end;
  }
  return tokens;
}

/** Scan to the index just past the tag-closing `>`, honoring quoted attribute values. */
function scanToTagEnd(s, from, n) {
  let q = 0; // 0 none, 1 single, 2 double
  for (let j = from; j < n; j++) {
    const c = s[j];
    if (q === 1) { if (c === "'") q = 0; }
    else if (q === 2) { if (c === '"') q = 0; }
    else if (c === "'") q = 1;
    else if (c === '"') q = 2;
    else if (c === '>') return j + 1;
  }
  return -1;
}

/** Extract the element name from a raw tag string (`<name ...>`, `</name>`, `<name/>`). */
function tagName(raw) {
  let k = 1;
  if (raw[k] === '/') k++;
  while (k < raw.length && /\s/.test(raw[k])) k++;
  let start = k;
  while (k < raw.length && !/[\s/>]/.test(raw[k])) k++;
  return raw.slice(start, k);
}

/**
 * Parse attributes from an already quote-scanned opening/self-closing tag.
 * Returns lower-cased names mapped to decoded values. Never mutates output.
 * @param {string} raw
 * @returns {{name:string, attrs:Record<string,string>}}
 */
export function parseAttributesFromTag(raw) {
  const name = tagName(raw);
  /** @type {Record<string,string>} */
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1].toLowerCase();
    const val = m[3] !== undefined ? m[3] : m[4];
    attrs[key] = decodeXmlText(val);
  }
  return { name, attrs };
}

/**
 * Decode the 5 predefined XML entities + decimal/hex numeric references.
 * Unknown named entities are left intact (and flagged separately by
 * hasUnsupportedEntity so the segment can be skipped fail-closed).
 * @param {string} s
 * @returns {string}
 */
export function decodeXmlText(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = (body[1] === 'x' || body[1] === 'X') ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return isLegalXmlChar(code) ? safeFromCodePoint(code, whole) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

function safeFromCodePoint(code, whole) {
  try { return String.fromCodePoint(code); } catch { return whole; }
}

/** XML 1.0 legal character range. Illegal numeric char refs (e.g. &#0;) are unsafe. */
function isLegalXmlChar(code) {
  if (!Number.isFinite(code)) return false;
  return code === 0x9 || code === 0xa || code === 0xd
    || (code >= 0x20 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd)
    || (code >= 0x10000 && code <= 0x10ffff);
}

/**
 * True if the string contains a bare `&` or an unknown named entity — either is
 * unsafe to round-trip, so the segment must be skipped.
 * @param {string} s
 * @returns {boolean}
 */
export function hasUnsupportedEntity(s) {
  const str = String(s);
  const re = /&(#x[0-9a-fA-F]+;|#[0-9]+;|[a-zA-Z][a-zA-Z0-9]*;)?/g;
  let m;
  while ((m = re.exec(str))) {
    const body = m[1];
    if (!body) return true; // bare '&' not starting a valid entity
    if (body[0] === '#') {
      const num = body.slice(1, -1);
      const code = (num[0] === 'x' || num[0] === 'X') ? parseInt(num.slice(1), 16) : parseInt(num, 10);
      if (!isLegalXmlChar(code)) return true; // invalid XML numeric char ref
      continue;
    }
    const name = body.slice(0, -1);
    if (!Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) return true;
  }
  return false;
}

/**
 * Encode replacement text for an XML text node.
 * @param {string} s
 * @returns {string}
 */
export function encodeXmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Split a target inner XML span into leading whitespace, core, trailing
 * whitespace, without overlap. Only `core` is humanized.
 * @param {string} innerXml
 * @returns {{leading:string, core:string, trailing:string}}
 */
export function splitTargetInnerWhitespace(innerXml) {
  const s = String(innerXml);
  const leading = (s.match(/^\s*/) || [''])[0];
  const rest = s.slice(leading.length);
  const trailing = (rest.match(/\s*$/) || [''])[0];
  const core = rest.slice(0, rest.length - trailing.length);
  return { leading, core, trailing };
}

/** True if a target inner span contains any inline markup tag (g/x/bpt/…, or any element). */
export function hasInlineMarkup(innerXml) {
  return scanXmlTokens(innerXml).some((t) => t.kind === 'open' || t.kind === 'close' || t.kind === 'selfclose');
}

/** True if a target inner span contains CDATA or a malformed construct. */
function hasCdataOrMalformed(innerXml) {
  return scanXmlTokens(innerXml).some((t) => t.kind === 'cdata' || t.kind === 'malformed');
}

/**
 * Walk the token stream for one trans-unit (opened at tokens[openIdx]) using a
 * name-matched nesting stack. Returns the matched close index and the direct
 * child source/target entries, or null when nesting is malformed/unmatched.
 */
function collectUnit(tokens, openIdx) {
  const stack = [{ name: 'trans-unit', openIdx }];
  const directTargets = [];
  const directSources = [];
  for (let j = openIdx + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === 'malformed') return null;
    if (t.kind === 'open') {
      const entry = { name: t.name, openIdx: j };
      if (stack.length === 1 && t.name === 'target') directTargets.push(entry);
      if (stack.length === 1 && t.name === 'source') directSources.push(entry);
      stack.push(entry);
    } else if (t.kind === 'selfclose') {
      if (stack.length === 1 && t.name === 'target') directTargets.push({ name: 'target', openIdx: j, selfClose: true });
    } else if (t.kind === 'close') {
      const top = stack.pop();
      if (!top || top.name !== t.name) return null;
      top.closeIdx = j;
      if (stack.length === 0) {
        return t.name === 'trans-unit' ? { openIdx, closeIdx: j, directTargets, directSources } : null;
      }
    }
  }
  return null;
}

/** Build a per-unit record, or a skip record with a reason. */
function buildUnitRecord(tokens, unit, xml, index) {
  const openTok = tokens[unit.openIdx];
  const { attrs: unitAttrs } = parseAttributesFromTag(openTok.raw);
  const base = {
    index,
    id: unitAttrs.id,
    resname: unitAttrs.resname,
    unitAttrs,
  };
  // Exactly one, well-formed, non-self-closing direct <target>.
  if (unit.directTargets.length !== 1) return { ...base, skip: true, reason: 'ambiguous_unit' };
  const tgt = unit.directTargets[0];
  if (tgt.selfClose || tgt.closeIdx === undefined) return { ...base, skip: true, reason: 'ambiguous_unit' };
  if (unit.directSources.length > 1) return { ...base, skip: true, reason: 'ambiguous_unit' };

  const targetOpen = tokens[tgt.openIdx];
  const targetClose = tokens[tgt.closeIdx];
  const innerStart = targetOpen.end;
  const innerEnd = targetClose.start;
  if (innerEnd < innerStart) return { ...base, skip: true, reason: 'ambiguous_unit' };
  const targetInnerXml = xml.slice(innerStart, innerEnd);
  const { attrs: targetAttrs } = parseAttributesFromTag(targetOpen.raw);

  let sourceText;
  if (unit.directSources.length === 1 && unit.directSources[0].closeIdx !== undefined && !unit.directSources[0].selfClose) {
    const so = tokens[unit.directSources[0].openIdx];
    const sc = tokens[unit.directSources[0].closeIdx];
    if (sc.start >= so.end) sourceText = decodeXmlText(xml.slice(so.end, sc.start));
  }

  return {
    ...base,
    skip: false,
    state: targetAttrs.state,
    targetAttrs,
    targetInnerXml,
    targetInnerStart: innerStart,
    targetInnerEnd: innerEnd,
    sourceText,
  };
}

/**
 * Parse an XLIFF 1.2 document into a target language + trans-unit records.
 * Throws (fail-closed) when the target language is missing/unsupported or when
 * no unit can be isolated at all. Individual ambiguous units are recorded as
 * skips, not fatal.
 *
 * @param {string} xml
 * @param {{langOverride?:string}} [options]
 * @returns {{targetLang:string, targetLangRaw:string|null, units:Array<object>, ambiguousCount:number, parseableCount:number}}
 */
export function parseXliffDocument(xml, { langOverride } = {}) {
  const tokens = scanXmlTokens(xml);
  let targetLangRaw = null;
  for (const t of tokens) {
    if (t.kind === 'open' && t.name === 'file') {
      targetLangRaw = parseAttributesFromTag(t.raw).attrs['target-language'] ?? null;
      break;
    }
  }
  const targetLang = langOverride ? normalizeLang(langOverride) : normalizeLang(targetLangRaw);
  if (!targetLang) {
    const err = new Error(`xliff: unsupported or missing target-language: ${targetLangRaw ?? '(none)'}`);
    /** @type {any} */ (err).code = 'xliff_unsupported_language';
    throw err;
  }

  const units = [];
  let ambiguousCount = 0;
  let index = 0;
  for (let a = 0; a < tokens.length; a++) {
    const t = tokens[a];
    if (!(t.kind === 'open' && t.name === 'trans-unit')) continue;
    const unit = collectUnit(tokens, a);
    if (!unit) { units.push({ index, skip: true, reason: 'ambiguous_unit' }); ambiguousCount++; index++; continue; }
    const rec = buildUnitRecord(tokens, unit, xml, index);
    if (rec.skip) ambiguousCount++;
    units.push(rec);
    index++;
  }
  const parseableCount = units.length - ambiguousCount;
  if (units.length === 0) {
    const err = new Error('xliff: no <trans-unit> elements found');
    /** @type {any} */ (err).code = 'xliff_no_units';
    throw err;
  }
  if (parseableCount === 0) {
    const err = new Error('xliff: no unambiguously parseable trans-units');
    /** @type {any} */ (err).code = 'xliff_no_parseable_units';
    throw err;
  }
  return { targetLang, targetLangRaw, units, ambiguousCount, parseableCount };
}

/** Whether a unit's translate/lock attributes forbid editing. */
function isLocked(attrs = {}) {
  return attrs.translate === 'no' || attrs.locked === 'true' || attrs.approved === 'no';
}

/** Whether the decoded core text is prose worth humanizing. */
export function isProseLike(text) {
  const t = String(text).trim();
  if (!t) return false;
  if (!/[A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t)) return false; // no letters at all
  // Reject obvious non-prose: URLs, emails, format codes / placeholders only.
  if (/^(https?:\/\/|mailto:)/i.test(t)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return false;
  const stripped = t.replace(/%[0-9]*\$?[a-zA-Z]|%\{[^}]*\}|\{\d+\}|\{[a-zA-Z_][\w]*\}|<[^>]+>/g, ' ').trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/).filter(Boolean).length;
  const cjk = (stripped.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return words >= MIN_WORDS || cjk >= MIN_CJK_CHARS;
}

/**
 * Classify one parsed unit record into a selected segment or a skip+reason.
 * @param {object} unit A non-skip record from parseXliffDocument.
 * @returns {{select:boolean, reason?:string, index:number, id?:string, resname?:string, dedupKey?:string, sourceText?:string, targetCore?:string, leading?:string, trailing?:string, targetInnerStart?:number, targetInnerEnd?:number}}
 */
export function classifyXliffSegment(unit) {
  const base = { index: unit.index, id: unit.id, resname: unit.resname };
  if (unit.skip) return { select: false, reason: unit.reason || 'ambiguous_unit', ...base };
  if (isLocked(unit.unitAttrs)) return { select: false, reason: 'locked', ...base };

  const state = unit.state;
  const stateOk = state === undefined || TARGET_STATE_ALLOWLIST.includes(state);
  if (!stateOk) return { select: false, reason: 'state_not_allowlisted', ...base };

  const inner = unit.targetInnerXml;
  if (hasCdataOrMalformed(inner)) return { select: false, reason: 'cdata_or_malformed', ...base };
  if (hasInlineMarkup(inner)) return { select: false, reason: 'inline_markup', ...base };
  if (hasUnsupportedEntity(inner)) return { select: false, reason: 'unsupported_entity', ...base };

  const { leading, core, trailing } = splitTargetInnerWhitespace(inner);
  const decodedCore = decodeXmlText(core);
  if (!decodedCore.trim()) return { select: false, reason: 'empty_target', ...base };

  // Untranslated: target core equals source core after decode+trim. (needs-translation
  // is already excluded by the state allowlist above.)
  if (typeof unit.sourceText === 'string' && decodedCore.trim() === unit.sourceText.trim()) {
    return { select: false, reason: 'untranslated', ...base };
  }
  if (!isProseLike(decodedCore)) return { select: false, reason: 'not_prose', ...base };

  return {
    select: true,
    ...base,
    sourceText: unit.sourceText,
    targetCore: decodedCore,
    leading,
    trailing,
    targetInnerStart: unit.targetInnerStart,
    targetInnerEnd: unit.targetInnerEnd,
    dedupKey: decodedCore.replace(/\r\n/g, '\n'),
  };
}

/**
 * Classify every unit in a parsed document and produce selection + skip stats,
 * with exact-text dedup (key = decoded core after CRLF→LF; no trim/casefold).
 *
 * @param {{units:Array<object>}} doc
 * @returns {{selected:Array<object>, skipped:Array<object>, skippedByReason:Record<string,number>, uniqueKeys:string[], selectedCount:number, uniqueCount:number}}
 */
export function selectXliffSegments(doc) {
  const selected = [];
  const skipped = [];
  /** @type {Record<string,number>} */
  const skippedByReason = {};
  const seen = new Set();
  for (const unit of doc.units) {
    const c = classifyXliffSegment(unit);
    if (c.select) {
      selected.push(c);
      seen.add(c.dedupKey);
    } else {
      skipped.push(c);
      skippedByReason[c.reason] = (skippedByReason[c.reason] || 0) + 1;
    }
  }
  return {
    selected,
    skipped,
    skippedByReason,
    uniqueKeys: [...seen],
    selectedCount: selected.length,
    uniqueCount: seen.size,
  };
}

/** Default cap on the number of UNIQUE segments processed per command. */
export const DEFAULT_UNIQUE_CAP = 50;

/** Resolve the effective unique-segment cap from parsed args (positive int override). */
export function resolveUniqueCap(parsed = {}) {
  const n = Number(parsed.maxSegments);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_UNIQUE_CAP;
}

/**
 * Apply target-inner replacements to XLIFF text. Each replacement is a
 * `{start, end, replacement}` span over the ORIGINAL string; spans are applied
 * right-to-left so earlier offsets stay valid, and overlapping spans are
 * rejected. An empty replacement list returns the input byte-identically, and
 * every byte outside a replaced span is preserved exactly.
 * Spans are JS string indices into the original decoded XML string (from the
 * same string the offsets were derived from), NOT UTF-8 byte offsets.
 *
 * @param {string} xmlText
 * @param {Array<{start:number,end:number,replacement:string}>} replacements
 * @returns {string}
 */
export function applyXliffReplacements(xmlText, replacements) {
  const s = String(xmlText);
  if (!Array.isArray(replacements) || replacements.length === 0) return s;
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let out = s;
  let prevStart = s.length + 1;
  for (const r of sorted) {
    if (!(Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end >= r.start && r.end <= s.length)) {
      throw new Error(`xliff: invalid replacement span [${r.start}, ${r.end}]`);
    }
    if (r.end > prevStart) throw new Error('xliff: overlapping replacement spans');
    out = out.slice(0, r.start) + String(r.replacement) + out.slice(r.end);
    prevStart = r.start;
  }
  return out;
}

/**
 * Compute a dry-run report for an XLIFF humanize run. Makes ZERO LLM calls and
 * writes nothing. Worst-case per unique segment is 6 LLM calls (1 rewrite + 2
 * verification scoring calls + 1 conservative retry rewrite + 2 retry scoring).
 *
 * @param {{totalUnits?:number, selectedCount?:number, uniqueCount?:number, skippedByReason?:Record<string,number>, cap?:number, backendAttemptsPerCall?:number, outputPath?:string|null, provider?:string, model?:string}} [input]
 * @returns {object}
 */
export function estimateXliffRun({
  totalUnits = 0,
  selectedCount = 0,
  uniqueCount = 0,
  skippedByReason = {},
  cap = DEFAULT_UNIQUE_CAP,
  backendAttemptsPerCall = 1,
  outputPath = null,
  provider,
  model,
} = {}) {
  const CALLS_PER_UNIQUE = 6; // rewrite + 2 verify + retry rewrite + 2 retry verify
  const REWRITE_CALLS_PER_UNIQUE = 2; // initial + conservative retry
  const REWRITE_PROMPT_INPUT_TOKENS = 12000; // measured patina rewrite prompt base
  const worstCaseLlmCalls = uniqueCount * CALLS_PER_UNIQUE;
  const attemptsPerCall = Math.max(1, Number(backendAttemptsPerCall) || 1);
  return {
    totalUnits,
    outputPath,
    selectedCount,
    uniqueCount,
    duplicateSavings: Math.max(0, selectedCount - uniqueCount),
    skippedByReason,
    cap,
    capStatus: uniqueCount > cap ? 'cap_exceeded' : 'ok',
    callsPerUnique: CALLS_PER_UNIQUE,
    worstCaseLlmCalls,
    worstCaseBackendAttempts: worstCaseLlmCalls * attemptsPerCall,
    inputTokensEstimate: uniqueCount * REWRITE_CALLS_PER_UNIQUE * REWRITE_PROMPT_INPUT_TOKENS,
    tokenEstimateBasis: 'estimated: ~12000 input tokens per rewrite-style call; verifier scoring prompts add more',
    cost: null,
    costNote: provider || model ? `pricing unavailable for ${provider ?? '?'}/${model ?? '?'}` : 'pricing unavailable',
    llmCalls: 0,
    writes: 0,
  };
}

/**
 * Orchestrate an XLIFF humanize run over a parsed+selected document. PURE except
 * for the injected `rewriteSegment`/`verifySegment` async callbacks, so tests
 * can drive it with fakes. Rewrites each UNIQUE selected target core once and
 * reuses the verified result for all duplicates. A segment is written only when
 * verification passes AND the core actually changed — so a no-op rewrite yields
 * a byte-identical file. Verify-floor misses and rewrite errors keep the
 * original bytes (fail-closed). Dry-run makes zero calls and no changes.
 *
 * @param {{
 *   xml: string,
 *   langOverride?: string,
 *   cap?: number,
 *   dryRun?: boolean,
 *   rewriteSegment?: (input: {core: string, lang: string, source?: string}) => Promise<string>,
 *   verifySegment?: (input: {core: string, candidate: string, lang?: string}) => Promise<{verified: boolean, text?: string, mps?: number, fidelity?: number}>,
 *   backendAttemptsPerCall?: number,
 *   provider?: string,
 *   model?: string,
 *   outputPath?: string|null,
 *   breaker?: {recordSuccess?: Function, recordFailure?: Function, shouldStop?: Function, toError?: Function}|null,
 *   signal?: {aborted?: boolean}|null,
 * }} input
 * @returns {Promise<{dryRun:boolean, outputXml:string, report:object, targetLang:string}>}
 */
export async function humanizeXliffDocument({
  xml,
  langOverride,
  cap = DEFAULT_UNIQUE_CAP,
  dryRun = false,
  rewriteSegment,
  verifySegment,
  backendAttemptsPerCall = 1,
  provider,
  model,
  outputPath = null,
  breaker = null,
  signal = null,
}) {
  const doc = parseXliffDocument(xml, { langOverride });
  const sel = selectXliffSegments(doc);
  const report = estimateXliffRun({
    totalUnits: doc.units.length,
    selectedCount: sel.selectedCount,
    uniqueCount: sel.uniqueCount,
    skippedByReason: sel.skippedByReason,
    cap,
    backendAttemptsPerCall,
    outputPath,
    provider,
    model,
  });

  if (dryRun) return { dryRun: true, outputXml: xml, report, targetLang: doc.targetLang };

  if (sel.uniqueCount > cap) {
    const err = new Error(`xliff: ${sel.uniqueCount} unique segments exceeds the cap of ${cap}; pass --max-segments to raise it or use --dry-run`);
    /** @type {any} */ (err).code = 'xliff_cap_exceeded';
    /** @type {any} */ (err).report = report;
    throw err;
  }

  if (typeof rewriteSegment !== 'function' || typeof verifySegment !== 'function') {
    throw new TypeError('humanizeXliffDocument requires rewriteSegment and verifySegment callbacks');
  }

  // One rewrite+verify per unique dedup key; reuse for every duplicate.
  const firstByKey = new Map();
  for (const s of sel.selected) if (!firstByKey.has(s.dedupKey)) firstByKey.set(s.dedupKey, s);

  /** @type {Map<string,string>} verified NEW core keyed by dedup key */
  const changedByKey = new Map();
  /** @type {Record<string,{status:string}>} */
  const perKey = {};

  for (const [key, seg] of firstByKey) {
    if (signal && signal.aborted) {
      const e = new Error('xliff: canceled');
      /** @type {any} */ (e).code = 'canceled';
      throw e;
    }
    let candidate;
    let verification;
    try {
      candidate = await rewriteSegment({ core: seg.targetCore, lang: doc.targetLang, source: seg.sourceText });
      verification = await verifySegment({ core: seg.targetCore, candidate, lang: doc.targetLang });
      breaker?.recordSuccess?.();
    } catch (err) {
      perKey[key] = { status: 'error' };
      breaker?.recordFailure?.({ path: seg.id ?? key, err });
      if (breaker?.shouldStop?.()) throw (breaker.toError ? breaker.toError() : err);
      continue; // fail-closed: keep original bytes
    }
    if (verification && verification.verified && typeof verification.text === 'string') {
      const newCore = verification.text.trim();
      if (newCore && newCore !== seg.targetCore.trim()) {
        changedByKey.set(key, newCore);
        perKey[key] = { status: 'rewritten' };
      } else {
        perKey[key] = { status: 'unchanged' };
      }
    } else {
      perKey[key] = { status: 'floor_failed' };
    }
  }

  // Build replacements for EVERY selected segment whose key was verified-changed.
  const replacements = [];
  for (const s of sel.selected) {
    const newCore = changedByKey.get(s.dedupKey);
    if (newCore === undefined) continue;
    replacements.push({
      start: s.targetInnerStart,
      end: s.targetInnerEnd,
      replacement: s.leading + encodeXmlText(newCore) + s.trailing,
    });
  }
  const outputXml = applyXliffReplacements(xml, replacements);

  return {
    dryRun: false,
    outputXml,
    report: { ...report, changedSegments: replacements.length, changedUniqueKeys: changedByKey.size, perKey },
    targetLang: doc.targetLang,
  };
}
