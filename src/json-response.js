// Shared response extraction; importing it does not call a model.
class SchemaError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'SchemaError';
    this.raw = raw;
  }
}

function tryParseJson(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, value: null };
  }
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Index of the `}` that closes the `{` at `open`, ignoring braces inside JSON
// string literals (and their escapes). Returns -1 when unbalanced.
function matchingBraceEnd(str, open) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

export function parseStrictJson(text) {
  if (!text) throw new SchemaError('Empty response', text);

  let body = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) body = codeBlockMatch[1];
  body = body.trim();

  // Common case: the body is exactly one JSON object.
  const whole = tryParseJson(body);
  if (whole.ok && isJsonObject(whole.value)) return whole.value;

  // Otherwise scan every balanced {...} span and keep the RICHEST object. A
  // naive indexOf('{')..lastIndexOf('}') slice breaks when prose carries stray
  // braces, e.g. "result for {A}: {\"overall\":20}" slices from `{A}`.
  // Returning the FIRST parseable object is also wrong when a chatty model
  // emits a stray/echoed object (or an empty `{}`) before the real score —
  // that nulls a valid score without a retry. And a lone unbalanced '{' must
  // skip, not abandon the scan, or a later valid object is missed. Picking the
  // object with the most keys favors the score object (many keys) over a small
  // echo while leaving the single-object case exact.
  let best = null;
  let bestKeys = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '{') continue;
    const end = matchingBraceEnd(body, i);
    if (end === -1) continue; // this '{' never balances; a later one might
    const candidate = tryParseJson(body.slice(i, end + 1));
    if (candidate.ok && isJsonObject(candidate.value)) {
      const keys = Object.keys(candidate.value).length;
      if (keys >= 1 && keys > bestKeys) {
        best = candidate.value;
        bestKeys = keys;
      }
    }
    i = end; // skip past this span
  }
  if (best !== null) return best;

  throw new SchemaError('No JSON object found', text);
}

