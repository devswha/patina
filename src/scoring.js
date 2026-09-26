// @ts-check
import { callLLM as defaultCallLLM, redactErrorText } from './api.js';
import { getRepoRoot } from './config.js';
import { analyzeText } from './features/index.js';
import { LEAKAGE_SCORE_FLOOR } from './features/markup-leakage.js';
import { summarizeSignalStrength } from './features/signal-strength.js';
import { buildScoreMathCore, fenceReferenceText, resolveSeverityPoints } from './prompt-builder.js';
import { createLogger } from './logger.js';
import { parseStrictJson } from './json-response.js';
import { validateMps, validateFidelityCriteria } from './verification-schema.js';

/**
 * Default maximum delta before deterministic and LLM scores are reconciled upward.
 *
 * @type {number}
 * @example
 * const threshold = DEFAULT_DETERMINISTIC_DIVERGENCE_THRESHOLD;
 */
export const DEFAULT_DETERMINISTIC_DIVERGENCE_THRESHOLD = 20;

// LEAKAGE_SCORE_FLOOR is owned by the browser-pure leakage module so the
// playground shares the same constant; re-exported here for src consumers.
export { LEAKAGE_SCORE_FLOOR };

/**
 * AI-likeness interpretation bands (upper bound inclusive, ascending).
 *
 * Single source for `interpretScore`, the score-prompt interpretation line
 * (src/prompt-builder.js buildScoreMathCore), the `scoreText` strict-JSON
 * contract's interpretation enum, and the core/scoring.md §7 table (gated by
 * tests/unit/threshold-parity.test.js).
 *
 * @type {ReadonlyArray<{max: number, label: string}>}
 */
export const SCORE_INTERPRETATION_BANDS = Object.freeze([
  Object.freeze({ max: 15, label: 'human' }),
  Object.freeze({ max: 30, label: 'mostly human' }),
  Object.freeze({ max: 50, label: 'mixed' }),
  Object.freeze({ max: 70, label: 'AI-like' }),
  Object.freeze({ max: 100, label: 'heavily AI' }),
]);

/**
 * Closed set of `error` values a failed scorer result may carry.
 *
 * Both mean "no usable verdict", and both are fail-closed for every gate that
 * reads `error != null`. They are distinguished because they mean different
 * things about the rewrite: SCHEMA_FAILURE says the judge answered and the
 * answer was unusable, TRANSPORT_FAILURE says the judge never answered at all
 * (HTTP 429/5xx, network failure, per-attempt timeout). Only the caller can
 * decide what to tell a user, and telling someone their rewrite missed the
 * meaning floor when nothing was ever scored is wrong.
 *
 * @type {Readonly<{SCHEMA_FAILURE: string, TRANSPORT_FAILURE: string}>}
 */
export const SCORE_ERRORS = Object.freeze({
  SCHEMA_FAILURE: 'schema-failure',
  TRANSPORT_FAILURE: 'transport-failure',
});

/**
 * Classify a scorer failure. `callAndParseJson` attaches `raw` (the provider's
 * response text) to a parse/validation error and only to that: a transport
 * error is rethrown with no response to attach. So the presence of an own
 * `raw` property is the discriminator, and it stays correct for shapes that
 * carry no status either — a `callLLM` timeout is a plain `TimeoutError`.
 *
 * @param {unknown} error
 * @returns {string} One of {@link SCORE_ERRORS}.
 */
function scoreFailureKind(error) {
  return Object.hasOwn(Object(error ?? {}), 'raw')
    ? SCORE_ERRORS.SCHEMA_FAILURE
    : SCORE_ERRORS.TRANSPORT_FAILURE;
}

// Call LLM and parse strict JSON. On schema failure, retry once at temperature 0.
// Attempt indices are one-based across all transport and schema retries in one score.
async function callAndParseJson({
  prompt,
  apiKey,
  baseURL,
  model,
  temperature = 0.1,
  deadline,
  signal,
  timeout,
  callLLM = /** @type {Function} */ (defaultCallLLM),
  logger = createLogger(),
  now,
  sleep,
  // Opt-in OpenAI-compatible structured-output request field. The strict JSON
  // parse and temperature-0 retry remain the fallback on every attempt.
  responseFormat,
  // Opt-in provider-specific request fields (e.g. reasoning/thinking control),
  // spread into the request body by callLLM. Undefined by default so the
  // provider's own defaults apply; callers are responsible for sending only
  // fields the target provider accepts.
  extraBody = undefined,
  onAttempt,
  onAttemptInvalid,
  validate = (value) => value,
}) {
  let lastError;
  let attemptIndex = 1;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = attempt === 0 ? temperature : 0;
    const reportedAttempts = [];
    let result;
    try {
      result = await callLLM({
        prompt,
        apiKey,
        baseURL,
        model,
        temperature: t,
        deadline,
        signal,
        timeout,
        now,
        sleep,
        responseFormat,
        extraBody,
        // Buffer provider records so a response which fails strict parsing can
        // be reported as a score-schema retry rather than a transport success.
        onAttempt: (record) => reportedAttempts.push(record),
      });
    } catch (error) {
      dispatchAttempts(onAttempt, onAttemptInvalid, reportedAttempts, {
        attemptIndex: () => attemptIndex++,
      });
      throw error;
    }
    let parsed;
    try {
      parsed = validate(parseStrictJson(result));
    } catch (e) {
      // Semantic JSON errors use the same single correction retry and retain
      // the original response as evidence; never normalize malformed scores.
      e.raw = result;
      lastError = e;
      dispatchAttempts(onAttempt, onAttemptInvalid, reportedAttempts, {
        attemptIndex: () => attemptIndex++,
        scoreSchemaFailure: true,
      });
      if (attempt === 0) {
        logger.warn('score.json_parse_retry', {
          message: `[patina] score JSON parse failed (${e.message}); retrying at temperature 0`,
        });
      }
      continue;
    }
    dispatchAttempts(onAttempt, onAttemptInvalid, reportedAttempts, {
      attemptIndex: () => attemptIndex++,
    });
    return { parsed, raw: result };
  }
  throw lastError;
}

