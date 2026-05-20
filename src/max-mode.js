import { callLLM as defaultCallLLM, callLLMMultiple } from './api.js';
import { scoreText, scoreMPS } from './scoring.js';
import { createLogger } from './logger.js';

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
  callLLM = defaultCallLLM,
  now = () => Date.now(),
  sleep,
  callLLMMultipleImpl = callLLMMultiple,
  scoreTextImpl = scoreText,
  scoreMPSImpl = scoreMPS,
  signal,
  logger = createLogger(),
}) {
  logger.info('max.dispatch', {
    message: `[patina-max] Dispatching to ${models.length} models: ${models.join(', ')}`,
  });

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  let cleanupCallerSignal = () => {};
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortFromCaller, { once: true });
      cleanupCallerSignal = () => signal.removeEventListener('abort', abortFromCaller);
    }
  }
  const deadline = now() + wallClockBudgetMs;
  const progressStartedAt = now();
  const modelStatus = new Map(models.map((model) => [model, '...']));
  const modelStartedAt = new Map();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    logger.warn('max.timeout', { message: '[patina-max] MAX wall-clock timeout reached; returning partial results' });
  }, wallClockBudgetMs);

  const renderProgress = () => {
    const statuses = models.map((model) => `${model} ${modelStatus.get(model) || '...'}`).join('  ');
    const elapsedSeconds = Math.max(0, Math.round((now() - progressStartedAt) / 1000));
    logger.progress('max.progress', {
      message: `[patina-max] ${statuses}  (${elapsedSeconds}s)`,
      elapsed_ms: Math.max(0, now() - progressStartedAt),
    });
  };

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
      callLLM,
      now,
      sleep,
      onStart: (model) => {
        modelStartedAt.set(model, now());
        modelStatus.set(model, '...');
        renderProgress();
      },
      onComplete: (model, ok) => {
        const latencyMs = modelStartedAt.has(model) ? Math.max(0, now() - modelStartedAt.get(model)) : undefined;
        modelStatus.set(model, ok ? '✓' : '✗');
        logger.progress('max.model_complete', {
          message: formatMaxProgress(models, modelStatus, progressStartedAt, now),
          model,
          latency_ms: latencyMs,
        });
      },
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
          callLLM,
          logger,
          now,
          sleep,
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
          callLLM,
          logger,
          now,
          sleep,
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
    cleanupCallerSignal();
    logger.closeProgress();
  }

  const { candidate: best, fallback } = selectBest(candidates, {
    log: (message) => logger.warn('max.selection_tie', { message }),
  });
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

export function selectBest(
  candidates,
  { log = (message) => createLogger().warn('max.selection_tie', { message }) } = {}
) {
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

function formatMaxProgress(models, modelStatus, startedAt, now) {
  const statuses = models.map((model) => `${model} ${modelStatus.get(model) || '...'}`).join('  ');
  const elapsedSeconds = Math.max(0, Math.round((now() - startedAt) / 1000));
  return `[patina-max] ${statuses}  (${elapsedSeconds}s)`;
}
