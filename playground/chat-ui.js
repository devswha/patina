// @ts-check
// Pure chat rendering helpers for the browser rewrite surface.

import {
  FIDELITY_FLOOR,
  MPS_FLOOR,
  PROVIDER_PRESETS,
} from '../src/web-rewrite-contract.js';

const ROLE_CLASS = Object.freeze({
  user: 'rewrite-chat__message--user',
  assistant: 'rewrite-chat__message--assistant',
  system: 'rewrite-chat__message--system',
});

/**
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {{role:string, text:string}} message
 * @returns {string}
 */
export function renderMessage({ role, text }) {
  const safeRole = role === 'user' || role === 'assistant' ? role : 'system';
  const className = ROLE_CLASS[safeRole];
  return `<article class="rewrite-chat__message ${className}" data-role="${safeRole}"><div class="rewrite-chat__role">${escapeHtml(safeRole)}</div><div class="rewrite-chat__text">${escapeHtml(text)}</div></article>`;
}

function formatMetric(value) {
  return Number.isFinite(value) ? String(Math.round(Number(value))) : '—';
}

/**
 * @param {{mps?:number, fidelity?:number, floorFailed?:boolean}} metrics
 * @returns {string}
 */
export function renderMetrics({ mps, fidelity, floorFailed } = {}) {
  const mpsFailed = Number.isFinite(mps) && Number(mps) < MPS_FLOOR;
  const fidelityFailed = Number.isFinite(fidelity) && Number(fidelity) < FIDELITY_FLOOR;
  const showWarning = Boolean(floorFailed || mpsFailed || fidelityFailed);
  const warning = showWarning
    ? `<p class="rewrite-metrics__warning" role="alert">Meaning-preservation or fidelity floor warning.</p>`
    : '';

  return `<details class="rewrite-metrics"><summary>Rewrite metrics</summary><dl><dt>MPS</dt><dd>${escapeHtml(formatMetric(mps))}</dd><dt>Fidelity</dt><dd>${escapeHtml(formatMetric(fidelity))}</dd></dl>${warning}</details>`;
}

/**
 * @param {unknown} diff
 * @returns {string}
 */
export function renderDiffSummary(diff) {
  const value = /** @type {any} */ (diff ?? {});
  const before = value.before ?? value.original ?? value.from ?? '';
  const after = value.after ?? value.rewrite ?? value.to ?? '';
  const summary = value.summary ?? value.label ?? 'Rewrite diff';
  return `<section class="rewrite-diff"><h3>${escapeHtml(summary)}</h3><div class="rewrite-diff__grid"><article><h4>Before</h4><p>${escapeHtml(before)}</p></article><article><h4>After</h4><p>${escapeHtml(after)}</p></article></div></section>`;
}

/**
 * Pick the deterministic AI-signal scalar from a scoreDeterministicSignals
 * payload, tolerant of field naming. Non-numeric => NaN (renders as em dash).
 * @param {unknown} payload
 * @returns {number}
 */
function pickSignalScore(payload) {
  const p = /** @type {any} */ (payload ?? {});
  const v = p.signalScore ?? p.score ?? p.overall ?? p.aiLikeness;
  return Number.isFinite(v) ? Number(v) : NaN;
}

/**
 * Render the before/after deterministic AI-signal comparison (AC2). Always
 * returns a stable .rewrite-signals element so the absence of signals is still
 * visible (em dash), never silently dropped.
 * @param {{before?:unknown, after?:unknown}} [signals]
 * @returns {string}
 */
export function renderSignals(signals) {
  const s = /** @type {any} */ (signals ?? {});
  const before = pickSignalScore(s.before);
  const after = pickSignalScore(s.after);
  return `<details class="rewrite-signals"><summary>AI signals (before \u2192 after)</summary><dl><dt>Before</dt><dd>${escapeHtml(formatMetric(before))}</dd><dt>After</dt><dd>${escapeHtml(formatMetric(after))}</dd></dl></details>`;
}

/**
 * @returns {Array<{provider:string, baseURL:string, models:string[]}>}
 */
export function providerOptions() {
  return Object.entries(PROVIDER_PRESETS).map(([provider, preset]) => ({
    provider,
    baseURL: preset.baseURL,
    models: [...preset.models],
  }));
}

/**
 * Thin browser integration seam. Branching/rendering logic stays in pure helpers.
 *
 * @param {Element} rootEl
 * @param {{messages?: Array<{role:string,text:string}>, metrics?: {mps?:number,fidelity?:number,floorFailed?:boolean}, diff?: unknown}} [deps]
 * @returns {{render(messages?: Array<{role:string,text:string}>): void}}
 */
export function mountChat(rootEl, deps = {}) {
  const render = (messages = deps.messages ?? []) => {
    rootEl.innerHTML = [
      ...messages.map(renderMessage),
      deps.metrics ? renderMetrics(deps.metrics) : '',
      deps.diff ? renderDiffSummary(deps.diff) : '',
    ].join('');
  };
  render();
  return { render };
}