const ATTEMPT_RETRY_REASONS = new Set([
  'initial',
  'transport',
  'network',
  'timeout',
  'temperature_schema',
  'score_schema_parse',
]);
const ATTEMPT_FIELDS = [
  'attemptIndex',
  'requestedModel',
  'effectiveModel',
  'usage',
  'retryReason',
  'minimumChargeApplied',
  'outcome',
];

/**
 * Whether `value` is exactly one paid-attempt record as the transports emit
 * it: the seven known fields and no others, with a one-based `attemptIndex`
 * equal to `expectedIndex`.
 *
 * @param {unknown} value
 * @param {number} expectedIndex
 * @returns {boolean}
 */
export function isValidAttemptRecord(value, expectedIndex) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = /** @type {any} */ (value);
  const keys = Reflect.ownKeys(source);
  return keys.length === ATTEMPT_FIELDS.length
    && keys.every((key) => typeof key === 'string' && ATTEMPT_FIELDS.includes(key))
    && Number.isInteger(source.attemptIndex)
    && source.attemptIndex > 0
    && source.attemptIndex === expectedIndex
    && (typeof source.requestedModel === 'string' || source.requestedModel === null)
    && (typeof source.effectiveModel === 'string' || source.effectiveModel === null)
    && (source.usage === null || (typeof source.usage === 'object' && !Array.isArray(source.usage)))
    && ATTEMPT_RETRY_REASONS.has(source.retryReason)
    && typeof source.minimumChargeApplied === 'boolean'
    && (source.outcome === 'success' || source.outcome === 'error');
}

function dispatchAttempts(onAttempt, onAttemptInvalid, records, { attemptIndex, scoreSchemaFailure = false }) {
  // Transport owns paid-attempt evidence. A scoring parse failure without a
  // transport record is not proof that a paid request occurred.
  if (records.length === 0) return;

  // A lower transport invocation owns one local attempt sequence. Do not
  // reinterpret a malformed sequence as a new global sequence: that would
  // fabricate provenance for an attempt whose local position is unknown.
  if (!records.every((record, index) => isValidAttemptRecord(record, index + 1))) {
    notifyInvalidAttempt(onAttemptInvalid);
    return;
  }

  const lastValidIndex = records.length - 1;
  for (let i = 0; i < records.length; i++) {
    const source = records[i];
    const schemaFailure = scoreSchemaFailure && i === lastValidIndex;
    const record = {
      attemptIndex: attemptIndex(),
      requestedModel: source.requestedModel,
      // Effective identity is provider-response-derived only.
      effectiveModel: source.effectiveModel,
      usage: source.usage,
      retryReason: schemaFailure ? 'score_schema_parse' : source.retryReason,
      minimumChargeApplied: source.minimumChargeApplied,
      outcome: schemaFailure ? 'error' : source.outcome,
    };
    try {
      Promise.resolve(onAttempt?.(record)).catch(() => {});
    } catch {
      // Observability must never alter paid requests or score results.
    }
  }
}

/** @param {Function|undefined} onAttemptInvalid */
function notifyInvalidAttempt(onAttemptInvalid) {
  try {
    Promise.resolve(onAttemptInvalid?.()).catch(() => {});
  } catch {
    // Observability must never alter paid requests or score results.
  }
}


/**
 * Score text for AI-likeness using an LLM JSON scorer plus deterministic shadow signals.
 *
 * @param {object} options Scoring options.
 * @param {string} options.text Text to score.
 * @param {import('./config.js').PatinaConfig} options.config Effective patina config.
 * @param {import('./loader.js').PatternPack[]} options.patterns Loaded pattern packs for the score math and contract example row.
 * @param {string} [options.apiKey] Provider API key.
 * @param {string} [options.baseURL] Provider base URL.
 * @param {string} [options.model] Model id.
 * @param {number} [options.deadline] Absolute epoch-millisecond deadline.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {number} [options.timeout] Per-attempt backend timeout in milliseconds.
 * @param {Function} [options.callLLM] Injectable LLM implementation.
 * @param {import('./logger.js').Logger} [options.logger] patina logger.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {object} [options.responseFormat] Opt-in OpenAI-compatible structured-output request field forwarded to callLLM.
 * @param {Function} [options.onAttempt] Safe callback for one-based paid-attempt metadata records.
 * @param {Function} [options.onAttemptInvalid] Safe callback when transport evidence is malformed; receives no provider metadata.
 * @param {Record<string, any>|null} [options.deterministicScore] Optional frozen analysis for this exact text/config; omitted callers compute it normally.
 * @returns {Promise<object>} Score payload with overall, interpretation, llmScore, and deterministicScore.
 * @throws {Error} When the operation is aborted.
 * @example
 * const score = await scoreText({ text: 'Draft', config, patterns, callLLM: async () => '{"categories":{},"overall":20,"interpretation":"mostly human"}' });
 */
