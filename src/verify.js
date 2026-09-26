// @ts-check
import { scoreMPS as defaultScoreMPS, scoreFidelity as defaultScoreFidelity } from './scoring.js';
import { buildPrompt } from './prompt-builder.js';
import { cleanRewriteOutput } from './output.js';
import { createLogger } from './logger.js';
import { evaluateVerification, validateMps, validateFidelityResult } from './verification-schema.js';
import { evaluateNumberSafety } from './features/meaning-proxy.js';

// Numeric tokens (integers, decimals, grouped numbers). Used by the cheap,
// LLM-free meaning guard to catch numbers that silently vanish in a rewrite.
const NUMBER_RE = /\d[\d.,]*/g;
// Valid thousands grouping only (1,200 / 1,234,567 / 1,234.56). Non-standard
// grouping like 1,2 or 3,14 is intentionally NOT stripped so it never collapses
// onto 12 / 314 and masks a genuinely dropped number on the enforcing guard.
const GROUPED_THOUSANDS_RE = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(NUMBER_RE)) {
    // Normalize valid grouping commas (1,200 === 1200) and strip trailing
    // separators so the same number in a different format is not flagged as
    // dropped; non-standard grouping (1,2) is preserved to avoid false negatives.
    const raw = m[0].replace(/\.+$/, '');
    const normalized = GROUPED_THOUSANDS_RE.test(raw) ? raw.replace(/,/g, '') : raw;
    if (normalized) out.add(normalized);
  }
  return out;
}

/**
 * Source numbers that vanish from the rewrite. Deterministic, LLM-free — the raw
 * signal behind {@link deterministicMeaningGuard} and the persona safety gate's
 * dropped-numbers check.
 *
 * @param {string} original
 * @param {string} rewrite
 * @returns {string[]}
 */
export function droppedNumbers(original, rewrite) {
  const oNums = numbersIn(String(original ?? ''));
  const rNums = numbersIn(String(rewrite ?? ''));
  return [...oNums].filter((n) => !rNums.has(n));
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
  const dropped = droppedNumbers(original, rewrite);
  if (dropped.length > 0) {
    warnings.push(
      `numbers in the source are missing from the rewrite: ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? '…' : ''}`,
    );
  }

  return warnings;
}

/**
 * CLI meaning-safety overlay. Dropped source digits keep the existing
 * `dropped-numbers` reason. Claim-bag changes that the web number-safety gate
 * already rejects (`-5`→`5`, `one`→`two`, added percents, collapsed
 * duplicates) become `numeric-claim-changed`. Unsupported syntax (`p < 0.05`)
 * is not a CLI failure — that fail-closed path stays web-only (#870).
 *
 * @param {string} original
 * @param {string} rewrite
 * @param {string} [lang]
 * @returns {{ok: boolean, reason: string|null, dropped: string[], numberSafety: ReturnType<typeof evaluateNumberSafety>}}
 */
