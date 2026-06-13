// @ts-check
import { createLogger } from './logger.js';
import { analyzeText, loadStructuralModel } from './features/index.js';
import { TRANSLATIONESE_RULES } from './features/translationese.js';

/**
 * Format a raw backend result for CLI output mode and requested format.
 *
 * @param {string|object} result Backend result or structured mode result.
 * @param {string} mode Output mode: rewrite, diff, audit, score, or ouroboros.
 * @param {object} [parsed={}] Parsed CLI options.
 * @param {object} [opts={}] Formatting options.
 * @param {object|null} [opts.tone] Tone metadata to append.
 * @param {object} [opts.logger] Logger for output warnings.
 * @param {object} [opts.env] Environment map for color decisions.
 * @param {object} [opts.stdout] Stdout-like stream for color decisions.
 * @param {string} [opts.auditBackstop] Deterministic audit-mode section to append before the tone footer.
 * @returns {string} User-facing formatted output.
 * @throws {TypeError} When `result` or `opts.tone` carries values JSON.stringify cannot serialize (circular references, BigInt) — the json format serializes the result payload, and the tone footer serializes `opts.tone.tone_evidence`.
 * @example
 * const output = formatOutput('[BODY]Hi[/BODY]', 'rewrite');
 */
export function formatOutput(result, mode, parsed = {}, opts = {}) {
  const tone = opts.tone || null;
  const format = parsed.format || 'markdown';
  let body = renderFormattedBody(result, mode, parsed, opts);

  if (mode === 'audit' && format !== 'json' && opts.auditBackstop) {
    body += opts.auditBackstop;
  }

  if (format === 'json') {
    return formatJsonOutput({ result, mode, body, tone, gate: parsed.gate });
  }

  if (format === 'text') {
    return formatTextOutput(body);
  }

  return appendToneFooter(body, tone);
}

function renderFormattedBody(result, mode, parsed = {}, opts = {}) {
  let body = renderBody(result);
  // Only rewrite and ouroboros emit [BODY] tags; diff/audit/score
  // emit tables and don't need the extraction step.
  if (mode === 'rewrite' || mode === 'ouroboros') {
    body = stripSelfAudit(body, { logger: opts.logger });
  }
  if (mode === 'diff') {
    body = colorizeDiff(body, { parsed, env: opts.env, stdout: opts.stdout });
  }
  return body;
}

const ANSI = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

function colorizeDiff(body, { parsed = {}, env = process.env, stdout = process.stdout } = {}) {
  if (!shouldColorDiff({ parsed, env, stdout })) return body;

  return String(body || '').split(/\r?\n/).map((line) => {
    if (/^(\s*)(Removed:)(.*)$/u.test(line)) {
      return line.replace(/^(\s*)(Removed:)(.*)$/u, `$1${ANSI.red}$2$3${ANSI.reset}`);
    }
    if (/^(\s*)(Added:)(.*)$/u.test(line)) {
      return line.replace(/^(\s*)(Added:)(.*)$/u, `$1${ANSI.green}$2$3${ANSI.reset}`);
    }
    if (/^(\s*)(Pattern:)(.*)$/u.test(line)) {
      return line.replace(/^(\s*)(Pattern:)(.*)$/u, `$1${ANSI.bold}$2$3${ANSI.reset}`);
    }
    return line;
  }).join('\n');
}

/**
 * @param {object} [options]
 * @param {object} [options.parsed]
 * @param {boolean} [options.parsed.noColor]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {object} [options.stdout]
 * @param {boolean} [options.stdout.isTTY]
 */
function shouldColorDiff({ parsed = {}, env = process.env, stdout = process.stdout } = {}) {
  return !parsed.noColor && env.NO_COLOR === undefined && stdout?.isTTY === true;
}


