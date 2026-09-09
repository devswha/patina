// @ts-check
// patina — Lovable-composition controller: landing (hero prompt + sections) that
// transitions into a chat view. Reuses the isomorphic streaming client + contract;
// renders via safe DOM APIs.
import { createRewriteThread, streamRewrite, classifyRewriteError, rewriteRecovery, REWRITE_ERROR_KINDS } from './rewrite-client.js';
import { normalizePreferences, readPresets, writePresets, saveNamedPreset } from './preferences.js';
import { EXPERIENCE_COPY, experienceCopy, initialLanguage, onboardingCopy, licenseStatusAfter, configuredPortalHref } from './experience-copy.js';
// @ts-expect-error Served from the same public root in development and production.
import { EXAMPLES } from '/examples/index.js';
import { createEditReview } from './edit-review.js';
import { protectedInputSpans, mergeProtectedSpans, PROTECTED_INPUT_COPY } from './protected-input.js';
// @ts-expect-error Browser-root generated module is resolved at deployment, not by Node/tsc.
import launchConfig from '/launch-config.js';
import {
  PROVIDER_PRESETS,
  WEB_DOCUMENT_TYPES,
  WEB_PERSONAS,
  WEB_TIERS,
  TIER_LIMITS,
  MPS_FLOOR,
  FIDELITY_FLOOR,
  REWRITE_MODES,
} from '../src/web-rewrite-contract.js';

// Browser globals (eslint config declares only Node globals; sibling modules use
// the same globalThis convention — e.g. rewrite-client.js).
const { document, Option } = globalThis;
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const track = (eventName, data) => {
  try {
    if (typeof globalThis.patinaTrack === 'function') globalThis.patinaTrack(eventName, data);
  } catch { /* analytics is optional */ }
};

function inputBucket(length) {
  if (length < 100) return '0-99';
  if (length < 500) return '100-499';
  if (length < 2000) return '500-1999';
  return '2000+';
}
function latencyBucket(startedAt) {
  const elapsed = Math.max(0, Date.now() - startedAt);
  if (elapsed < 5000) return '<5s';
  if (elapsed < 10000) return '5-10s';
  if (elapsed < 30000) return '10-30s';
  return '30s+';
}
function scoreBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 70 || value > 100) return 'failed';
  if (value < 80) return '70-79';
  if (value < 90) return '80-89';
  return '90-100';
}
function rewriteData(source, clean, mode, lang = els.lang.value) {
  const tier = els.tier.value;
  return { surface: source, lang, tier, mode, inputBucket: inputBucket(clean.length) };
}
function failureOutcome(frame, kind, hasScores) {
  const K = REWRITE_ERROR_KINDS;
  const status = Number(frame?.status);
  const code = typeof frame?.code === 'string' ? frame.code : '';
  if (kind === K.NUMBER_SAFETY) return 'number-safety';
  if (kind === K.FLOOR_FAILED) return 'floor';
  if (kind.startsWith('quota_') && kind !== K.QUOTA_CONCURRENT && kind !== K.QUOTA_STORAGE && kind !== K.QUOTA_SECRET) return 'quota';
  if (kind === K.QUOTA_CONCURRENT) return 'concurrency';
  if (kind === K.TEXT_TOO_LONG) return 'input';
  if (status === 401 || status === 403) return 'auth';
  if ([K.IP_UNAVAILABLE, K.QUOTA_STORAGE, K.QUOTA_SECRET, K.SERVICE_UNAVAILABLE].includes(kind)) return 'service';
  if (code === 'stream_failed') return 'stream';
  return hasScores ? 'scoring' : 'unknown';
}

const els = {
  app: $('#app'),
  // nav controls (shared by landing + chat)
  lang: /** @type {HTMLSelectElement} */ ($('#lang')),
  tier: /** @type {HTMLSelectElement} */ ($('#tier')),
  documentType: /** @type {HTMLSelectElement} */ ($('#document-type')),
  persona: /** @type {HTMLSelectElement} */ ($('#persona')),
  register: /** @type {HTMLSelectElement} */ ($('#register')),
  protectedInput: /** @type {HTMLTextAreaElement} */ ($('#protected-text')),
  provider: /** @type {HTMLSelectElement} */ ($('#provider')),
  model: /** @type {HTMLSelectElement} */ ($('#model')),
  apiKey: /** @type {HTMLInputElement} */ ($('#api-key')),
  byokRow: $('#byok-row'),
  proRow: $('#pro-row'),
  licenseKey: /** @type {HTMLInputElement} */ ($('#license-key')),
  licenseSignIn: /** @type {HTMLButtonElement} */ ($('#license-sign-in')),
  licenseSignOut: /** @type {HTMLButtonElement} */ ($('#license-sign-out')),
  homeLink: $('#home-link'),
  // landing hero
  heroForm: /** @type {HTMLFormElement} */ ($('#hero-form')),
  heroInput: /** @type {HTMLTextAreaElement} */ ($('#hero-input')),
  heroSend: /** @type {HTMLButtonElement} */ ($('#hero-send')),
  ctaStart: /** @type {HTMLButtonElement} */ ($('#cta-start')),

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
    promptPh: 'Paste the text you want to clean up…',
    howTitle: 'Three steps',
    examplesTitle: 'Before and after',
    benchTitle: 'Numbers, in the open',
    benchLede: 'A deterministic suspect-zone benchmark on a checked-in fixture corpus — auditable, not an authorship test.',
    benchCards: [['overall accuracy', '95% CI 92.7–100%'], ['fixtures', 'AI vs. natural, labeled'], ['languages', 'KO · EN · ZH · JA'], ['false positives', 'at the 1% FPR budget']],
    benchCols: ['lang', 'fixtures', 'accuracy', '95% CI', 'F1'],
    benchNote: 'Measured on 49 deterministic fixtures as a regression gate — not a claim of generalization to new models, genres, or edited AI text, and not an authorship verdict.',
    benchLink: 'Read the full report →',
    ctaTitle: 'Paste your own and see',
    ctaSub: 'Drop an AI-sounding draft into the box above. No code, no key.',
    ctaBtn: 'Start at the top ↑',
    note: ['Deterministic humanizer —', 'same claim, numbers, voice.'],
    chatPh: 'Keep refining…  (Enter to send · Shift+Enter for newline)',
    newchat: 'New chat',
    emptyChat: 'New chat — paste AI-sounding text below and patina cleans it up.',
    outputUnapproved: 'Unapproved — checks have not passed. Actions are disabled.',
    outputApproved: 'Approved — checks passed. Actions are enabled.',
    floorWarn: 'This rewrite didn’t pass patina’s meaning-preservation floor (MPS / fidelity), so it’s flagged. Try again or pick a stronger model.',
    reportFp: 'Flagged your own writing? Report a false positive →',
    failNote: 'Rewrite failed. Try again, or check the mode/key.',
    numberSafetyNote: 'The rewrite didn’t keep the numbers/times exactly as written, so patina discarded it for safety. Try again.',
    proUpsell: 'Get API access — $9.99/mo',
    proBuy: 'Get API access — $9.99/mo',
    proSoon: 'Pro — coming soon',
    quotaConcurrent: 'A rewrite is already running for your connection. Wait for it to finish, then try again.',
    serviceDown: 'The rewrite service is temporarily unavailable. Please try again later.',
    tooLong: 'Text is over the {tier} limit of {cap} characters. Shorten it and try again.',
    keyMissing: 'Enter your API key to use API mode.',
    stopNote: 'Stopped — the rewrite was cancelled.',
    timeoutNote: 'Rewrite timed out — no response from the server. Please try again.',
    netNote: 'Network error: {msg}',
    retry: 'Retry',
    stopLabel: 'Stop',
  },
  ko: {
    promptPh: '다듬고 싶은 문장을 붙여넣어 보세요…',
    howTitle: '세 단계면 끝',
    examplesTitle: '이런 문장을, 이렇게',
    benchTitle: '숨김없는 벤치마크',
    benchLede: '저장소에 포함된 fixture 코퍼스로 측정한 결정론적 의심구간 벤치마크 — 작성자 판별이 아니라, 감사 가능한 회귀 지표예요.',
    benchCards: [['전체 정확도', '95% CI 92.7–100%'], ['fixtures', 'AI·자연 라벨 코퍼스'], ['지원 언어', 'KO · EN · ZH · JA'], ['오탐(FP)', '1% FPR 기준']],
    benchCols: ['언어', 'fixtures', '정확도', '95% CI', 'F1'],
    benchNote: '결정론 fixture 49개로 측정한 회귀 게이트 결과입니다. 새 모델·장르·편집된 AI 글로의 일반화나 작성자 판별을 뜻하지 않아요.',
    benchLink: '전체 리포트 보기 →',
    ctaTitle: '직접 붙여넣어 확인해 보세요',
    ctaSub: 'AI 티 나는 초안을 위 입력칸에 붙여넣으면 끝. 코드도 키도 필요 없어요.',
    ctaBtn: '맨 위로 가서 시작하기 ↑',
    note: ['의미·숫자·톤을 바꾸지 않는', '결정론적 휴머나이저.'],
    chatPh: '이어서 다듬기…  (Enter 전송 · Shift+Enter 줄바꿈)',
    newchat: '새 대화',
    emptyChat: '새 대화 — 아래에 AI 티 나는 문장을 붙여넣으면 patina가 다듬어요.',
    outputUnapproved: '미승인 — 검사를 통과하지 않았습니다. 작업을 사용할 수 없습니다.',
    outputApproved: '승인됨 — 검사를 통과했습니다. 작업을 사용할 수 있습니다.',
    floorWarn: '이 리라이트는 patina의 의미 보존 기준(MPS·fidelity)을 통과하지 못해 경고로 표시했어요. 다시 시도하거나 더 강한 모델을 골라보세요.',
    reportFp: '직접 쓴 글인데 잡혔나요? 오탐 신고 →',
    failNote: '리라이트 실패. 다시 시도하거나 모드·키를 확인해 주세요.',
    numberSafetyNote: '리라이트가 숫자·시간 표기를 원문 그대로 보존하지 못해 안전을 위해 결과를 폐기했어요. 다시 시도해 주세요.',
    proUpsell: 'API 액세스 받기 — $9.99/월',
    proBuy: 'API 액세스 받기 — $9.99/월',
    proSoon: 'Pro — 곧 공개',
    quotaConcurrent: '이미 진행 중인 리라이트가 있어요. 끝난 뒤 다시 시도해 주세요.',
    serviceDown: '리라이트 서비스를 잠시 사용할 수 없어요. 나중에 다시 시도해 주세요.',
    tooLong: '{tier} 모드 한도({cap}자)를 넘었어요. 줄여서 다시 시도해 주세요.',
    keyMissing: 'API 모드를 쓰려면 API 키를 입력해 주세요.',
    stopNote: '중단했어요 — 리라이트가 취소됐어요.',
    timeoutNote: '서버 응답이 없어 리라이트가 시간 초과됐어요. 다시 시도해 주세요.',
    netNote: '네트워크 오류: {msg}',
    retry: '다시 시도',
    stopLabel: '중단',
  },
  zh: {
    promptPh: '粘贴你想润色的文字…',
    howTitle: '三步搞定',
    examplesTitle: '改写前后',
    benchTitle: '公开的基准',
    benchLede: '基于仓库内 fixture 语料的确定性可疑区间基准 — 可审计，而非作者判定。',
    benchCards: [['总体准确率', '95% CI 92.7–100%'], ['fixtures', 'AI 与自然，已标注'], ['支持语言', 'KO · EN · ZH · JA'], ['误报', '1% FPR 预算下']],
    benchCols: ['语言', 'fixtures', '准确率', '95% CI', 'F1'],
    benchNote: '在 49 个确定性 fixture 上作为回归门测得 — 不代表对新模型、体裁或经过编辑的 AI 文本的泛化，也不是作者判定。',
    benchLink: '查看完整报告 →',
    ctaTitle: '粘贴你的文字试试',
    ctaSub: '把有 AI 味的草稿粘到上面的输入框，无需代码或密钥。',
    ctaBtn: '回到顶部开始 ↑',
    note: ['不改变主张·数字·语气的', '确定性人性化工具。'],
    chatPh: '继续润色…  (Enter 发送 · Shift+Enter 换行)',
    newchat: '新对话',
    emptyChat: '新对话 — 在下方粘贴有 AI 味的文字，patina 帮你润色。',
    outputUnapproved: '未批准 — 尚未通过检查，操作不可用。',
    outputApproved: '已批准 — 已通过检查，操作已启用。',
    floorWarn: '该改写未通过 patina 的语义保留阈值（MPS·fidelity），已标记。请重试或选择更强的模型。',
    reportFp: '人工撰写却被标记？反馈误报 →',
    failNote: '改写失败。请重试，或检查模式 / 密钥。',
    numberSafetyNote: '改写未能原样保留数字 / 时间，为安全起见已丢弃结果。请重试。',
    proUpsell: '获取 API 访问权限 — 每月 $9.99',
    proBuy: '获取 API 访问权限 — 每月 $9.99',
    proSoon: 'Pro — 即将推出',
    quotaConcurrent: '已有一个改写正在进行。请等它完成后再试。',
    serviceDown: '改写服务暂时不可用，请稍后再试。',
    tooLong: '文字超过 {tier} 模式的 {cap} 字上限。请缩短后重试。',
    keyMissing: '使用 API 模式请先输入 API 密钥。',
    stopNote: '已停止 — 改写已取消。',
    timeoutNote: '服务器无响应，改写超时。请重试。',
    netNote: '网络错误：{msg}',
    retry: '重试',
    stopLabel: '停止',
  },
  ja: {
    promptPh: '整えたい文章を貼り付けてください…',
    howTitle: '3ステップで完了',
    examplesTitle: 'ビフォー・アフター',
    benchTitle: '隠さないベンチマーク',
    benchLede: 'リポジトリ同梱の fixture コーパスで測る決定論的サスペクトゾーンのベンチマーク — 監査可能で、作者判定ではありません。',
    benchCards: [['全体精度', '95% CI 92.7–100%'], ['fixtures', 'AI・自然のラベル付き'], ['対応言語', 'KO · EN · ZH · JA'], ['誤検知', '1% FPR 基準']],
    benchCols: ['言語', 'fixtures', '精度', '95% CI', 'F1'],
    benchNote: '49 件の決定論 fixture で回帰ゲートとして測定 — 新しいモデルやジャンル、編集済み AI 文章への一般化や作者判定を意味しません。',
    benchLink: '詳細レポートを見る →',
    ctaTitle: '自分の文章で試す',
    ctaSub: 'AIっぽい下書きを上の入力欄に貼るだけ。コードも鍵も不要。',
    ctaBtn: '上に戻って始める ↑',
    note: ['主張・数字・トーンを変えない', '決定論的ヒューマナイザー。'],
    chatPh: 'さらに整える…  (Enter送信 · Shift+Enter改行)',
    newchat: '新しいチャット',
    emptyChat: '新しいチャット — 下にAIっぽい文章を貼ると patina が整えます。',
    outputUnapproved: '未承認 — チェックを通過していないため、操作は使えません。',
    outputApproved: '承認済み — チェックを通過しました。操作を利用できます。',
    floorWarn: 'この書き換えは patina の意味保持しきい値（MPS・fidelity）を満たさず、警告表示しています。再試行するか、より強力なモデルを選んでください。',
    reportFp: '自分で書いた文章なのに検出？誤検出を報告 →',
    failNote: '書き換えに失敗しました。再試行するか、モード・キーを確認してください。',
    numberSafetyNote: '書き換えが数値・時刻を原文どおりに保持できなかったため、安全のため結果を破棄しました。もう一度お試しください。',
    proUpsell: 'APIアクセスを取得 — 月額$9.99',
    proBuy: 'APIアクセスを取得 — 月額$9.99',
    proSoon: 'Pro — 近日公開',
    quotaConcurrent: 'すでに実行中の書き換えがあります。完了後にもう一度お試しください。',
    serviceDown: '書き換えサービスは一時的に利用できません。しばらくしてからお試しください。',
    tooLong: '{tier}モードの上限（{cap}文字）を超えています。短くしてからお試しください。',
    keyMissing: 'APIモードを使うにはAPIキーを入力してください。',
    stopNote: '停止しました — 書き換えはキャンセルされました。',
    timeoutNote: 'サーバーから応答がなくタイムアウトしました。もう一度お試しください。',
    netNote: 'ネットワークエラー：{msg}',
    retry: '再試行',
    stopLabel: '停止',
  },
};
const PRO_I18N = EXPERIENCE_COPY;

