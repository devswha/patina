// @ts-check
import { createLogger } from './logger.js';
import { analyzeText, loadStructuralModel } from './features/index.js';
import { TRANSLATIONESE_RULES } from './features/translationese.js';

/**
 * Format a raw backend result for CLI output mode and requested format.
 *
 * @param {string|object} result Backend result or structured mode result.
 * @param {string} mode Output mode: rewrite, diff, audit, or score.
 * @param {object} [parsed={}] Parsed CLI options.
 * @param {object} [opts={}] Formatting options.
 * @param {object|null} [opts.register] Explicit register metadata.
 * @param {import('./logger.js').Logger} [opts.logger] Logger for output warnings.
 * @param {object} [opts.env] Environment map for color decisions.
 * @param {object} [opts.stdout] Stdout-like stream for color decisions.
 * @param {string} [opts.auditBackstop] Deterministic audit-mode section.
 * @param {object|null} [opts.persona] Persona metadata to append.
 * @param {object|null} [opts.inspection] Source-bound deterministic audit diagnostics.
 * @param {object|null} [opts.verification] Runtime --verify evidence, never model-emitted metadata.
 * @returns {string} User-facing formatted output.
 * @throws {TypeError} When JSON output carries unserializable values.
 * @example
 * const output = formatOutput('[BODY]Hi[/BODY]', 'rewrite');
 */
export function formatOutput(result, mode, parsed = {}, opts = {}) {
  const rewriteOutput = mode === 'rewrite'
    ? splitRewriteOutput(result, { logger: opts.logger })
    : null;
  const register = resolveOutputRegister(opts.register || null, rewriteOutput?.register || null);
  const persona = opts.persona || null;
  const format = parsed.format || 'markdown';
  let body = rewriteOutput?.body ?? renderFormattedBody(result, mode, parsed, opts);

  if (mode === 'audit' && format !== 'json' && opts.auditBackstop) {
    body += opts.auditBackstop;
  }
  if (format === 'json') {
    return formatJsonOutput({ result, mode, body, register, gate: parsed.gate, persona, inspection: opts.inspection,
      verification: mode === 'rewrite' && parsed.verify ? opts.verification : null });
  }
  return formatTextOutput(body);
}

function renderFormattedBody(result, mode, parsed = {}, opts = {}) {
  let body = renderBody(result);
  if (mode === 'diff' && (parsed.format || 'markdown') !== 'json') {
    // Skip ANSI colorization for JSON output, otherwise raw escape codes get
    // embedded inside the JSON `output` string field on a TTY (#449).
    body = colorizeDiff(body, { parsed, env: opts.env, stdout: opts.stdout });
  }
  return body;
}

