import { callLLM } from './api.js';
import { scoreText, scoreMPS } from './scoring.js';
import { buildPrompt } from './prompt-builder.js';

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

    const humanized = await callLLM({
      prompt,
      apiKey,
      baseURL,
      model,
    });

    const scoreResult = await scoreText({
      text: humanized,
      config,
      patterns,
      apiKey,
      baseURL,
      model,
    });

    const currentScore = scoreResult?.overall ?? 100;
    const delta = previousScore - currentScore;

    const mpsResult = await scoreMPS({
      original: text,
      rewritten: humanized,
      apiKey,
      baseURL,
      model,
    });

    const mps = mpsResult?.mps ?? 100;

    let reason = '';
    let shouldStop = false;
    let shouldRollback = false;

    if (currentScore <= targetScore) {
      reason = 'Target met';
      shouldStop = true;
    } else if (delta < 0) {
      reason = 'Regression';
      shouldStop = true;
      shouldRollback = true;
    } else if (delta <= plateauThreshold) {
      reason = 'Plateau';
      shouldStop = true;
    } else if (iteration >= maxIterations) {
      reason = 'Max iterations';
      shouldStop = true;
    } else if (mps < mpsFloor) {
      reason = 'MPS floor violation';
      shouldStop = true;
      shouldRollback = true;
    }

    iterationLog.push({
      iteration,
      before: previousScore,
      after: currentScore,
      improvement: delta,
      reason: shouldStop ? reason : '',
    });

    if (shouldRollback) {
      currentText = bestText;
      currentScore = bestScore;
    } else {
      currentText = humanized;
      previousScore = currentScore;

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
