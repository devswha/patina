import { callLLMMultiple } from './api.js';
import { scoreText, scoreMPS } from './scoring.js';

export async function runMaxMode({ prompt, sourceText, models, apiKey, baseURL, config, patterns, maxConcurrency }) {
  console.error(`[patina-max] Dispatching to ${models.length} models: ${models.join(', ')}`);

  const results = await callLLMMultiple({
    prompt,
    models,
    apiKey,
    baseURL,
    maxConcurrency,
    onStart: (model) => console.error(`[patina-max] Starting ${model}...`),
    onComplete: (model, ok) => console.error(`[patina-max] ${model} ${ok ? 'completed' : 'failed'}`),
  });

  const candidates = [];
  for (const r of results) {
    if (!r.ok) {
      candidates.push({ model: r.model, ok: false, error: r.error });
      continue;
    }

    const aiScoreResult = await scoreText({
      text: r.result,
      config,
      patterns,
      apiKey,
      baseURL,
      model: r.model,
    });

    const mpsResult = await scoreMPS({
      original: sourceText,
      rewritten: r.result,
      apiKey,
      baseURL,
      model: r.model,
    });

    candidates.push({
      model: r.model,
      ok: true,
      result: r.result,
      aiScore: aiScoreResult?.overall ?? null,
      mps: mpsResult?.mps ?? null,
    });
  }

  const best = selectBest(candidates);
  const valid = candidates.filter((c) => c.ok && c.aiScore !== null);
  const allFailed = best === null;
  const mpsFallback = valid.length > 0 && !valid.some((c) => (c.mps ?? 0) >= 70);

  return {
    type: 'max-mode',
    candidates,
    best,
    allFailed,
    mpsFallback,
  };
}

export function selectBest(candidates, { log = console.error } = {}) {
  const valid = candidates.filter((c) => c.ok && c.aiScore !== null);

  if (valid.length === 0) {
    return null;
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

    return best;
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

  return best;
}
