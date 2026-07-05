// @ts-check
// Browser-pure rewrite client helpers. No DOM, no Node imports.

import {
  CONTEXT_LIMITS,
  QUOTA_REASONS,
  REWRITE_MODES,
  STREAM_FRAME_TYPES,
  WEB_TIERS,
  parseStreamFrame,
} from '../src/web-rewrite-contract.js';

/**
 * @typedef {{role:'user'|'assistant', content:string}} RewriteTurn
 */

function capTurns(turns) {
  return turns.slice(-CONTEXT_LIMITS.maxTurns);
}

/**
 * Create a client-held rewrite thread. The server is no-store, so refinement
 * context is carried by the browser on each request.
 *
 * @param {{lang:string}} options
 */
export function createRewriteThread({ lang }) {
  /** @type {string|undefined} */
  let original;
  let currentDraft = '';
  /** @type {RewriteTurn[]} */
  let turns = [];

  return {
    get original() {
      return original;
    },
    get currentDraft() {
      return currentDraft;
    },
    set currentDraft(value) {
      currentDraft = String(value ?? '');
    },
    get turns() {
      return [...turns];
    },


    /**
     * Build a request body WITHOUT mutating thread state. State is only
     * committed on an accepted rewrite (see commit), so a failed/floor-rejected
     * turn never poisons the next request's original/history (fail-closed UX).
     * @param {{text:string, tier:string, provider?:string, model?:string, apiKey?:string, persona?:string}} input
     * @returns {Record<string, unknown>}
     */
    buildRequest({ text, tier, provider, model, apiKey, persona }) {
      const cleanText = String(text ?? '');
      const isRefine = original != null;
      const body = {
        mode: isRefine ? REWRITE_MODES.REFINE : REWRITE_MODES.FIRST,
        lang,
        tier,
        text: cleanText,
      };

      // Voice persona is a voice-only directive (no cost/security escalation),
      // so it applies to both tiers and every turn of a conversation.
      if (persona) body.persona = persona;

      if (isRefine) {
        Object.assign(body, { original, history: capTurns(turns) });
      }

      if (tier === WEB_TIERS.BYOK) {
        if (provider != null) body.provider = provider;
        if (model != null) body.model = model;
        if (apiKey != null) body.apiKey = apiKey;
      }

      return body;
    },

    /**
     * Commit an ACCEPTED rewrite turn: anchor the original on first commit and
     * append the user + assistant turns (capped). Call only after a done frame.
     * @param {{userText:string, assistantText:string}} turn
     */
    commit({ userText, assistantText }) {
      if (original == null) original = String(userText ?? '');
      turns = capTurns([
        ...turns,
        { role: 'user', content: String(userText ?? '') },
        { role: 'assistant', content: String(assistantText ?? '') },
      ]);
      currentDraft = String(assistantText ?? '');
    },

    /**
     * @param {'user'|'assistant'} role
     * @param {string} content
     */
    recordTurn(role, content) {
      turns = capTurns([...turns, { role, content: String(content ?? '') }]);
      if (role === 'assistant') currentDraft = String(content ?? '');
    },

    reset() {
      original = undefined;
      currentDraft = '';
      turns = [];
    },
  };
}

/**
 * Stream a /api/rewrite NDJSON response and dispatch parsed protocol frames.
 *
 * @param {object} options
 * @param {Record<string, unknown>} options.body
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {string} [options.url]
 * @param {(frame: Record<string, unknown>) => void} [options.onStart]
 * @param {(text: string, accumulated: string, frame: Record<string, unknown>) => void} [options.onDelta]
 * @param {(frame: Record<string, unknown>) => void} [options.onDone]
 * @param {(frame: Record<string, unknown>) => void} [options.onError]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:boolean, finalFrame: Record<string, unknown>|null}>}
 */
