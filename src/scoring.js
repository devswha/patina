// @ts-check
import { callLLM as defaultCallLLM, redactErrorText } from './api.js';
import { getRepoRoot } from './config.js';
import { analyzeText, loadStructuralModel } from './features/index.js';
import { LEAKAGE_SCORE_FLOOR } from './features/markup-leakage.js';
import { summarizeSignalStrength } from './features/signal-strength.js';
import { buildScoreMathCore, resolveSeverityPoints } from './prompt-builder.js';
import { createLogger } from './logger.js';

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
 * Structural classifier score is a calibrated probability-like document signal.
 * It only affects the deterministic score when a private local model is loaded
 * and the model verdict is hot; absent model means baseline behavior.
 *
 * @type {number}
 */
export const STRUCTURAL_CLASSIFIER_MIN_FLOOR = 70;

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

function parseStrictJson(text) {
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
  // braces, e.g. "result for {A}: {\"overall\":20}" slices from `{A}` (#508 G2).
  // Returning the FIRST parseable object is also wrong when a chatty model
  // emits a stray/echoed object (or an empty `{}`) before the real score —
  // that nulls a valid score without a retry (#527 H8). And a lone unbalanced
  // '{' must skip, not abandon the scan, or a later valid object is missed
  // (#527 H9). Picking the object with the most keys favors the score object
  // (many keys) over a small echo while leaving the single-object case exact.
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
  // Opt-in OpenAI-compatible structured-output request field (e.g.
  // { type: 'json_object' }). Forwarded to callLLM on every attempt; the strict
  // JSON parse + temperature-0 retry below remains the fallback regardless.
  responseFormat,
  onAttempt,
  onAttemptInvalid,
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
      parsed = parseStrictJson(result);
    } catch (e) {
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

function dispatchAttempts(onAttempt, onAttemptInvalid, records, { attemptIndex, scoreSchemaFailure = false }) {
  // Transport owns paid-attempt evidence. A scoring parse failure without a
  // transport record is not proof that a paid request occurred.
  if (records.length === 0) return;

  const sources = records.map(validateAttemptRecord);
  // A lower transport invocation owns one local attempt sequence. Do not
  // reinterpret a malformed sequence as a new global sequence: that would
  // fabricate provenance for an attempt whose local position is unknown.
  if (sources.some((source, index) => !source || source.attemptIndex !== index + 1)) {
    notifyInvalidAttempt(onAttemptInvalid);
    return;
  }

  const lastValidIndex = sources.length - 1;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source) continue;
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

/** @param {unknown} value */
function validateAttemptRecord(value) {
  const fields = [
    'attemptIndex',
    'requestedModel',
    'effectiveModel',
    'usage',
    'retryReason',
    'minimumChargeApplied',
    'outcome',
  ];
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = /** @type {any} */ (value);
    const keys = Reflect.ownKeys(source);
    if (
      keys.length !== fields.length
      || !fields.every((field) => Object.prototype.hasOwnProperty.call(source, field))
      || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
      || !Number.isInteger(source.attemptIndex)
      || source.attemptIndex <= 0
      || !(typeof source.requestedModel === 'string' || source.requestedModel === null)
      || !(typeof source.effectiveModel === 'string' || source.effectiveModel === null)
      || !(source.usage === null || (typeof source.usage === 'object' && !Array.isArray(source.usage)))
      || !ATTEMPT_RETRY_REASONS.has(source.retryReason)
      || typeof source.minimumChargeApplied !== 'boolean'
      || !(source.outcome === 'success' || source.outcome === 'error')
    ) return null;
    return source;
  } catch {
    return null;
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
 * @param {object} options.config Effective patina config.
 * @param {object[]} options.patterns Loaded pattern packs, retained for scorer compatibility.
 * @param {string} [options.apiKey] Provider API key.
 * @param {string} [options.baseURL] Provider base URL.
 * @param {string} [options.model] Model id.
 * @param {number} [options.deadline] Absolute epoch-millisecond deadline.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {number} [options.timeout] Per-attempt backend timeout in milliseconds.
 * @param {Function} [options.callLLM] Injectable LLM implementation.
 * @param {object} [options.logger] patina logger.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {object} [options.responseFormat] Opt-in OpenAI-compatible structured-output request field forwarded to callLLM.
 * @param {Function} [options.onAttempt] Safe callback for one-based paid-attempt metadata records.
 * @param {Function} [options.onAttemptInvalid] Safe callback when transport evidence is malformed; receives no provider metadata.
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
  // Opt-in structured-output request field; defaults off (undefined).
  responseFormat,
  onAttempt,
  onAttemptInvalid,
}) {
  const lang = config.language || 'ko';
  const deterministicScore = scoreDeterministicSignals({ text, config, logger });

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

## Text to Score

${text}
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
    logger.warn('score.text_schema_failure', {
      message: `[patina] scoreText schema failure after retry: ${e.message}`,
    });
    return {
      overall: null,
      llmScore: { overall: null, interpretation: null, error: 'schema-failure' },
      deterministicScore,
      error: 'schema-failure',
      raw: e.raw,
    };
  }
}