export function assessRewriteMeaningSafety(original, rewrite, lang = 'en') {
  const dropped = droppedNumbers(original, rewrite);
  const numberSafety = evaluateNumberSafety(original, rewrite, lang);
  if (dropped.length > 0) {
    return { ok: false, reason: 'dropped-numbers', dropped, numberSafety };
  }
  if (numberSafety.reason === 'numeric_claim_changed') {
    return { ok: false, reason: 'numeric-claim-changed', dropped, numberSafety };
  }
  return { ok: true, reason: null, dropped, numberSafety };
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
 * Every option is listed because documenting only some of them would make the
 * compiler treat those as the entire parameter shape.
 *
 * @param {object} options
 * @param {string} options.original Source text the rewrite must preserve.
 * @param {string} options.rewrite Candidate rewrite to verify.
 * @param {import('./config.js').PatinaConfig} options.config Effective patina config.
 * @param {import('./loader.js').PatternPack[]} options.patterns Loaded pattern packs.
 * @param {Record<string, any>|null} options.documentType Parsed document-type policy.
 * @param {Record<string, any>|null} options.voice Parsed claim-safe voice baseline.
 * @param {Record<string, any>|null} [options.persona] Optional validated voice persona.
 * @param {ReturnType<typeof import('./config.js').resolveRegister>} [options.register] Explicit register metadata.
 * @param {Record<string, any>|null} options.scoring Parsed scoring guide.
 * @param {'strict'|'minimal'} [options.promptMode] Prompt catalog detail level.
 * @param {string[]|null} [options.documentSignals] Deterministic document measurements.
 * @param {boolean} [options.rewriteHeadings] Allow rewording Markdown headings.
 * @param {'default'|'legacy'} [options.rhetoricPolicy] Rhetoric policy forwarded to the prompt builder.
 * @param {string} [options.apiKey] Backend API key.
 * @param {string} [options.baseURL] Backend base URL.
 * @param {string} [options.model] Backend model id.
 * @param {Function} options.callLLM Injected transport-agnostic LLM client.
 * @param {AbortSignal} [options.signal] Abort signal.
 * @param {number} [options.timeout] Per-call timeout in milliseconds.
 * @param {import('./logger.js').Logger} [options.logger] patina logger.
 * @param {{scoreMPS?: Function, scoreFidelity?: Function}} [options.scoreFns] Injectable scorers.
 * @returns {Promise<{text: string, mps: number|null, fidelity: number, verified: boolean, retried: boolean, reason: string}>}
 */
export async function verifyRewrite({
  original,
  rewrite,
  config,
  patterns,
  documentType,
  voice,
  persona = null,
  register = null,
  scoring,
  promptMode = 'strict',
  documentSignals = null,
  rewriteHeadings = false,
  rhetoricPolicy = 'default',
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
  const verification = config?.verification || {};
  const mpsFloor = verification['mps-floor'] ?? 70;
  const fidelityFloor = verification['fidelity-floor'] ?? 70;

  const grade = async (text) => {
    const [mpsResult, fidelityResult] = await Promise.all([
      scoreMPS({ original, rewritten: text, apiKey, baseURL, model, callLLM, signal, timeout, logger }),
      scoreFidelity({ original, rewritten: text, apiKey, baseURL, model, callLLM, signal, timeout, logger }),
    ]);
    const gate = evaluateVerification({ mps: mpsResult, fidelity: fidelityResult }, { mpsFloor, fidelityFloor });
    // core/scoring.md: zero extracted anchors means "MPS = N/A", which src/scoring.js
    // renders as 100 because the JSON contract has no N/A and consumers fail closed on
    // null. The floor is genuinely exempt for claim-free text — but when the source
    // carries numeric claims, nothing was actually compared, so that 100 is an absence
    // of evidence and must not certify meaning preservation (a polarity inversion keeps
    // its digits and would otherwise pass). Anchored results are untouched.
    const unanchoredNumericSource = Array.isArray(mpsResult?.anchors)
      && mpsResult.anchors.length === 0
      && numbersIn(original).size > 0;
    // Keep the existing numeric CLI result and candidate-selection behavior.
    // Invalid evidence is missing, never a coercible or out-of-range score.
    let mps = null, fidelity = 0;
    try { if (mpsResult?.error == null) mps = validateMps(mpsResult).mps; } catch {}
    try { if (fidelityResult?.error == null) fidelity = validateFidelityResult(fidelityResult).fidelity; } catch {}
    return { mps, fidelity, verified: gate.ok && !unanchoredNumericSource };
  };
  const passes = (s) => s.verified;

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
    documentType,
    voice,
    persona,
    register,
    scoring,
    promptMode,
    documentSignals,
    rewriteHeadings,
    rhetoricPolicy,
    text: original,
    mode: 'rewrite',
    includeSelfAudit: false,
  }) + STRICT_RETRY_DIRECTIVE;

  let retryText;
  try {
    const raw = await callLLM({ prompt: retryPrompt, apiKey, baseURL, model, signal, timeout });
    retryText = cleanRewriteOutput(raw, { logger });
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
