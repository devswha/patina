// @ts-check
// patina chat — full-page ChatGPT-style controller.
// Reuses the isomorphic streaming client + contract; renders via safe DOM APIs.
import { createRewriteThread, streamRewrite } from './rewrite-client.js';
import {
  PROVIDER_PRESETS,
  WEB_TIERS,
  MPS_FLOOR,
  FIDELITY_FLOOR,
} from '../src/web-rewrite-contract.js';

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

const els = {
  app: $('#app'),
  sidebar: $('#sidebar'),
  history: $('#history'),
  newChat: $('#new-chat'),
  toggleSidebar: $('#toggle-sidebar'),
  thread: $('#thread'),
  empty: $('#empty'),
  chips: $('#chips'),
  composer: /** @type {HTMLFormElement} */ ($('#composer')),
  input: /** @type {HTMLTextAreaElement} */ ($('#input')),
  send: /** @type {HTMLButtonElement} */ ($('#send')),
  lang: /** @type {HTMLSelectElement} */ ($('#lang')),
  tier: /** @type {HTMLSelectElement} */ ($('#tier')),
  provider: /** @type {HTMLSelectElement} */ ($('#provider')),
  model: /** @type {HTMLSelectElement} */ ($('#model')),
  apiKey: /** @type {HTMLInputElement} */ ($('#api-key')),
  providerCtl: $('#provider-ctl'),
  modelCtl: $('#model-ctl'),
  keyCtl: $('#key-ctl'),
};

const SAMPLES = {
  ko: [
    { t: '마케팅 문구', x: '본 솔루션은 혁신적인 시너지를 활용하여 고객에게 전례 없는 가치를 원활하게 제공합니다.' },
    { t: '보고서 톤', x: '결론적으로, 이러한 다각적인 접근 방식은 조직의 역량을 한층 더 제고하는 데 기여할 것으로 사료됩니다.' },
  ],
  en: [
    { t: 'Marketing copy', x: 'Our cutting-edge, best-in-class solution leverages synergies to seamlessly deliver world-class value at scale.' },
    { t: 'Announcement', x: 'We are thrilled to announce that our innovative platform will revolutionize the way you work.' },
  ],
  zh: [
    { t: '营销文案', x: '本解决方案充分利用前沿协同效应，无缝赋能客户，释放前所未有的价值。' },
    { t: '正式语气', x: '综上所述，这种多元化的方法将进一步全面提升组织的核心竞争力。' },
  ],
  ja: [
    { t: 'マーケ文', x: '本ソリューションは革新的なシナジーを活用し、お客様にかつてない価値をシームレスに提供します。' },
    { t: '報告調', x: '結論として、この多角的なアプローチは組織の能力を一層向上させることに寄与すると考えられます。' },
  ],
};

/** @typedef {{id:string,title:string,messages:Array<{role:string,text:string,meta?:object}>,thread:ReturnType<typeof createRewriteThread>}} Convo */

const state = {
  /** @type {Convo[]} */ convos: [],
  /** @type {string|null} */ activeId: null,
  busy: false,
};

function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function activeConvo() { return state.convos.find((c) => c.id === state.activeId) || null; }

// ---------- element helpers (safe by construction) ----------
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- provider/model + tier wiring ----------
function populateProviders() {
  els.provider.innerHTML = '';
  for (const name of Object.keys(PROVIDER_PRESETS)) {
    els.provider.appendChild(new Option(name, name));
  }
  populateModels();
}
function populateModels() {
  const preset = PROVIDER_PRESETS[els.provider.value];
  els.model.innerHTML = '';
  for (const m of (preset?.models || [])) els.model.appendChild(new Option(m, m));
}
function syncTier() {
  const byok = els.tier.value === WEB_TIERS.BYOK;
  for (const c of [els.providerCtl, els.modelCtl, els.keyCtl]) c.hidden = !byok;
}

// ---------- empty-state samples ----------
function renderChips() {
  els.chips.innerHTML = '';
  const list = SAMPLES[els.lang.value] || SAMPLES.en;
  for (const s of list) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.appendChild(el('b', null, s.t));
    chip.appendChild(document.createTextNode(s.x));
    chip.addEventListener('click', () => {
      els.input.value = s.x;
      autoGrow();
      updateSendState();
      els.input.focus();
    });
    els.chips.appendChild(chip);
  }
}

// ---------- conversation lifecycle ----------
function newConvo() {
  const convo = { id: uid(), title: '새 대화', messages: [], thread: createRewriteThread({ lang: els.lang.value }) };
  state.convos.unshift(convo);
  state.activeId = convo.id;
  renderSidebar();
  renderThread();
}

