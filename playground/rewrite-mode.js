// @ts-check
// Browser entry for the patina REWRITE mode (chat UI). Loaded as its own module
// alongside the audit app, so it is purely additive: it never modifies the
// audit page's app.js/i18n.js/styles.css. It mounts a chat composer, streams
// /api/rewrite NDJSON frames, and renders the live rewrite + MPS/fidelity/diff.
//
// Carries its own EN/KO strings inline (does not touch the audit i18n bundle).

import {
  createRewriteThread,
  streamRewrite,
} from './rewrite-client.js';
import {
  escapeHtml,
  renderMetrics,
  renderSignals,
  renderDiffSummary,
  providerOptions,
} from './chat-ui.js';
import { SUPPORTED_LANGS, WEB_TIERS } from '../src/web-rewrite-contract.js';

const doc = globalThis.document;

const STRINGS = Object.freeze({
  en: {
    modeAudit: 'Audit', modeRewrite: 'Rewrite',
    title: 'Rewrite mode', subtitle: 'patina rewrites your text and preserves the meaning, numbers, and tone. Streamed, with MPS/fidelity floors.',
    lang: 'Language', tier: 'Tier', free: 'Free', byok: 'BYOK',
    provider: 'Provider', model: 'Model', apiKey: 'API key', apiKeyPh: 'sk-… (kept in your browser, sent per request)',
    placeholder: 'Paste the AI-sounding text to humanize…', send: 'Rewrite', refine: 'Refine', sending: 'Rewriting…',
    you: 'You', patina: 'patina', retry: 'Retry',
    floorWarn: 'Rewrite did not meet the meaning/fidelity floor — not applied. Try again or refine.',
    error: 'Something went wrong. Try again.',
    empty: 'Enter some text first.',
  },
  ko: {
    modeAudit: '감사', modeRewrite: '리라이트',
    title: '리라이트 모드', subtitle: 'patina가 의미·숫자·논조를 보존하며 다시 씁니다. 스트리밍, MPS/충실도 하한 적용.',
    lang: '언어', tier: '등급', free: '무료', byok: 'BYOK',
    provider: '프로바이더', model: '모델', apiKey: 'API 키', apiKeyPh: 'sk-… (브라우저에 보관, 요청마다 전송)',
    placeholder: 'AI 티 나는 문장을 붙여넣으세요…', send: '리라이트', refine: '다듬기', sending: '다시 쓰는 중…',
    you: '나', patina: 'patina', retry: '다시 시도',
    floorWarn: '의미/충실도 하한을 통과하지 못해 적용하지 않았습니다. 다시 시도하거나 다듬으세요.',
    error: '문제가 발생했습니다. 다시 시도하세요.',
    empty: '먼저 텍스트를 입력하세요.',
  },
});

function uiLang() {
  const v = doc?.documentElement?.lang;
  return v === 'ko' ? 'ko' : 'en';
}
function t(key) {
  const lang = uiLang();
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
}

