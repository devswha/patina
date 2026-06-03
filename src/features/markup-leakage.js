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
    build: () => /\bas an? (?:AI|artificial intelligence) language model\b|\bas a large language model\b|\bas a language model\b|\bas an AI assistant\b|\bI am an AI\b|\bI'?m an AI\b/gi,
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