function resolveOutputRegister(requested, emitted) {
  return requested || emitted || null;
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
 * @param {import('./config.js').PatinaConfig} configWeights Expected category weight map.
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

// v3.11: rewrite/diff prompts ask the model to wrap user-facing
// text in [BODY]...[/BODY] and put audit notes in [SELF_AUDIT]...[/SELF_AUDIT].
// We extract the body block and drop the audit so callers get clean text.
// If the model didn't honor the tags (older runs, mocked tests, etc.), we
// fall back to returning the full output untouched.
/**
 * Remove SELF_AUDIT blocks and unwrap the BODY block from rewrite output.
 *
 * @param {string} body Raw model response.
 * @param {object} [options] Strip options.
 * @param {import('./logger.js').Logger} [options.logger] Logger for malformed output warnings.
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
function splitRewriteOutput(result, { logger = createLogger() } = {}) {
  // Strip model scaffolding and any trailing register footer. Stdout remains
  // prose-only; JSON retains structured register metadata.
  const stripped = stripSelfAudit(renderBody(result), { logger }).trim();
  const footer = locateRegisterFooter(stripped);
  if (!footer) return { body: stripped, register: null };
  return {
    body: footer.lines.slice(0, footer.start).join('\n').trimEnd(),
    register: parseRegisterFooter(footer.block),
  };
}

export function cleanRewriteOutput(result, { logger = createLogger() } = {}) {
  return splitRewriteOutput(result, { logger }).body;
}

export function formatRewriteBodyForBrowser(result, { logger = createLogger() } = {}) {
  return cleanRewriteOutput(result, { logger });
}

function removeSelfAuditBlocks(body) {
  return String(body || '').replace(/\[SELF_AUDIT\][\s\S]*?\[\/SELF_AUDIT\]/g, '');
}

function parseRegisterFooter(block) {
  const fields = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*(register|register_source|register_evidence|register_confidence)\s*:\s*(.*?)\s*$/u);
    if (match) fields[match[1]] = match[2];
  }
  let evidence = [];
  try {
    const parsed = JSON.parse(fields.register_evidence ?? '[]');
    if (Array.isArray(parsed)) evidence = parsed;
  } catch {
    evidence = [];
  }
  return {
    register: parseRegisterScalar(fields.register),
    register_source: parseRegisterScalar(fields.register_source),
    register_evidence: evidence,
    register_confidence: parseRegisterScalar(fields.register_confidence),
  };
}

function parseRegisterScalar(raw) {
  if (raw === undefined || /^(?:null|~)$/iu.test(raw)) return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(raw)) return Number(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
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

function formatJsonOutput({ result, mode, body, register, gate, persona, inspection, verification }) {
  const overall = extractOverall(result, body);
  const scoreDetails = extractScoreDetails(result);
  const payload = {
    mode,
    format: 'json',
    overall,
    categories: extractCategories(result, body),
    register: register ? {
      register: register.register ?? null,
      register_source: register.register_source ?? null,
      register_evidence: Array.isArray(register.register_evidence) ? register.register_evidence : [],
      register_confidence: register.register_confidence ?? null,
    } : null,
    mps: extractMps(result, body),
    gateResult: buildGateResult(overall, gate),
    persona: persona || null,
    output: body,
    ...(verification ? { verification: {
      verified: verification.verified, mps: verification.mps, fidelity: verification.fidelity,
      retried: verification.retried, reason: verification.reason,
      mpsFloor: verification.mpsFloor, fidelityFloor: verification.fidelityFloor,
      outputHash: verification.outputHash,
    } } : {}),
    ...(mode === 'audit' && inspection ? { inspection } : {}),
    ...(scoreDetails ? { scores: scoreDetails } : {}),
  };


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
 * above and by the CLI score gate (src/cli/score-gate.js). Both call sites now
 * use strict numeric coercers (toFiniteNumber here, toFiniteScore in the score
 * gate) that accept a plain numeric token and reject anything else (#505); the
 * coercer stays a parameter so each site keeps its own small differences (e.g.
 * the gate's empty-string handling).
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
  // Strict parse: accept a plain numeric token (incl. exponent notation like
  // "1e3") and reject anything else to null. Deleting non-numeric characters
  // and re-parsing the residue silently salvaged junk ("1e3"→13, "12px"→12,
  // "12abc34"→1234, "8%"→8), which could flip the --format json score gate via
  // buildGateResult (#505). Markdown table cells are de-bolded before reaching
  // here (parseMarkdownCategories strips ** first), so strictness is safe.
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === '') return null;
  const n = Number(str);
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
    // Each balanced {...} span in order, not a greedy first-{..last-} slice
    // (which grabs stray braces like "result {A}: {\"overall\":7}") (#527 H10).
    ...balancedBraceSpans(text),
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

// Collect each balanced {...} substring in order, ignoring braces inside JSON
// string literals. Bounded by text length; runs only on model output.
function balancedBraceSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) continue;
    spans.push(text.slice(i, end + 1));
    i = end;
  }
  return spans;
}


function locateRegisterFooter(body) {
  if (!body) return null;
  const lines = String(body).split(/\r?\n/u);
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') end--;

  let closingFence = -1;
  if (end >= 0 && isCodeFence(lines[end])) {
    closingFence = end;
    end--;
    while (end >= 0 && lines[end].trim() === '') end--;
  }
  if (end < 0 || normalizeFooterLine(lines[end]).trim() !== '---') return null;

  const close = end;
  const lowerBound = Math.max(0, close - 29);
  for (let start = close - 1; start >= lowerBound; start--) {
    if (normalizeFooterLine(lines[start]).trim() !== '---') continue;
    const block = lines
      .slice(start + 1, close)
      .map(normalizeFooterLine)
      .join('\n');
    const registerFooter =
      /\bregister\s*:/.test(block)
      && /\bregister_source\s*:/.test(block)
      && /\bregister_evidence\s*:/.test(block)
      && /\bregister_confidence\s*:/.test(block);
    if (!registerFooter) continue;
    const openingFence = start > 0 && isCodeFence(lines[start - 1]) ? start - 1 : start;
    return {
      lines,
      start: openingFence,
      end: closingFence >= 0 ? closingFence : close,
      block,
    };
  }
  return null;
}

function normalizeFooterLine(line) {
  return String(line || '').replace(/^\s*>\s?/u, '').trimEnd();
}

function isCodeFence(line) {
  return /^\s*(?:>\s*)?```[\w-]*\s*$/u.test(String(line || ''));
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
 * @param {import('./config.js').PatinaConfig} [opts.config]
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
