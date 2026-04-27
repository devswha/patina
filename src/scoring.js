import { callLLM } from './api.js';

function extractJson(text) {
  if (!text) return null;

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1];
  }

  text = text.trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return null;
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

  const result = await callLLM({
    prompt,
    apiKey,
    baseURL,
    model,
    temperature: 0.1,
  });

  try {
    const cleaned = extractJson(result);
    if (cleaned) {
      return JSON.parse(cleaned);
    }
    return { raw: result, overall: null };
  } catch {
    return { raw: result, overall: null };
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

  const result = await callLLM({
    prompt,
    apiKey,
    baseURL,
    model,
    temperature: 0.1,
  });

  try {
    const cleaned = extractJson(result);
    if (cleaned) {
      return JSON.parse(cleaned);
    }
    return { mps: null, raw: result };
  } catch {
    return { mps: null, raw: result };
  }
}

export function interpretScore(score) {
  if (score <= 15) return 'human';
  if (score <= 30) return 'mostly human';
  if (score <= 50) return 'mixed';
  if (score <= 70) return 'AI-like';
  return 'heavily AI';
}