/** Build the composer + transcript DOM inside the host section. */
function buildChat(host) {
  const langOpts = SUPPORTED_LANGS
    .map((l) => `<option value="${l}">${l.toUpperCase()}</option>`)
    .join('');
  const providers = providerOptions();
  const providerOpts = providers
    .map((p) => `<option value="${escapeHtml(p.provider)}">${escapeHtml(p.provider)}</option>`)
    .join('');
  const firstModels = (providers[0]?.models ?? [])
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join('');

  host.innerHTML = `
    <div class="rw">
      <div class="rw__head">
        <h2>${escapeHtml(t('title'))}</h2>
        <p class="quiet">${escapeHtml(t('subtitle'))}</p>
      </div>
      <div class="rw__controls">
        <label class="field"><span>${escapeHtml(t('lang'))}</span>
          <select class="rw-lang">${langOpts}</select></label>
        <label class="field"><span>${escapeHtml(t('tier'))}</span>
          <select class="rw-tier">
            <option value="free">${escapeHtml(t('free'))}</option>
            <option value="byok">${escapeHtml(t('byok'))}</option>
          </select></label>
        <label class="field rw-byok" hidden><span>${escapeHtml(t('provider'))}</span>
          <select class="rw-provider">${providerOpts}</select></label>
        <label class="field rw-byok" hidden><span>${escapeHtml(t('model'))}</span>
          <select class="rw-model">${firstModels}</select></label>
        <label class="field rw-byok" hidden><span>${escapeHtml(t('apiKey'))}</span>
          <input class="rw-key" type="password" autocomplete="off" placeholder="${escapeHtml(t('apiKeyPh'))}"></label>
      </div>
      <div class="rw__transcript" aria-live="polite"></div>
      <div class="rw__composer">
        <textarea class="rw-input" rows="4" placeholder="${escapeHtml(t('placeholder'))}"></textarea>
        <button class="button rw-send" type="button">${escapeHtml(t('send'))}</button>
      </div>
      <p class="status rw-status" role="status" aria-live="polite"></p>
    </div>`;

  return {
    langSel: host.querySelector('.rw-lang'),
    tierSel: host.querySelector('.rw-tier'),
    byokFields: [...host.querySelectorAll('.rw-byok')],
    providerSel: host.querySelector('.rw-provider'),
    modelSel: host.querySelector('.rw-model'),
    keyInput: host.querySelector('.rw-key'),
    transcript: host.querySelector('.rw__transcript'),
    input: host.querySelector('.rw-input'),
    send: host.querySelector('.rw-send'),
    status: host.querySelector('.rw-status'),
  };
}

function bubble(role, html) {
  const cls = role === 'user' ? 'rw-msg rw-msg--user' : 'rw-msg rw-msg--patina';
  const who = role === 'user' ? t('you') : t('patina');
  return `<div class="${cls}"><span class="rw-msg__who">${escapeHtml(who)}</span><div class="rw-msg__body">${html}</div></div>`;
}

/**
 * Wire the chat: thread state + streaming + live render. Browser-only.
 * @param {Element} host
 */
