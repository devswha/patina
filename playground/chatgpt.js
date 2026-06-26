// @ts-check
// patina — Lovable-composition controller: landing (hero prompt + sections) that
// transitions into a chat view. Reuses the isomorphic streaming client + contract;
// renders via safe DOM APIs.
import { createRewriteThread, streamRewrite } from './rewrite-client.js';
import {
  PROVIDER_PRESETS,
  WEB_TIERS,
  MPS_FLOOR,
  FIDELITY_FLOOR,
} from '../src/web-rewrite-contract.js';

// Browser globals (eslint config declares only Node globals; sibling modules use
// the same globalThis convention — e.g. rewrite-client.js).
const { document, Option } = globalThis;
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

const els = {
  app: $('#app'),
  // nav controls (shared by landing + chat)
  lang: /** @type {HTMLSelectElement} */ ($('#lang')),
  tier: /** @type {HTMLSelectElement} */ ($('#tier')),
  provider: /** @type {HTMLSelectElement} */ ($('#provider')),
  model: /** @type {HTMLSelectElement} */ ($('#model')),
  apiKey: /** @type {HTMLInputElement} */ ($('#api-key')),
  providerCtl: $('#provider-ctl'),
  modelCtl: $('#model-ctl'),
  keyCtl: $('#key-ctl'),
  homeLink: $('#home-link'),
  // landing hero
  heroForm: /** @type {HTMLFormElement} */ ($('#hero-form')),
  heroInput: /** @type {HTMLTextAreaElement} */ ($('#hero-input')),
  heroSend: /** @type {HTMLButtonElement} */ ($('#hero-send')),

  suggest: $('#suggest'),
  exampleCards: $('#example-cards'),
  // chat view
  chat: $('#chat'),
  sidebar: $('#sidebar'),
  history: $('#history'),
  newChat: $('#new-chat'),
  toggleSidebar: $('#toggle-sidebar'),
  thread: $('#thread'),
  composer: /** @type {HTMLFormElement} */ ($('#composer')),
  input: /** @type {HTMLTextAreaElement} */ ($('#input')),
  send: /** @type {HTMLButtonElement} */ ($('#send')),
};

const LANG_NAME = { ko: '한국어', en: 'English', zh: '中文', ja: '日本語' };