/** @typedef {{role:string,text:string,meta?:any,original?:string,receipt?:any,editReview?:any,protectedSpans?:any[],reviewSelection?:boolean[],reviewCandidate?:string}} ChatMessage */
/** @typedef {{id:string,title:string,messages:ChatMessage[],thread:ReturnType<typeof createRewriteThread>,protectedInput?:string,reviewPending?:boolean}} Convo */

const state = {
  /** @type {Convo[]} */ convos: [],
  /** @type {string|null} */ activeId: null,
  /** @type {{protectedInput:string}|null} */ heroDraft: null,
  busy: false,
  license: '',
  licenseStatus: 'empty',
  sessionEpoch: 0,
};

function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function activeConvo() { return state.convos.find((c) => c.id === state.activeId) || null; }
const reviewControllers = new Set();
let reviewView = 0;
const reviewCopy = (lang) => ({
  en: { pending: 'Selected changes need meaning verification.', original: 'Original text — no edits applied.', unavailable: 'Change review is unavailable for this result.', requested: 'Verify selected changes', failed: 'The selected text was not approved.', protected: 'Protected phrases could not be preserved.', stale: 'The original text has changed. Start a new rewrite.' },
  ko: { pending: '선택한 변경 내용의 의미 검증이 필요합니다.', original: '원문 — 변경을 적용하지 않았습니다.', unavailable: '이 결과의 변경 목록을 확인할 수 없습니다.', requested: '선택한 변경의 의미 검증', failed: '선택본이 승인되지 않았습니다.', protected: '보호 문구를 그대로 유지하지 못했습니다.', stale: '원문이 달라졌습니다. 새로 다듬어 주세요.' },
  zh: { pending: '所选修改需要重新验证含义。', original: '原文 — 未应用修改。', unavailable: '无法查看此结果的修改列表。', requested: '验证所选修改', failed: '所选文本未获通过。', protected: '未能保持受保护词句。', stale: '原文已更改，请重新改写。' },
  ja: { pending: '選択した変更の意味を再検証してください。', original: '原文 — 変更は適用していません。', unavailable: 'この結果の変更一覧は確認できません。', requested: '選択した変更を検証', failed: '選択した文章は承認されませんでした。', protected: '保護した語句を維持できませんでした。', stale: '原文が変わりました。新しく書き直してください。' },
}[lang] || { pending: 'Selected changes need verification.', original: 'Original text.', unavailable: 'Review unavailable.', requested: 'Verify changes', failed: 'Not approved.', protected: 'Protected text changed.', stale: 'Original changed.' });

function lastAssistant(convo) { return convo.messages.filter((message) => message.role === 'assistant').at(-1); }
function clearReviewControllers() {
  reviewView += 1;
  for (const controller of reviewControllers) controller.dispose();
  reviewControllers.clear();
}

