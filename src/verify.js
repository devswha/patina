// @ts-check
import { scoreMPS as defaultScoreMPS, scoreFidelity as defaultScoreFidelity } from './scoring.js';
import { buildPrompt } from './prompt-builder.js';
import { stripSelfAudit } from './output.js';
import { createLogger } from './logger.js';

// Numeric tokens (integers, decimals, grouped numbers). Used by the cheap,
// LLM-free meaning guard to catch numbers that silently vanish in a rewrite.
const NUMBER_RE = /\d[\d.,]*/g;

function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(NUMBER_RE)) {
    // Normalize grouping commas (1,200 === 1200) and strip trailing separators
    // so the same number in a different format is not flagged as dropped.
    const normalized = m[0].replace(/,/g, '').replace(/\.+$/, '');
    if (normalized) out.add(normalized);
  }
  return out;
}

/**
 * Cheap, LLM-free meaning-drift heuristic for the default rewrite path. Returns
 * human-readable warning strings (never throws, never blocks output). Kept
 * deliberately conservative — only source numbers that vanish from the rewrite —
 * so the default path stays fast and free of false positives (a humanizer
 * legitimately changes length, so length is not a reliable drift signal here).
 *
 * @param {string} original
 * @param {string} rewrite
 * @returns {string[]}
 */
export function deterministicMeaningGuard(original, rewrite) {
  const warnings = [];
  const orig = String(original ?? '');
  const out = String(rewrite ?? '');

  const oNums = numbersIn(orig);
  const rNums = numbersIn(out);
  const dropped = [...oNums].filter((n) => !rNums.has(n));
  if (dropped.length > 0) {
    warnings.push(
      `numbers in the source are missing from the rewrite: ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? '…' : ''}`,
    );
  }

  return warnings;
}

// Trusted directive appended (outside the input data fence) for the conservative
// retry. The first rewrite drifted; this asks for minimal, meaning-safe edits.
const STRICT_RETRY_DIRECTIVE = [
  '',
  '## STRICT MEANING PRESERVATION (verify retry)',
  'A previous rewrite of this text drifted from the source meaning and failed the',
  'meaning-preservation floor. Rewrite again with MINIMAL changes:',
  '- Preserve every claim, number, named entity, polarity, and causal relationship exactly.',
  '- Prefer leaving a sentence unchanged over altering what it asserts.',
  '- Only remove AI-pattern wording; never rephrase content whose meaning could shift.',
  '',
].join('\n');

/**
 * Verify that a produced rewrite preserves meaning. Scores MPS + fidelity; if
 * either is below the configured floor, runs ONE conservative retry from the
 * original. If the retry still misses, returns the highest-fidelity candidate
 * with a warning (fail-closed but non-destructive — the caller still gets text).
 *
 * Transport-agnostic: `callLLM` is injected by the caller and is expected to be
 * routed through the selected backend chain, so verify works with HTTP and local
 * CLI backends alike.
 *
 * @param {object} options
 * @returns {Promise<{text: string, mps: number|null, fidelity: number, verified: boolean, retried: boolean, reason: string}>}
 */
export async function verifyRewrite({
  original,
  rewrite,
  config,
  patterns,
  profile,
  voice,
  scoring,
  apiKey,
  baseURL,
  model,
  callLLM,
  signal,
  timeout,
  logger = createLogger(),
  scoreFns = {},
}) {
  const scoreMPS = scoreFns.scoreMPS || defaultScoreMPS;
  const scoreFidelity = scoreFns.scoreFidelity || defaultScoreFidelity;
  const oc = config?.ouroboros || {};
  const mpsFloor = oc['mps-floor'] ?? 70;
  const fidelityFloor = oc['fidelity-floor'] ?? 70;

  const grade = async (text) => {
    const [mpsResult, fidelityResult] = await Promise.all([
      scoreMPS({ original, rewritten: text, apiKey, baseURL, model, callLLM, signal, timeout, logger }),
      scoreFidelity({ original, rewritten: text, apiKey, baseURL, model, callLLM, signal, timeout, logger }),
    ]);
    // Fail closed: a missing MPS stays null (treated as a floor miss); a missing
    // fidelity clamps to 0, matching scoreFidelity's own behavior.
    return { mps: mpsResult?.mps ?? null, fidelity: fidelityResult?.fidelity ?? 0 };
  };
  const passes = (s) => s.mps !== null && s.mps >= mpsFloor && s.fidelity >= fidelityFloor;

  const first = await grade(rewrite);
  if (passes(first)) {
    return { text: rewrite, mps: first.mps, fidelity: first.fidelity, verified: true, retried: false, reason: 'passed' };
  }
  logger.warn?.('verify.retry', {
    message: `[patina] verify: rewrite below floor (MPS ${first.mps ?? 'n/a'}, fidelity ${first.fidelity}); retrying with stricter meaning preservation…`,
  });

  const retryPrompt = buildPrompt({
    config,
    patterns,
    profile,
    voice,
    scoring,
    text: original,
    mode: 'rewrite',
    includeSelfAudit: false,
  }) + STRICT_RETRY_DIRECTIVE;

  let retryText;
  try {
    const raw = await callLLM({ prompt: retryPrompt, apiKey, baseURL, model, signal, timeout });
    retryText = stripSelfAudit(raw, { logger });
  } catch (err) {
    logger.warn?.('verify.retry_failed', {
      message: `[patina] verify: retry call failed (${/** @type {any} */ (err)?.message || err}); keeping the first rewrite.`,
    });
    return { text: rewrite, mps: first.mps, fidelity: first.fidelity, verified: false, retried: true, reason: 'retry-error' };
  }

  const second = await grade(retryText);
  if (passes(second)) {
    return { text: retryText, mps: second.mps, fidelity: second.fidelity, verified: true, retried: true, reason: 'passed-on-retry' };
  }

  // Fail-closed but non-destructive: emit the highest-fidelity candidate (closest
  // to the source meaning), tie-broken by higher MPS, with a loud warning.
  const candidates = [
    { text: rewrite, mps: first.mps, fidelity: first.fidelity },
    { text: retryText, mps: second.mps, fidelity: second.fidelity },
  ];
  candidates.sort((a, b) => (b.fidelity - a.fidelity) || ((b.mps ?? -1) - (a.mps ?? -1)));
  const best = candidates[0];
  logger.warn?.('verify.failed', {
    message: `[patina] verify: meaning floors not met after a retry (best MPS ${best.mps ?? 'n/a'}, fidelity ${best.fidelity}; floors ${mpsFloor}/${fidelityFloor}). Emitting the closest candidate — review the meaning before publishing.`,
  });
  return { text: best.text, mps: best.mps, fidelity: best.fidelity, verified: false, retried: true, reason: 'floor-not-met' };
}