// Localized landing copy — the description follows the selected language.
const I18N = {
  en: {
    title: 'Make it sound <span class="grad">human</span>',
    sub: 'Paste AI-sounding text — patina rewrites it naturally. KO·EN·ZH·JA.',
    promptPh: 'Paste the text you want to clean up…',
    howTitle: 'Three steps',
    steps: [['1 · Paste', 'Drop in your AI-sounding draft. No code, no key.'], ['2 · Rewrite', 'patina clears ~160 patterns and rewrites it naturally.'], ['3 · Verify', 'Check MPS, fidelity, and the AI signal (before → after).']],
    examplesTitle: 'Before and after',
    stats: ['catalogued patterns', 'languages · KO·EN·ZH·JA', 'deterministic signals', 'in-browser audit'],
    note: 'Deterministic humanizer —<br />same claim, numbers, tone.',
    hint: 'patina changes only the wording — never the claim, numbers, or causation. This demo rewrites via a local CLI; MPS/fidelity are preview values.',
    chatPh: 'Keep refining…  (Enter to send · Shift+Enter for newline)',
    newchat: 'New chat',
  },
  ko: {
    title: 'AI 티 없이, <span class="grad">자연스럽게</span>',
    sub: 'AI 티 나는 문장을 붙여넣으면 patina가 자연스럽게 다듬어요. KO·EN·ZH·JA.',
    promptPh: '다듬고 싶은 문장을 붙여넣어 보세요…',
    howTitle: '세 단계면 끝',
    steps: [['1 · 붙여넣기', 'AI 티 나는 초안을 그대로 붙여넣어요. 코드도 키도 필요 없어요.'], ['2 · 다듬기', 'patina가 ~160개 패턴을 걷어내고 자연스럽게 고쳐요.'], ['3 · 검증', 'MPS·fidelity·AI 신호(전→후)로 의미 보존을 확인해요.']],
    examplesTitle: '이런 문장을, 이렇게',
    stats: ['카탈로그 패턴', '지원 언어 · KO·EN·ZH·JA', '결정론 신호', '브라우저 audit'],
    note: '의미·숫자·톤을 바꾸지 않는<br />결정론적 휴머나이저.',
    hint: 'patina는 주장·수치·인과를 바꾸지 않고 표현만 다듬습니다. 데모는 로컬 CLI로 리라이트하며 MPS/fidelity는 프리뷰 값입니다.',
    chatPh: '이어서 다듬기…  (Enter 전송 · Shift+Enter 줄바꿈)',
    newchat: '새 대화',
  },
  zh: {
    title: '让文字更<span class="grad">像人写的</span>',
    sub: '粘贴有 AI 味的文字，patina 会自然地改写。支持 KO·EN·ZH·JA。',
    promptPh: '粘贴你想润色的文字…',
    howTitle: '三步搞定',
    steps: [['1 · 粘贴', '贴入有 AI 味的草稿，无需代码或密钥。'], ['2 · 改写', 'patina 清除约 160 种模式并自然地改写。'], ['3 · 校验', '查看 MPS、fidelity 和 AI 信号（前 → 后）。']],
    examplesTitle: '改写前后',
    stats: ['收录模式', '支持语言 · KO·EN·ZH·JA', '确定性信号', '浏览器内审计'],
    note: '不改变主张·数字·语气的<br />确定性人性化工具。',
    hint: 'patina 只调整措辞，绝不改变主张、数字或因果。本演示通过本地 CLI 改写，MPS/fidelity 为预览值。',
    chatPh: '继续润色…  (Enter 发送 · Shift+Enter 换行)',
    newchat: '新对话',
  },
  ja: {
    title: 'AIっぽさを消して、<span class="grad">自然に</span>',
    sub: 'AIっぽい文章を貼り付けると、patinaが自然に書き換えます。KO·EN·ZH·JA対応。',
    promptPh: '整えたい文章を貼り付けてください…',
    howTitle: '3ステップで完了',
    steps: [['1 · 貼り付け', 'AIっぽい下書きを貼るだけ。コードも鍵も不要。'], ['2 · 書き換え', 'patinaが約160のパターンを取り除き自然に書き換えます。'], ['3 · 検証', 'MPS・fidelity・AIシグナル（前 → 後）で意味の保持を確認。']],
    examplesTitle: 'ビフォー・アフター',
    stats: ['収録パターン', '対応言語 · KO·EN·ZH·JA', '決定論シグナル', 'ブラウザ内監査'],
    note: '主張・数字・トーンを変えない<br />決定論的ヒューマナイザー。',
    hint: 'patinaは表現だけを整え、主張・数値・因果は変えません。デモはローカルCLIで書き換え、MPS/fidelityはプレビュー値です。',
    chatPh: 'さらに整える…  (Enter送信 · Shift+Enter改行)',
    newchat: '新しいチャット',
  },
};

// Suggestion pills (label + text the pill loads into the prompt).
const SAMPLES = {
  ko: [
    { t: 'Marketing copy', x: '본 솔루션은 혁신적인 시너지를 활용하여 고객에게 전례 없는 가치를 원활하게 제공합니다.' },
    { t: 'Report tone', x: '결론적으로, 이러한 다각적인 접근 방식은 조직의 역량을 한층 더 제고하는 데 기여할 것으로 사료됩니다.' },
    { t: 'Announcement', x: '저희는 여러분께 혁신적인 신규 플랫폼을 선보이게 되어 진심으로 기쁘게 생각합니다.' },
  ],
  en: [
    { t: 'Marketing copy', x: 'Our cutting-edge, best-in-class solution leverages synergies to seamlessly deliver world-class value at scale.' },
    { t: 'Announcement', x: 'We are thrilled to announce that our innovative platform will revolutionize the way you work.' },
    { t: 'Report tone', x: 'In conclusion, this multifaceted approach will further enhance the overall capabilities of the organization.' },
  ],
  zh: [
    { t: 'Marketing copy', x: '本解决方案充分利用前沿协同效应，无缝赋能客户，释放前所未有的价值。' },
    { t: 'Formal tone', x: '综上所述，这种多元化的方法将进一步全面提升组织的核心竞争力。' },
  ],
  ja: [
    { t: 'Marketing copy', x: '本ソリューションは革新的なシナジーを活用し、お客様にかつてない価値をシームレスに提供します。' },
    { t: 'Report tone', x: '結論として、この多角的なアプローチは組織の能力を一層向上させることに寄与すると考えられます。' },
  ],
};

// Example cards (illustrative before → after, one per language).
const EXAMPLES = [
  { lang: 'ko', before: '본 솔루션은 혁신적인 시너지를 활용하여 전례 없는 가치를 원활하게 제공합니다.', after: '이 솔루션은 고객에게 실질적인 가치를 제공합니다.' },
  { lang: 'en', before: 'Our cutting-edge solution leverages synergies to seamlessly deliver world-class value.', after: 'Our solution gives teams something that actually works.' },
  { lang: 'zh', before: '本方案充分利用前沿协同效应，无缝赋能客户，释放前所未有的价值。', after: '这个方案帮客户真正解决问题。' },
  { lang: 'ja', before: '本ソリューションは革新的なシナジーを活用し、かつてない価値を提供します。', after: 'このソリューションは、顧客に実際の価値を届けます。' },
];

