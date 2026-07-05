// @ts-check
import { callLLMStream as defaultStream } from './streaming-api.js';
import { scoreDeterministicSignals, scoreFidelity, scoreMPS } from './scoring.js';
import { formatRewriteBodyForBrowser } from './output.js';
import { loadWebConfig, resolveBundleRoot } from './web-config.js';
import { buildWebRewritePrompt, loadWebAssets } from './web-rewrite.js';
import { evaluateFloors, redactSecrets, STREAM_FRAME_TYPES } from './web-rewrite-contract.js';

/**
 * Extract a score field RAW (no coercion) so evaluateFloors can strictly reject
 * non-numbers. evaluateFloors requires a finite number >= floor, so a string,
 * object, array, or missing value fails closed — "95" must NOT become 95.
 * @param {unknown} score
 * @param {string} field
 */
function rawScore(score, field) {
  return /** @type {any} */ (score)?.[field];
}

/** @param {unknown} err */
function safeError(err) {
  return String(redactSecrets(/** @type {any} */ (err)?.message ?? err ?? 'unknown error'));
}

/** @param {unknown} value */
function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/**
 * @param {string} before
 * @param {string} after
 */
function summarizeDiff(before, after) {
  const beforeWords = before.trim() ? before.trim().split(/\s+/).length : 0;
  const afterWords = after.trim() ? after.trim().split(/\s+/).length : 0;
  return {
    beforeChars: before.length,
    afterChars: after.length,
    charDelta: after.length - before.length,
    beforeWords,
    afterWords,
    wordDelta: afterWords - beforeWords,
  };
}

/**
 * Stream a web rewrite and emit contract frames. A successful stream is start -> delta* -> done;
 * stream failures and scoring floor failures emit terminal error frames with no success done.
 *
 * @param {object} options
 * @param {object} options.request Validated web rewrite request.
 * @param {object} [options.config] Web-safe config.
 * @param {string} [options.repoRoot] Bundle root.
 * @param {Function} [options.callLLMStream] Streaming LLM client.
 * @param {{scoreMPS?: Function, scoreFidelity?: Function, scoreDeterministicSignals?: Function}} [options.scoreFns] Injectable scorers.
 * @param {(frame: object) => void} options.emit Frame sink.
 * @param {AbortSignal} [options.signal] Abort signal.
 * @param {number} [options.timeout] Timeout in milliseconds.
 * @returns {Promise<object>} Small result summary.
 */
export async function runWebRewriteStream({
  request,
  repoRoot = resolveBundleRoot(),
  config = loadWebConfig({ repoRoot }),
  callLLMStream = defaultStream,
  scoreFns = {},
  emit,
  signal,
  timeout,
}) {
  if (typeof emit !== 'function') throw new TypeError('emit must be a function');
  const effectiveConfig = cloneConfig(config);
  effectiveConfig.language = request.lang;
  effectiveConfig.profile = effectiveConfig.profile || 'default';
  const profile = effectiveConfig.profile;
  const assets = loadWebAssets({ repoRoot, lang: request.lang, profile, config: effectiveConfig, personaId: request.persona });
  const prompt = buildWebRewritePrompt({ request, config: effectiveConfig, assets });

  emit({ type: STREAM_FRAME_TYPES.START, provider: request.provider, model: request.model });

  let rewrite = '';
  try {
    const streamResult = await callLLMStream({
      prompt,
      apiKey: request.apiKey,
      baseURL: request.baseURL,
      model: request.model,
      signal,
      timeout,
      onDelta: (text) => {
        emit({ type: STREAM_FRAME_TYPES.DELTA, text });
      },
    });
    rewrite = formatRewriteBodyForBrowser(streamResult.text);
  } catch (err) {
    const error = safeError(err);
    emit({ type: STREAM_FRAME_TYPES.ERROR, code: 'stream_failed', error });
    return { ok: false, code: 'stream_failed', error };
  }

  const original = String(request.original ?? request.text ?? '');
  const mpsScore = scoreFns.scoreMPS || scoreMPS;
  const fidelityScore = scoreFns.scoreFidelity || scoreFidelity;
  const deterministicScore = scoreFns.scoreDeterministicSignals || scoreDeterministicSignals;

  let mps, fidelity, signals, diff;
  try {
    [mps, fidelity] = await Promise.all([
      mpsScore({ original, rewritten: rewrite, apiKey: request.apiKey, baseURL: request.baseURL, model: request.model, signal, timeout }),
      fidelityScore({ original, rewritten: rewrite, apiKey: request.apiKey, baseURL: request.baseURL, model: request.model, signal, timeout }),
    ]);
    signals = {
      before: deterministicScore({ text: original, config: effectiveConfig, repoRoot }),
      after: deterministicScore({ text: rewrite, config: effectiveConfig, repoRoot }),
    };
    diff = summarizeDiff(original, rewrite);
  } catch (err) {
    // A scoring failure (including an abort during scoring) must terminate as
    // a clean NDJSON error frame — never bubble to the handler's JSON 500,
    // which would append a non-frame tail to an already-started stream.
    const error = safeError(err);
    emit({ type: STREAM_FRAME_TYPES.ERROR, code: 'scoring_failed', error });
    return { ok: false, code: 'scoring_failed', error };
  }

  // Pass the raw score values to evaluateFloors, which strictly requires a
  // finite number >= floor (a non-number fails closed). No Number() coercion.
  const floors = evaluateFloors({ mps: rawScore(mps, 'mps'), fidelity: rawScore(fidelity, 'fidelity') });
  if (!floors.ok) {
    // Keep the already-computed audit metadata (deterministic signals + length
    // diff) on floor failures so a flagged attempt stays auditable in the UI.
    emit({ type: STREAM_FRAME_TYPES.ERROR, code: 'floor_failed', failed: floors.failed, rewrite, mps, fidelity, signals, diff });
    return { ok: false, code: 'floor_failed', failed: floors.failed, mps, fidelity, signals, diff };
  }

  emit({ type: STREAM_FRAME_TYPES.DONE, rewrite, mps, fidelity, signals, diff });
  return { ok: true, rewrite, mps, fidelity, signals, diff };
}