// v3.11 Phase 1.3: parse the model's score table and check that the Weight
// column matches the config-supplied category-weights. case-02 found that
// the model often invents weights or extra categories (e.g., "discord");
// this surfaces those drifts as warnings rather than silently accepting them.
//
// Returns an array of human-readable warning strings (empty if everything
// matches). Caller is responsible for emitting to stderr.
/**
 * Validate that a model-emitted score table used configured category weights.
 *
 * @param {string} output Score-mode markdown output.
 * @param {object} configWeights Expected category weight map.
 * @returns {string[]} Human-readable warnings for missing, mismatched, or unexpected categories.
 * @example
 * const warnings = validateScoreWeights('| content | 0.4 | 1 | 10 | 4 |', { content: 0.4 });
 */
export function validateScoreWeights(output, configWeights) {
  if (!output || !configWeights || Object.keys(configWeights).length === 0) {
    return [];
  }
  const warnings = [];
  // Match table rows where the first column is a category label and the
  // second is a numeric weight. Category labels may be localized by weaker
  // models (for example `내용` or `言語`), so parse Unicode letters and map
  // them back to the canonical config keys before comparison.
  const rowRe = /^\|\s*([\p{L}\p{N}_-][^|]*?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|/u;
  const seen = new Map();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(rowRe);
    if (!m) continue;
    const cat = normalizeCategoryName(m[1]);
    if (!cat) continue;
    const weight = parseFloat(m[2]);
    if (!Number.isNaN(weight) && !seen.has(cat)) {
      seen.set(cat, weight);
    }
  }
  for (const [cat, expected] of Object.entries(configWeights)) {
    if (!seen.has(cat)) {
      warnings.push(`weight check: category "${cat}" missing from score output`);
      continue;
    }
    const actual = seen.get(cat);
    if (Math.abs(actual - expected) > 0.005) {
      warnings.push(`weight check: "${cat}" expected ${expected}, model used ${actual}`);
    }
  }
  for (const cat of seen.keys()) {
    if (!(cat in configWeights)) {
      warnings.push(`weight check: unexpected category "${cat}" — likely model hallucination`);
    }
  }
  return warnings;
}

const CATEGORY_ALIASES = new Map([
  ['content', 'content'],
  ['내용', 'content'],
  ['콘텐츠', 'content'],
  ['内容', 'content'],
  ['language', 'language'],
  ['언어', 'language'],
  ['语言', 'language'],
  ['語言', 'language'],
  ['言語', 'language'],
  ['style', 'style'],
  ['문체', 'style'],
  ['스타일', 'style'],
  ['文体', 'style'],
  ['文體', 'style'],
  ['风格', 'style'],
  ['風格', 'style'],
  ['communication', 'communication'],
  ['커뮤니케이션', 'communication'],
  ['소통', 'communication'],
  ['沟通', 'communication'],
  ['溝通', 'communication'],
  ['コミュニケーション', 'communication'],
  ['filler', 'filler'],
  ['채움', 'filler'],
  ['필러', 'filler'],
  ['填充', 'filler'],
  ['フィラー', 'filler'],
  ['structure', 'structure'],
  ['구조', 'structure'],
  ['结构', 'structure'],
  ['結構', 'structure'],
  ['構造', 'structure'],
  ['viral-hook', 'viral-hook'],
  ['viral hook', 'viral-hook'],
  ['바이럴훅', 'viral-hook'],
  ['바이럴-훅', 'viral-hook'],
  ['病毒钩子', 'viral-hook'],
  ['病毒鉤子', 'viral-hook'],
  ['バイラルフック', 'viral-hook'],
]);

function normalizeCategoryName(raw) {
  const cleaned = String(raw || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[：:]+$/u, '');

  if (!cleaned || cleaned === 'total' || cleaned === '합계' || cleaned === '总计' || cleaned === '總計' || cleaned === '合計') {
    return null;
  }

  const ascii = cleaned.match(/\b(content|language|style|communication|filler|structure|viral[\s-]?hook)\b/);
  if (ascii) return ascii[1].replace(/\s+/, '-');

  const compact = cleaned.replace(/[\s・·_/]+/gu, '');
  return CATEGORY_ALIASES.get(cleaned) || CATEGORY_ALIASES.get(compact) || compact;
}