// Build the example category row for the scoreText strict-JSON contract.
// Derived from the first loaded pack that declares a frontmatter pattern
// count, so the illustrated `max` always equals the pattern_count × high
// denominator the same prompt instructs the model to use — including under a
// `severity-points` override. Falls back to an illustrative 6-pattern
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

/**
 * Compute deterministic stylometry/lexicon AI-likeness signals.
 *
 * @param {object} [options] Deterministic scoring options.
 * @param {string} [options.text] Text to analyze.
 * @param {object} [options.config={}] Effective config.
 * @param {string} [options.repoRoot] Repository root for analyzer resources.
 * @param {object} [options.logger] Optional logger for recoverable deterministic warnings.
 * @param {Function} [options.analyzer] Analyzer implementation.
 * @returns {object|null} Deterministic score payload, skipped payload, or null when disabled.
 * @example
 * const deterministic = scoreDeterministicSignals({ text: 'Draft', config });
 */
export function scoreDeterministicSignals({
  text,
  config = {},
  repoRoot = getRepoRoot(),
  analyzer = analyzeText,
  logger = createLogger(),
} = {}) {
  const options = deterministicScoringOptions(config);
  if (!options.enabled) return null;

  const lang = config.language || 'ko';
  const enabledLanguages = config.stylometry?.languages;
  if (Array.isArray(enabledLanguages) && !enabledLanguages.includes(lang)) {
    return {
      overall: null,
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
    let structuralModel = null;
    try {
      structuralModel = loadStructuralModel(config, { lang });
    } catch (err) {
      logger?.warn?.('score.structural_model_load_failure', {
        message: `[patina] structural model load failed; continuing without structural classifier: ${err?.message || err}`,
      });
    }
    const result = analyzer(String(text || ''), {
      lang,
      repoRoot,
      burstinessBands: config.stylometry?.burstiness?.bands,
      mattrBands: config.stylometry?.ttr?.bands,
      mattrWindow: config.stylometry?.ttr?.window,
      koDiagnosticsEnabled: config.stylometry?.ko_diagnostics?.enabled !== false,
      koDiagnosticBands: config.stylometry?.ko_diagnostics?.bands,
      lexiconDensityThreshold: config.lexicon?.density_threshold,
      structuralModel,
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
    const structuralClassifier = result?.structuralClassifier ?? { available: false, hot: null, score: null };
    const structuralFloor =
      structuralClassifier.hot === true && typeof structuralClassifier.score === 'number'
        ? Math.max(STRUCTURAL_CLASSIFIER_MIN_FLOOR, roundScore(structuralClassifier.score * 100))
        : 0;
    // All floors apply together. Previously leakage and the structural-classifier
    // floor were mutually exclusive, so a document that BOTH leaked and scored a
    // high structural floor was capped at the (lower) leakage floor — a near-proof
    // leakage token could LOWER the overall score. Take the max of every signal so
    // a floor can only ever raise the score (#527 H5).
    const overall = Math.max(
      hotRatioOverall,
      leaked ? LEAKAGE_SCORE_FLOOR : 0,
      structuralFloor,
    );
    const signalScore = roundScore(summarizeSignalStrength(paragraphs, {
      burstinessBands: config.stylometry?.burstiness?.bands,
      mattrBands: config.stylometry?.ttr?.bands,
      lexiconDensityThreshold: config.lexicon?.density_threshold,
    }));

    return {
      overall,
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
        structuralClassifier: {
          available: Boolean(structuralClassifier.available),
          hot: structuralClassifier.hot ?? null,
          score: structuralClassifier.score ?? null,
          floor: structuralClassifier.hot === true ? structuralFloor : 0,
        },
      },
    };
  } catch (err) {
    return {
      overall: null,
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
 * @param {object} parsed Parsed LLM scoring JSON.
 * @param {object} [options] Reconciliation options.
 * @param {object|null} [options.deterministicScore] Deterministic score payload.
 * @param {object} [options.config={}] Effective config.
 * @param {object} [options.logger] Logger for reconciliation warnings.
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
 * @param {object|null} [options.deterministicScore] Deterministic score payload.
 * @param {object} [options.config={}] Effective config.
 * @param {object} [options.logger] Logger for warnings.
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
 * @param {object} [options.logger] patina logger.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {object} [options.responseFormat] Opt-in OpenAI-compatible structured-output request field forwarded to callLLM.
 * @param {Function} [options.onAttempt] Safe callback for one-based paid-attempt metadata records.
 * @param {Function} [options.onAttemptInvalid] Safe callback when transport evidence is malformed; receives no provider metadata.
 * @returns {Promise<Object>} MPS result.
 * @throws {Error} When the operation is aborted.
 * @example
 * const mps = await scoreMPS({ original: 'A', rewritten: 'A', callLLM: async () => '{"mps":100,"anchors":[]}' });
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
  // Opt-in structured-output request field; defaults off (undefined).
  responseFormat,
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
      onAttempt,
      onAttemptInvalid,
    });
    return parsed;
  } catch (e) {
    rethrowIfAborted(e, signal);
    logger.warn('score.mps_schema_failure', {
      message: `[patina] scoreMPS schema failure after retry: ${redactErrorText(e.message)}`,
    });
    return { mps: null, error: 'schema-failure', raw: e.raw };
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
  if (ratio >= 70 && ratio <= 130) return 3;
  if ((ratio >= 50 && ratio < 70) || (ratio > 130 && ratio <= 150)) return 2;
  if ((ratio >= 30 && ratio < 50) || (ratio > 150 && ratio <= 200)) return 1;
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
 * @param {object} [options.logger] patina logger.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {object} [options.responseFormat] Opt-in OpenAI-compatible structured-output request field forwarded to callLLM.
 * @param {Function} [options.onAttempt] Safe callback for one-based paid-attempt metadata records.
 * @param {Function} [options.onAttemptInvalid] Safe callback when transport evidence is malformed; receives no provider metadata.
 * @returns {Promise<Object>} Fidelity result.
 * @throws {Error} When the operation is aborted.
 * @example
 * const fidelity = await scoreFidelity({ original: 'A', rewritten: 'A', callLLM: async () => '{"criteria":{"meaning":3,"tone":3,"no_unintended_additions":3}}' });
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
  // Opt-in structured-output request field; defaults off (undefined).
  responseFormat,
  onAttempt,
  onAttemptInvalid,
}) {
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
      onAttempt,
      onAttemptInvalid,
    });
    parsed = result.parsed;
  } catch (e) {
    rethrowIfAborted(e, signal);
    logger.warn('score.fidelity_schema_failure', {
      message: `[patina] scoreFidelity schema failure after retry: ${redactErrorText(e.message)}`,
    });
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

/**
 * Clamp and round a value into the inclusive 0-3 scoring range.
 *
 * @param {number|string} v Value to clamp.
 * @returns {number} Integer from 0 to 3.
 * @example
 * const value = clamp03(4.2); // 3
 */
export function clamp03(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return Math.round(n);
}

function rethrowIfAborted(err, signal) {
  if (signal?.aborted || err?.name === 'AbortError') throw err;
}

// Combined score per core/scoring.md §13: AI-likeness × ai_weight + (100 - fidelity) × fidelity_weight.
// Lower is better. Falls back to default weights if profile not configured.
/**
 * Combine AI-likeness, inverted fidelity, and optional deterministic score.
 *
 * @param {object} options Combined score inputs.
 * @param {number} options.aiLikeness AI-likeness score, lower is better.
 * @param {number} options.fidelity Fidelity score, higher is better.
 * @param {string} [options.profile] Profile name for configured weights.
 * @param {object} [options.config] Effective config.
 * @param {number|object|null} [options.deterministicScore] Optional deterministic score.
 * @returns {number} Combined score, lower is better.
 * @example
 * const score = combinedScore({ aiLikeness: 20, fidelity: 90, profile: 'default', config: {} });
 */
export function combinedScore({ aiLikeness, fidelity, profile, config, deterministicScore }) {
  const profileWeights = config?.ouroboros?.['combined-weights']?.[profile];
  const ai = profileWeights?.['ai-likeness'] ?? 0.6;
  const fid = profileWeights?.fidelity ?? 0.4;
  const deterministicWeight = deterministicScoringOptions(config).combinedWeight;
  const deterministic = toFiniteScore(deterministicScore?.overall ?? deterministicScore);
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
  const divergenceThreshold = Math.max(0, positiveNumber(
    cfg['divergence-threshold'] ?? cfg.divergenceThreshold,
    DEFAULT_DETERMINISTIC_DIVERGENCE_THRESHOLD
  ));
  const combinedWeight = Math.max(0, positiveNumber(
    cfg['combined-weight'] ?? cfg.combinedWeight,
    0
  ));
  return { enabled, divergenceThreshold, combinedWeight };
}

function positiveNumber(value, fallback) {
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
    structuralClassifier: { available: false, hot: null, score: null, floor: 0 },
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