async function attachReview(convo, message, body, textEl, statusEl) {
  if (!message.editReview || message !== lastAssistant(convo)) return;
  const epoch = state.sessionEpoch, view = reviewView;
  const current = () => state.sessionEpoch === epoch && reviewView === view && activeConvo() === convo
    && body.isConnected && message === lastAssistant(convo);
  const original = message.original;
  const copy = reviewCopy(convo.thread.preferences.lang);
  try {
    const controller = await createEditReview({
      original, rewrite: message.text, editReview: message.editReview,
      initialSelection: message.reviewSelection, lang: convo.thread.preferences.lang,
      onSelectionChange: ({ candidate, isAccepted, isOriginal }, selected) => {
        if (!current()) return;
        message.reviewSelection = [...selected];
        message.reviewCandidate = candidate;
        convo.reviewPending = !isAccepted && !isOriginal;
        textEl.textContent = candidate;
        body.querySelectorAll('.output-actions').forEach((node) => node.remove());
        const audit = /** @type {HTMLElement} */ (body.querySelector('[data-verification-meta]'));
        if (audit) audit.hidden = !isAccepted;
        if (isAccepted) {
          approveOutput(textEl, statusEl);
          body.appendChild(buildOutputActions(candidate, message.receipt));
        } else {
          markOutputUnapproved(textEl, statusEl);
          statusEl.textContent = isOriginal ? copy.original : copy.pending;
          if (isOriginal) {
            textEl.classList.remove('msg__text--unapproved');
            textEl.removeAttribute('aria-invalid');
            textEl.dataset.outputStatus = 'original';
            statusEl.dataset.outputStatus = 'original';
            body.appendChild(buildOutputActions(candidate));
          }
        }
        if ((isAccepted || isOriginal) && convo.thread.currentDraft !== candidate) convo.thread.recordTurn('assistant', candidate);
        updateHeroSend(); updateChatSend(); syncSettingsBusy();
      },
      onVerify: async (candidate, baseHash) => {
        if (!current() || state.busy || !preflight(candidate, 'chat')) return { ok: false };
        const tier = els.tier.value;
        const reqBody = convo.thread.buildRequest({ text: candidate, tier, provider: els.provider.value, model: els.model.value,
          apiKey: tier === WEB_TIERS.BYOK ? els.apiKey.value : undefined });
        let protectedSpans;
        try {
          protectedSpans = mergeProtectedSpans(original, message.protectedSpans || [], protectedInputSpans(original, convo.protectedInput || ''));
        } catch {
          showInlineError(inlineErrorNode('chat'), (PROTECTED_INPUT_COPY[els.lang.value] || PROTECTED_INPUT_COPY.en).invalid);
          return { ok: false };
        }
        Object.assign(reqBody, { mode: REWRITE_MODES.VERIFY, original, text: candidate, baseHash, includeEdits: true,
          protectedSpans });
        delete reqBody.history;
        const resultView = buildPatinaMsg();
        const inner = threadInner();
        convo.messages.push({ role: 'user', text: copy.requested });
        inner.appendChild(buildUserMsg(copy.requested));
        inner.appendChild(resultView.node);
        const result = await runAttempt({ convo, clean: candidate, reqBody, ...resultView,
          telemetry: rewriteData('chat', candidate, REWRITE_MODES.VERIFY, convo.thread.preferences.lang),
          authorization: tier === WEB_TIERS.PRO ? `Bearer ${state.license}` : undefined, epoch });
        if (result?.ok && state.sessionEpoch === epoch && activeConvo() === convo) {
          message.reviewSelection = undefined; message.reviewCandidate = undefined;
          convo.reviewPending = false;
          renderThread(); updateHeroSend(); updateChatSend();
        }
        return { ok: result?.ok === true };
      },
    });
    if (!current()) { controller.dispose(); return; }
    reviewControllers.add(controller);
    controller.setBusy(state.busy);
    body.appendChild(controller.element);
  } catch {
    if (current()) body.appendChild(errorNote(copy.unavailable));
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- launch: pricing CTAs, Pro checkout, UTM attribution ----------
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
const UTM_VALUE = /^[A-Za-z0-9._~-]{1,64}$/;
let capturedUtm = {};

function isSafeUtm(value) {
  if (!UTM_VALUE.test(value)) return false;
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) return false;
  if (/^[0-9a-f]{16,}$/i.test(value)) return false;
  if (/^(?:(?:sk|pk|rk|api|key|token|secret|auth|bearer|ghp|github_pat)[_.-]?[A-Za-z0-9._~-]+|eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2})$/i.test(value)) return false;
  if (value.length < 16) return true;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  const entropy = [...counts.values()].reduce((sum, count) => {
    const p = count / value.length;
    return sum - p * Math.log2(p);
  }, 0);
  return entropy < 3.8;
}

function checkoutBase() {
  const config = launchConfig;
  if (!config || config.schemaVersion !== 1 || !config.enabled || !['staging', 'production'].includes(config.channel)) return null;
  if (typeof config.checkoutOrigin !== 'string' || typeof config.checkoutPath !== 'string') return null;
  try {
    const origin = new globalThis.URL(config.checkoutOrigin);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || !config.checkoutPath.startsWith('/')) return null;
    const url = new globalThis.URL(config.checkoutPath, origin);
    if (url.origin !== origin.origin || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

function captureUtm() {
  capturedUtm = {};
  try {
    const params = new globalThis.URLSearchParams(globalThis.location.search);
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value && isSafeUtm(value)) capturedUtm[key] = value;
    }
  } catch { /* attribution is optional and held only in memory */ }
}

function proCheckoutHref() {
  const url = checkoutBase();
  if (!url) return '';
  for (const [key, value] of Object.entries(capturedUtm)) url.searchParams.set(key, value);
  return url.toString();
}

function wireProCta() {
  const btn = $('#pro-buy');
  if (!btn) return;
  const href = proCheckoutHref();
  if (href) {
    btn.setAttribute('href', href);
    btn.setAttribute('target', '_blank');
    btn.removeAttribute('aria-disabled');
    btn.classList.remove('is-soon');
    btn.textContent = i18n().proBuy;
    btn.addEventListener('click', () => {
      track('Tier Selected', { tier: 'pro', surface: 'pricing' });
      track('Checkout Started', { surface: 'pricing', lang: els.lang.value });
    });
  } else {
    btn.removeAttribute('href');
    btn.removeAttribute('target');
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('is-soon');
    btn.textContent = i18n().proSoon;
  }
}

function quotaUpsell() {
  const a = el('a', 'pro-upsell', i18n().proUpsell);
  const href = proCheckoutHref();
  if (href) {
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.addEventListener('click', () => track('Checkout Started', { surface: 'quota', lang: els.lang.value }));
  } else {
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.classList.add('is-soon');
  }
  return a;
}

function wirePricingCtas() {
  $('#pro-existing')?.addEventListener('click', openLicenseControls);
  const portal = configuredPortalHref(launchConfig);
  if (portal) { $('#pro-portal').setAttribute('href', portal); $('#pro-portal').hidden = false; }
  const free = $('#price-free');
  if (free) free.addEventListener('click', () => {
    track('Tier Selected', { tier: 'free', surface: 'pricing' });
    els.tier.value = WEB_TIERS.FREE; syncTier(); updateHeroSend(); updateChatSend();
    showLanding();
    globalThis.scrollTo({ top: 0, behavior: 'smooth' }); els.heroInput?.focus();
  });
  const byok = $('#price-byok');
  if (byok) byok.addEventListener('click', () => {
    track('Tier Selected', { tier: 'byok', surface: 'pricing' });
    els.tier.value = WEB_TIERS.BYOK;
    syncTier();
    updateHeroSend();
    updateChatSend();
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
    openSettings(); els.apiKey?.focus();
  });
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
  const pro = els.tier.value === WEB_TIERS.PRO;
  const signedIn = Boolean(state.license);
  els.byokRow.hidden = !byok;
  els.proRow.hidden = !pro;
  els.licenseKey.disabled = signedIn;
  els.licenseSignIn.hidden = signedIn;
  els.licenseSignOut.hidden = !signedIn;
  const copy = experienceCopy(els.lang.value);
  $('#license-status').textContent = copy.licenseStates[state.licenseStatus];
  $('#hero-hint').textContent = byok ? copy.byokCost : pro ? copy.licenseStates[state.licenseStatus] : onboardingCopy(els.lang.value).heroHint;
}

// Populate opt-in voices. The empty option preserves the source voice.
function populateDocumentTypes() {
  const prev = els.documentType.value;
  els.documentType.innerHTML = '';
  for (const [index, id] of WEB_DOCUMENT_TYPES.entries()) {
    if (id === 'namuwiki' && els.lang.value !== 'ko') continue;
    const label = experienceCopy(els.lang.value).documents[index];
    els.documentType.appendChild(new Option(label, id));
  }
  els.documentType.value = Array.from(els.documentType.options).some((option) => option.value === prev)
    ? prev
    : 'default';
}

function populatePersonas() {
  const prev = els.persona.value;
  els.persona.innerHTML = '';
  const copy = experienceCopy(els.lang.value);
  els.persona.appendChild(new Option(copy.preserve, ''));
  for (const p of (WEB_PERSONAS[els.lang.value] || [])) {
    const voiceIndex = p.id.startsWith('natural-') ? 0 : ['blog-essay', 'technical-explainer', 'soft-professional', 'pragmatic-founder'].indexOf(p.id) + 1;
    els.persona.appendChild(new Option(copy.voices[voiceIndex] || p.label, p.id));
  }
  // Personas are per-language; keep a prior pick only if the new language offers it.
  els.persona.value = Array.from(els.persona.options).some((o) => o.value === prev) ? prev : '';
}

// ---------- landing: suggestions + examples ----------
function renderSuggest() {
  els.suggest.innerHTML = '';
  const list = EXAMPLES.filter((example) => example.lang === els.lang.value);
  for (const s of list) {
    const pill = el('button', 'suggest__pill', s.label);
    pill.type = 'button';
    pill.addEventListener('click', () => { selectExample?.(s, true); loadIntoPrompt(s.before); });
    els.suggest.appendChild(pill);
  }
}
// Mixed-script tokenizer: CJK ideographs/kana/CJK-punct become single-char
// tokens (char-level diff), while Latin/Hangul runs stay word-level. Whitespace
// is its own token so spacing diffs cleanly.
function isCJKChar(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x3040 && c <= 0x30ff)   // hiragana + katakana
    || (c >= 0x3400 && c <= 0x4dbf)     // CJK ext A
    || (c >= 0x4e00 && c <= 0x9fff)     // CJK unified
    || (c >= 0xf900 && c <= 0xfaff)     // CJK compat
    || (c >= 0x3001 && c <= 0x303f)     // CJK punctuation (U+3000 is whitespace)
    || (c >= 0xff00 && c <= 0xffef);    // fullwidth forms
}
function tokenizeText(s) {
  const toks = [];
  let buf = '';
  const flush = () => { if (buf) { toks.push(buf); buf = ''; } };
  for (const ch of s) {
    if (/\s/.test(ch)) { flush(); toks.push(ch); }
    else if (isCJKChar(ch)) { flush(); toks.push(ch); }
    else buf += ch;
  }
  flush();
  return toks;
}
// LCS diff → ordered tokens tagged same | rm (before-only) | add (after-only).
// before text = same+rm in order; after text = same+add in order.
function diffSeq(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: a[i], s: 'same' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: a[i], s: 'rm' }); i++; }
    else { out.push({ t: b[j], s: 'add' }); j++; }
  }
  while (i < n) out.push({ t: a[i++], s: 'rm' });
  while (j < m) out.push({ t: b[j++], s: 'add' });
  return out;
}
// Render one side of the diff into a line node, skipping the opposite-side status.
function fillLine(node, seq, skip) {
  node.textContent = '';
  for (const tok of seq) {
    if (tok.s === skip) continue;
    const cls = tok.s === 'rm' ? 'dtok dtok--rm' : tok.s === 'add' ? 'dtok dtok--add' : 'dtok';
    node.appendChild(el('span', cls, tok.t));
  }
}

