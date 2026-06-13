// Deterministic detection of model-output *leakage* artifacts: tokens that LLM
// web-search / tooling inject and that essentially never appear in human-written
// prose. Unlike the stylometry/lexicon signals (which are probabilistic and
// fire on clusters), a single hit here is near-proof-grade evidence of pasted
// model output, so it fires hard at the document level. See issue #332.
//
// Language-agnostic literal token set — applies to ko/en/zh/ja alike.
//
// Self-scan caveat: patina's own docs, fixtures, and issues that *discuss* these
// tokens will match. That is correct behavior (the text genuinely contains
// them); callers scanning the repo's own meta-content should expect hits.

/**
 * Score floor applied when deterministic markup-leakage is detected.
 *
 * Model-output leakage (issue #332) is near-proof-grade: a single token that
 * LLM tooling injects and humans never type. Unlike the stylometric/lexical
 * signals it is decisive on its own, so any hit short-circuits the deterministic
 * `overall` into the 'heavily AI' band (>70) regardless of the per-paragraph
 * hot ratio. It is a floor, not a hard 100, because the surrounding prose may
 * still be genuinely human and we avoid claiming absolute proof.
 *
 * Lives here — the browser-pure module that owns leakage detection — so both
 * src/scoring.js and playground/analyzer.js consume the same constant
 * (threshold parity gate: tests/unit/threshold-parity.test.js).
 *
 * @type {number}
 */
export const LEAKAGE_SCORE_FLOOR = 90;

const OBJECT_REPLACEMENT_CHAR = '￼';

// Each entry: { id, label, build() => fresh RegExp }. We build a fresh regex per
// scan so the shared module is reentrant (no leaking lastIndex across calls).
const MARKUP_RULES = [
  {
    id: 'oai-citation-markup',
    label: 'OpenAI citation markup',
    build: () => /:contentReference|oaicite|oai_citation/gi,
  },
  {
    id: 'model-tool-token',
    label: 'Model tool token',
    build: () => /\bturn\d+(?:search|view|news|image|forecast|finance|fetch)\d*\b|\bnavlist\b|\bgrok_card\b/gi,
  },
  {
    id: 'object-replacement-char',
    label: 'Object-replacement character (￼)',
    build: () => new RegExp(OBJECT_REPLACEMENT_CHAR, 'g'),
  },
  {
    id: 'ai-tracking-param',
    label: 'AI-tool tracking parameter in URL',
    build: () => /utm_source=(?:chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)|[?&](?:ref|utm_source)=chatgpt/gi,
  },
  {
    id: 'explicit-self-identification',
    label: 'Explicit AI self-identification',
    // Near-proof-grade, so precision beats recall (issue #435): a single hit
    // forces LEAKAGE_SCORE_FLOOR. Human bio/ML prose must not fire:
    // - "I am an AI researcher" / "I'm an AI safety engineer": \b alone sits
    //   between "AI" and the next noun, so the bare phrase needs a guard. The
    //   "I am/I'm an AI" alternant (optionally with an AI-role noun:
    //   assistant/chatbot/model) only matches when the phrase ends the clause
    //   (punctuation/EOL) or continues with refusal-boilerplate provenance
    //   ("created/trained/developed ... by"), and never before "-"/"/"
    //   compounds like "AI-powered" or "AI/ML". Human job titles such as
    //   "AI assistant manager" stay cold.
    // - "BERT functions as a language model": the bare alternant now requires
    //   the first-person continuation ("as a language model, I ...") that
    //   real refusal boilerplate uses.
    build: () => /\bas an? (?:AI|artificial intelligence) language model\b|\bas a large language model\b|\bas a language model,? I\b|\bas an AI assistant\b|\bI(?: am|'?m) an AI(?:\s+(?:assistant|chatbot|language model|model))?(?:\s+(?:created|developed|trained|designed|built|made)\s+by\b|(?![-/]|\s+\w))/gi,
  },
];

/**
 * Scan raw text for model-output leakage artifacts.
 * @param {string} text
 * @returns {{ leaked: boolean, hits: Array<{id:string,label:string,count:number,samples:string[]}> }}
 */
export function detectMarkupLeakage(text) {
  const str = typeof text === 'string' ? text : '';
  const hits = [];
  if (!str) return { leaked: false, hits };

  for (const rule of MARKUP_RULES) {
    const matches = str.match(rule.build());
    if (matches && matches.length > 0) {
      hits.push({
        id: rule.id,
        label: rule.label,
        count: matches.length,
        samples: [...new Set(matches.map((m) => m.trim()).filter(Boolean))].slice(0, 3),
      });
    }
  }
  return { leaked: hits.length > 0, hits };
}

export { MARKUP_RULES, OBJECT_REPLACEMENT_CHAR };