export async function scoreText({
  text,
  config,
  patterns,
  apiKey,
  baseURL,
  model,
  deadline,
  signal,
  timeout,
  callLLM = defaultCallLLM,
  logger = createLogger(),
  now,
  sleep,
  responseFormat,
  onAttempt,
  onAttemptInvalid,
  deterministicScore: preparedDeterministicScore,
}) {
  const lang = config.language || 'ko';
  const deterministicScore = preparedDeterministicScore === undefined
    ? scoreDeterministicSignals({ text, config, patterns }) : preparedDeterministicScore;

  // buildScoreMathCore carries the shared scoring math (weights, severity
  // scale, denominators, catalog digest) but no output contract; the strict
  // JSON contract below is the ONLY contract in this prompt (issue #397).
  // The contract's example row and interpretation enum are derived from the
  // same sources as the math core (pack frontmatter counts × effective
  // severity points, SCORE_INTERPRETATION_BANDS) so an override or band
  // relabel can never leave the contract contradicting the instructions.
  const prompt = `You are an AI-likeness scoring engine. Score the following text for AI-writing patterns.

## Scoring Instructions

${buildScoreMathCore(config, lang, text, patterns)}

## Output Format (strict JSON)

Return ONLY a JSON object in this exact format (no markdown, no explanation):

{
  "categories": {
    ${buildContractExampleCategoryRow(patterns, config)},
    ...
  },
  "overall": 0.0,
  "interpretation": "${SCORE_INTERPRETATION_BANDS.map((band) => band.label).join(' | ')}"
}

${fenceReferenceText(text, { label: '## Text to Score' })}
`;

  try {
    const { parsed } = await callAndParseJson({
      prompt,
      apiKey,
      baseURL,
      model,
      deadline,
      signal,
      callLLM,
      timeout,
      logger,
      now,
      sleep,
      responseFormat,
      onAttempt,
      onAttemptInvalid,
    });
    return withShadowScore(parsed, { deterministicScore, config, logger });
  } catch (e) {
    rethrowIfAborted(e, signal);
    const kind = scoreFailureKind(e);
    logger.warn(kind === SCORE_ERRORS.TRANSPORT_FAILURE ? 'score.text_transport_failure' : 'score.text_schema_failure', {
      message: `[patina] scoreText ${kind} after retry: ${e.message}`,
    });
    return {
      overall: null,
      llmScore: { overall: null, interpretation: null, error: kind },
      deterministicScore,
      error: kind,
      raw: e.raw,
    };
  }
}

// Build the example category row for the scoreText strict-JSON contract.
// Derived from the first loaded pack that declares a frontmatter pattern
// count, so the illustrated `max` always equals the pattern_count × high
// denominator the same prompt instructs the model to use — including under a
// `scoring.severity-points` override. Falls back to an illustrative 6-pattern
// "content" category when no pack metadata is available (mock/test paths);
// in that case the prompt carries no pattern-count claims to contradict.
function buildContractExampleCategoryRow(patterns, config) {
  const severityPoints = resolveSeverityPoints(config);
  const pack = (patterns || []).find((p) => Number.isFinite(Number(p?.frontmatter?.patterns)));
  const packName = String(pack?.frontmatter?.pack || 'content');
  // Category = pack name minus the language prefix (core/scoring.md §3).
  const category = packName.replace(/^[a-z]{2}-/, '');
  const patternCount = pack ? Number(pack.frontmatter.patterns) : 6;
  const max = patternCount * severityPoints.high;
  return `"${category}": {"detected": 0, "sum": 0, "max": ${max}, "score": 0.0, "weighted": 0.0}`;
}

// Calibrated evidence floor for the short-form (social/marketing) em-dash tell
// (patterns/en-style.md #13 short-form branch). Reconstructs the same category
// math the LLM scorer uses — adjusted severity / (style pattern count x high) x
// weight, with the core/scoring.md short-text 1.5x boost — so the deterministic
// floor and the LLM's own scoring of this tell agree instead of being an ad-hoc
// penalty. Returns 0 when the tell is inert (not eligible / not en / no dash) or
// when the style pattern count or category weight is unavailable.
function computeShortFormEvidenceFloor({ result, config, lang, patterns = [] }) {
  // #879: the 2026 cadence combination (stack + set group + informationless aside,
  // or a short-form phrase) is a stronger tell than a lone dash, so the floor takes
  // whichever signal is stronger. Both run through the same short-text boost and the
  // same `high` cap below, so this raises no ceiling — it only stops a combination
  // from scoring as if it were a single dash.
  const dashSeverity = Number(result?.shortForm?.emDash?.severity ?? 0);
  const cadenceSeverity = Number(result?.shortForm?.cadence?.severity ?? 0);
  const rawSeverity = Math.max(dashSeverity, cadenceSeverity);
  if (!(rawSeverity > 0)) return 0;
  const severityPoints = resolveSeverityPoints(config);
  const high = severityPoints.high;
  const stylePack = patterns.find((pack) => pack?.frontmatter?.pack === `${lang}-style`);
  const patternCount = Number(stylePack?.frontmatter?.patterns);
  const weight = Number(config?.scoring?.['category-weights']?.[lang]?.style);
  if (!(patternCount > 0) || !(high > 0) || !Number.isFinite(weight)) return 0;
  // core/scoring.md short-text boost (1.5x, capped at `high`).
  const adjusted = Math.min(high, rawSeverity * 1.5);
  return roundScore((adjusted / (patternCount * high)) * 100 * weight);
}