let selectExample = null;
let exampleSelection = null;

function renderExamples() {
  els.exampleCards.innerHTML = '';
  const ui = onboardingCopy(els.lang.value);
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const editor = el('div', 'editor');
  const bar = el('div', 'editor__bar');
  const tabs = el('div', 'editor__tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', ui.exampleLanguage);
  bar.appendChild(tabs);

  const panel = el('div', 'editor__panel');
  panel.id = 'example-panel';
  panel.setAttribute('role', 'tabpanel');
  const choiceLabel = el('label', 'editor__choice');
  const choice = el('select', 'ctl__select');
  choice.id = 'example-choice';
  choiceLabel.append(el('span', null, ui.exampleChoice), choice);
  const body = el('div', 'editor__body');
  const code = el('div', 'editor__code');
  const beforeLabel = el('p', 'editor__label');
  const afterLabel = el('p', 'editor__label');
  const before = el('div', 'editor__seg editor__seg--before');
  const after = el('div', 'editor__seg editor__seg--after');
  code.append(beforeLabel, before, afterLabel, after);
  body.appendChild(code);
  const caption = el('p', 'editor__cap');
  const note = el('p', 'editor__note', ui.illustrative);
  note.id = 'example-note';
  panel.setAttribute('aria-describedby', note.id);
  const foot = el('div', 'editor__foot');
  const copy = el('button', 'editor__btn', ui.copyExample); copy.type = 'button';
  const replay = el('button', 'xcard__replay', ui.replay); replay.type = 'button';
  const tryIt = el('button', 'xcard__try', ui.tryExample); tryIt.type = 'button';
  foot.append(copy, replay, tryIt);
  panel.append(note, choiceLabel, body, caption, foot);
  editor.append(bar, panel);
  els.exampleCards.appendChild(editor);

  let active = EXAMPLES.find((example) => example.id === exampleSelection && example.lang === els.lang.value)
    || EXAMPLES.find((example) => example.lang === els.lang.value) || EXAMPLES[0];
  // The copy button carries a transient result label; it belongs to the row that
  // was copied, so switching rows drops both the label and its pending timer.
  let copyReset;
  const restCopy = () => {
    clearTimeout(copyReset);
    copy.textContent = ui.copyExample;
    copy.classList.remove('is-ok');
  };
  const reveal = () => {
    if (reduce) return;
    editor.classList.remove('is-reveal');
    void editor.offsetWidth;
    editor.classList.add('is-reveal');
  };
  const setActive = (example, animate = false) => {
    active = example;
    exampleSelection = example.id;
    const labels = onboardingCopy(example.lang);
    beforeLabel.textContent = labels.before;
    afterLabel.textContent = labels.after;
    code.setAttribute('lang', example.lang);
    caption.setAttribute('lang', example.lang);
    caption.textContent = example.caption;
    panel.setAttribute('aria-labelledby', `example-tab-${example.lang}`);
    const seq = diffSeq(tokenizeText(example.before), tokenizeText(example.after));
    fillLine(before, seq, 'add'); fillLine(after, seq, 'rm');
    choice.innerHTML = '';
    for (const row of EXAMPLES.filter((row) => row.lang === example.lang)) choice.appendChild(new Option(row.label, row.id));
    choice.value = example.id;
    choice.setAttribute('lang', example.lang);
    for (const tab of tabs.children) {
      const selected = tab.dataset.lang === example.lang;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    }
    restCopy();
    if (animate) reveal();
  };
  selectExample = setActive;
  for (const lang of Object.keys(LANG_NAME)) {
    const tab = el('button', 'editor__tab', LANG_NAME[lang]);
    tab.type = 'button'; tab.dataset.lang = lang; tab.id = `example-tab-${lang}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('lang', lang);
    tab.setAttribute('aria-controls', panel.id);
    tab.addEventListener('click', () => setActive(EXAMPLES.find((example) => example.lang === lang), true));
    tab.addEventListener('keydown', (event) => {
      const buttons = Array.from(tabs.children);
      const index = buttons.indexOf(tab);
      const next = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length,
        Home: 0, End: buttons.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].click(); buttons[next].focus();
    });
    tabs.appendChild(tab);
  }
  choice.addEventListener('change', () => setActive(EXAMPLES.find((example) => example.id === choice.value), true));
  replay.addEventListener('click', reveal);
  tryIt.addEventListener('click', () => {
    if (state.busy) return;
    // Keep the selected row across re-rendering; the old conversation stays intact.
    const selected = active;
    newConvo();
    els.lang.value = selected.lang; onLangChange();
    selectExample?.(selected);
    loadIntoPrompt(selected.before);
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  });
  copy.addEventListener('click', async () => {
    clearTimeout(copyReset);
    try {
      await globalThis.navigator.clipboard.writeText(active.after);
      copy.textContent = ui.copied;
      copy.classList.add('is-ok');
    } catch {
      // A failure must not keep the success styling from a previous copy.
      copy.textContent = ui.copyFailed;
      copy.classList.remove('is-ok');
    }
    // Restore the resting label so a second copy still reads as an available action.
    copyReset = globalThis.setTimeout(restCopy, 1400);
  });
  setActive(active);
}

function loadIntoPrompt(text) {
  showLanding();
  els.heroInput.value = text;
  autoGrow(els.heroInput);
  updateHeroSend();
  els.heroInput.focus();
}

// ---------- view switching ----------
function showLanding() {
  // A fresh source has its own constraints, even while the old chat stays active.
  if (activeConvo()?.messages.length && !state.heroDraft) state.heroDraft = { protectedInput: '' };
  els.app.setAttribute('data-view', 'landing');
  renderProtectedInput(); syncSettingsBusy();
}
function showChat() {
  els.app.setAttribute('data-view', 'chat');
  renderProtectedInput(); syncSettingsBusy();
  if (globalThis.matchMedia?.('(max-width: 720px)')?.matches) {
    document.querySelectorAll('.nav__presets').forEach((panel) => panel.removeAttribute('open'));
  }
}

// ---------- conversation lifecycle ----------
function newConvo(protectedInput = '') {
  const settings = readControls();
  const languageExplicit = activeConvo()?.thread.languageExplicit || false;
  const convo = { id: uid(), title: 'New chat', messages: [], protectedInput, thread: createRewriteThread({ ...settings, languageExplicit }) };
  state.heroDraft = null;
  state.convos.unshift(convo);
  state.activeId = convo.id;
  restoreControls(convo);
  renderSidebar();
  renderThread();
}
function selectConvo(convo) {
  if (state.busy) stopActive();
  state.activeId = convo.id;
  restoreControls(convo);
  renderSidebar(); renderThread(); showChat(); closeMobileSidebar();
}
function renderSidebar() {
  els.history.innerHTML = '';
  for (const c of state.convos) {
    const item = el('button', 'histitem' + (c.id === state.activeId ? ' active' : ''), c.title);
    item.type = 'button';
    item.addEventListener('click', () => selectConvo(c));
    els.history.appendChild(item);
  }
}
function renderThread() {
  clearReviewControllers();
  const convo = activeConvo();
  renderProtectedInput();
  els.thread.innerHTML = '';
  const inner = el('div', 'thread__inner');
  if (convo && convo.messages.length) {
    let lastUserText = null;
    for (const m of convo.messages) {
      if (m.role === 'user') { lastUserText = m.text; inner.appendChild(buildUserMsg(m.text)); }
      else {
        const { node, body, textEl, statusEl } = buildPatinaMsg();
        textEl.textContent = m.text;
        if (m.meta) {
          approveOutput(textEl, statusEl);
          const audit = buildMeta(m.meta, m.original || lastUserText);
          audit.dataset.verificationMeta = 'true';
          body.appendChild(audit);
          body.appendChild(buildOutputActions(m.text, m.receipt));
          void attachReview(convo, m, body, textEl, statusEl);
        }
        inner.appendChild(node);
      }
    }
  } else {
    inner.appendChild(buildThreadEmpty());
  }
  els.thread.appendChild(inner);
  scrollDown();
}
function buildThreadEmpty() {
  const t = I18N[els.lang.value] || I18N.en;
  const wrap = el('div', 'thread__empty');
  const mark = document.createElement('img');
  mark.src = '/assets/brand/patina-mark.svg'; mark.alt = ''; mark.width = 40; mark.height = 40;
  wrap.appendChild(mark);
  wrap.appendChild(el('p', 'thread__empty-text', t.emptyChat));
  return wrap;
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
  const avatar = el('div', 'msg__avatar');
  const mark = document.createElement('img');
  mark.src = '/assets/brand/patina-mark.svg'; mark.alt = 'patina'; mark.width = 20; mark.height = 20;
  avatar.appendChild(mark);
  msg.appendChild(avatar);
  const body = el('div', 'msg__body');
  const textEl = el('div', 'msg__text');
  const statusEl = el('p', 'output-status');
  statusEl.id = `${uid()}-status`;
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');
  textEl.setAttribute('aria-describedby', statusEl.id);
  body.append(textEl, statusEl);
  msg.appendChild(body);
  return { node: msg, body, textEl, statusEl };
}
// `announce: false` covers a rewrite that has not finished yet. The disabled-action
// state is real from the first byte, but calling an in-flight stream "unapproved —
// checks have not passed" reads as a failure warning during a normal 10-60s rewrite,
// so the status line stays empty until there is an actual outcome to report.
function markOutputUnapproved(textEl, statusEl, { announce = true } = {}) {
  textEl.classList.add('msg__text--unapproved');
  textEl.dataset.outputStatus = 'unapproved';
  textEl.setAttribute('aria-invalid', 'true');
  statusEl.textContent = announce ? i18n().outputUnapproved : '';
  statusEl.dataset.outputStatus = announce ? 'unapproved' : 'streaming';
}
function approveOutput(textEl, statusEl) {
  textEl.classList.remove('msg__text--unapproved');
  delete textEl.dataset.outputStatus;
  textEl.removeAttribute('aria-invalid');
  statusEl.textContent = i18n().outputApproved;
  statusEl.dataset.outputStatus = 'approved';
}
function buildTyping() {
  const t = el('div', 'typing');
  t.appendChild(el('span')); t.appendChild(el('span')); t.appendChild(el('span'));
  return t;
}
function fmt(v) { return Number.isFinite(v) ? String(Math.round(Number(v))) : '—'; }
// Strip the rewrite prompt scaffolding ([BODY]…[/BODY] + [SELF_AUDIT]) so the
// chat bubble only ever shows the rewritten body, never the internal format.
function cleanStream(s) {
  let out = String(s ?? '');
  const sa = out.search(/\[SELF[_\s-]?AUDIT\]/i);
  if (sa >= 0) out = out.slice(0, sa);
  const bm = out.match(/\[BODY\]([\s\S]*?)(?:\[\/BODY\]|$)/i);
  if (bm) out = bm[1];
  out = out.replace(/\[\/?BODY\]/gi, '').replace(/\[\/?SELF[_\s-]?AUDIT\]/gi, '');
  return out.trim();
}
function badge(label, value, ok) {
  const b = el('span', 'badge' + (ok ? ' badge--ok' : ''));
  b.appendChild(document.createTextNode(label + ' '));
  b.appendChild(el('b', null, value));
  return b;
}
function buildMeta(meta, original) {
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
  if (meta?.diff && (meta.diff.charDelta != null || meta.diff.wordDelta != null)) {
    const det = el('details', 'foldout');
    det.appendChild(el('summary', null, 'Length (before → after)'));
    const b = el('div', 'foldout__body');
    const sign = (d) => (Number(d) > 0 ? `+${d}` : String(d));
    const r1 = el('div', 'diffrow');
    r1.appendChild(el('span', 'k', 'Characters'));
    r1.appendChild(el('span', null, `${meta.diff.beforeChars} → ${meta.diff.afterChars} (${sign(meta.diff.charDelta)})`));
    const r2 = el('div', 'diffrow');
    r2.appendChild(el('span', 'k', 'Words'));
    r2.appendChild(el('span', null, `${meta.diff.beforeWords} → ${meta.diff.afterWords} (${sign(meta.diff.wordDelta)})`));
    b.appendChild(r1); b.appendChild(r2); det.appendChild(b); wrap.appendChild(det);
  }
  const report = buildReportLink(meta, original);
  if (report) wrap.appendChild(report);
  return wrap;
}

// False-positive report affordance (restores the pre-#560 audit-playground
// loop). Shown only when the BEFORE signal flagged at least one paragraph, so
// a user whose own writing was marked hot can file a prefilled GitHub issue
// (.github/ISSUE_TEMPLATE/false_positive.yml). User-initiated navigation only —
// nothing is sent anywhere until they submit the form on GitHub.
function buildReportLink(meta, original) {
  const b = meta?.signals?.before;
  if (!b || !(Number(b.hotParagraphs) > 0) || !original) return null;
  const sample = String(original).slice(0, 1200);
  const score = [
    'Source: playground rewrite (before-signal)',
    `Signal: ${fmt(Number(b.signalScore))} (hot ${b.hotParagraphs}/${b.paragraphCount})`,
    `MPS: ${fmt(Number(meta?.mps?.mps ?? meta?.mps))} / Fidelity: ${fmt(Number(meta?.fidelity?.fidelity ?? meta?.fidelity))}`,
  ].join('\n');
  const qs = new globalThis.URLSearchParams({
    template: 'false_positive.yml',
    language: els.lang.value,
    fired_paragraph: sample,
    score_output: score,
  });
  const a = el('a', 'report-fp', i18n().reportFp);
  a.href = `https://github.com/devswha/patina/issues/new?${qs}`;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
function buildOutputActions(text, receipt = null) {
  const actions = el('div', 'output-actions');
  const copy = el('button', 'output-action', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    track('Result Action', { action: 'copy' });
    try { await globalThis.navigator.clipboard?.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
  });
  const download = el('button', 'output-action', 'Download');
  download.type = 'button';
  const save = (name) => {
    const href = globalThis.URL.createObjectURL(new globalThis.Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = el('a'); anchor.href = href; anchor.download = name; anchor.click();
    globalThis.URL.revokeObjectURL(href);
  };
  download.addEventListener('click', () => { track('Result Action', { action: 'download' }); save('patina-rewrite.txt'); });
  const exportFile = el('button', 'output-action', 'Export');
  exportFile.type = 'button';
  exportFile.addEventListener('click', () => { track('Result Action', { action: 'export' }); save('patina-rewrite-export.txt'); });
  actions.append(copy, download, exportFile);
  if (receipt) {
    const audit = el('button', 'output-action', 'Audit JSON');
    audit.type = 'button';
    audit.addEventListener('click', () => {
      track('Result Action', { action: 'audit' });
      const sortKeys = (value) => {
        if (Array.isArray(value)) return value.map(sortKeys);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
      };
      const json = JSON.stringify(sortKeys(receipt), null, 2);
      const href = globalThis.URL.createObjectURL(new globalThis.Blob([json], { type: 'application/json;charset=utf-8' }));
      const anchor = el('a'); anchor.href = href; anchor.download = 'patina-audit-receipt.json'; anchor.click();
      globalThis.URL.revokeObjectURL(href);
    });
    actions.appendChild(audit);
  }
  return actions;
}

// Auto-detect the dominant script so pasted KO/EN/ZH/JA text is not silently
// rewritten under the wrong language. Kana => ja; Hangul => ko; Han without
// kana => zh; Latin => en. Returns null when undecidable.
function detectLang(text) {
  const s = String(text || '');
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7a3]/.test(s)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[A-Za-z]/.test(s)) return 'en';
  return null;
}

// Landing locale seeds the UI; only a deliberate control/preset selection locks the source language.
const DEFAULT_LANG = initialLanguage(globalThis.navigator, globalThis.location?.search);

// ---------- unified submit ----------
/** In-flight rewrite attempt: { controller, cancelled }. One at a time (busy gate). */
let active = null;

function i18n() { return { ...(I18N[els.lang.value] || I18N.en), ...experienceCopy(els.lang.value) }; }
function tfmt(template, vars) { return String(template).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')); }
function tierLabel(tier) {
  if (tier === WEB_TIERS.BYOK) return 'BYOK';
  if (tier === WEB_TIERS.PRO) return 'Pro';
  return 'Free';
}
// Error notes are live alerts so assistive tech announces failures.
function errorNote(text) { const n = el('div', 'error-note', text); n.setAttribute('role', 'alert'); return n; }

function stopActive() {
  if (!active) return;
  active.cancelled = true;
  active.controller.abort();
  active.stop?.();
}
function signOutLicense() {
  state.sessionEpoch += 1;
  if (active) { active.trackCancelled?.(); active.cancelled = true; active.controller.abort(); active = null; }
  state.busy = false;
  state.license = '';
  state.licenseStatus = licenseStatusAfter(state.licenseStatus, 'clear');
  els.licenseKey.value = '';
  state.convos = [];
  newConvo();
  els.thread.setAttribute('aria-busy', 'false');
  syncTier();
  updateHeroSend(); updateChatSend();
}
function signInLicense() {
  if (state.license) return;
  const license = els.licenseKey.value.trim();
  const error = $('#license-error');
  if (!license) {
    showInlineError(error, (PRO_I18N[els.lang.value] || PRO_I18N.en).missing);
    return;
  }
  state.license = license;
  state.licenseStatus = licenseStatusAfter(state.licenseStatus, 'apply');
  els.licenseKey.value = '';
  if (error) { error.hidden = true; error.textContent = ''; }
  syncTier();
  updateHeroSend(); updateChatSend();
}

function openSettings() { $('#settings-panel').setAttribute('open', ''); }
function closeSettings({ restoreFocus = false } = {}) {
  const panel = $('#settings-panel');
  if (!panel.hasAttribute('open')) return;
  panel.removeAttribute('open');
  if (restoreFocus) $('#settings-label').focus();
}
function withinSettings(node) {
  const panel = $('#settings-panel');
  for (let current = node; current; current = current.parentElement) if (current === panel) return true;
  return false;
}

function openLicenseControls() {
  openSettings();
  els.tier.value = WEB_TIERS.PRO;
  syncTier(); updateHeroSend(); updateChatSend();
  globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  if (state.license) els.licenseSignOut.focus();
  else els.licenseKey.focus();
}

function inlineErrorNode(source) { return source === 'chat' ? $('#composer-error') : $('#hero-error'); }
function clearInlineErrors() {
  document.querySelectorAll('#hero-error, #composer-error, #key-error, #license-error').forEach((n) => { /** @type {HTMLElement} */ (n).hidden = true; n.textContent = ''; });
  els.apiKey.classList.remove('is-invalid');
}
function showInlineError(node, msg) { if (!node) return; node.textContent = msg; node.hidden = false; }

// Client preflight mirrors the server contract caps (TIER_LIMITS — the server
// stays the enforcer) so over-cap or key-less requests never hit the network.
function preflight(clean, source) {
  const t = i18n();
  const tier = els.tier.value;
  const cap = TIER_LIMITS[tier]?.maxChars;
  if (cap && clean.length > cap) {
    showInlineError(inlineErrorNode(source), tfmt(t.tooLong, { cap, tier: tierLabel(tier) }));
    return false;
  }
  try {
    protectedInputSpans(activeConvo()?.thread.original ?? clean, els.protectedInput.value);
  } catch {
    showInlineError(inlineErrorNode(source), (PROTECTED_INPUT_COPY[els.lang.value] || PROTECTED_INPUT_COPY.en).invalid);
    return false;
  }
  if (tier === WEB_TIERS.BYOK && els.apiKey.value.trim().length === 0) {
    els.apiKey.classList.add('is-invalid');
    showInlineError($('#key-error'), t.keyMissing);
    showInlineError(inlineErrorNode(source), t.keyMissing);
    openSettings(); els.apiKey.focus();
    return false;
  }
  if (tier === WEB_TIERS.PRO && !state.license) {
    const message = (PRO_I18N[els.lang.value] || PRO_I18N.en).missing;
    showInlineError($('#license-error'), message);
    showInlineError(inlineErrorNode(source), message);
    openSettings(); els.licenseKey.focus();
    return false;
  }
  return true;
}

async function submit(text, source = 'hero') {
  if (state.busy) return;
  const clean = String(text || '').trim();
  if (!clean) return;

  // Hero text starts a new source. Detach before checking review/protected
  // anchors; keep an empty conversation so failed preflight retries reuse it.
  if (source === 'hero' && (state.heroDraft || activeConvo()?.messages.length)) newConvo(state.heroDraft?.protectedInput || '');
  if (activeConvo()?.reviewPending) return;

  clearInlineErrors();
  const currentConvo = activeConvo();
  const initialTurn = currentConvo?.thread.original == null;
  const preflightLang = initialTurn && !currentConvo?.thread.languageExplicit ? (detectLang(clean) || els.lang.value) : els.lang.value;
  const preflightMode = initialTurn ? 'first' : 'refine';
  if (!preflight(clean, source)) {
    const data = rewriteData(source, clean, preflightMode, preflightLang);
    track('Rewrite Requested', data);
    track('Rewrite Failed', { ...data, latencyBucket: '<5s', outcome: 'preflight' });
    return;
  }

  let convo = activeConvo();
  if (!convo) { newConvo(); convo = activeConvo(); }
  if (!convo) return;

  convo.thread.detectLanguage(detectLang(clean));
  restoreControls(convo);

  showChat();

  convo.messages.push({ role: 'user', text: clean });
  if (convo.title === 'New chat') { convo.title = clean.slice(0, 40); renderSidebar(); }
  const inner = threadInner();
  const emptyState = inner.querySelector('.thread__empty');
  if (emptyState) emptyState.remove();
  inner.appendChild(buildUserMsg(clean));

  const { node, body, textEl, statusEl } = buildPatinaMsg();
  inner.appendChild(node);

  els.heroInput.value = ''; autoGrow(els.heroInput);
  els.input.value = ''; autoGrow(els.input);

  const tier = els.tier.value;
  const reqBody = convo.thread.buildRequest({
    text: clean, tier,
    provider: els.provider.value, model: els.model.value,
    apiKey: tier === WEB_TIERS.BYOK ? els.apiKey.value : undefined,
  });
  reqBody.includeEdits = true;
  reqBody.protectedSpans = protectedInputSpans(convo.thread.original ?? clean, convo.protectedInput || '');
  const telemetry = rewriteData(source, clean, String(reqBody.mode));
  await runAttempt({
    convo, clean, reqBody, body, textEl, statusEl, telemetry,
    authorization: tier === WEB_TIERS.PRO ? `Bearer ${state.license}` : undefined,
    epoch: state.sessionEpoch,
  });
}

// One streaming attempt against /api/rewrite. The thread only commits on a
// done frame, so a failed or cancelled attempt never poisons conversation state.
async function runAttempt(attempt) {
  const { convo, clean, reqBody, body, textEl, statusEl, authorization, epoch, telemetry } = attempt;
  const startedAt = Date.now();
  let approved = false;
  track('Rewrite Requested', telemetry);
  let terminalTracked = false;
  const trackFailed = (outcome) => {
    if (terminalTracked) return;
    terminalTracked = true;
    track('Rewrite Failed', { ...telemetry, latencyBucket: latencyBucket(startedAt), outcome });
  };
  const trackCompleted = (mps, fidelity) => {
    if (terminalTracked) return;
    terminalTracked = true;
    track('Rewrite Completed', {
      ...telemetry,
      latencyBucket: latencyBucket(startedAt),
      mpsBand: scoreBand(mps),
      fidelityBand: scoreBand(fidelity),
    });
  };
  state.busy = true;
  for (const controller of reviewControllers) controller.setBusy(true);
  if (reqBody.tier === WEB_TIERS.PRO) {
    state.licenseStatus = licenseStatusAfter(state.licenseStatus, 'request');
    syncTier();
  }
  syncSettingsBusy();
  updateHeroSend(); updateChatSend();
  els.thread.setAttribute('aria-busy', 'true');

  textEl.style.display = 'none';
  textEl.classList.remove('msg__text--flagged');
  markOutputUnapproved(textEl, statusEl, { announce: false });
  const typing = buildTyping();
  body.appendChild(typing);
  scrollDown();

  let started = false;
  const start = () => { if (started) return; started = true; if (typing.parentElement) typing.remove(); textEl.style.display = ''; textEl.classList.add('streaming'); };

  const controller = new AbortController();
  const run = {
    controller,
    cancelled: false,
    trackCancelled: () => trackFailed('cancelled'),
    stop: () => {
      trackFailed('cancelled');
      if (typing.parentElement) typing.remove();
      textEl.style.display = '';
      textEl.classList.remove('streaming');
      textEl.classList.add('msg__text--flagged');
      markOutputUnapproved(textEl, statusEl);
      body.appendChild(errorNote(i18n().stopNote));
    },
  };
  active = run;
  const current = () => active === run && !run.cancelled && state.sessionEpoch === epoch;
  const IDLE_MS = 60000;
  let timedOut = false;
  let idleTimer;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { timedOut = true; controller.abort(); }, IDLE_MS);
  };
  armIdle();

  try {
    const { ok, finalFrame } = await streamRewrite({
      body: reqBody,
      authorization,
      signal: controller.signal,
      onStart: () => {
        if (!current()) return;
        armIdle();
        if (reqBody.tier === WEB_TIERS.PRO) {
          state.licenseStatus = licenseStatusAfter(state.licenseStatus, 'accepted');
          syncTier();
        }
      },
      onDelta: (_t, acc) => { if (current()) { armIdle(); start(); textEl.textContent = cleanStream(acc); scrollDown(); } },
      onDone: (frame) => {
        if (!current()) return;
        armIdle();
        start();
        const rewrite = typeof frame.rewrite === 'string' ? frame.rewrite : textEl.textContent;
        const mpsSource = frame.mps;
        const mpsNested = typeof mpsSource === 'object' && mpsSource !== null && 'mps' in mpsSource
          ? mpsSource.mps
          : undefined;
        const mps = Number(mpsNested ?? mpsSource);
        const fidelitySource = frame.fidelity;
        const fidelityNested = typeof fidelitySource === 'object' && fidelitySource !== null && 'fidelity' in fidelitySource
          ? fidelitySource.fidelity
          : undefined;
        const fidelity = Number(fidelityNested ?? fidelitySource);
        const rejected = frame.floorFailed || !Number.isFinite(mps) || !Number.isFinite(fidelity)
          || mps < MPS_FLOOR || fidelity < FIDELITY_FLOOR || mps > 100 || fidelity > 100
          || Number(/** @type {any} */ (frame.mps)?.hard_fail_count || 0) > 0;
        const meta = { mps: frame.mps, fidelity: frame.fidelity, signals: frame.signals, diff: frame.diff, floorFailed: rejected };
        textEl.textContent = rewrite; textEl.classList.remove('streaming');
        const original = reqBody.original ?? clean;
        const audit = buildMeta(meta, original);
        audit.dataset.verificationMeta = 'true';
        body.appendChild(audit);
        if (rejected) {
          trackFailed(Number.isFinite(mps) && Number.isFinite(fidelity) ? 'floor' : 'scoring');
          textEl.classList.add('msg__text--flagged');
          markOutputUnapproved(textEl, statusEl);
          body.appendChild(errorNote(i18n().floorWarn));
          return;
        }
        approveOutput(textEl, statusEl);
        approved = true;
        trackCompleted(mps, fidelity);
        body.appendChild(buildOutputActions(rewrite, frame.receipt));
        const message = { role: 'assistant', text: rewrite, meta, original, receipt: frame.receipt,
          editReview: frame.editReview, protectedSpans: reqBody.protectedSpans || [] };
        convo.messages.push(message);
        convo.reviewPending = false;
        convo.thread.commit({ userText: clean, assistantText: rewrite });
        void attachReview(convo, message, body, textEl, statusEl);
        scrollDown();
      },
    });
    if (!current()) return;
    if (!ok) {
      if (typing.parentElement) typing.remove();
      textEl.classList.remove('streaming');
      textEl.classList.add('msg__text--flagged');
      markOutputUnapproved(textEl, statusEl);
      const t = i18n();
      const ff = finalFrame || {};
      const attemptText = typeof ff.rewrite === 'string' ? ff.rewrite.trim() : '';
      const hasScores = ff.mps != null || ff.fidelity != null;
      const kind = classifyRewriteError(ff);
      const K = REWRITE_ERROR_KINDS;
      const outcome = failureOutcome(ff, kind, hasScores);
      trackFailed(outcome);
      if (attemptText || hasScores) {
        textEl.style.display = '';
        textEl.textContent = attemptText || cleanStream(textEl.textContent);
        textEl.classList.add('msg__text--flagged');
        body.appendChild(buildMeta({ mps: ff.mps, fidelity: ff.fidelity, signals: ff.signals, diff: ff.diff, floorFailed: true }, clean));
        body.appendChild(errorNote(t.floorWarn));
      } else {
        textEl.style.display = 'none';
        body.appendChild(errorNote(failureMessage(kind, ff, t)));
        if (reqBody.tier === WEB_TIERS.FREE && (kind === K.QUOTA_DAILY || kind === K.QUOTA_HOURLY)) body.appendChild(quotaUpsell());
        const recovery = rewriteRecovery(kind);
        if (recovery === 'credentials' && reqBody.tier === WEB_TIERS.PRO) {
          state.license = '';
          state.licenseStatus = licenseStatusAfter(state.licenseStatus, 'denied');
          syncTier();
        }
        if (recovery === 'retry') addRetry(body, attempt);
        else addRecovery(body, attempt, recovery);
      }
    }
  } catch (e) {
    if (!current()) return;
    if (typing.parentElement) typing.remove();
    textEl.style.display = ''; textEl.classList.remove('streaming');
    textEl.classList.add('msg__text--flagged');
    markOutputUnapproved(textEl, statusEl);
    const t = i18n();
    const msg = run.cancelled ? t.stopNote : timedOut ? t.timeoutNote : tfmt(t.netNote, { msg: String(e?.message || e) });
    trackFailed(run.cancelled ? 'cancelled' : 'stream');
    body.appendChild(errorNote(msg));
    if (!run.cancelled) addRetry(body, attempt);
  } finally {
    clearTimeout(idleTimer);
    if (active === run) {
      active = null;
      state.busy = false;
      for (const controller of reviewControllers) controller.setBusy(false);
      if (reqBody.tier === WEB_TIERS.PRO) {
        state.licenseStatus = licenseStatusAfter(state.licenseStatus, 'end');
        syncTier();
      }
      syncSettingsBusy();
      els.thread.setAttribute('aria-busy', 'false');
      updateHeroSend(); updateChatSend();
      els.input.focus();
    }
  }
  return { ok: approved };
}