/** @typedef {{id:string,title:string,messages:Array<{role:string,text:string,meta?:object}>,thread:ReturnType<typeof createRewriteThread>}} Convo */

const state = {
  /** @type {Convo[]} */ convos: [],
  /** @type {string|null} */ activeId: null,
  busy: false,
};

function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function activeConvo() { return state.convos.find((c) => c.id === state.activeId) || null; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- provider / tier ----------
function populateProviders() {
  els.provider.innerHTML = '';
  for (const name of Object.keys(PROVIDER_PRESETS)) els.provider.appendChild(new Option(name, name));
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

// ---------- landing: suggestions + examples ----------
function renderSuggest() {
  els.suggest.innerHTML = '';
  const list = SAMPLES[els.lang.value] || SAMPLES.en;
  for (const s of list) {
    const pill = el('button', 'suggest__pill', s.t);
    pill.type = 'button';
    pill.addEventListener('click', () => { loadIntoPrompt(s.x); });
    els.suggest.appendChild(pill);
  }
}
function renderExamples() {
  els.exampleCards.innerHTML = '';
  for (const ex of EXAMPLES) {
    const card = el('div', 'xcard');
    card.appendChild(el('div', 'xcard__lang', LANG_NAME[ex.lang] || ex.lang));
    const b = el('div', 'xcard__row xcard__row--b');
    b.appendChild(el('span', 'xcard__k', 'before')); b.appendChild(el('span', null, ex.before));
    const a = el('div', 'xcard__row xcard__row--a');
    a.appendChild(el('span', 'xcard__k', 'after')); a.appendChild(el('span', null, ex.after));
    card.appendChild(b); card.appendChild(a);
    card.addEventListener('click', () => {
      els.lang.value = ex.lang; onLangChange();
      loadIntoPrompt(ex.before);

      globalThis.scrollTo({ top: 0, behavior: 'smooth' });
    });
    els.exampleCards.appendChild(card);
  }
}
function loadIntoPrompt(text) {
  showLanding();
  els.heroInput.value = text;
  autoGrow(els.heroInput);
  updateHeroSend();
  els.heroInput.focus();
}

// ---------- view switching ----------
function showLanding() { els.app.setAttribute('data-view', 'landing'); }
function showChat() { els.app.setAttribute('data-view', 'chat'); }

// ---------- conversation lifecycle ----------
function newConvo() {
  const convo = { id: uid(), title: 'New chat', messages: [], thread: createRewriteThread({ lang: els.lang.value }) };
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
    item.addEventListener('click', () => { state.activeId = c.id; renderSidebar(); renderThread(); showChat(); closeMobileSidebar(); });
    els.history.appendChild(item);
  }
}
function renderThread() {
  const convo = activeConvo();
  els.thread.innerHTML = '';
  const inner = el('div', 'thread__inner');
  if (convo) {
    for (const m of convo.messages) {
      if (m.role === 'user') inner.appendChild(buildUserMsg(m.text));
      else {
        const { node, body, textEl } = buildPatinaMsg();
        textEl.textContent = m.text;
        if (m.meta) body.appendChild(buildMeta(m.meta));
        inner.appendChild(node);
      }
    }
  }
  els.thread.appendChild(inner);
  scrollDown();
}
function threadInner() { return els.thread.querySelector('.thread__inner') || (() => { const i = el('div', 'thread__inner'); els.thread.appendChild(i); return i; })(); }

// ---------- message builders ----------
function buildUserMsg(text) {
  const msg = el('div', 'msg msg--user');
  msg.appendChild(el('div', 'msg__body', text));
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
function badge(label, value, ok) {
  const b = el('span', 'badge' + (ok ? ' badge--ok' : ''));
  b.appendChild(document.createTextNode(label + ' '));
  b.appendChild(el('b', null, value));
  return b;
}
function buildMeta(meta) {
  const wrap = el('div', 'meta');
  const badges = el('div', 'badges');
  const mps = Number(meta?.mps?.mps ?? meta?.mps);
  const fid = Number(meta?.fidelity?.fidelity ?? meta?.fidelity);
  const floorFailed = meta?.floorFailed || (Number.isFinite(mps) && mps < MPS_FLOOR) || (Number.isFinite(fid) && fid < FIDELITY_FLOOR);
  badges.appendChild(badge('MPS', fmt(mps), Number.isFinite(mps) && mps >= MPS_FLOOR));
  badges.appendChild(badge('Fidelity', fmt(fid), Number.isFinite(fid) && fid >= FIDELITY_FLOOR));
  if (floorFailed) { const b = el('span', 'badge badge--warn'); b.appendChild(el('b', null, '⚠ floor failed')); badges.appendChild(b); }
  wrap.appendChild(badges);

  const before = meta?.signals?.before?.signalScore;
  const after = meta?.signals?.after?.signalScore;
  if (before != null || after != null) {
    const det = el('details', 'foldout');
    det.appendChild(el('summary', null, 'AI signal (before → after)'));
    const b = el('div', 'foldout__body');
    const bar = el('div', 'signal-bar');
    bar.appendChild(el('span', null, 'hot-paragraph ratio '));
    bar.appendChild(el('span', 'sig-before', before == null ? '—' : String(before)));
    bar.appendChild(el('span', 'arrow', '→'));
    bar.appendChild(el('span', 'sig-after', after == null ? '—' : String(after)));
    b.appendChild(bar); det.appendChild(b); wrap.appendChild(det);
  }
  if (meta?.diff?.before != null) {
    const det = el('details', 'foldout');
    det.appendChild(el('summary', null, 'Original / result'));
    const b = el('div', 'foldout__body');
    const r1 = el('div', 'diffrow'); r1.appendChild(el('span', 'k', 'Original')); r1.appendChild(el('span', null, String(meta.diff.before)));
    const r2 = el('div', 'diffrow'); r2.appendChild(el('span', 'k', 'Result')); r2.appendChild(el('span', null, String(meta.diff.after ?? '')));
    b.appendChild(r1); b.appendChild(r2); det.appendChild(b); wrap.appendChild(det);
  }
  return wrap;
}

// Auto-detect the dominant script so pasted EN/ZH/JA text is not silently
// rewritten under the default (ko) language. Kana => ja; Hangul => ko; Han
// without kana => zh; Latin => en. Returns null when undecidable.
function detectLang(text) {
  const s = String(text || '');
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7a3]/.test(s)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[A-Za-z]/.test(s)) return 'en';
  return null;
}

