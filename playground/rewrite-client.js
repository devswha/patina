// @ts-check
// Browser-pure rewrite client helpers. No DOM, no Node imports.

import {
  CONTEXT_LIMITS,
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
     * @param {{text:string, tier:string, provider?:string, model?:string, apiKey?:string, proSessionToken?:string}} input
     * @returns {Record<string, unknown>}
     */
    buildRequest({ text, tier, provider, model, apiKey, proSessionToken }) {
      const cleanText = String(text ?? '');
      const isRefine = original != null;
      const body = {
        mode: isRefine ? REWRITE_MODES.REFINE : REWRITE_MODES.FIRST,
        lang,
        tier,
        text: cleanText,
      };

      if (isRefine) {
        Object.assign(body, { original, history: capTurns(turns) });
      }

      if (tier === WEB_TIERS.BYOK) {
        if (provider != null) body.provider = provider;
        if (model != null) body.model = model;
        if (apiKey != null) body.apiKey = apiKey;
      } else if (tier === WEB_TIERS.PRO) {
        // Pro sends ONLY the opaque session token (never the raw license key,
        // and never a caller-chosen provider/model/apiKey — the server picks
        // the enhanced route). Mirrors the G001 contract.
        if (proSessionToken != null) body.proSessionToken = proSessionToken;
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
    const frame = { type: STREAM_FRAME_TYPES.ERROR, status: response.status, error: 'rewrite request failed' };
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
 * Exchange a raw Lemon Squeezy license key for an opaque, short-lived Pro
 * session token (POST /api/pro-session). The raw key is sent ONCE, in the body,
 * and is never retained by this helper — the caller stores only the returned
 * opaque token (recommended: in-memory/session, not persistent). On any
 * non-2xx the returned error carries the server message but never the raw key.
 *
 * @param {{licenseKey:string, fetchImpl?:typeof fetch, url?:string, signal?:AbortSignal}} input
 * @returns {Promise<{ok:true, proSessionToken:string, expiresAt:number, status:string}|{ok:false, status:number, error:string}>}
 */
export async function exchangeProLicense({ licenseKey, fetchImpl = globalThis.fetch, url = '/api/pro-session', signal }) {
  if (typeof licenseKey !== 'string' || licenseKey.trim().length === 0) {
    return { ok: false, status: 400, error: 'licenseKey required' };
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
      signal,
    });
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data || typeof data.proSessionToken !== 'string') {
    // Scrub the submitted raw key from any server-provided error text before
    // returning it: a buggy/hostile server that echoes the key back must never
    // cause this helper to retain the raw license key in its result.
    const raw = (data && typeof data.error === 'string') ? data.error : 'pro exchange failed';
    const error = raw.split(licenseKey).join('[REDACTED]');
    return { ok: false, status: response.status || 502, error };
  }
  return { ok: true, proSessionToken: data.proSessionToken, expiresAt: data.expiresAt, status: data.status };
}