// v3.11: rewrite/diff/ouroboros prompts ask the model to wrap user-facing
// text in [BODY]...[/BODY] and put audit notes in [SELF_AUDIT]...[/SELF_AUDIT].
// We extract the body block and drop the audit so callers get clean text.
// If the model didn't honor the tags (older runs, mocked tests, etc.), we
// fall back to returning the full output untouched.
/**
 * Remove SELF_AUDIT blocks and unwrap the BODY block from rewrite output.
 *
 * @param {string} body Raw model response.
 * @param {object} [options] Strip options.
 * @param {object} [options.logger] Logger for malformed output warnings.
 * @returns {string} Clean user-facing body text.
 * @example
 * const clean = stripSelfAudit('[BODY]Hello[/BODY]\n[SELF_AUDIT]ok[/SELF_AUDIT]');
 */
export function stripSelfAudit(body, { logger = createLogger() } = {}) {
  if (!body) return body;
  const bodyOpen = body.indexOf('[BODY]');
  const bodyClose = body.indexOf('[/BODY]', bodyOpen);
  if (bodyOpen < 0 || bodyClose <= bodyOpen) {
    const stripped = removeSelfAuditBlocks(body).trim();
    if (stripped !== body.trim()) {
      logger.warn('output.missing_body_tags', {
        message: `[patina] warning: model output omitted [BODY] tags (${body.length} chars); stripped [SELF_AUDIT]. Try a different backend if the output looks wrong.`,
      });
      return stripped;
    }
    return body;
  }
  const inner = removeSelfAuditBlocks(body.slice(bodyOpen + '[BODY]'.length, bodyClose)).trim();
  const tail = removeSelfAuditBlocks(body.slice(bodyClose + '[/BODY]'.length)).trim();
  return tail ? `${inner}\n\n${tail}` : inner;
}
export function formatRewriteBodyForBrowser(result, { logger = createLogger() } = {}) {
  const body = stripSelfAudit(renderBody(result), { logger }).trim();
  return removeToneFooter(body);
}


function removeSelfAuditBlocks(body) {
  return String(body || '').replace(/\[SELF_AUDIT\][\s\S]*?\[\/SELF_AUDIT\]/g, '');
}

function removeToneFooter(body) {
  if (!hasToneFooter(body)) return body;
  const str = String(body || '');
  // Anchor to the LAST '---'-fenced block: the inner content may not contain another
  // '---' fence line, so a markdown thematic break earlier in the body cannot be
  // mistaken for the footer opener (which would truncate everything after it).
  const match = str.match(/(?:^|\n)---[ \t]*\n((?:(?!\n---[ \t]*(?:\n|$))[\s\S])*?)\n---[ \t]*$/);
  if (!match) return body;
  const block = match[1];
  if (
    !/\btone\s*:/.test(block)
    || !/\btone_source\s*:/.test(block)
    || !/\btone_evidence\s*:/.test(block)
    || !/\btone_confidence\s*:/.test(block)
  ) {
    return body;
  }
  return str.slice(0, match.index).trimEnd();
}

function renderBody(result) {
  if (typeof result === 'string') {
    return result.trim();
  }

  if (result && typeof result === 'object' && 'raw' in result) {
    return String(result.raw).trim();
  }


  return String(result).trim();
}

function extractScoreDetails(result) {
  if (!result || typeof result !== 'object') return null;
  if (!result.llmScore && !result.deterministicScore && !result.scorePreference) return null;
  return {
    llm: result.llmScore ?? null,
    deterministic: result.deterministicScore ?? null,
    preference: result.scorePreference ?? null,
  };
}

