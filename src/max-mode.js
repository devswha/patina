import { callLLMMultiple } from './api.js';
import { scoreText, scoreMPS } from './scoring.js';

const DEFAULT_WALL_CLOCK_BUDGET_MS = 300_000;

export async function runMaxMode({
  prompt,
  sourceText,
  models,
  apiKey,
  baseURL,
  config,
  patterns,
  maxConcurrency,
  wallClockBudgetMs = DEFAULT_WALL_CLOCK_BUDGET_MS,
  callLLMMultipleImpl = callLLMMultiple,
  scoreTextImpl = scoreText,
  scoreMPSImpl = scoreMPS,
}) {
  console.error(`[patina-max] Dispatching to ${models.length} models: ${models.join(', ')}`);

  const controller = new AbortController();
  const deadline = Date.now() + wallClockBudgetMs;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    console.error(`[patina-max] MAX wall-clock timeout reached; returning partial results`);
  }, wallClockBudgetMs);

  const candidates = [];
  try {
    const results = await callLLMMultipleImpl({
      prompt,
      models,
      apiKey,
      baseURL,
      maxConcurrency,
      deadline,
      signal: controller.signal,
      onStart: (model) => console.error(`[patina-max] Starting ${model}...`),
      onComplete: (model, ok) => console.error(`[patina-max] ${model} ${ok ? 'completed' : 'failed'}`),
    });

    for (const r of results) {
      if (!r.ok) {
        candidates.push({ model: r.model, ok: false, error: r.error });
        continue;
      }

      let aiScoreResult = null;
      let mpsResult = null;

      if (!timedOut) {
        aiScoreResult = await scoreTextImpl({
          text: r.result,
          config,
          patterns,
          apiKey,
          baseURL,
          model: r.model,
          deadline,
          signal: controller.signal,
        });
      }

      if (!timedOut) {
        mpsResult = await scoreMPSImpl({
          original: sourceText,
          rewritten: r.result,
          apiKey,
          baseURL,
          model: r.model,
          deadline,
          signal: controller.signal,
        });
      }

      candidates.push({
        model: r.model,
        ok: true,
        result: r.result,
        aiScore: aiScoreResult?.overall ?? null,
        mps: mpsResult?.mps ?? null,
      });

      if (timedOut) break;
    }
  } finally {
    clearTimeout(timeout);
  }

  const { candidate: best, fallback } = selectBest(candidates);
  const allFailed = best === null;

  return {
    type: 'max-mode',
    candidates,
    best,
    allFailed,
    mpsFallback: fallback,
    timedOut,
  };
}

export function selectBest(candidates, { log = console.error } = {}) {
  const valid = candidates.filter((c) => c.ok && c.aiScore !== null);

  if (valid.length === 0) {
    return { candidate: null, fallback: false };
  }

  const passingMps = valid.filter((c) => (c.mps ?? 0) >= 70);

  if (passingMps.length > 0) {
    const best = passingMps.reduce((best, current) =>
      // Strict comparison preserves --models config order when AI scores tie.
      (current.aiScore < best.aiScore) ? current : best
    );

    if (passingMps.some((c) => c !== best && c.aiScore === best.aiScore)) {
      log(`[patina-max] Tie on AI score — picked ${best.model} by config order`);
    }

    return { candidate: best, fallback: false };
  }

  const best = valid.reduce((best, current) => {
    const bestMps = best.mps ?? -1;
    const currentMps = current.mps ?? -1;
    // Strict comparison preserves --models config order when MPS scores tie.
    return currentMps > bestMps ? current : best;
  });

  const bestMps = best.mps ?? -1;
  if (valid.some((c) => c !== best && (c.mps ?? -1) === bestMps)) {
    log(`[patina-max] Tie on MPS — picked ${best.model} by config order`);
  }

  return { candidate: best, fallback: true };
}