// Stable error-kind → localized copy. Classification is centralized in
// rewrite-client.js#classifyRewriteError (no ad-hoc string matching here).
function failureMessage(kind, ff, t) {
  if (ff.code === 'protected_text_failed') return reviewCopy(els.lang.value).protected;
  if (ff.code === 'source_changed') return reviewCopy(els.lang.value).stale;
  if (ff.code === 'edit_output_too_long') return reviewCopy(els.lang.value).unavailable;
  const K = REWRITE_ERROR_KINDS;
  switch (kind) {
    case K.AUTH_REQUIRED: return t.authRequired;
    case K.AUTH_DENIED: return t.authDenied;
    case K.QUOTA_MONTHLY_REQUESTS: return t.monthlyRequests;
    case K.QUOTA_MONTHLY_CHARS: return t.monthlyChars;
    case K.QUOTA_MONTHLY_PROCESSING: return t.monthlyProcessing;
    case K.QUOTA_UNKNOWN: return t.quotaUnknown;
    case K.QUOTA_DAILY: return t.quotaDaily;
    case K.QUOTA_HOURLY: return t.quotaHourly;
    case K.QUOTA_CONCURRENT: return t.quotaConcurrent;
    case K.NUMBER_SAFETY: return t.numberSafetyNote;
    case K.IP_UNAVAILABLE:
    case K.QUOTA_STORAGE:
    case K.QUOTA_SECRET:
    case K.SERVICE_UNAVAILABLE: return t.serviceDown;
    case K.TEXT_TOO_LONG: {
      const tier = els.tier.value;
      return tfmt(t.tooLong, { cap: TIER_LIMITS[tier]?.maxChars ?? '', tier: tierLabel(tier) });
    }
    default: return t.failNote + (ff.status ? ` (HTTP ${ff.status})` : '');
  }
}

