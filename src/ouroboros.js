import { callLLM as defaultCallLLM } from './api.js';
import { scoreText, scoreMPS, scoreFidelity, combinedScore } from './scoring.js';
import { buildPrompt } from './prompt-builder.js';
import { createLogger } from './logger.js';

export async function runOuroboros({
  config,
  patterns,
  profile,
  voice,
  scoring,
  text,
  apiKey,
  baseURL,
  model,
  callLLM = defaultCallLLM,
  now,
  sleep,
  signal,
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
  });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const prompt = buildPrompt({
      config,
      patterns,
      profile,
      voice,
      scoring,
      text: currentText,
      mode: 'rewrite',
    });

    const iterationStartedAt = now ? now() : Date.now();
    const humanized = await callLLM({
      prompt,
      apiKey,
      baseURL,
      model,
      now,
      sleep,
      signal,
    });

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
        logger,
      }),
    ]);

    const mps = mpsResult?.mps ?? 100;
    const fidelity = fidelityResult?.fidelity ?? 100;
    const combined = combinedScore({
      aiLikeness: currentScore,
      fidelity,
      profile: config.profile,
      config,
    });
    const combinedDelta = previousCombined - combined;

    let reason = '';
    let shouldStop = false;
    let shouldRollback = false;

    if (currentScore <= targetScore) {
      reason = 'Target met';
      shouldStop = true;
    } else if (combinedDelta < 0) {
      reason = `Regression (combined ${previousCombined} → ${combined})`;
      shouldStop = true;
      shouldRollback = true;
    } else if (fidelity < fidelityFloor) {
      reason = 'Fidelity floor violation';
      shouldStop = true;
      shouldRollback = true;
    } else if (mps < mpsFloor) {
      reason = 'MPS floor violation';
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

  return {
    finalText: currentText,
    finalScore: bestScore,
    iterations: iterationLog.length - 1,
    reason: iterationLog[iterationLog.length - 1]?.reason || 'Completed',
    log: iterationLog,
  };
}

function formatElapsed(ms) {
  return `${Math.round(ms / 100) / 10}s`;
}
