export function formatOutput(result, mode, _parsed, opts = {}) {
  const tone = opts.tone || null;
  let body = renderBody(result);
  // Only rewrite and ouroboros emit [BODY]/[VARIANT n] tags; diff/audit/score
  // emit tables and don't need the extraction step.
  if (mode === 'rewrite' || mode === 'ouroboros') {
    const variants = extractVariants(body);
    body = variants.length > 0 ? formatVariants(variants, body) : stripSelfAudit(body);
  }
  return appendToneFooter(body, tone);
}

// v3.11 Phase 3.1: extract [VARIANT n]...[/VARIANT] blocks from a model
// response. Returns an array of { id, text } sorted by id, empty if no
// variant tags are present.
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
export function validateScoreWeights(output, configWeights) {
  if (!output || !configWeights || Object.keys(configWeights).length === 0) {
    return [];
  }
  const warnings = [];
  // Match table rows where the first column is a category id and the
  // second is a numeric weight. Skip header/separator rows by requiring
  // the category to start with a letter.
  const rowRe = /^\|\s*([a-z][\w-]*)\s*\|\s*([\d.]+)\s*\|/i;
  const seen = new Map();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(rowRe);
    if (!m) continue;
    const cat = m[1].toLowerCase();
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

// v3.11: rewrite/diff/ouroboros prompts ask the model to wrap user-facing
// text in [BODY]...[/BODY] and put audit notes in [SELF_AUDIT]...[/SELF_AUDIT].
// We extract the body block and drop the audit so callers get clean text.
// If the model didn't honor the tags (older runs, mocked tests, etc.), we
// fall back to returning the full output untouched.
export function stripSelfAudit(body) {
  if (!body) return body;
  const bodyOpen = body.indexOf('[BODY]');
  const bodyClose = body.indexOf('[/BODY]', bodyOpen);
  if (bodyOpen < 0 || bodyClose <= bodyOpen) {
    return body;
  }
  const inner = body.slice(bodyOpen + '[BODY]'.length, bodyClose).trim();
  const tail = body
    .slice(bodyClose + '[/BODY]'.length)
    .replace(/\[SELF_AUDIT\][\s\S]*?\[\/SELF_AUDIT\]/g, '')
    .trim();
  return tail ? `${inner}\n\n${tail}` : inner;
}

function renderBody(result) {
  if (typeof result === 'string') {
    return result.trim();
  }

  if (result?.type === 'max-mode') {
    return formatMaxModeOutput(result);
  }

  return String(result).trim();
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
  const tail = body.split(/\r?\n/).slice(-30).join('\n');
  const m = tail.match(/(^|\n)---\s*\n([\s\S]*?)\n---\s*$/);
  if (!m) return false;
  const block = m[2];
  return /\btone\s*:/.test(block)
    && /\btone_source\s*:/.test(block)
    && /\btone_evidence\s*:/.test(block)
    && /\btone_confidence\s*:/.test(block);
}

function formatMaxModeOutput(result) {
  const { candidates, best } = result;

  let output = '## MAX Mode Results\n\n';
  output += '| Model | AI Score | MPS | Status |\n';
  output += '|-------|----------|-----|--------|\n';

  for (const c of candidates) {
    const status = c.ok ? (c.model === best?.model ? '✅ best' : '✅') : '❌ failed';
    const score = c.aiScore ?? '--';
    const mps = c.mps ?? '--';
    output += `| ${c.model} | ${score} | ${mps} | ${status} |\n`;
  }

  output += `\n**Best: ${best?.model || 'none'}**\n\n`;

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
