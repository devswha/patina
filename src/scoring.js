import { callLLM } from './api.js';

class SchemaError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'SchemaError';
    this.raw = raw;
  }
}

function parseStrictJson(text) {
  if (!text) throw new SchemaError('Empty response', text);

  let body = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) body = codeBlockMatch[1];
  body = body.trim();

  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new SchemaError('No JSON object found', text);
  }

  try {
    return JSON.parse(body.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    throw new SchemaError(`JSON parse failed: ${e.message}`, text);
  }
}

// Call LLM and parse strict JSON. On schema failure, retry once at temperature 0.
async function callAndParseJson({ prompt, apiKey, baseURL, model, temperature = 0.1 }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = attempt === 0 ? temperature : 0;
    const result = await callLLM({ prompt, apiKey, baseURL, model, temperature: t });
    try {
      return { parsed: parseStrictJson(result), raw: result };
    } catch (e) {
      lastError = e;
      if (attempt === 0) {
        console.error(`[patina] score JSON parse failed (${e.message}); retrying at temperature 0`);
      }
    }
  }
  throw lastError;
}

export async function scoreText({ text, config, patterns, apiKey, baseURL, model }) {
  const lang = config.language || 'ko';
  const weights = config.ouroboros?.['category-weights']?.[lang] || {};

  const prompt = `You are an AI-likeness scoring engine. Score the following text for AI-writing patterns.

## Scoring Rules

Severity per detection: Low=1, Medium=2, High=3 points.

Category weights for ${lang}:
${Object.entries(weights).map(([cat, w]) => `- ${cat}: ${w}`).join('\n')}

Per-category score = (sum of adjusted severities / (pattern_count × 3)) × 100
Overall = weighted average of category scores.

## Output Format (strict)

Return ONLY a JSON object in this exact format (no markdown, no explanation):

{
  "categories": {
    "content": {"detected": 0, "sum": 0, "max": 18, "score": 0.0, "weighted": 0.0},
    ...
  },
  "overall": 0.0,
  "interpretation": "human | mostly human | mixed | AI-like | heavily AI"
}

## Text to Score

${text}
`;

  try {
    const { parsed } = await callAndParseJson({ prompt, apiKey, baseURL, model });
    return parsed;
  } catch (e) {
    console.error(`[patina] scoreText schema failure after retry: ${e.message}`);
    return { overall: null, error: 'schema-failure', raw: e.raw };
  }
}

export async function scoreMPS({ original, rewritten, apiKey, baseURL, model }) {
  const prompt = `You are a Meaning Preservation evaluator. Compare the ORIGINAL text with the REWRITTEN text.

Extract semantic anchors from the original (claims, polarity, causation, quantifiers, negations) and check if each is preserved in the rewritten text.

Verdict per anchor: PASS | SOFT_FAIL | HARD_FAIL

Return ONLY a JSON object:

{
  "anchors": [
    {"type": "claim", "content": "...", "verdict": "PASS"}
  ],
  "pass_count": 0,
  "total_count": 0,
  "polarity_pass_count": 0,
  "polarity_total_count": 0,
  "mps": 0.0
}

MPS formula: (pass_rate × 0.6 + polarity_preserved × 0.4) × 100
If no polarity anchors: MPS = pass_rate × 100

## Original

${original}

## Rewritten

${rewritten}
`;

  try {
    const { parsed } = await callAndParseJson({ prompt, apiKey, baseURL, model });
    return parsed;
  } catch (e) {
    console.error(`[patina] scoreMPS schema failure after retry: ${e.message}`);
    return { mps: null, error: 'schema-failure', raw: e.raw };
  }
}

export function interpretScore(score) {
  if (score <= 15) return 'human';
  if (score <= 30) return 'mostly human';
  if (score <= 50) return 'mixed';
  if (score <= 70) return 'AI-like';
  return 'heavily AI';
}

// Length ratio is deterministic — bucket per core/scoring.md §10.4.
function lengthRatioPoints(original, rewritten) {
  if (!original || original.length === 0) return 3;
  const ratio = (rewritten.length / original.length) * 100;
  if (ratio >= 70 && ratio <= 130) return 3;
  if ((ratio >= 50 && ratio < 70) || (ratio > 130 && ratio <= 150)) return 2;
  if ((ratio >= 30 && ratio < 50) || (ratio > 150 && ratio <= 200)) return 1;
  return 0;
}

export async function scoreFidelity({ original, rewritten, apiKey, baseURL, model }) {
  // Length is deterministic; only ask LLM for the three judgment criteria.
  const lengthPoints = lengthRatioPoints(original, rewritten);
  const lengthRatio = original ? Math.round((rewritten.length / original.length) * 100) : 100;

  const prompt = `You are a Fidelity evaluator. Compare ORIGINAL vs REWRITTEN text and score three criteria.

Each criterion: 0-3 points. High=3 (preserved), Medium=2 (minor drift), Low=1 (noticeable drift), Fail=0 (broken).

Criteria:
1. claims_preserved — every factual claim in ORIGINAL appears (perhaps rephrased) in REWRITTEN.
2. no_fabrication — REWRITTEN does not add claims/facts not present in ORIGINAL.
3. tone_match — register/formality of REWRITTEN matches ORIGINAL.

Return ONLY this JSON, no markdown:

{
  "claims_preserved": 0,
  "no_fabrication": 0,
  "tone_match": 0,
  "rationale": "one sentence per criterion"
}

## ORIGINAL

${original}

## REWRITTEN

${rewritten}
`;

  let parsed = null;
  let schemaError = null;
  try {
    const result = await callAndParseJson({ prompt, apiKey, baseURL, model });
    parsed = result.parsed;
  } catch (e) {
    console.error(`[patina] scoreFidelity schema failure after retry: ${e.message}`);
    schemaError = e;
  }

  const claims = clamp03(parsed?.claims_preserved);
  const noFab = clamp03(parsed?.no_fabrication);
  const tone = clamp03(parsed?.tone_match);
  const fidelity = ((claims + noFab + tone + lengthPoints) / 12) * 100;

  return {
    criteria: {
      claims_preserved: claims,
      no_fabrication: noFab,
      tone_match: tone,
      length_ratio: lengthPoints,
    },
    length_ratio_pct: lengthRatio,
    rationale: parsed?.rationale ?? null,
    fidelity: Math.round(fidelity * 10) / 10,
    ...(schemaError ? { error: 'schema-failure', raw: schemaError.raw } : {}),
  };
}

function clamp03(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return Math.round(n);
}

// Combined score per core/scoring.md §13: AI-likeness × ai_weight + (100 - fidelity) × fidelity_weight.
// Lower is better. Falls back to default weights if profile not configured.
export function combinedScore({ aiLikeness, fidelity, profile, config }) {
  const profileWeights = config?.ouroboros?.['combined-weights']?.[profile];
  const ai = profileWeights?.['ai-likeness'] ?? 0.6;
  const fid = profileWeights?.fidelity ?? 0.4;
  const fidelityInverted = 100 - fidelity;
  return Math.round((aiLikeness * ai + fidelityInverted * fid) * 10) / 10;
}