// ---------- unified submit ----------
async function submit(text) {
  if (state.busy) return;
  const clean = String(text || '').trim();
  if (!clean) return;

  let convo = activeConvo();
  if (!convo) { newConvo(); convo = activeConvo(); }
  if (!convo) return;

  // Match the language to the pasted text's script on the first turn (the
  // selector defaults to ko; without this, EN/ZH/JA input is silently rewritten
  // under the wrong language). Refine turns keep the conversation's language.
  const detected = convo.thread.original == null ? detectLang(clean) : null;
  if (detected && detected !== els.lang.value) {
    els.lang.value = detected;
    applyI18n(detected);
    renderSuggest();
    convo.thread = createRewriteThread({ lang: detected });
  }

  showChat();
  state.busy = true;
  updateHeroSend(); updateChatSend();

  convo.messages.push({ role: 'user', text: clean });
  if (convo.title === 'New chat') { convo.title = clean.slice(0, 40); renderSidebar(); }
  const inner = threadInner();
  inner.appendChild(buildUserMsg(clean));

  const { node, body, textEl } = buildPatinaMsg();
  textEl.style.display = 'none';
  const typing = buildTyping();
  body.appendChild(typing);
  inner.appendChild(node);
  scrollDown();

  els.heroInput.value = ''; autoGrow(els.heroInput); updateHeroSend();
  els.input.value = ''; autoGrow(els.input);

  const reqBody = convo.thread.buildRequest({
    text: clean, tier: els.tier.value,
    provider: els.provider.value, model: els.model.value, apiKey: els.apiKey.value,
  });

  let started = false;
  const start = () => { if (started) return; started = true; if (typing.parentElement) typing.remove(); textEl.style.display = ''; textEl.classList.add('streaming'); };

  try {
    const { ok, finalFrame } = await streamRewrite({
      body: reqBody,
      onDelta: (_t, acc) => { start(); textEl.textContent = acc; scrollDown(); },
      onDone: (frame) => {
        start();
        const rewrite = typeof frame.rewrite === 'string' ? frame.rewrite : textEl.textContent;
        textEl.textContent = rewrite; textEl.classList.remove('streaming');
        const meta = { mps: frame.mps, fidelity: frame.fidelity, signals: frame.signals, diff: frame.diff, floorFailed: frame.floorFailed };
        body.appendChild(buildMeta(meta));
        convo.messages.push({ role: 'assistant', text: rewrite, meta });
        convo.thread.commit({ userText: clean, assistantText: rewrite });
        scrollDown();
      },
    });
    if (!ok) {
      if (typing.parentElement) typing.remove();
      textEl.style.display = ''; textEl.classList.remove('streaming');
      const status = finalFrame?.status ? ` (HTTP ${finalFrame.status})` : '';
      body.appendChild(el('div', 'error-note', `Rewrite failed${status}. Try again, or check the mode/key.`));
    }
  } catch (e) {
    if (typing.parentElement) typing.remove();
    textEl.style.display = '';
    body.appendChild(el('div', 'error-note', `Network error: ${String(e?.message || e)}`));
  } finally {
    state.busy = false;
    updateHeroSend(); updateChatSend();
    els.input.focus();
  }
}

