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

  return {
    type: 'max-mode',
    candidates,
    best,
  };
}

function selectBest(candidates) {
  const valid = candidates.filter((c) => c.ok && c.aiScore !== null);

  if (valid.length === 0) {
    return null;
  }

  const passingMps = valid.filter((c) => (c.mps ?? 0) >= 70);

  if (passingMps.length > 0) {
    return passingMps.reduce((best, current) =>
      (current.aiScore < best.aiScore) ? current : best
    );
  }

  return valid.reduce((best, current) => {
    const bestMps = best.mps ?? -1;
    const currentMps = current.mps ?? -1;
    return currentMps > bestMps ? current : best;
  });
}