/**
 * Compute deterministic stylometry/lexicon AI-likeness signals.
 *
 * @param {object} [options] Deterministic scoring options.
 * @param {string} [options.text] Text to analyze.
 * @param {import('./config.js').PatinaConfig} [options.config={}] Effective config.
 * @param {Array} [options.patterns=[]] Loaded pattern packs; used for short-form category math.
 * @param {string} [options.repoRoot] Repository root for analyzer resources.
 * @param {Function} [options.analyzer] Analyzer implementation.
 * @returns {object|null} Deterministic score payload, skipped payload, or null when disabled.
 * @example
 * const deterministic = scoreDeterministicSignals({ text: 'Draft', config });
 */
export function scoreDeterministicSignals({
  text,
  config = {},
  patterns = [],
  repoRoot = getRepoRoot(),
  analyzer = analyzeText,
} = {}) {
  const options = deterministicScoringOptions(config);
  if (!options.enabled) return null;

  const lang = config.language || 'ko';
  const enabledLanguages = config.stylometry?.languages;
  if (Array.isArray(enabledLanguages) && !enabledLanguages.includes(lang)) {
    return {
      overall: null,
      evidenceFloor: 0,
      interpretation: null,
      skipped: true,
      skipReason: 'language-disabled',
      paragraphCount: 0,
      hotParagraphs: 0,
      signalScore: 0,
      bands: emptyDeterministicBands(),
    };
  }

  try {
    const lexiconAllowed = isLexiconEnabledForLanguage(config, lang);
    const result = analyzer(String(text || ''), {
      lang,
      documentType: config.documentType,
      repoRoot,
      burstinessBands: config.stylometry?.burstiness?.bands,
      mattrBands: config.stylometry?.ttr?.bands,
      mattrWindow: config.stylometry?.ttr?.window,
      koDiagnosticsEnabled: config.stylometry?.ko_diagnostics?.enabled !== false,
      koDiagnosticBands: config.stylometry?.ko_diagnostics?.bands,
      lexiconDensityThreshold: config.lexicon?.density_threshold,
      ...(lexiconAllowed ? {} : { lexicon: { lang, path: null, strict: [], phrases: [] } }),
    });
    const paragraphs = Array.isArray(result?.paragraphs) ? result.paragraphs : [];
    const paragraphCount = paragraphs.length;
    const hotParagraphs = paragraphs.filter((p) => p.hot).length;
    const hotRatioOverall = paragraphCount > 0 ? roundScore((hotParagraphs / paragraphCount) * 100) : 0;
    // Model-output leakage (#332) is near-proof-grade and lives at the document
    // level, so it short-circuits the hot-ratio score into the 'heavily AI' band.
    const leaked = Boolean(result?.markupLeakage?.leaked);
    // Discourse tells (#334/#391) carry no document-level floor: the analyzer
    // attributes them to the paragraphs that carry the tell, so they reach the
    // score through the hot ratio like every other per-paragraph signal.
    const discourseTells = result?.discourseTells ?? null;
    // Hard, document-level evidence floor: near-proof markup leakage (#332) is
    // decisive on its own, so it must survive even when the text is too short
    // for the stylometry meta-block (skipped=true): reconcileScoreOverall
    // applies this floor before deferring to the LLM. The coarse per-paragraph
    // hot ratio (1/1 = 100 on a single paragraph) is deliberately NOT part of
    // this floor — only calibrated hard signals are — so short prose cannot
    // manufacture a false positive.
    const hardEvidenceFloor = leaked ? LEAKAGE_SCORE_FLOOR : 0;
    // Calibrated weak short-form (social/marketing) punctuation floor (#13
    // short-form branch). Register-gated and Low-severity by design, so it only
    // nudges eligible SNS text off an exact 0 and is inert for the default
    // document type. Reconstructs the same category math as the LLM path (style
    // pattern count x severity, short-text 1.5x boost) rather than an ad-hoc
    // penalty, so a single em dash contributes ~1.7 and stays in the human band.
    const shortFormFloor = computeShortFormEvidenceFloor({ result, config, lang, patterns });
    const evidenceFloor = Math.max(hardEvidenceFloor, shortFormFloor);
    const overall = Math.max(hotRatioOverall, evidenceFloor);
    const signalScore = roundScore(summarizeSignalStrength(paragraphs, {
      burstinessBands: config.stylometry?.burstiness?.bands,
      mattrBands: config.stylometry?.ttr?.bands,
      lexiconDensityThreshold: config.lexicon?.density_threshold,
    }));

    return {
      overall,
      evidenceFloor,
      shortFormFloor,
      interpretation: interpretScore(overall),
      skipped: Boolean(result?.skipped),
      skipReason: result?.skipReason ?? null,
      paragraphCount,
      hotParagraphs,
      signalScore,
      bands: {
        burstiness: countBands(paragraphs.map((p) => p.burstiness?.band)),
        mattr: countBands(paragraphs.map((p) => p.mattr?.band)),
        lexicon: {
          hot: paragraphs.filter((p) => p.lexicon?.hot).length,
          threshold: config.lexicon?.density_threshold ?? null,
        },
        koDiagnostics: {
          hot: paragraphs.filter((p) => p.koDiagnostics?.hot).length,
          thresholds: config.stylometry?.ko_diagnostics?.bands ?? null,
        },
        markupLeakage: {
          leaked,
          hits: Array.isArray(result?.markupLeakage?.hits) ? result.markupLeakage.hits.length : 0,
          floor: LEAKAGE_SCORE_FLOOR,
        },
        discourseTells: {
          hot: discourseTells?.hot ?? null,
          fakeCandor: discourseTells?.fakeCandor ?? null,
          thematicBreaks: discourseTells?.thematicBreaks ?? null,
        },
      },
    };
  } catch (err) {
    return {
      overall: null,
      evidenceFloor: 0,
      interpretation: null,
      skipped: true,
      skipReason: 'deterministic-failure',
      paragraphCount: 0,
      hotParagraphs: 0,
      signalScore: 0,
      bands: emptyDeterministicBands(),
      error: err?.message || 'deterministic scoring failed',
    };
  }
}

