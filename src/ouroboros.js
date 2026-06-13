import { callLLM as defaultCallLLM } from './api.js';
import { scoreText, scoreMPS, scoreFidelity, combinedScore } from './scoring.js';
import { buildPrompt } from './prompt-builder.js';
import { stripSelfAudit } from './output.js';
import { createLogger } from './logger.js';

/**
 * Run the iterative Ouroboros rewrite-and-score loop.
 *
 * @param {object} options Ouroboros options.
 * @param {object} options.config Effective config with ouroboros settings.
 * @param {object[]} options.patterns Loaded pattern packs.
 * @param {object|null} options.profile Parsed profile.
 * @param {object|null} options.voice Parsed voice guide.
 * @param {object|null} [options.voiceSample] Optional voice sample payload.
 * @param {object|null} options.scoring Parsed scoring guide.
 * @param {string} options.text Source text to improve.
 * @param {string} [options.apiKey] Provider API key.
 * @param {string} [options.baseURL] Provider base URL.
 * @param {string} [options.model] Model id.
 * @param {Function} [options.callLLM] LLM implementation.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @param {Function} [options.sleep] Sleep helper for tests.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {number} [options.timeout] Per-attempt backend timeout in milliseconds.
 * @param {object} [options.logger] patina logger.
 * @returns {Promise<{finalText: string, finalScore: number, iterations: number, reason: string, log: object[]}>} Final text and iteration log.
 * @throws {Error} When model calls or scoring fail outside handled schema fallbacks.
 * @example
 * const result = await runOuroboros({ config, patterns, profile, voice, scoring, text });
 */