function renderSidebar() {
  els.history.innerHTML = '';
  for (const c of state.convos) {
    const item = el('button', 'histitem' + (c.id === state.activeId ? ' active' : ''), c.title);
    item.type = 'button';
    item.addEventListener('click', () => { state.activeId = c.id; renderSidebar(); renderThread(); closeMobileSidebar(); });
    els.history.appendChild(item);
  }
}

function renderThread() {
  const convo = activeConvo();
  els.thread.innerHTML = '';
  if (!convo || convo.messages.length === 0) {
    els.thread.appendChild(els.empty);
    els.empty.hidden = false;
    return;
  }
  const inner = el('div', 'thread__inner');
  for (const m of convo.messages) {
    if (m.role === 'user') inner.appendChild(buildUserMsg(m.text));
    else {
      const { node, textEl } = buildPatinaMsg();
      textEl.textContent = m.text;
      if (m.meta) node.querySelector('.msg__body').appendChild(buildMeta(m.meta));
      inner.appendChild(node);
    }
  }
  els.thread.appendChild(inner);
  scrollDown();
}

function ensureInner() {
  let inner = els.thread.querySelector('.thread__inner');
  if (!inner) {
    els.empty.hidden = true;
    if (els.empty.parentElement === els.thread) els.thread.removeChild(els.empty);
    inner = el('div', 'thread__inner');
    els.thread.appendChild(inner);
  }
  return inner;
}

// ---------- message builders ----------
function buildUserMsg(text) {
  const msg = el('div', 'msg msg--user');
  const body = el('div', 'msg__body', text);
  msg.appendChild(body);
  return msg;
}

function buildPatinaMsg() {
  const msg = el('div', 'msg msg--patina');
  msg.appendChild(el('div', 'msg__avatar', 'p'));
  const body = el('div', 'msg__body');
  const textEl = el('div', 'msg__text');
  body.appendChild(textEl);
  msg.appendChild(body);
  return { node: msg, body, textEl };
}

function buildTyping() {
  const t = el('div', 'typing');
  t.appendChild(el('span')); t.appendChild(el('span')); t.appendChild(el('span'));
  return t;
}

function fmt(v) { return Number.isFinite(v) ? String(Math.round(Number(v))) : '—'; }

function buildMeta(meta) {
  const wrap = el('div', 'meta');
  const badges = el('div', 'badges');

  const mps = Number(meta?.mps?.mps ?? meta?.mps);
  const fid = Number(meta?.fidelity?.fidelity ?? meta?.fidelity);
  const floorFailed = meta?.floorFailed || (Number.isFinite(mps) && mps < MPS_FLOOR) || (Number.isFinite(fid) && fid < FIDELITY_FLOOR);

  badges.appendChild(badge('MPS', fmt(mps), Number.isFinite(mps) && mps >= MPS_FLOOR));
  badges.appendChild(badge('Fidelity', fmt(fid), Number.isFinite(fid) && fid >= FIDELITY_FLOOR));
  if (floorFailed) {
    const b = el('span', 'badge badge--warn');
    b.appendChild(el('b', null, '⚠ floor 미달'));
    badges.appendChild(b);
  }
  wrap.appendChild(badges);

  // AI signals before -> after
  const before = meta?.signals?.before?.signalScore;
  const after = meta?.signals?.after?.signalScore;
  if (before != null || after != null) {
    const det = el('details', 'foldout');
    det.appendChild(el('summary', null, 'AI 신호 (전 → 후)'));
    const b = el('div', 'foldout__body');
    const bar = el('div', 'signal-bar');
    bar.appendChild(el('span', null, `핫 문단 비율 ${before == null ? '—' : before} `));
    bar.appendChild(el('span', 'arrow', '→'));
    bar.appendChild(el('span', null, ` ${after == null ? '—' : after}`));
    b.appendChild(bar);
    det.appendChild(b);
    wrap.appendChild(det);
  }

  // before / after diff
  if (meta?.diff?.before != null) {
    const det = el('details', 'foldout');
    det.appendChild(el('summary', null, '원문 / 결과 비교'));
    const b = el('div', 'foldout__body');
    const r1 = el('div', 'diffrow'); r1.appendChild(el('span', 'k', '원문')); r1.appendChild(el('span', null, String(meta.diff.before)));
    const r2 = el('div', 'diffrow'); r2.appendChild(el('span', 'k', '결과')); r2.appendChild(el('span', null, String(meta.diff.after ?? '')));
    b.appendChild(r1); b.appendChild(r2);
    det.appendChild(b);
    wrap.appendChild(det);
  }
  return wrap;
}