function formatTextOutput(body) {
  return body.trim();
}

function formatJsonOutput({ result, mode, body, tone, gate }) {
  const overall = extractOverall(result, body);
  const payload = {
    mode,
    format: 'json',
    overall,
    categories: extractCategories(result, body),
    tone: tone ? {
      tone: tone.tone ?? null,
      tone_source: tone.tone_source ?? null,
      tone_evidence: Array.isArray(tone.tone_evidence) ? tone.tone_evidence : [],
      tone_confidence: tone.tone_confidence ?? null,
    } : null,
    mps: extractMps(result, body),
    gateResult: buildGateResult(overall, gate),
    output: body,
  };

  const scoreDetails = extractScoreDetails(result);
  if (scoreDetails) payload.scores = scoreDetails;


  return JSON.stringify(payload, null, 2);
}

function buildGateResult(overall, gate) {
  if (gate === undefined) return null;
  if (overall === null) {
    return { threshold: gate, overall: null, passed: null, exitCode: null };
  }
  const passed = overall <= gate;
  return { threshold: gate, overall, passed, exitCode: passed ? 0 : 3 };
}

function extractOverall(result, body) {
  return extractOverallScore(result, body, {
    coerce: toFiniteNumber,
    parseResultFallback: true,
  });
}

/**
 * Shared overall-score traversal: structured result field → embedded JSON →
 * markdown score table → inline "overall: N" text. Used by extractOverall
 * above and by the CLI score gate (src/cli/score-gate.js). The two call sites
 * intentionally keep different numeric coercers (toFiniteNumber here strips
 * non-numeric characters before Number(); the score gate's toFiniteScore
 * rejects anything that is not already a plain number), so the coercer is a
 * parameter rather than shared.
 *
 * @param {string|object|null} result Structured result whose `overall` field is checked first.
 * @param {string} text Raw output text scanned for embedded JSON, a score table, or inline "overall: N".
 * @param {object} options Extraction options (required).
 * @param {function(*): (number|null)} options.coerce Numeric coercer applied to candidate values.
 * @param {boolean} [options.parseResultFallback=false] When the text yields no JSON, also try parsing `result` itself if it is a string (output.js JSON formatter behavior).
 * @param {boolean} [options.pipeBoundary=false] Accept a `|` table-cell boundary before "overall" in the inline-text regex (score-gate behavior).
 * @returns {number|null} Extracted overall score, or null when none is found.
 */