// Retry a transient failure with current settings: one submission per activation.
function addRetry(body, attempt) {
  // The review panel retries verification with current credentials. A generic
  // submit here would change a verification request into a generated rewrite.
  if (attempt.reqBody.mode === REWRITE_MODES.VERIFY) return;
  const btn = el('button', 'retrybtn', i18n().retry);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    if (state.busy || attempt.epoch !== state.sessionEpoch || activeConvo() !== attempt.convo) return;
    // Resubmit through preflight using this conversation's current settings and credentials.
    // An old retry button must never replay a cleared key or superseded preferences.
    btn.disabled = true;
    submit(attempt.clean, 'chat').finally(() => { btn.disabled = false; });
  });
  body.appendChild(btn);
  scrollDown();
}

function addRecovery(body, attempt, recovery) {
  const copy = experienceCopy(els.lang.value);
  const verification = attempt.reqBody.mode === REWRITE_MODES.VERIFY;
  const verifyRecovery = { en: 'Review key, then verify the selection', ko: '키 확인 후 선택본 다시 검증', zh: '检查密钥后重新验证所选文本', ja: 'キーを確認して選択文を再検証' };
  const btn = el('button', 'retrybtn', verification ? (verifyRecovery[els.lang.value] || verifyRecovery.en)
    : recovery === 'credentials' ? copy.recover : copy.revise);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    if (state.busy || attempt.epoch !== state.sessionEpoch) return;
    selectConvo(attempt.convo);
    // Verification belongs to the review panel. Putting its candidate in the
    // composer would turn recovery into a generated refine request.
    if (!verification && !els.input.value.trim()) els.input.value = attempt.clean;
    autoGrow(els.input);
    if (recovery === 'credentials') {
      els.tier.value = String(attempt.reqBody.tier);
      syncTier();
      if (els.tier.value === WEB_TIERS.PRO) openLicenseControls();
      else { openSettings(); els.apiKey.focus(); }
    } else {
      openSettings();
      if (!verification) els.input.focus();
    }
    updateChatSend();
  });
  body.appendChild(btn);
  const docs = el('a', 'ctl__link', copy.docs);
  docs.href = $('#pro-docs').getAttribute('href');
  docs.target = '_blank'; docs.rel = 'noopener noreferrer';
  body.appendChild(docs);
}