export function initRewriteChat(host) {
  if (!host) return null;
  const el = buildChat(host);
  let thread = createRewriteThread({ lang: el.langSel.value });

  const setLang = () => { thread = createRewriteThread({ lang: el.langSel.value }); el.transcript.innerHTML = ''; };
  el.langSel.addEventListener('change', setLang);

  const syncTier = () => {
    const byok = el.tierSel.value === WEB_TIERS.BYOK;
    for (const f of el.byokFields) f.hidden = !byok;
  };
  el.tierSel.addEventListener('change', syncTier);
  syncTier();

  el.providerSel.addEventListener('change', () => {
    const found = providerOptions().find((p) => p.provider === el.providerSel.value);
    el.modelSel.innerHTML = (found?.models ?? [])
      .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      .join('');
  });

  let busy = false;
  async function run() {
    if (busy) return;
    const text = String(el.input.value || '').trim();
    if (!text) { el.status.textContent = t('empty'); return; }
    busy = true;
    el.send.disabled = true;
    el.status.textContent = t('sending');

    const tier = el.tierSel.value;
    // buildRequest is pure: thread state (original/history) is committed ONLY on
    // an accepted done frame, so a floor/error turn never poisons the next request.
    const body = thread.buildRequest({
      text,
      tier,
      provider: tier === WEB_TIERS.BYOK ? el.providerSel.value : undefined,
      model: tier === WEB_TIERS.BYOK ? el.modelSel.value : undefined,
      apiKey: tier === WEB_TIERS.BYOK ? (el.keyInput.value || undefined) : undefined,
    });
    // Display-only bubbles for this attempt; removed on failure (not committed).
    el.transcript.insertAdjacentHTML('beforeend', bubble('user', escapeHtml(text)));
    const userBubble = el.transcript.lastElementChild;
    const liveId = `rw-live-${Date.now()}`;
    el.transcript.insertAdjacentHTML('beforeend', bubble('assistant', `<span id="${liveId}"></span>`));
    const assistantBubble = el.transcript.lastElementChild;
    const live = doc.getElementById(liveId);

    const rollback = (msg) => {
      // Fail-closed UX: drop the rejected attempt's bubbles, keep thread state
      // unchanged, restore the input so Retry resends the same text.
      assistantBubble?.remove();
      userBubble?.remove();
      el.input.value = text;
      el.transcript.insertAdjacentHTML('beforeend',
        `<div class="rw-msg rw-msg--patina"><p class="rw-warn">${escapeHtml(msg)} <button class="button secondary rw-retry" type="button">${escapeHtml(t('retry'))}</button></p></div>`);
      el.status.textContent = msg;
    };

    let acc = '';
    await streamRewrite({
      body,
      onDelta: (chunk) => { acc += chunk; if (live) live.textContent = acc; },
      onDone: (frame) => {
        const f = /** @type {any} */ (frame) ?? {};
        const finalText = f.rewrite ?? acc;
        // Commit thread state only now that the rewrite is accepted.
        thread.commit({ userText: text, assistantText: finalText });
        if (live) live.textContent = finalText;
        const extra = renderMetrics({ mps: f.mps?.mps, fidelity: f.fidelity?.fidelity })
          + renderSignals(f.signals)
          + renderDiffSummary(f.diff);
        live?.closest('.rw-msg__body')?.insertAdjacentHTML('beforeend', extra);
        el.status.textContent = '';
        el.send.textContent = t('refine');
        el.input.value = ''; // clear only on success
      },
      onError: (frame) => {
        rollback(frame?.code === 'floor_failed' ? t('floorWarn') : t('error'));
      },
    }).catch(() => { rollback(t('error')); });

    busy = false;
    el.send.disabled = false;
  }

  el.send.addEventListener('click', run);
  el.transcript.addEventListener('click', (ev) => {
    if (ev.target && /** @type {Element} */ (ev.target).classList?.contains('rw-retry')) run();
  });

  return { run, el };
}

/** Wire the audit<->rewrite mode toggle. Audit stays the default. */
export function initModeToggle() {
  if (!doc) return;
  const toggle = doc.getElementById('mode-toggle');
  const rewriteSection = doc.getElementById('rewrite-mode');
  const workspace = doc.querySelector('main.workspace');
  if (!toggle || !rewriteSection || !workspace) return;

  // Label the toggle from our own strings (the audit i18n bundle has no chat keys).
  const relabel = () => {
    const a = toggle.querySelector('[data-mode="audit"]');
    const r = toggle.querySelector('[data-mode="rewrite"]');
    if (a) a.textContent = t('modeAudit');
    if (r) r.textContent = t('modeRewrite');
  };
  relabel();
  // Re-label when the audit page's interface language changes.
  for (const radio of Array.from(doc.querySelectorAll('input[name="ui-lang"]'))) {
    radio.addEventListener('change', () => setTimeout(relabel, 0));
  }

  let inited = false;
  const apply = (mode) => {
    const rewrite = mode === 'rewrite';
    rewriteSection.hidden = !rewrite;
    /** @type {HTMLElement} */ (workspace).hidden = rewrite;
    if (rewrite && !inited) { initRewriteChat(rewriteSection.querySelector('.rw-host')); inited = true; }
    for (const btn of Array.from(toggle.querySelectorAll('[data-mode]'))) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-mode') === mode));
    }
  };
  toggle.addEventListener('click', (ev) => {
    const btn = /** @type {Element} */ (ev.target)?.closest?.('[data-mode]');
    if (btn) apply(btn.getAttribute('data-mode'));
  });
  apply('audit');
}

if (doc) {
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initModeToggle);
  else initModeToggle();
}