// ---------- composer UX ----------
function autoGrow(node) { node.style.height = 'auto'; node.style.height = Math.min(node.scrollHeight, 200) + 'px'; }
function updateHeroSend() { els.heroSend.disabled = state.busy || els.heroInput.value.trim().length === 0; }
function updateChatSend() { els.send.disabled = state.busy || els.input.value.trim().length === 0; }
function scrollDown() { els.thread.scrollTop = els.thread.scrollHeight; }
function closeMobileSidebar() { els.chat.classList.remove('sidebar-open'); }

function applyI18n(lang) {
  const t = I18N[lang] || I18N.en;
  const set = (sel, text) => { const n = document.querySelector(sel); if (n) n.textContent = text; };
  const setHtml = (sel, html) => { const n = document.querySelector(sel); if (n) n.innerHTML = html; };
  setHtml('.hero__title', t.title);
  set('.hero__sub', t.sub);
  els.heroInput.setAttribute('placeholder', t.promptPh);
  set('.how .sec__title', t.howTitle);
  const stepEls = document.querySelectorAll('.how__steps li');
  t.steps.forEach((s, i) => { const li = stepEls[i]; if (!li) return; const h = li.querySelector('h3'); const p = li.querySelector('p'); if (h) h.textContent = s[0]; if (p) p.textContent = s[1]; });
  set('.examples .sec__title', t.examplesTitle);
  const dds = document.querySelectorAll('.stats .stat dd');
  t.stats.forEach((s, i) => { if (dds[i]) dds[i].textContent = s; });
  setHtml('.sidebar__note', t.note);
  set('.composer__hint', t.hint);
  els.input.setAttribute('placeholder', t.chatPh);
  const nc = document.querySelector('#new-chat span:last-child'); if (nc) nc.textContent = t.newchat;
  const ex = EXAMPLES.find((e) => e.lang === lang) || EXAMPLES[0];
  const setPreview = (sel, tag, text) => { const n = document.querySelector(sel); if (!n) return; n.textContent = ''; n.appendChild(el('span', 'hp-tag', tag)); n.appendChild(document.createTextNode(text)); };
  setPreview('.hp-before', 'before', ex.before);
  setPreview('.hp-after', 'after', ex.after);
}

function onLangChange() {
  applyI18n(els.lang.value);
  renderSuggest();
  const convo = activeConvo();
  if (convo && convo.messages.length === 0) convo.thread = createRewriteThread({ lang: els.lang.value });
}

// ---------- events ----------
els.heroForm.addEventListener('submit', (e) => { e.preventDefault(); submit(els.heroInput.value); });
els.heroInput.addEventListener('input', () => { autoGrow(els.heroInput); updateHeroSend(); });
els.heroInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(els.heroInput.value); } });

els.composer.addEventListener('submit', (e) => { e.preventDefault(); submit(els.input.value); });
els.input.addEventListener('input', () => { autoGrow(els.input); updateChatSend(); });
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(els.input.value); } });

els.newChat.addEventListener('click', () => { newConvo(); showLanding(); els.heroInput.value = ''; autoGrow(els.heroInput); updateHeroSend(); closeMobileSidebar(); els.heroInput.focus(); });
els.toggleSidebar.addEventListener('click', () => { els.chat.classList.toggle('sidebar-open'); });
els.homeLink.addEventListener('click', (e) => { e.preventDefault(); showLanding(); globalThis.scrollTo({ top: 0, behavior: 'smooth' }); });

els.lang.addEventListener('change', onLangChange);
els.tier.addEventListener('change', syncTier);
els.provider.addEventListener('change', populateModels);

// ---------- init ----------
populateProviders();
syncTier();
renderSuggest();
renderExamples();
onLangChange();
newConvo();
showLanding();
updateHeroSend();
updateChatSend();