// ---------- composer UX ----------
function autoGrow(node) { node.style.height = 'auto'; node.style.height = Math.min(node.scrollHeight, 200) + 'px'; }
function tierBlocked(source) {
  return (source === 'chat' && Boolean(activeConvo()?.reviewPending))
    || (els.tier.value === WEB_TIERS.BYOK && els.apiKey.value.trim().length === 0)
    || (els.tier.value === WEB_TIERS.PRO && !state.license);
}
// While streaming, the send buttons become enabled Stop controls (is-stop).
function syncSendButton(btn, input, source) {
  btn.classList.toggle('is-stop', state.busy);
  btn.setAttribute('aria-label', state.busy ? i18n().stopLabel : experienceCopy(els.lang.value).send);
  btn.disabled = state.busy ? false : (input.value.trim().length === 0 || tierBlocked(source));
}
function updateHeroSend() { syncSendButton(els.heroSend, els.heroInput, 'hero'); }
function updateChatSend() { syncSendButton(els.send, els.input, 'chat'); }
function scrollDown() { els.thread.scrollTop = els.thread.scrollHeight; }
function closeMobileSidebar() { els.chat.classList.remove('sidebar-open'); els.toggleSidebar.setAttribute('aria-expanded', 'false'); }

function applyI18n(lang) {
  const t = { ...(I18N[lang] || I18N.en), ...onboardingCopy(lang) };
  const set = (sel, text) => { const n = document.querySelector(sel); if (n) n.textContent = text; };
  const protection = PROTECTED_INPUT_COPY[lang] || PROTECTED_INPUT_COPY.en;
  set('#protected-label', protection.label);
  set('#protected-hint', protection.hint);
  // Structured copy is rendered via DOM nodes (textContent + createElement), so
  // localized strings are never parsed as HTML (no innerHTML injection surface).
  const setTitle = (sel, parts) => {
    const n = document.querySelector(sel); if (!n) return;
    n.textContent = parts[0];
    n.appendChild(el('span', 'grad', parts[1]));
    if (parts[2]) n.appendChild(document.createTextNode(parts[2]));
  };
  const setLines = (sel, lines) => {
    const n = document.querySelector(sel); if (!n) return;
    n.textContent = '';
    lines.forEach((line, i) => { if (i) n.appendChild(document.createElement('br')); n.appendChild(document.createTextNode(line)); });
  };
  document.documentElement.lang = lang;
  const proBuyBtn = document.querySelector('#pro-buy');
  if (proBuyBtn) proBuyBtn.textContent = proBuyBtn.classList.contains('is-soon') ? t.proSoon : t.proBuy;
  setTitle('.hero__title', t.title);
  set('.hero__sub', t.sub);
  els.heroInput.setAttribute('placeholder', t.promptPh);
  els.heroInput.setAttribute('aria-label', t.promptPh);
  set('.how .sec__title', t.howTitle);
  const stepEls = document.querySelectorAll('.how__steps li');
  t.steps.forEach((s, i) => { const li = stepEls[i]; if (!li) return; const h = li.querySelector('h3'); const p = li.querySelector('p'); if (h) h.textContent = s[0]; if (p) p.textContent = s[1]; });
  set('.examples .sec__title', t.examplesTitle);
  set('.bench .sec__title', t.benchTitle);
  set('.bench .sec__lede', t.benchLede);
  const bcards = document.querySelectorAll('.bench__cards .bstat');
  t.benchCards.forEach((c, i) => { const card = bcards[i]; if (!card) return; const dd = card.querySelector('dd'); const sm = card.querySelector('small'); if (dd) dd.textContent = c[0]; if (sm) sm.textContent = c[1]; });
  const bcols = document.querySelectorAll('.bench__table thead th');
  t.benchCols.forEach((c, i) => { if (bcols[i]) bcols[i].textContent = c; });
  set('.bench__note', t.benchNote);
  set('.bench__link', t.benchLink);
  set('.cta__title', t.ctaTitle);
  set('.cta__sub', t.ctaSub);
  set('#cta-start', t.ctaBtn);
  setLines('.sidebar__note', t.note);
  set('.composer__hint', t.resultHint);
  set('#meaning-hint', t.hint);
  set('#meaning-label', t.meaningLabel);
  els.input.setAttribute('placeholder', t.chatPh);
  els.input.setAttribute('aria-label', t.chatPh);
  const nc = document.querySelector('#new-chat span:last-child'); if (nc) nc.textContent = t.newchat;
  const pro = PRO_I18N[lang] || PRO_I18N.en;
  set('#license-label', pro.license);
  els.licenseKey.setAttribute('placeholder', pro.placeholder);
  els.licenseKey.setAttribute('aria-label', pro.placeholder);
  set('#license-sign-in', pro.signIn);
  set('#license-sign-out', pro.signOut);
  applyExperienceCopy(lang, set);
  renderExamples();
}