/**
 * Merge an LLM score payload with deterministic shadow-score reconciliation.
 *
 * @param {Record<string, any>} parsed Parsed LLM scoring JSON.
 * @param {object} [options] Reconciliation options.
 * @param {Record<string, any>|null} [options.deterministicScore] Deterministic score payload.
 * @param {import('./config.js').PatinaConfig} [options.config={}] Effective config.
 * @param {import('./logger.js').Logger} [options.logger] Logger for reconciliation warnings.
 * @returns {object} Score payload preserving llmScore and deterministicScore details.
 * @example
 * const score = withShadowScore({ overall: 20 }, { deterministicScore: { overall: 25 } });
 */
export function withShadowScore(parsed, { deterministicScore, config = {}, logger } = {}) {
  const llmOverall = toFiniteScore(parsed?.overall);
  const llmScore = {
    overall: llmOverall,
    interpretation: parsed?.interpretation ?? (llmOverall === null ? null : interpretScore(llmOverall)),
    categories: parsed?.categories ?? null,
  };
  const reconciliation = reconcileScoreOverall({
    llmOverall,
    deterministicScore,
    config,
    logger,
  });
  const overall = reconciliation.overall ?? llmOverall;
  return {
    ...parsed,
    overall,
    interpretation: overall === null
      ? parsed?.interpretation ?? null
      : interpretScore(overall),
    llmScore,
    deterministicScore,
    ...(reconciliation.scorePreference ? { scorePreference: reconciliation.scorePreference } : {}),
  };
}

/**
 * Reconcile LLM and deterministic overall scores according to config thresholds.
 *
 * @param {object} [options] Reconciliation inputs.
 * @param {number|null} [options.llmOverall] LLM overall score.
 * @param {Record<string, any>|null} [options.deterministicScore] Deterministic score payload.
 * @param {import('./config.js').PatinaConfig} [options.config={}] Effective config.
 * @param {import('./logger.js').Logger} [options.logger] Logger for warnings.
 * @returns {{overall: number|null, scorePreference: (object|null)}} Reconciled score and preference source.
 * @example
 * const result = reconcileScoreOverall({ llmOverall: 20, deterministicScore: { overall: 60 } });
 */
export function reconcileScoreOverall({
  llmOverall,
  deterministicScore,
  config = {},
  logger,
} = {}) {
  const llm = toFiniteScore(llmOverall);
  const deterministic = toFiniteScore(deterministicScore?.overall);
  if (llm === null) return { overall: null, scorePreference: null };
  if (deterministic === null) return { overall: llm, scorePreference: null };
  // Hard evidence floor applies in EVERY posture. Near-proof markup leakage
  // (#332) and the calibrated short-form tell are each decisive on their own,
  // so the final score must never sit below them — not even when the text is
  // short (skipped) OR when the LLM lands within the divergence threshold of
  // the deterministic score. The coarse per-paragraph hot ratio is deliberately
  // excluded from evidenceFloor (see scoreDeterministicSignals), so this cannot
  // false-positive on ordinary prose. Applied before the skip/divergence
  // branches, which only decide the score when no hard floor binds.
  const evidenceFloor = toFiniteScore(deterministicScore?.evidenceFloor);
  if (evidenceFloor !== null && evidenceFloor > 0 && llm < evidenceFloor) {
    return {
      overall: evidenceFloor,
      scorePreference: {
        reason: 'deterministic-evidence-floor',
        selected: 'deterministic',
        llmOverall: llm,
        deterministicOverall: deterministic,
        evidenceFloor,
        overall: evidenceFloor,
      },
    };
  }

  // `skipped` (≤2 paragraphs / ≤2 sentences) suppressed the long-form
  // stylometry meta-block, and its coarse per-paragraph hot ratio is unreliable
  // on such short text. With no hard floor binding above, defer to the LLM
  // instead of running the divergence path on that coarse ratio.
  if (deterministicScore?.skipped) return { overall: llm, scorePreference: null };

  const threshold = deterministicScoringOptions(config).divergenceThreshold;
  const delta = Math.abs(llm - deterministic);
  if (delta <= threshold) return { overall: llm, scorePreference: null };

  const overall = Math.max(llm, deterministic);
  const selected = overall === deterministic ? 'deterministic' : 'llm';
  const scorePreference = {
    reason: 'deterministic-divergence',
    selected,
    threshold,
    llmOverall: llm,
    deterministicOverall: deterministic,
    overall,
  };
  logger?.warn?.('score.deterministic_divergence', {
    message: `[patina] deterministic score diverged from LLM score (${llm} vs ${deterministic}); using pessimistic ${overall}`,
    llm_overall: llm,
    deterministic_overall: deterministic,
    selected,
  });
  return { overall, scorePreference };
}

