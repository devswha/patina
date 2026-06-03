// @ts-check
import { createLogger } from './logger.js';

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
 * @returns {string} User-facing formatted output.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const output = formatOutput('[BODY]Hi[/BODY]', 'rewrite');
 */
export function formatOutput(result, mode, parsed = {}, opts = {}) {
  const tone = opts.tone || null;
  const format = parsed.format || 'markdown';
  const body = renderFormattedBody(result, mode, parsed, opts);

  if (format === 'json') {
    return formatJsonOutput({ result, mode, body, tone, gate: parsed.gate });
  }

  if (format === 'text') {
    return formatTextOutput(body, tone);
  }

  return appendToneFooter(body, tone);
}

function renderFormattedBody(result, mode, parsed = {}, opts = {}) {
  let body = renderBody(result);
  // Only rewrite and ouroboros emit [BODY]/[VARIANT n] tags; diff/audit/score
  // emit tables and don't need the extraction step.
  if (mode === 'rewrite' || mode === 'ouroboros') {
    const variants = extractVariants(body);
    body = variants.length > 0 ? formatVariants(variants, body) : stripSelfAudit(body, { logger: opts.logger });
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

function shouldColorDiff(/** @type {{ parsed?: { noColor?: boolean }, env?: Record<string, string|undefined>, stdout?: { isTTY?: boolean } }} */ { parsed = {}, env = process.env, stdout = process.stdout } = {}) {
  return !parsed.noColor && env.NO_COLOR === undefined && stdout?.isTTY === true;
}

// v3.11 Phase 3.1: extract [VARIANT n]...[/VARIANT] blocks from a model
// response. Returns an array of { id, text } sorted by id, empty if no
// variant tags are present.
/**
 * Extract tagged [VARIANT n] blocks from a model response.
 *
 * @param {string} body Raw model response.
 * @returns {Array<{id: number, text: string}>} Variants sorted by numeric id.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const variants = extractVariants('[VARIANT 1]\nHello\n[/VARIANT]');
 */
export function extractVariants(body) {
  if (!body) return [];
  const re = /\[VARIANT\s*(\d+)\]\s*\n([\s\S]*?)\n\s*\[\/VARIANT\]/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const id = parseInt(m[1], 10);
    const text = m[2].trim();
    if (text) out.push({ id, text });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function formatVariants(variants, raw) {
  // Surface each variant with a labeled header so users can copy whichever
  // voice they want. Strip [SELF_AUDIT] and any tail metadata that follows
  // the last [/VARIANT] block, but preserve the YAML footer if present.
  const lastClose = raw.lastIndexOf('[/VARIANT]');
  const tail = lastClose >= 0
    ? raw.slice(lastClose + '[/VARIANT]'.length).replace(/\[SELF_AUDIT\][\s\S]*?\[\/SELF_AUDIT\]/g, '').trim()
    : '';
  const blocks = variants.map(({ id, text }) => `## Variant ${id}\n\n${text}`);
  const merged = blocks.join('\n\n');
  return tail ? `${merged}\n\n${tail}` : merged;
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
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
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
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
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
        message: `[patina] warning: model output omitted [BODY] tags (${body.length} chars); stripped [SELF_AUDIT]. Re-run with --prompt-mode strict if the output looks wrong.`,
      });
      return stripped;
    }
    return body;
  }
  const inner = body.slice(bodyOpen + '[BODY]'.length, bodyClose).trim();
  const tail = removeSelfAuditBlocks(body.slice(bodyClose + '[/BODY]'.length)).trim();
  return tail ? `${inner}\n\n${tail}` : inner;
}

function removeSelfAuditBlocks(body) {
  return String(body || '').replace(/\[SELF_AUDIT\][\s\S]*?\[\/SELF_AUDIT\]/g, '');
}

function renderBody(result) {
  if (typeof result === 'string') {
    return result.trim();
  }

  if (result && typeof result === 'object' && 'raw' in result) {
    return String(result.raw).trim();
  }

  if (result?.type === 'max-mode') {
    return formatMaxModeOutput(result);
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

function formatTextOutput(body, tone) {
  const lines = [body.trim()];
  if (tone?.tone_source) {
    lines.push(
      '',
      `Tone: ${tone.tone === null || tone.tone === undefined ? 'profile-only' : tone.tone} (${tone.tone_source})`
    );
  }
  return lines.join('\n').trimEnd();
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

  if (result?.type === 'max-mode') {
    payload.max = {
      allFailed: Boolean(result.allFailed),
      mpsFallback: Boolean(result.mpsFallback),
      best: result.best ? {
        model: result.best.model,
        aiScore: result.best.aiScore ?? null,
        mps: result.best.mps ?? null,
      } : null,
      candidates: result.candidates.map((candidate) => ({
        model: candidate.model,
        ok: Boolean(candidate.ok),
        aiScore: candidate.aiScore ?? null,
        mps: candidate.mps ?? null,
        error: candidate.error ?? null,
      })),
    };
  }

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
  const direct = toFiniteNumber(result?.overall);
  if (direct !== null) return direct;
  const parsed = parseFirstJson(body) || (typeof result === 'string' ? parseFirstJson(result) : null);
  const parsedOverall = toFiniteNumber(parsed?.overall);
  if (parsedOverall !== null) return parsedOverall;
  const overallFromTable = String(body || '').match(/(?:^|\n)\|\s*(?:\*\*)?Overall(?:\*\*)?\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(?:\*\*)?([0-9]+(?:\.[0-9]+)?)/i);
  if (overallFromTable) return Number(overallFromTable[1]);
  const overallFromText = String(body || '').match(/(?:^|[\s{,"])overall(?:["\s]*[:|]|\s+score\s*[:|]?)\s*(\d+(?:\.\d+)?)/i);
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

function parseFirstJson(text) {
  if (!text || typeof text !== 'string') return null;
  const candidates = [
    text.trim(),
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1],
    text.match(/\{[\s\S]*\}/)?.[0],
  ].filter(Boolean);
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

function formatMaxModeOutput(result) {
  const { candidates, best } = result;

  let output = '## MAX Mode Results\n\n';
  if (result.timedOut) {
    output += '⚠ MAX wall-clock timeout reached; showing partial results.\n\n';
  }
  output += '| Model | AI Score | MPS | Status |\n';
  output += '|-------|----------|-----|--------|\n';

  for (const c of candidates) {
    const status = c.ok ? (c.model === best?.model ? '✅ best' : '✅') : '❌ failed';
    const score = c.aiScore ?? '--';
    const mps = c.mps ?? '--';
    output += `| ${c.model} | ${score} | ${mps} | ${status} |\n`;
  }

  output += `\n**Best: ${best?.model || 'none'}**\n\n`;

  if (result.allFailed) {
    output += '> No MAX candidate produced a scoreable result. Exit code: 4.\n\n';
  } else if (result.mpsFallback) {
    output += '⚠ No candidate passed MPS ≥ 70 — selecting by highest MPS (fallback)\n\n';
    output += '> Exit code: 4.\n\n';
  }

  if (best?.result) {
    output += '### Final Text\n\n';
    output += best.result.trim();
    output += '\n\n';
  }

  for (const c of candidates) {
    if (c.model !== best?.model && c.ok && c.result) {
      output += `\n<details>\n<summary>${c.model} result</summary>\n\n`;
      output += c.result.trim();
      output += '\n</details>\n';
    }
  }

  return output;
}