function readControls() {
  return normalizePreferences({ lang: els.lang.value, documentType: els.documentType.value, persona: els.persona.value, register: els.register.value });
}
function restoreControls(convo) {
  const settings = convo.thread.preferences;
  els.lang.value = settings.lang;
  applyI18n(settings.lang);
  populatePersonas(); populateDocumentTypes();
  els.persona.value = settings.persona;
  els.documentType.value = settings.documentType;
  els.register.value = settings.register;
  $('#settings-status').textContent = '';
  renderSuggest(); syncTier(); syncSettingsBusy(); updateHeroSend(); updateChatSend();
}
function onLangChange() {
  if (state.heroDraft) {
    const selected = els.lang.value;
    newConvo(state.heroDraft.protectedInput);
    els.lang.value = selected;
  }
  const convo = activeConvo();
  if (convo) {
    const accepted = convo.thread.updatePreferences(readControls(), { explicitLanguage: true });
    restoreControls(convo);
    if (!accepted) $('#settings-status').textContent = experienceCopy(els.lang.value).languageLocked;
  } else {
    applyI18n(els.lang.value); populatePersonas(); populateDocumentTypes(); renderSuggest();
  }
}
function onPreferencesChange() {
  if (state.heroDraft) newConvo(state.heroDraft.protectedInput);
  const convo = activeConvo();
  if (convo) convo.thread.updatePreferences(readControls());
}
/** @returns {{protectedInput?:string,reviewPending?:boolean}|null} */
function protectedInputOwner() {
  return (els.app.getAttribute('data-view') === 'landing' && state.heroDraft) || activeConvo();
}
function renderProtectedInput() {
  els.protectedInput.value = protectedInputOwner()?.protectedInput || '';
}
function syncSettingsBusy() {
  for (const control of [els.lang, els.persona, els.documentType, els.register, $('#preset-apply')]) {
    control.toggleAttribute('disabled', state.busy);
  }
  syncPresetButtons();
  els.protectedInput.disabled = state.busy || Boolean(protectedInputOwner()?.reviewPending);
}

const storedPresets = readPresets();
let presets = storedPresets.presets;
let presetStatus = ({ unavailable: 'storageUnavailable', invalid: 'storageInvalid', version: 'storageVersion' })[storedPresets.status] || '';
const presetSelect = /** @type {HTMLSelectElement} */ ($('#preset-select'));
const presetName = /** @type {HTMLInputElement} */ ($('#preset-name'));
els.protectedInput.addEventListener('input', () => {
  const owner = protectedInputOwner();
  if (owner && !state.busy && !owner.reviewPending) owner.protectedInput = els.protectedInput.value;
});
function renderPresets(selected = presetSelect.value) {
  presetSelect.innerHTML = '';
  presetSelect.appendChild(new Option(experienceCopy(els.lang.value).presetNone, ''));
  presets.forEach((p) => presetSelect.appendChild(new Option(p.name, p.name)));
  presetSelect.value = presets.some((p) => p.name === selected) ? selected : '';
  $('#preset-status').textContent = experienceCopy(els.lang.value)[presetStatus] || '';
  syncPresetButtons();
}
function syncPresetButtons() {
  $('#preset-apply').toggleAttribute('disabled', state.busy || !presetSelect.value);
  $('#preset-delete').toggleAttribute('disabled', !presetSelect.value);
}
function persistPresets(success) {
  presetStatus = writePresets(presets) ? success : 'storageUnavailable';
}
function savePreset() {
  const result = saveNamedPreset(presets, presetName.value, readControls());
  if (result.ok) { presets = result.presets; persistPresets('presetSaved'); }
  else presetStatus = result.reason === 'limit' ? 'presetLimit' : 'presetNameError';
  renderPresets(result.ok ? presetName.value.trim() : presetSelect.value);
}
function applyPreset() {
  if (state.busy) return;
  const preset = presets.find((p) => p.name === presetSelect.value);
  if (preset && state.heroDraft) newConvo(state.heroDraft.protectedInput);
  const convo = activeConvo();
  if (!preset || !convo) return;
  const accepted = convo.thread.updatePreferences(preset.settings, { explicitLanguage: true });
  restoreControls(convo);
  presetStatus = accepted ? 'presetApplied' : 'languageLocked';
  renderPresets();
}
function deletePreset() {
  presets = presets.filter((p) => p.name !== presetSelect.value);
  persistPresets('presetDeleted');
  renderPresets('');
}
function applyExperienceCopy(lang, set) {
  const copy = experienceCopy(lang);
  const intro = onboardingCopy(lang);
  for (const [id, key] of [['settings-label', 'settings'], ['settings-hint', 'settingsHint'], ['hero-hint', 'heroHint'],
    ['hero-action', 'heroAction'], ['suggest-label', 'suggestions'], ['price-free', 'freeCta']]) set(`#${id}`, intro[key]);
  set('.nav__links a[href="#examples"]', intro.navExamples);
  set('.nav__links a[href="#pricing"]', intro.navPricing);
  els.homeLink.setAttribute('aria-label', intro.home);
  $('.nav__links').setAttribute('aria-label', intro.navigation);
  for (const [id, key] of [['provider', 'provider'], ['model', 'model'], ['api-key', 'apiKey']]) {
    $(`#${id}`).parentElement.querySelector('.ctl__label').textContent = intro[key];
  }
  els.apiKey.setAttribute('placeholder', intro.apiPlaceholder);
  els.apiKey.setAttribute('aria-label', intro.apiKey);
  const cards = document.querySelectorAll('.price');
  const renderCard = (card, name, features) => {
    if (!card) return;
    card.querySelector('.price__name').textContent = name;
    card.querySelectorAll('.price__feats li').forEach((li, i) => { li.textContent = features[i]; });
  };
  renderCard(cards[0], intro.freeName, intro.freeFeatures);
  renderCard(cards[1], copy.byokName, copy.byokFeatures);
  renderCard(cards[2], copy.proName, copy.proFeatures);
  if (cards[1]) cards[1].querySelector('.price__cost').textContent = copy.byokCost;
  set('.price__badge', copy.proBadge);
  set('.pricing .sec__title', copy.pricingTitle); set('.pricing .sec__lede', copy.pricingLede);
  set('.pricing__note', copy.pricingNote); set('#price-byok', copy.byokCta);
  set('#pro-existing', copy.already); set('#pro-docs', copy.docs); set('#pro-portal', copy.portal);
  for (const [i, id] of ['lang', 'document-type', 'persona', 'register', 'tier'].entries()) {
    const label = $(`#${id}`).parentElement.querySelector('.ctl__label');
    if (label) label.textContent = copy.labels[i];
    $(`#${id}`).setAttribute('aria-label', copy.labels[i]);
  }
  for (const [value, label] of [['', copy.preserve], ['casual', copy.casual], ['professional', copy.professional]]) {
    set(`#register option[value="${value}"]`, label);
  }
  for (const [id, key] of [['presets-label', 'presets'], ['preset-select-label', 'presetSelect'], ['preset-name-label', 'presetName'],
    ['preset-apply', 'presetApply'], ['preset-save', 'presetSave'], ['preset-delete', 'presetDelete'], ['preset-hint', 'presetHint']]) set(`#${id}`, copy[key]);
  renderPresets(); syncTier();
}

// ---------- events ----------
// The panel overlays the hero, so dismissal is document-scoped: Escape has to work
// while typing in the prompt, and a press outside the panel has to close it.
// A focused control inside the panel still bubbles its keydown up to the document,
// so one listener covers both; an open native <select> popup consumes the first
// Escape itself, which is the platform behavior and is left alone.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeSettings({ restoreFocus: true });
});
document.addEventListener('mousedown', (event) => {
  if (withinSettings(event.target)) return;
  closeSettings();
});
const inputStarted = new Set();
function trackInputStarted(surface, input) {
  if (inputStarted.has(surface) || input.value.length === 0) return;
  inputStarted.add(surface);
  track('Input Started', { surface, lang: els.lang.value });
}

function submitOnEnter(e, input, source) {
  // 229 also covers IME boundary keydowns whose isComposing flag is false.
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (!state.busy) submit(input.value, source);
}

els.heroForm.addEventListener('submit', (e) => { e.preventDefault(); if (state.busy) { stopActive(); return; } submit(els.heroInput.value, 'hero'); });
els.heroInput.addEventListener('input', () => { trackInputStarted('hero', els.heroInput); autoGrow(els.heroInput); updateHeroSend(); });
els.heroInput.addEventListener('keydown', (e) => submitOnEnter(e, els.heroInput, 'hero'));

els.composer.addEventListener('submit', (e) => { e.preventDefault(); if (state.busy) { stopActive(); return; } submit(els.input.value, 'chat'); });
els.input.addEventListener('input', () => { trackInputStarted('chat', els.input); autoGrow(els.input); updateChatSend(); });
els.input.addEventListener('keydown', (e) => submitOnEnter(e, els.input, 'chat'));

els.newChat.addEventListener('click', () => { if (state.busy) stopActive(); newConvo(); showChat(); els.input.value = ''; autoGrow(els.input); updateChatSend(); closeMobileSidebar(); els.input.focus(); });
els.toggleSidebar.addEventListener('click', () => {
  const open = els.chat.classList.toggle('sidebar-open');
  els.toggleSidebar.setAttribute('aria-expanded', String(open));
});
els.homeLink.addEventListener('click', (e) => { e.preventDefault(); showLanding(); globalThis.scrollTo({ top: 0, behavior: 'smooth' }); });
els.ctaStart && els.ctaStart.addEventListener('click', () => { globalThis.scrollTo({ top: 0, behavior: 'smooth' }); els.heroInput.focus(); });

els.lang.addEventListener('change', onLangChange);
for (const control of [els.documentType, els.persona, els.register]) control.addEventListener('change', onPreferencesChange);
$('#preset-save').addEventListener('click', savePreset);
$('#preset-apply').addEventListener('click', applyPreset);
$('#preset-delete').addEventListener('click', deletePreset);
presetSelect.addEventListener('change', () => { presetName.value = presetSelect.value; syncPresetButtons(); });
presetName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } });
els.tier.addEventListener('change', () => {
  track('Tier Selected', { tier: els.tier.value, surface: 'controls' });
  syncTier(); clearInlineErrors(); updateHeroSend(); updateChatSend();
});
els.apiKey.addEventListener('input', () => {
  els.apiKey.classList.remove('is-invalid');
  const ke = $('#key-error'); if (ke) { ke.hidden = true; ke.textContent = ''; }
  updateHeroSend(); updateChatSend();
});
els.licenseSignIn.addEventListener('click', signInLicense);
els.licenseSignOut.addEventListener('click', signOutLicense);
els.licenseKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); signInLicense(); } });
els.provider.addEventListener('change', populateModels);

// ---------- init ----------
els.lang.value = DEFAULT_LANG;
populateProviders();
syncTier();
captureUtm();
wireProCta();
wirePricingCtas();
newConvo();
showLanding();
updateHeroSend();
updateChatSend();

// Arrival uses the initialized browser locale; analytics owns success/reuse counting.
try { globalThis.patinaFunnelReady?.(els.lang.value); } catch { /* optional analytics */ }