/**
 * Score meaning preservation between original and rewritten text.
 *
 * @param {object} options MPS options.
 * @param {string} options.original Original text.
 * @param {string} options.rewritten Rewritten text.
 * @param {string} [options.apiKey] Provider API key.
 * @param {string} [options.baseURL] Provider base URL.
 * @param {string} [options.model] Model id.
 * @param {number} [options.deadline] Absolute epoch-millisecond deadline.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {number} [options.timeout] Per-attempt backend timeout in milliseconds.
 * @param {Function} [options.callLLM] Injectable LLM implementation.
 * @param {import('./logger.js').Logger} [options.logger] patina logger.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {object} [options.responseFormat] Opt-in OpenAI-compatible structured-output request field forwarded to callLLM.
 * @param {object} [options.extraBody] Opt-in provider-specific request fields (e.g. reasoning control) spread into the request body.
 * @param {Function} [options.onAttempt] Safe callback for one-based paid-attempt metadata records.
 * @param {Function} [options.onAttemptInvalid] Safe callback when transport evidence is malformed; receives no provider metadata.
 * @returns {Promise<Object>} MPS result.
 * @throws {Error} When the operation is aborted.
 * @example
 * const mps = await scoreMPS({ original: 'A', rewritten: 'A', callLLM: async () => '{"mps":100,"anchors":[],"pass_count":0,"total_count":0,"polarity_pass_count":0,"polarity_total_count":0}' });
 */
export async function scoreMPS({
  original,
  rewritten,
  apiKey,
  baseURL,
  model,
  deadline,
  signal,
  timeout,
  callLLM = defaultCallLLM,
  logger = createLogger(),
  now,
  sleep,
  responseFormat,
  // Provider-specific request fields (e.g. reasoning control); see callAndParseJson.
  extraBody,
  onAttempt,
  onAttemptInvalid,
}) {
  // Anchor definition mirrors core/scoring.md §14-16 and SKILL.md step 4.5:
  // anchors are explicitly stated FACTUAL meaning units (claim/polarity/
  // causation/quantifier/negation), capped at 3 per paragraph. Stylistic
  // packaging (hype, intensifiers, boilerplate enthusiasm) is exactly what the
  // rewrite removes, so it must never be counted as an anchor — otherwise every
  // successful de-puffing scores as meaning loss (#579). The zero-anchor case
  // maps the spec's "MPS = N/A, gating exempt" to 100 because this JSON
  // contract has no N/A and consumers fail closed on null.
  const prompt = `You are a Meaning Preservation evaluator. Compare the ORIGINAL text with the REWRITTEN text.

Extract semantic anchors from the ORIGINAL text only, then verify whether each anchor survives in the REWRITTEN text.

Anchor types:
- claim: factual assertion or conclusion ("the system failed", "revenue grew 30%")
- polarity: positive/negative/neutral stance of a claim
- causation: cause-effect statement ("A caused B")
- quantifier: number, degree, or range ("p<0.05", "about 3x", "most")
- negation: negated statement ("does not", "never", "impossible")

Extraction rules:
- Extract only explicitly stated meaning. Never extract implications or subtext.
- Extract at most 3 anchors per paragraph of the original.
- Stylistic packaging is NOT an anchor. Intensifiers, marketing hype, and boilerplate enthusiasm ("cutting-edge", "we are thrilled to announce", "revolutionize your workflow", "unlock full potential", "take X to the next level", "comprehensive", "seamlessly") carry no factual content — removing or toning them down is the rewrite's job and must never be penalized as meaning loss.
- If the original contains no factual anchors at all, return "anchors": [], "pass_count": 0, "total_count": 0, "polarity_pass_count": 0, "polarity_total_count": 0, "mps": 100 (nothing meaning-bearing was at risk).

Verdict per anchor: PASS | SOFT_FAIL | HARD_FAIL
- PASS: the anchor's core assertion is unambiguously recoverable from the rewritten text; rephrasing is fine.
- SOFT_FAIL: present but weakened or made ambiguous.
- HARD_FAIL: deleted, contradicted, or polarity inverted.
- If the rewritten text fabricates new facts absent from the original (numbers, customers, outcomes, features), mark the closest related anchor HARD_FAIL. If facts were fabricated but no original anchor relates to them (including the zero-anchor case), add an anchor {"type": "claim", "content": "<the fabricated fact>", "verdict": "HARD_FAIL"} so fabrication always lowers mps — the mps-100 zero-anchor rule applies only when the rewritten text also adds no new facts.

Return ONLY a JSON object:

{
  "anchors": [
    {"type": "claim", "content": "...", "verdict": "PASS"}
  ],
  "pass_count": 1,
  "total_count": 1,
  "polarity_pass_count": 0,
  "polarity_total_count": 0,
  "mps": 100.0
}

MPS formula: (pass_rate × 0.6 + polarity_preserved × 0.4) × 100
The polarity group includes BOTH polarity and negation anchors. Count both types in polarity_pass_count and polarity_total_count.
If no polarity or negation anchors: MPS = pass_rate × 100

${fenceReferenceText(original, { label: '## Original reference' })}
${fenceReferenceText(rewritten, { label: '## Rewritten reference' })}
`;

  try {
    const { parsed } = await callAndParseJson({
      prompt,
      apiKey,
      baseURL,
      model,
      deadline,
      signal,
      timeout,
      callLLM,
      logger,
      now,
      sleep,
      responseFormat,
      extraBody,
      onAttempt,
      onAttemptInvalid,
      validate: validateMps,
    });
    return parsed;
  } catch (e) {
    rethrowIfAborted(e, signal);
    const kind = scoreFailureKind(e);
    logger.warn(kind === SCORE_ERRORS.TRANSPORT_FAILURE ? 'score.mps_transport_failure' : 'score.mps_schema_failure', {
      message: `[patina] scoreMPS ${kind} after retry: ${redactErrorText(e.message)}`,
    });
    return { mps: null, error: kind, raw: e.raw };
  }
}