function badge(label, value, ok) {
  const b = el('span', 'badge' + (ok ? ' badge--ok' : ''));
  b.appendChild(document.createTextNode(label + ' '));
  b.appendChild(el('b', null, value));
  return b;
}

// ---------- send flow ----------
async function send(text) {
  if (state.busy) return;
  const clean = text.trim();
  if (!clean) return;

  let convo = activeConvo();
  if (!convo) { newConvo(); convo = activeConvo(); }
  if (!convo) return;

  state.busy = true;
  updateSendState();

  // user message
  convo.messages.push({ role: 'user', text: clean });
  if (convo.title === '새 대화') { convo.title = clean.slice(0, 40); renderSidebar(); }
  const inner = ensureInner();
  inner.appendChild(buildUserMsg(clean));

  // patina placeholder + typing
  const { node, body, textEl } = buildPatinaMsg();
  textEl.style.display = 'none';
  const typing = buildTyping();
  body.appendChild(typing);
  inner.appendChild(node);
  scrollDown();

  els.input.value = '';
  autoGrow();

  const tier = els.tier.value;
  const reqBody = convo.thread.buildRequest({
    text: clean,
    tier,
    provider: els.provider.value,
    model: els.model.value,
    apiKey: els.apiKey.value,
  });

  let streamingStarted = false;
  const startStreaming = () => {
    if (streamingStarted) return;
    streamingStarted = true;
    if (typing.parentElement) typing.remove();
    textEl.style.display = '';
    textEl.classList.add('streaming');
  };

  try {
    const { ok, finalFrame } = await streamRewrite({
      body: reqBody,
      onStart: () => {},
      onDelta: (_t, accumulated) => { startStreaming(); textEl.textContent = accumulated; scrollDown(); },
      onDone: (frame) => {
        startStreaming();
        const rewrite = typeof frame.rewrite === 'string' ? frame.rewrite : textEl.textContent;
        textEl.textContent = rewrite;
        textEl.classList.remove('streaming');
        const meta = { mps: frame.mps, fidelity: frame.fidelity, signals: frame.signals, diff: frame.diff, floorFailed: frame.floorFailed };
        body.appendChild(buildMeta(meta));
        convo.messages.push({ role: 'assistant', text: rewrite, meta });
        convo.thread.commit({ userText: clean, assistantText: rewrite });
        scrollDown();
      },
      onError: () => {},
    });

    if (!ok) {
      if (typing.parentElement) typing.remove();
      textEl.style.display = '';
      textEl.classList.remove('streaming');
      const status = finalFrame?.status ? ` (HTTP ${finalFrame.status})` : '';
      const note = el('div', 'error-note', `리라이트에 실패했어요${status}. 잠시 후 다시 시도하거나 모드/키를 확인해 주세요.`);
      body.appendChild(note);
    }
  } catch (e) {
    if (typing.parentElement) typing.remove();
    textEl.style.display = '';
    body.appendChild(el('div', 'error-note', `네트워크 오류: ${String(e?.message || e)}`));
  } finally {
    state.busy = false;
    updateSendState();
    els.input.focus();
  }
}

// ---------- composer UX ----------
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
}
function updateSendState() {
  els.send.disabled = state.busy || els.input.value.trim().length === 0;
}
function scrollDown() { els.thread.scrollTop = els.thread.scrollHeight; }
function closeMobileSidebar() { els.app.classList.remove('sidebar-open'); }

// ---------- events ----------
els.composer.addEventListener('submit', (e) => { e.preventDefault(); send(els.input.value); });
els.input.addEventListener('input', () => { autoGrow(); updateSendState(); });
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(els.input.value); }
});
els.newChat.addEventListener('click', () => { newConvo(); closeMobileSidebar(); els.input.focus(); });
els.toggleSidebar.addEventListener('click', () => { els.app.classList.toggle('sidebar-open'); });
els.lang.addEventListener('change', () => {
  renderChips();
  const convo = activeConvo();
  if (convo) convo.thread = createRewriteThread({ lang: els.lang.value });
});
els.tier.addEventListener('change', syncTier);
els.provider.addEventListener('change', populateModels);

// ---------- init ----------
populateProviders();
syncTier();
renderChips();
newConvo();
updateSendState();