export function extractOverallScore(result, text, {
  coerce,
  parseResultFallback = false,
  pipeBoundary = false,
}) {
  const direct = coerce(result?.overall);
  if (direct !== null) return direct;

  const str = String(text ?? '');
  const parsed = parseFirstJson(str)
    || (parseResultFallback && typeof result === 'string' ? parseFirstJson(result) : null);
  const parsedOverall = coerce(parsed?.overall);
  if (parsedOverall !== null) return parsedOverall;

  const overallFromTable = str.match(/(?:^|\n)\|\s*(?:\*\*)?Overall(?:\*\*)?\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(?:\*\*)?([0-9]+(?:\.[0-9]+)?)/i);
  if (overallFromTable) return Number(overallFromTable[1]);

  const overallFromText = str.match(pipeBoundary
    ? /(?:^|[\s|{,"])overall(?:["\s]*[:|]|\s+score\s*[:|]?)\s*(\d+(?:\.\d+)?)/i
    : /(?:^|[\s{,"])overall(?:["\s]*[:|]|\s+score\s*[:|]?)\s*(\d+(?:\.\d+)?)/i);
  return overallFromText ? Number(overallFromText[1]) : null;
}

function extractMps(result, body) {
  const direct = toFiniteNumber(result?.mps ?? result?.best?.mps);
  if (direct !== null) return direct;
  const parsed = parseFirstJson(body);
  return toFiniteNumber(parsed?.mps);
}

function extractCategories(result, body) {
  const direct = normalizeCategories(result?.categories);
  if (direct.length > 0) return direct;

  const parsed = parseFirstJson(body) || (typeof result === 'string' ? parseFirstJson(result) : null);
  const parsedCategories = normalizeCategories(parsed?.categories);
  if (parsedCategories.length > 0) return parsedCategories;

  return parseMarkdownCategories(body);
}

function normalizeCategories(categories) {
  if (Array.isArray(categories)) {
    return categories.map((category) => ({ ...category }));
  }
  if (!categories || typeof categories !== 'object') {
    return [];
  }
  return Object.entries(categories).map(([name, value]) => ({
    name,
    ...(value && typeof value === 'object' ? value : { value }),
  }));
}

function parseMarkdownCategories(body) {
  const rows = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/^\*\*|\*\*$/g, ''));
    if (cells.length < 5) continue;
    const [name, weight, detected, rawScore, weighted] = cells;
    if (!name || /^-+$/.test(name) || /^category$/i.test(name) || /^overall$/i.test(name)) continue;
    rows.push({
      name: normalizeCategoryName(name) || name,
      weight: toFiniteNumber(weight),
      detected: toFiniteNumber(detected),
      rawScore: toFiniteNumber(rawScore),
      weighted: toFiniteNumber(weighted),
    });
  }
  return rows;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the first JSON value found in raw text, a fenced code block, or a brace span.
 *
 * @param {string} text Raw model output that may embed JSON.
 * @returns {object|null} Parsed JSON value, or null when no candidate parses.
 * @example
 * const data = parseFirstJson('```json\n{"overall": 12}\n```');
 */
export function parseFirstJson(text) {
  if (!text || typeof text !== 'string') return null;
  const rawCandidates = [
    text.trim(),
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1],
    text.match(/\{[\s\S]*\}/)?.[0],
  ];
  const candidates = /** @type {string[]} */ (
    rawCandidates.filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  );
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

// Append the v3.10 YAML footer to every output mode (rewrite/diff/audit/score).
// SKILL.md Phase 6 spec: footer is the *only* sanctioned tone-info surface.
// If the LLM already emitted a footer (it should, per SKILL.md), do not duplicate.
function appendToneFooter(body, tone) {
  if (!tone || !tone.tone_source) return body;
  if (hasToneFooter(body)) return body;

  const lines = ['', '---'];
  lines.push(`tone: ${tone.tone === null || tone.tone === undefined ? 'null' : tone.tone}`);
  lines.push(`tone_source: ${tone.tone_source}`);
  const ev = Array.isArray(tone.tone_evidence) ? tone.tone_evidence : [];
  lines.push(`tone_evidence: ${JSON.stringify(ev)}`);
  lines.push(`tone_confidence: ${tone.tone_confidence ?? 'null'}`);
  lines.push('---');
  return `${body}\n${lines.join('\n')}\n`;
}

// Detect a trailing YAML footer block emitted by the model. Match a `---`
// fenced block within the last ~30 non-empty lines that contains a `tone:`
// key. We avoid double-printing when the model honored Phase 6.
function hasToneFooter(body) {
  if (!body) return false;
  const tail = normalizeFooterTail(body.split(/\r?\n/).slice(-30));
  const m = tail.match(/(^|\n)---\s*\n([\s\S]*?)\n---\s*$/);
  if (!m) return false;
  const block = m[2];
  return /\btone\s*:/.test(block)
    && /\btone_source\s*:/.test(block)
    && /\btone_evidence\s*:/.test(block)
    && /\btone_confidence\s*:/.test(block);
}