/**
 * Convert a numeric AI-likeness score to a human-readable band.
 *
 * @param {number} score AI-likeness score from 0 to 100.
 * @returns {string} Interpretation band.
 * @example
 * const label = interpretScore(28); // mostly human
 */
export function interpretScore(score) {
  for (const band of SCORE_INTERPRETATION_BANDS) {
    if (score <= band.max) return band.label;
  }
  // Above the last band max (e.g. unclamped >100): still the top band.
  return SCORE_INTERPRETATION_BANDS[SCORE_INTERPRETATION_BANDS.length - 1].label;
}

// Length ratio is deterministic — bucket per core/scoring.md §10.4.
/**
 * Score rewritten length ratio on the 0-3 fidelity scale.
 *
 * @param {string} original Original text.
 * @param {string} rewritten Rewritten text.
 * @returns {number} Length-ratio points from 0 to 3.
 * @example
 * const points = lengthRatioPoints('abcd', 'abcde');
 */
export function lengthRatioPoints(original, rewritten) {
  if (!original || original.length === 0) return 3;
  const ratio = (rewritten.length / original.length) * 100;
  // Compression is the expected shape of a humanizing rewrite: stripping hype,
  // filler, and ceremony shortens hype-dense copy well past 30%. Meaning loss
  // is already caught directly by scoreMPS anchors, so the compression side is
  // scored generously and only guards against gutting the text. Expansion
  // bands are unchanged — padding still signals fabrication.
  if (ratio >= 50 && ratio <= 130) return 3;
  if ((ratio >= 35 && ratio < 50) || (ratio > 130 && ratio <= 150)) return 2;
  if ((ratio >= 25 && ratio < 35) || (ratio > 150 && ratio <= 200)) return 1;
  return 0;
}

/**
 * Score fidelity between original and rewritten text using length plus LLM criteria.
 *
 * @param {object} options Fidelity options.
 * @param {string} options.original Original text.
 * @param {string} options.rewritten Rewritten text.
 * @param {string} [options.apiKey] Provider API key.
 * @param {string} [options.baseURL] Provider base URL.
 * @param {string} [options.model] Model id.
 * @param {number} [options.deadline] Absolute epoch-millisecond deadline.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {number} [options.timeout] Per-attempt backend timeout in milliseconds.
 * @param {Function} [options.callLLM] Injectable LLM implementation.
 * @param {import('./logger.js').Logger} [options.logger] patina logger.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {object} [options.responseFormat] Opt-in OpenAI-compatible structured-output request field forwarded to callLLM.
 * @param {object} [options.extraBody] Opt-in provider-specific request fields (e.g. reasoning control) spread into the request body.
 * @param {Function} [options.onAttempt] Safe callback for one-based paid-attempt metadata records.
 * @param {Function} [options.onAttemptInvalid] Safe callback when transport evidence is malformed; receives no provider metadata.
 * @returns {Promise<Object>} Fidelity result.
 * @throws {Error} When the operation is aborted.
 * @example
 * const fidelity = await scoreFidelity({ original: 'A', rewritten: 'A', callLLM: async () => '{"claims_preserved":3,"no_fabrication":3,"audience_register_match":3}' });
 */
export async function scoreFidelity({
  original,
  rewritten,
  apiKey,
  baseURL,
  model,
  deadline,
  signal,
  timeout,
  callLLM = defaultCallLLM,
  logger = createLogger(),
  now,
  sleep,
  responseFormat,
  // Provider-specific request fields (e.g. reasoning control); see callAndParseJson.
  extraBody,
  onAttempt,
  onAttemptInvalid,
}) {
  // Length is deterministic; only ask LLM for the three judgment criteria.
  const lengthPoints = lengthRatioPoints(original, rewritten);
  const lengthRatio = original ? Math.round((rewritten.length / original.length) * 100) : 100;

  const prompt = `You are a Fidelity evaluator. Compare ORIGINAL vs REWRITTEN text and score three criteria.

REWRITTEN is the output of a humanizer whose job is to strip AI-sounding
style: inflated adjectives, marketing hype, boilerplate enthusiasm, filler,
and formulaic connectives. Removing that packaging is the intended outcome.
Never score it as drift, loss, or mismatch under any criterion below.

Each criterion: 0-3 points. High=3 (preserved), Medium=2 (minor drift), Low=1 (noticeable drift), Fail=0 (broken).

Criteria:
1. claims_preserved — every factual claim in ORIGINAL appears (perhaps rephrased) in REWRITTEN. Stylistic packaging is not a claim: hype and intensifiers ("cutting-edge", "unprecedented", "seamlessly", "revolutionary", "transformative") carry no checkable content, so their absence is never a loss. Score only entities, numbers, causal links, conclusions, and polarity.
2. no_fabrication — REWRITTEN does not add claims/facts not present in ORIGINAL.
3. audience_register_match — REWRITTEN still serves the same audience and document function as ORIGINAL: a policy notice reads as a policy notice, a product page as a product page. Judge that function, not surface polish. Dropping AI-ish stiffness, hype, or ceremony while the audience and function hold is High, not drift. Score Low or Fail only for a real register mismatch, such as an academic passage rewritten as slang or a casual note rewritten as legalese.

Return ONLY this JSON, no markdown:

{
  "claims_preserved": 0,
  "no_fabrication": 0,
  "audience_register_match": 0,
  "rationale": "one sentence per criterion"
}

${fenceReferenceText(original, { label: '## Original reference' })}
${fenceReferenceText(rewritten, { label: '## Rewritten reference' })}
`;

  let parsed = null;
  let scoreError = null;
  let scoreErrorKind = null;
  try {
    const result = await callAndParseJson({
      prompt,
      apiKey,
      baseURL,
      model,
      deadline,
      signal,
      callLLM,
      timeout,
      logger,
      now,
      sleep,
      responseFormat,
      extraBody,
      onAttempt,
      onAttemptInvalid,
      validate: validateFidelityCriteria,
    });
    parsed = result.parsed;
  } catch (e) {
    rethrowIfAborted(e, signal);
    const kind = scoreFailureKind(e);
    logger.warn(kind === SCORE_ERRORS.TRANSPORT_FAILURE ? 'score.fidelity_transport_failure' : 'score.fidelity_schema_failure', {
      message: `[patina] scoreFidelity ${kind} after retry: ${redactErrorText(e.message)}`,
    });
    scoreError = e;
    scoreErrorKind = kind;
  }

  const claims = parsed?.claims_preserved ?? null;
  const noFab = parsed?.no_fabrication ?? null;
  const registerMatch = parsed?.audience_register_match ?? null;
  const fidelity = scoreError ? null : ((claims + noFab + registerMatch + lengthPoints) / 12) * 100;

  return {
    criteria: {
      claims_preserved: claims,
      no_fabrication: noFab,
      audience_register_match: registerMatch,
      length_ratio: lengthPoints,
    },
    length_ratio_pct: lengthRatio,
    rationale: parsed?.rationale ?? null,
    fidelity: fidelity === null ? null : Math.round(fidelity * 10) / 10,
    ...(scoreError ? { error: scoreErrorKind, raw: scoreError.raw } : {}),
  };
}