export async function streamRewrite({
  body,
  fetchImpl = globalThis.fetch,
  url = '/api/rewrite',
  onStart,
  onDelta,
  onDone,
  onError,
  signal,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let reason;
    try {
      const errBody = await response.json();
      if (errBody && typeof errBody.error === 'string') reason = errBody.error;
    } catch { /* non-JSON error body */ }
    const frame = { type: STREAM_FRAME_TYPES.ERROR, status: response.status, error: reason || 'rewrite request failed' };
    onError?.(frame);
    return { ok: false, finalFrame: frame };
  }

  if (!response.body) {
    const frame = { type: STREAM_FRAME_TYPES.ERROR, error: 'empty response body' };
    onError?.(frame);
    return { ok: false, finalFrame: frame };
  }

  const decoder = new globalThis.TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let accumulated = '';
  /** @type {Record<string, unknown>|null} */
  let finalFrame = null;
  let failed = false;

  const dispatchFrame = (/** @type {Record<string, unknown>|null} */ frame) => {
    if (!frame || failed || finalFrame) return;
    if (frame.type === STREAM_FRAME_TYPES.START) {
      onStart?.(frame);
    } else if (frame.type === STREAM_FRAME_TYPES.DELTA) {
      const text = typeof frame.text === 'string' ? frame.text : '';
      accumulated += text;
      onDelta?.(text, accumulated, frame);
    } else if (frame.type === STREAM_FRAME_TYPES.DONE) {
      finalFrame = frame;
      onDone?.(frame);
    } else if (frame.type === STREAM_FRAME_TYPES.ERROR) {
      failed = true;
      finalFrame = frame;
      onError?.(frame);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) dispatchFrame(parseStreamFrame(line));
  }

  buffer += decoder.decode();
  if (buffer) dispatchFrame(parseStreamFrame(buffer));

  if (failed) return { ok: false, finalFrame };
  if (finalFrame?.type === STREAM_FRAME_TYPES.DONE) return { ok: true, finalFrame };

  const frame = { type: STREAM_FRAME_TYPES.ERROR, error: 'stream ended before done' };
  onError?.(frame);
  return { ok: false, finalFrame: frame };
}

/**
 * Stable error kinds for terminal rewrite failures. The UI maps these to
 * localized copy; server reason strings are recognized in exactly one place
 * (here) instead of ad-hoc substring checks scattered through the controller.
 */
export const REWRITE_ERROR_KINDS = Object.freeze({
  QUOTA_DAILY: 'quota_daily',
  QUOTA_HOURLY: 'quota_hourly',
  QUOTA_CONCURRENT: 'quota_concurrent',
  IP_UNAVAILABLE: 'ip_unavailable',
  QUOTA_STORAGE: 'quota_storage',
  QUOTA_SECRET: 'quota_secret',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  TEXT_TOO_LONG: 'text_too_long',
  FLOOR_FAILED: 'floor_failed',
  UNKNOWN: 'unknown',
});

/**
 * Classify a terminal error frame ({status?, code?, error?}) into a stable
 * REWRITE_ERROR_KINDS value. Reason strings come from the shared contract's
 * QUOTA_REASONS (single source of truth for src/rate-limit.js, api/rewrite.js,
 * and this classifier) plus validateRewriteRequest's 413
 * 'text exceeds N characters for tier T'. Unrecognized 429s fall back to
 * QUOTA_HOURLY (retry-shortly copy is the least misleading), unrecognized
 * 5xx to SERVICE_UNAVAILABLE.
 *
 * @param {Record<string, unknown>|null|undefined} frame
 * @returns {string} one of REWRITE_ERROR_KINDS
 */
export function classifyRewriteError(frame) {
  const K = REWRITE_ERROR_KINDS;
  const R = QUOTA_REASONS;
  const status = Number(frame?.status);
  const code = typeof frame?.code === 'string' ? frame.code : '';
  const reason = typeof frame?.error === 'string' ? frame.error.toLowerCase() : '';
  if (code === 'floor_failed') return K.FLOOR_FAILED;
  if (reason.includes(R.DAILY)) return K.QUOTA_DAILY;
  if (reason.includes(R.HOURLY)) return K.QUOTA_HOURLY;
  if (reason.includes(R.CONCURRENT)) return K.QUOTA_CONCURRENT;
  if (reason.includes(R.IP_UNAVAILABLE)) return K.IP_UNAVAILABLE;
  if (reason.includes(R.STORAGE_UNAVAILABLE)) return K.QUOTA_STORAGE;
  if (reason.includes(R.SECRET_UNAVAILABLE)) return K.QUOTA_SECRET;
  if (reason.includes(R.SERVICE_UNAVAILABLE)) return K.SERVICE_UNAVAILABLE;
  if (status === 413 || (reason.includes('exceeds') && reason.includes('characters'))) return K.TEXT_TOO_LONG;
  if (status === 429) return K.QUOTA_HOURLY;
  if (status === 502 || status === 503 || status === 504) return K.SERVICE_UNAVAILABLE;
  return K.UNKNOWN;
}
