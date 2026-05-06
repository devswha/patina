export function formatOutput(result, mode, _parsed, opts = {}) {
  const tone = opts.tone || null;
  let body = renderBody(result);
  if (mode === 'rewrite' || mode === 'diff' || mode === 'ouroboros') {
    body = stripSelfAudit(body);
  }
  return appendToneFooter(body, tone);
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