function rethrowIfAborted(err, signal) {
  if (signal?.aborted || err?.name === 'AbortError') throw err;
}

// Combined score per core/scoring.md §13: AI-likeness × ai_weight + (100 - fidelity) × fidelity_weight.
// Lower is better. Falls back to default weights if the document type is not configured.
/**
 * Combine AI-likeness, inverted fidelity, and optional deterministic score.
 *
 * @param {object} options Combined score inputs.
 * @param {number} options.aiLikeness AI-likeness score, lower is better.
 * @param {number} options.fidelity Fidelity score, higher is better.
 * @param {string} [options.documentType] Document type for configured weights.
 * @param {import('./config.js').PatinaConfig} [options.config] Effective config.
 * @param {number|object|null} [options.deterministicScore] Optional deterministic score.
 * @returns {number} Combined score, lower is better.
 * @example
 * const score = combinedScore({ aiLikeness: 20, fidelity: 90, documentType: 'default', config: {} });
 */
export function combinedScore({ aiLikeness, fidelity, documentType, config, deterministicScore }) {
  const documentTypeWeights = config?.scoring?.['combined-weights']?.[documentType];
  const ai = documentTypeWeights?.['ai-likeness'] ?? 0.6;
  const fid = documentTypeWeights?.fidelity ?? 0.4;
  const deterministicWeight = deterministicScoringOptions(config).combinedWeight;
  // Accepts either a score payload or a bare number; probing `.overall` on the
  // number yields undefined and falls through to the value itself.
  const deterministic = toFiniteScore(/** @type {Record<string, any>|null|undefined} */ (deterministicScore)?.overall ?? deterministicScore);
  const fidelityInverted = 100 - fidelity;
  if (deterministicWeight > 0 && deterministic !== null) {
    const totalWeight = ai + fid + deterministicWeight;
    return roundScore(
      (aiLikeness * ai + fidelityInverted * fid + deterministic * deterministicWeight) /
        totalWeight
    );
  }
  return roundScore(aiLikeness * ai + fidelityInverted * fid);
}

function isLexiconEnabledForLanguage(config = {}, lang) {
  if (config.lexicon?.enabled === false) return false;
  const enabledLanguages = config.lexicon?.languages;
  return !Array.isArray(enabledLanguages) || enabledLanguages.includes(lang);
}

function deterministicScoringOptions(config = {}) {
  const cfg = config.scoring?.deterministic || {};
  const enabled = cfg.enabled !== false;
  const divergenceThreshold = Math.max(0, numberOr(
    cfg['divergence-threshold'],
    DEFAULT_DETERMINISTIC_DIVERGENCE_THRESHOLD
  ));
  const combinedWeight = Math.max(0, numberOr(
    cfg['combined-weight'],
    0
  ));
  return { enabled, divergenceThreshold, combinedWeight };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function countBands(values) {
  const counts = { low: 0, mid: 0, high: 0, null: 0 };
  for (const value of values) {
    if (value === 'low' || value === 'mid' || value === 'high') counts[value]++;
    else counts.null++;
  }
  return counts;
}

function emptyDeterministicBands() {
  return {
    burstiness: { low: 0, mid: 0, high: 0, null: 0 },
    mattr: { low: 0, mid: 0, high: 0, null: 0 },
    lexicon: { hot: 0, threshold: null },
    koDiagnostics: { hot: 0, thresholds: null },
    markupLeakage: { leaked: false, hits: 0, floor: LEAKAGE_SCORE_FLOOR },
    discourseTells: { hot: null, fakeCandor: null, thematicBreaks: null },
  };
}

function toFiniteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundScore(value) {
  return Math.round(value * 10) / 10;
}