function normalizeFooterTail(lines) {
  return lines
    .map((line) => line.replace(/^\s*>\s?/u, '').trimEnd())
    .filter((line) => !/^\s*```[\w-]*\s*$/u.test(line))
    .join('\n')
    .trim();
}

/**
 * Build a deterministic "backstop" section for audit mode. The LLM audit is
 * model-dependent (a weak model silently drops 번역투/calques); these signals are
 * computed deterministically so they appear regardless of which model ran. ko
 * translationese rules are listed even below the hot-density gate, because audit
 * is a hint surface, not a verdict.
 *
 * @param {string} text Source text.
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {string} [opts.repoRoot]
 * @param {object} [opts.config]
 * @param {{ warn?: Function }} [opts.logger] Optional logger; the structural
 *   model load degrades to a warning here instead of aborting the audit (#443).
 * @returns {string} Markdown section (empty string when nothing fired).
 */
export function buildDeterministicAuditBackstop(text, opts = {}) {
  const lang = opts.lang ?? 'ko';
  const str = typeof text === 'string' ? text : '';
  /** @type {Array<{signal:string,label:string,severity:string,location:string}>} */
  const rows = [];
  /** @type {Array<{signal:string,location:string,hint:string}>} */
  const translationeseRows = [];

  // ko translationese — per-rule, with matched samples (model-independent).
  // This is an editing-hint surface, not calibrated severity evidence.
  if (lang === 'ko' && str) {
    for (const rule of TRANSLATIONESE_RULES) {
      const matches = str.match(rule.re());
      if (matches && matches.length >= (rule.minCount ?? 1)) {
        const samples = [...new Set(matches.map((m) => m.trim()).filter(Boolean))].slice(0, 4);
        translationeseRows.push({
          signal: `번역투: ${rule.id} — ${rule.label}`,
          location: samples.join(', '),
          hint: rule.example?.after
            ? `자연스러운 한국어 예: ${rule.example.after}`
            : '문맥을 읽고 자연스러운 한국어 절·문장으로 다듬는다.',
        });
      }
    }
  }

  // markup leakage (near-proof) + density-gated discourse tells — language-agnostic.
  // The structural classifier is an advisory backstop: a configured-but-missing
  // or corrupt model must degrade to a warning here, exactly as the --score path
  // does (scoring.js), instead of aborting `patina --audit` (#443).
  let structuralModel = null;
  try {
    structuralModel = loadStructuralModel(opts.config ?? {}, { lang });
  } catch (err) {
    opts.logger?.warn?.('audit.structural_model_load_failure', {
      message: `[patina] structural model load failed; continuing without structural classifier: ${err?.message || err}`,
    });
  }
  const a = analyzeText(str, { lang, repoRoot: opts.repoRoot, structuralModel });
  for (const h of a.markupLeakage?.hits ?? []) {
    rows.push({ signal: 'markup-leakage', label: h.label, severity: 'HIGH', location: (h.samples ?? []).join(', ') });
  }
  if (a.discourseTells?.fakeCandor?.hot) {
    rows.push({ signal: 'discourse: fake-candor', label: '친근함 위장 도입부', severity: 'MEDIUM', location: (a.discourseTells.fakeCandor.hits ?? []).join(', ') });
  }
  if (a.discourseTells?.thematicBreaks?.hot) {
    rows.push({ signal: 'discourse: thematic-breaks', label: '장식용 구분선 남용', severity: 'LOW', location: `${a.discourseTells.thematicBreaks.count}개` });
  }
  if (a.structuralClassifier?.hot) {
    rows.push({ signal: 'structural-classifier', label: '문서 단위 구조 분류기', severity: 'HIGH', location: `score ${a.structuralClassifier.score}` });
  }

  const koPostEditeseRows = buildKoPostEditeseAdvisoryRows(a.koPostEditese);
  if (rows.length === 0 && translationeseRows.length === 0 && koPostEditeseRows.length === 0) return '';

  const lines = [
    '## 결정적 신호 (deterministic backstop — 모델과 무관하게 항상 검사)',
  ];
  if (rows.length > 0) {
    lines.push(
      '',
      '| 신호 | 설명 | 심각도 | 위치 |',
      '|------|------|--------|------|',
      ...rows.map((r) => renderMarkdownTableRow([r.signal, r.label, r.severity, r.location])),
    );
  }
  if (translationeseRows.length > 0) {
    lines.push(
      '',
      '### Korean translationese editing hints',
      '',
      '| signal | matched sample | editing hint |',
      '|--------|----------------|--------------|',
      ...translationeseRows.map((r) => renderMarkdownTableRow([r.signal, r.location, r.hint])),
    );
  }
  if (koPostEditeseRows.length > 0) {
    lines.push(
      '',
      '### koPostEditese.v1 편집 참고 원시 지표',
      '',
      '| metric | value | editing hint |',
      '|--------|-------|--------------|',
      ...koPostEditeseRows.map((r) => renderMarkdownTableRow([r.metric, formatAdvisoryValue(r.value), r.hint])),
    );
  }

  return `\n\n${lines.join('\n')}`;
}

function buildKoPostEditeseAdvisoryRows(payload) {
  if (!payload?.analyzed || payload.schema !== 'koPostEditese.v1') return [];
  const metrics = payload.metrics ?? {};
  return [
    { metric: 'lexical.tokenCount', value: metrics.lexical?.tokenCount, hint: '표본 크기를 확인하고 짧은 글에서는 다른 지표를 과해석하지 않는다.' },
    { metric: 'lexical.ttr', value: metrics.lexical?.ttr, hint: '반복 어휘가 많으면 같은 뜻의 한국어 표현으로 압축한다.' },
    { metric: 'lexical.endingDiversity', value: metrics.lexical?.endingDiversity, hint: '문장 끝맺음이 단조로우면 종결형을 섞어 읽는 리듬을 다듬는다.' },
    { metric: 'endings.declarativeDaRatio', value: metrics.endings?.declarativeDaRatio, hint: "'다/한다/된다/이다' 종결이 몰리면 일부 문장을 자연스러운 구어·서술형으로 바꾼다." },
    { metric: 'endings.endingStreakMax', value: metrics.endings?.endingStreakMax, hint: '같은 종결형이 연속되면 문장 순서나 연결 방식을 손본다.' },
    { metric: 'interference.pronounLiteralCount', value: metrics.interference?.pronounLiteralCount, hint: "'당신/그것/이것' 직역 대명사는 생략하거나 구체 명사로 바꾼다." },
    { metric: 'interference.byPassiveCount', value: metrics.interference?.byPassiveCount, hint: "'~에 의해' 피동은 가능한 한 행위자 주어 능동문으로 고친다." },
    { metric: 'interference.lightVerbCount', value: metrics.interference?.lightVerbCount, hint: "'~을 하다/가지다' 류는 더 직접적인 동사나 형용사로 줄인다." },
    { metric: 'interference.progressiveAspectCount', value: metrics.interference?.progressiveAspectCount, hint: "'~하고 있다' 진행상은 실제 진행이 아니면 단순 현재로 줄인다." },
    { metric: 'rhythm.meanSentenceEojeols', value: metrics.rhythm?.meanSentenceEojeols, hint: '문장이 길게 늘어지면 한 생각 단위로 끊는다.' },
    { metric: 'rhythm.commaPerSentence', value: metrics.rhythm?.commaPerSentence, hint: '쉼표가 많으면 접속 구조를 문장 분리나 조사로 정리한다.' },
    { metric: 'rhythm.suffixDiversity', value: metrics.rhythm?.suffixDiversity, hint: '연결 어미 선택이 좁으면 문장 연결 방식을 다양화한다.' },
  ].filter((row) => row.value !== undefined && row.value !== null);
}

function formatAdvisoryValue(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return String(value);
}
function renderMarkdownTableRow(cells) {
  return `| ${cells.map(escapeMarkdownTableCell).join(' | ')} |`;
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}