export async function runOuroboros({
  config,
  patterns,
  profile,
  voice,
  voiceSample,
  scoring,
  text,
  apiKey,
  baseURL,
  model,
  callLLM = defaultCallLLM,
  now,
  sleep,
  signal,
  timeout,
  logger = createLogger(),
}) {
  const ouroborosConfig = config.ouroboros || {};
  const targetScore = ouroborosConfig['target-score'] ?? 30;
  const maxIterations = ouroborosConfig['max-iterations'] ?? 3;
  const plateauThreshold = ouroborosConfig['plateau-threshold'] ?? 10;
  const fidelityFloor = ouroborosConfig['fidelity-floor'] ?? 70;
  const mpsFloor = ouroborosConfig['mps-floor'] ?? 70;

  const iterationLog = [];

  const initialScoreResult = await scoreText({
    text,
    config,
    patterns,
    apiKey,
    baseURL,
    model,
    callLLM,
    now,
    sleep,
    signal,
    timeout,
    logger,
  });

  const initialScore = initialScoreResult?.overall ?? 100;

  iterationLog.push({
    iteration: 0,
    before: null,
    after: initialScore,
    improvement: null,
    reason: 'Initial',
  });

  if (initialScore <= targetScore) {
    return {
      finalText: text,
      finalScore: initialScore,
      iterations: 0,
      reason: `Already at target (score: ${initialScore})`,
      log: iterationLog,
    };
  }

  let currentText = text;
  let previousScore = initialScore;
  let bestText = text;
  let bestScore = initialScore;
  // Original is identical to itself, so its fidelity is 100 by definition.
  // This gives iteration 1 a valid combined baseline to detect regressions against.
  let previousCombined = combinedScore({
    aiLikeness: initialScore,
    fidelity: 100,
    profile: config.profile,
    config,
    deterministicScore: initialScoreResult?.deterministicScore,
  });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const prompt = buildPrompt({
      config,
      patterns,
      profile,
      voice,
      voiceSample,
      scoring,
      text: currentText,
      mode: 'rewrite',
    });

    const iterationStartedAt = now ? now() : Date.now();
    const rawOutput = await callLLM({
      prompt,
      apiKey,
      baseURL,
      model,
      now,
      sleep,
      signal,
      timeout,
    });
    // The rewrite prompt asks the model to wrap output in [BODY]/[SELF_AUDIT] tags.
    // Strip them before scoring and before re-feeding: otherwise the AI-likeness
    // score, MPS, and fidelity all see the self-audit meta-commentary, and the next
    // iteration humanizes text with nested tags.
    const humanized = stripSelfAudit(rawOutput, { logger });

    const scoreResult = await scoreText({
      text: humanized,
      config,
      patterns,
      apiKey,
      baseURL,
      model,
      callLLM,
      now,
      sleep,
      signal,
      timeout,
      logger,
    });

    let currentScore = scoreResult?.overall ?? 100;
    const delta = previousScore - currentScore;
    const latencyMs = Math.max(0, (now ? now() : Date.now()) - iterationStartedAt);
    logger.info('ouroboros.iteration', {
      message: `[ouroboros] iter ${iteration}/${maxIterations} score ${previousScore} → ${currentScore} (${formatElapsed(latencyMs)})`,
      model,
      latency_ms: latencyMs,
    });

    const [mpsResult, fidelityResult] = await Promise.all([
      scoreMPS({
        original: text,
        rewritten: humanized,
        apiKey,
        baseURL,
        model,
        callLLM,
        now,
        sleep,
        signal,
        timeout,
        logger,
      }),
      scoreFidelity({
        original: text,
        rewritten: humanized,
        apiKey,
        baseURL,
        model,
        callLLM,
        now,
        sleep,
        signal,
        timeout,
        logger,
      }),
    ]);

    // A failed MPS scorer returns { mps: null }. Treat that as a floor violation
    // (fail closed) rather than defaulting to a passing 100 — scoreFidelity already
    // fails closed (missing criteria clamp to 0), so MPS must match.
    const mps = mpsResult?.mps ?? null;
    const fidelity = fidelityResult?.fidelity ?? 100;
    const combined = combinedScore({
      aiLikeness: currentScore,
      fidelity,
      profile: config.profile,
      config,
      deterministicScore: scoreResult?.deterministicScore,
    });
    const combinedDelta = previousCombined - combined;

    let reason = '';
    let shouldStop = false;
    let shouldRollback = false;

    // Floor checks MUST precede the target-met check (core/scoring.md "Ouroboros
    // Loop Gating": both floors must pass for an iteration to be accepted).
    // Deleting content is the easiest way to drop AI-likeness, so the iteration
    // most likely to violate the floors is exactly the one that meets the target;
    // checking the target first would accept it and promote gutted text to bestText.
    if (fidelity < fidelityFloor) {
      reason = 'Fidelity floor violation';
      shouldStop = true;
      shouldRollback = true;
    } else if (mps === null || mps < mpsFloor) {
      reason = mps === null ? 'MPS scorer failure' : 'MPS floor violation';
      shouldStop = true;
      shouldRollback = true;
    } else if (currentScore <= targetScore) {
      reason = 'Target met';
      shouldStop = true;
    } else if (combinedDelta < 0) {
      reason = `Regression (combined ${previousCombined} → ${combined})`;
      shouldStop = true;
      shouldRollback = true;
    } else if (delta <= plateauThreshold) {
      reason = 'Plateau';
      shouldStop = true;
    } else if (iteration >= maxIterations) {
      reason = 'Max iterations';
      shouldStop = true;
    }

    iterationLog.push({
      iteration,
      before: previousScore,
      after: currentScore,
      improvement: delta,
      fidelity,
      mps,
      combined,
      combinedDelta,
      reason: shouldStop ? reason : '',
    });

    if (shouldRollback) {
      currentText = bestText;
      currentScore = bestScore;
    } else {
      currentText = humanized;
      previousScore = currentScore;
      previousCombined = combined;

      if (currentScore < bestScore) {
        bestText = humanized;
        bestScore = currentScore;
      }
    }

    if (shouldStop) {
      break;
    }
  }

  // Return the best-scoring text with its score. A non-rollback stop (plateau/target/max)
  // leaves currentText at the last iteration, which can score worse than bestScore when
  // combined-score improvements (e.g. fidelity) let an AI-likeness regression through;
  // pairing currentText with bestScore would mislabel that text. bestText is only ever
  // updated on floor-passing iterations, so it is always a safe result.
  return {
    finalText: bestText,
    finalScore: bestScore,
    iterations: iterationLog.length - 1,
    reason: iterationLog[iterationLog.length - 1]?.reason || 'Completed',
    log: iterationLog,
  };
}

function formatElapsed(ms) {
  return `${Math.round(ms / 100) / 10}s`;
}
