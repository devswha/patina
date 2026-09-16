/* global document, window, URLSearchParams */

// Dependency-free local UI. Wire choices: languages/documentTypes/registers/
// backends are ID arrays; personas is { ko: [{ id, label }], en: [...], ... }.
// ID arrays may also carry { value, label } (label: string or { ko, en }).
// These exports keep network/state behavior testable without a browser package.
const FIELDS = ['language', 'documentType', 'persona', 'register', 'backend', 'model', 'protectedTerms'];
const SELECT_FIELDS = FIELDS.slice(0, 5);
const CHOICE_KEYS = { language: 'languages', documentType: 'documentTypes', persona: 'personas', register: 'registers', backend: 'backends' };
const OPTIONAL_SELECTS = new Set(['persona', 'register', 'backend']);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

const COPY = {
  ko: {
    uiLanguage: '화면 언어', pageTitle: 'Patina · Aside 설정', eyebrow: 'ASIDE 블로그 워크플로우',
    title: '뜻은 그대로, 표현은 자연스럽게.', intro: 'Aside가 블로그 초안을 쓴 뒤, Patina가 의미를 지키며 상투적인 AI 표현을 다듬도록 설정하세요.',
    workflow: '워크플로우', stepDraft: 'Aside 초안 작성', stepPolish: 'Patina 표현 다듬기', stepReview: '결과 확인', settings: '블로그 작성 설정',
    writingTitle: '글의 기본 설정', writingIntro: '처음에는 언어 자동 감지와 원문 스타일 유지를 권장합니다.',
    language: '글 언어', languageHint: '자동 감지는 초안의 언어를 따릅니다. 번역 설정이 아닙니다.', documentType: '문서 유형', persona: '글쓴이 스타일',
    personaHint: '원문 유지로 두면 초안의 글쓴이 스타일을 따릅니다.', personaAutoHint: '언어 자동 감지에서는 원문 스타일을 유지합니다. 다른 스타일을 고르려면 글 언어를 먼저 선택하세요.',
    register: '말투', registerHint: '원문 유지로 두면 기존 말투를 따릅니다.',
    termsTitle: '그대로 둘 용어', termsIntro: '제품명이나 고유명사처럼 바꾸고 싶지 않은 용어를 지정하세요.', protectedTerms: '보호할 용어 (선택)', termsHint: '한 줄에 하나씩, 최대 20개. 초안에 등장하는 용어에만 적용됩니다.',
    runnerTitle: 'Patina 실행 설정', runnerIntro: '이미 설정한 실행 도구를 사용합니다. 이 화면에서 로그인하거나 API 키를 입력하지 않습니다.',
    backend: '실행 도구', model: '모델 (선택)', modelHint: '비워 두면 기존 모델 설정을 따릅니다. 실행 도구가 지원하는 모델 ID만 입력하세요.',
    privacy: '이 페이지는 설정만 이 컴퓨터에 저장합니다. 보호 용어도 설정에 포함됩니다. 이 화면에서 초안을 전송하거나 외부 서비스에 접속하지 않습니다.',
    loading: '설정을 불러오는 중…', saving: '설정을 저장하는 중…', ready: '다음 초안에 사용할 옵션을 선택하세요.', configured: '저장된 설정을 불러왔습니다.', dirty: '아직 저장하지 않은 변경 사항이 있습니다.',
    saved: '저장했습니다. Aside로 돌아가세요. 다음 초안에 이 설정이 적용됩니다.',
    saveHint: '저장하면 다음 Aside 블로그 초안부터 적용됩니다.', save: '설정 저장', reload: '현재 설정 다시 불러오기', retry: '다시 연결',
    footer: '의미 · 숫자 · 고유명사 보존', preserve: '원문 유지', backendDefault: '기존 Patina 설정 사용', unavailable: '현재 값 · 사용할 수 없음',
    invalid: '표시된 설정을 확인한 뒤 저장하세요.', conflict: '다른 곳에서 설정이 변경되었습니다. 현재 설정을 다시 불러온 뒤 수정하세요. 다시 불러오면 이 화면의 미저장 변경 사항은 대체됩니다.',
    missingToken: '이 설정 페이지를 Aside에서 다시 열어 주세요. 실행 중인 Patina 설정 명령이 제공하는 전체 주소를 사용하세요.',
    unauthorized: '설정 세션이 만료되었거나 유효하지 않습니다. Aside에서 Patina 설정 명령을 다시 실행해 새 페이지를 여세요.',
    network: '로컬 설정 서비스에 연결하지 못했습니다. 입력 내용은 이 화면에 남아 있습니다. 다시 연결하거나 Aside에서 Patina 설정 명령을 다시 실행하세요.',
    protocol: '설정 응답을 읽을 수 없습니다. Aside에서 Patina 설정 명령을 다시 실행해 주세요.',
    rejected: '설정을 저장하지 못했습니다. 입력한 옵션을 확인해 다시 시도하세요.', server: '로컬 설정 서비스가 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.',
    unsupported: '현재 값은 지원되지 않습니다. 목록에서 사용할 값을 선택하세요.',
    personaAuto: '언어 자동 감지에서는 원문 유지를 선택하세요. 현재 스타일을 쓰려면 해당 언어를 선택하세요.',
    personaLanguage: '현재 스타일은 선택한 언어에 없습니다. 원문 유지 또는 이 언어의 스타일을 선택하세요.',
    namuwiki: '나무위키풍은 글 언어가 한국어일 때만 사용할 수 있습니다.',
    modelInvalid: '모델 ID는 영문·숫자로 시작하며 최대 160자입니다. 영문, 숫자, 점, 밑줄, 콜론, /, @, +, -만 사용할 수 있습니다.',
    termsLimit: '보호 용어는 최대 20개입니다. 한 줄에 하나씩 입력하세요.', termsInvalid: '보호 용어는 중복 없이 256자 이내로 입력하고, 제어 문자는 제거해 주세요.',
  },
  en: {
    uiLanguage: 'Page language', pageTitle: 'Patina · Aside settings', eyebrow: 'ASIDE BLOG WORKFLOW',
    title: 'Keep the meaning. Find the words.', intro: 'After Aside writes your blog draft, let Patina refine formulaic AI phrasing while preserving meaning.',
    workflow: 'Workflow', stepDraft: 'Aside writes a draft', stepPolish: 'Patina refines the phrasing', stepReview: 'Review the result', settings: 'Blog writing settings',
    writingTitle: 'Writing preferences', writingIntro: 'Start with automatic language detection and preserve the source style.',
    language: 'Draft language', languageHint: 'Auto detects the language of the draft. This does not translate it.', documentType: 'Document type', persona: 'Writer style',
    personaHint: 'Preserve source keeps the writer style of the draft.', personaAutoHint: 'Auto language keeps the source style. Choose a draft language first to select another style.',
    register: 'Register', registerHint: 'Preserve source follows the existing level of formality.',
    termsTitle: 'Words to keep', termsIntro: 'Specify product names or other terms whose wording should stay unchanged.', protectedTerms: 'Protected terms (optional)', termsHint: 'One per line, up to 20. Only terms present in the draft are protected.',
    runnerTitle: 'Run Patina with', runnerIntro: 'Use a tool you have already configured. This page does not collect sign-ins or API keys.',
    backend: 'Execution tool', model: 'Model (optional)', modelHint: 'Leave blank to use your existing model setting. Enter a model ID supported by the execution tool.',
    privacy: 'This page saves settings on this computer, including protected terms. It does not send drafts or connect to external services.',
    loading: 'Loading settings…', saving: 'Saving settings…', ready: 'Choose the options for your next draft.', configured: 'Your saved settings are loaded.', dirty: 'You have unsaved changes.',
    saved: 'Saved. Return to Aside; the next draft uses these settings.',
    saveHint: 'Saved options apply to the next Aside blog draft.', save: 'Save settings', reload: 'Reload current settings', retry: 'Reconnect',
    footer: 'Preserve meaning, numbers & names', preserve: 'Preserve source', backendDefault: 'Use existing Patina configuration', unavailable: 'Current value · unavailable',
    invalid: 'Review the highlighted settings before saving.', conflict: 'Settings changed elsewhere. Reload the current settings before editing again. Reloading replaces the unsaved changes on this page.',
    missingToken: 'Reopen this settings page from Aside using the full address provided by the running Patina settings command.',
    unauthorized: 'This settings session has expired or is invalid. Run the Patina settings command again in Aside to open a new page.',
    network: 'Could not connect to the local settings service. Your input is still on this page. Reconnect or run the Patina settings command again in Aside.',
    protocol: 'Could not read the settings response. Run the Patina settings command again in Aside.',
    rejected: 'Could not save these settings. Check your options and try again.', server: 'The local settings service could not complete the request. Try again shortly.',
    unsupported: 'This value is not supported. Choose an available value from the list.',
    personaAuto: 'Auto language requires Preserve source. Choose a matching language to keep the current style.',
    personaLanguage: 'This style is not available for the selected language. Choose Preserve source or a style for this language.',
    namuwiki: 'NamuWiki style requires Korean as the draft language.',
    modelInvalid: 'Use a model ID up to 160 characters, starting with a letter or number. Allowed: letters, numbers, period, underscore, colon, /, @, +, -.',
    termsLimit: 'Use at most 20 protected terms, one per line.', termsInvalid: 'Use unique protected terms up to 256 characters, without control characters.',
  },
};

const LABELS = {
  language: { auto: ['자동 감지', 'Auto detect'], ko: ['한국어', 'Korean'], en: ['영어', 'English'], zh: ['중국어', 'Chinese'], ja: ['일본어', 'Japanese'] },
  documentType: {
    default: ['기본 문서', 'General'], blog: ['블로그 / 에세이', 'Blog / essay'], academic: ['학술 / 연구', 'Academic / research'], technical: ['기술 문서', 'Technical'], formal: ['제안서 / 공식 보고서', 'Proposal / official report'], resume: ['이력서', 'Resume'], 'personal-statement': ['자기소개서 / 커버레터', 'Personal statement / cover letter'], 'project-writeup': ['프로젝트 기록', 'Project writeup'],
    social: ['SNS', 'Social post'], email: ['이메일', 'Email'], legal: ['법률 문서', 'Legal'], medical: ['의학 문서', 'Medical'], marketing: ['마케팅', 'Marketing'], narrative: ['내러티브 / 에세이', 'Narrative / essay'],
    instructional: ['안내 / 사용법', 'How-to / instructions'], 'casual-conversation': ['대화 / 메시지', 'Conversation / message'], 'code-comment': ['코드 주석', 'Code comment'], 'commit-message': ['커밋 메시지', 'Commit message'],
    'release-notes': ['릴리스 노트', 'Release notes'], namuwiki: ['나무위키풍 · 한국어 전용', 'NamuWiki style · Korean only'],
  },
  persona: {
    'natural-ko': ['담백한 한국어', 'Plain Korean'], 'natural-en': ['담백한 영어', 'Plain English'], 'natural-zh': ['담백한 중국어', 'Plain Chinese'], 'natural-ja': ['담백한 일본어', 'Plain Japanese'],
    'blog-essay': ['개인 블로그 에세이', 'Personal blog essay'], 'technical-explainer': ['기술 설명형', 'Technical explainer'], 'soft-professional': ['부드러운 업무 문체', 'Approachable professional'], 'pragmatic-founder': ['실전형 창업자', 'Pragmatic founder'],
  },
  register: { casual: ['편안한 말투', 'Casual'], professional: ['업무용 말투', 'Professional'] },
  backend: { 'codex-cli': ['Codex CLI', 'Codex CLI'], 'claude-cli': ['Claude CLI', 'Claude CLI'], 'gemini-cli': ['Gemini CLI', 'Gemini CLI'], 'kimi-cli': ['Kimi CLI', 'Kimi CLI'], default: ['기존 Patina 설정 사용', 'Use existing Patina configuration'] },
};

export function textFor(locale, key) {
  return COPY[locale === 'en' ? 'en' : 'ko'][key] || COPY.ko[key] || key;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code) => Object.assign(new Error(code), { code });

function normalizeChoice(entry) {
  if (typeof entry === 'string' && entry) return { value: entry, label: null };
  if (!record(entry)) throw failure('protocol');
  const value = entry.value ?? entry.id;
  if (typeof value !== 'string' || !value) throw failure('protocol');
  const label = entry.label;
  if (label !== undefined && typeof label !== 'string' && !record(label)) throw failure('protocol');
  return { value, label: label ?? null };
}

function choiceList(value) {
  if (!Array.isArray(value)) throw failure('protocol');
  const list = value.map(normalizeChoice);
  if (new Set(list.map((entry) => entry.value)).size !== list.length) throw failure('protocol');
  return list;
}

export function readPayload(payload) {
  if (!record(payload) || payload.schemaVersion !== 1 || typeof payload.configured !== 'boolean'
      || !(payload.settingsHash === null || (typeof payload.settingsHash === 'string' && payload.settingsHash.length > 0))
      || !record(payload.settings) || !record(payload.choices)) throw failure('protocol');
  const settings = Object.fromEntries(FIELDS.map((field) => [field, payload.settings[field]]));
  for (const field of ['language', 'documentType']) if (typeof settings[field] !== 'string') throw failure('protocol');
  for (const field of ['persona', 'register', 'backend', 'model']) {
    if (settings[field] !== null && typeof settings[field] !== 'string') throw failure('protocol');
  }
  if (!Array.isArray(settings.protectedTerms) || settings.protectedTerms.some((term) => typeof term !== 'string' || /[\r\n]/.test(term))) throw failure('protocol');
  const choices = {};
  for (const key of ['languages', 'documentTypes', 'registers', 'backends']) choices[key] = choiceList(payload.choices[key]);
  if (!record(payload.choices.personas)) throw failure('protocol');
  choices.personas = Object.fromEntries(Object.entries(payload.choices.personas).map(([lang, entries]) => [lang, choiceList(entries)]));
  return { schemaVersion: 1, configured: payload.configured, settingsHash: payload.settingsHash, settings, choices };
}

export function parseProtectedTerms(value) {
  return String(value).split(/\r\n|\r|\n/).map((term) => term.trim()).filter(Boolean);
}

function toDraft(settings) {
  return { ...settings, model: settings.model ?? '', protectedTerms: settings.protectedTerms.join('\n') };
}

export function settingsFromDraft(draft) {
  return {
    language: draft.language, documentType: draft.documentType,
    persona: draft.persona || null, register: draft.register || null, backend: draft.backend || null,
    model: draft.model.trim() || null, protectedTerms: parseProtectedTerms(draft.protectedTerms),
  };
}

function choicesFor(choices, field, language) {
  if (field === 'persona') return Object.prototype.hasOwnProperty.call(choices.personas, language) ? choices.personas[language] : [];
  return choices[CHOICE_KEYS[field]];
}

export function validateSettings(settings, choices) {
  const errors = {};
  for (const field of SELECT_FIELDS) {
    const value = settings[field];
    if (value === null && OPTIONAL_SELECTS.has(field)) continue;
    if (!choicesFor(choices, field, settings.language).some((entry) => entry.value === value)) errors[field] = 'unsupported';
  }
  if (settings.persona !== null) {
    if (settings.language === 'auto') errors.persona = 'personaAuto';
    else if (errors.persona) errors.persona = 'personaLanguage';
  }
  if (settings.documentType === 'namuwiki' && settings.language !== 'ko') errors.documentType = 'namuwiki';
  if (settings.model !== null && (settings.model.length > 160 || !MODEL_PATTERN.test(settings.model) || /:\/\/|^(?:sk[-_]|AIza|Bearer)/i.test(settings.model))) errors.model = 'modelInvalid';
  if (settings.protectedTerms.length > 20) errors.protectedTerms = 'termsLimit';
  // One term is a literal configuration value, never markup or an instruction.
  // Reject embedded controls; ordinary Unicode names and punctuation are valid.
  if (new Set(settings.protectedTerms).size !== settings.protectedTerms.length || settings.protectedTerms.some((term) => term.length > 256 || [...term].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) errors.protectedTerms = 'termsInvalid';
  return errors;
}

export function displayChoices(choices, field, settings, locale = 'ko') {
  let entries = choicesFor(choices, field, settings.language);
  if (field === 'persona' && settings.language === 'auto') {
    entries = [...new Map(Object.values(choices.personas).flat().map((entry) => [entry.value, entry])).values()];
  }
  const available = choicesFor(choices, field, settings.language);
  const result = entries.map((entry) => {
    const translated = LABELS[field]?.[entry.value]?.[locale === 'en' ? 1 : 0];
    const provided = typeof entry.label === 'string' ? entry.label : entry.label?.[locale];
    return {
      value: entry.value,
      label: translated || (typeof provided === 'string' && provided) || entry.value,
      disabled: (field === 'persona' && settings.language === 'auto') || (field === 'documentType' && entry.value === 'namuwiki' && settings.language !== 'ko'),
    };
  });
  if (OPTIONAL_SELECTS.has(field)) result.unshift({ value: null, label: textFor(locale, field === 'backend' ? 'backendDefault' : 'preserve'), disabled: false });
  const selected = settings[field];
  if (selected !== null && !available.some((entry) => entry.value === selected)) {
    const existing = result.find((entry) => entry.value === selected);
    const label = `${selected} (${textFor(locale, 'unavailable')})`;
    if (existing) existing.label = label;
    else result.push({ value: selected, label, disabled: true });
  }
  return result;
}

// Keep the fragment so reload can reconnect during the local server's session.
// The token is copied into the client's closure, never rendered or stored by
// the page. Requests send it only to a fixed same-origin path, never in a query
// or body; redirects cannot forward it to another service.
export function takeSessionToken(location) {
  const fragment = location.hash.slice(1);
  let token = '';
  try {
    token = fragment.startsWith('token=') ? new URLSearchParams(fragment).get('token') : decodeURIComponent(fragment);
  } catch { /* An invalid fragment is reported as an expired/missing session. */ }
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : '';
}

export function createOptionsClient({ token, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  async function request(method, data) {
    if (!token) throw failure('missingToken');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'X-Patina-Session': token, Accept: 'application/json' };
      if (data) headers['Content-Type'] = 'application/json';
      let response;
      try {
        response = await fetchImpl('/api/options', {
          method, headers, ...(data ? { body: JSON.stringify(data) } : {}),
          cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        });
      } catch { throw failure('network'); }
      if (!response.ok) {
        // Do not echo arbitrary server text: it could contain local paths,
        // capability tokens, or private protected terms.
        if (response.status === 409) throw failure('conflict');
        if ([401, 403, 410].includes(response.status)) throw failure('unauthorized');
        throw failure(response.status >= 500 ? 'server' : 'rejected');
      }
      try { return readPayload(await response.json()); }
      catch { throw failure(controller.signal.aborted ? 'network' : 'protocol'); }
    } finally { clearTimeout(timer); }
  }
  return {
    load: () => request('GET'),
    save: (settings, baseHash) => request('POST', { settings: Object.fromEntries(FIELDS.map((field) => [field, settings[field]])), baseHash }),
  };
}

export function createOptionsController({ client, onChange = () => {} }) {
  let state = { phase: 'loading', payload: null, draft: null, errors: {}, problem: null, conflict: false, dirty: false };
  const getState = () => clone(state);
  const emit = () => onChange(getState());
  const busy = () => state.phase === 'loading' || state.phase === 'saving';
  function refresh() {
    const settings = settingsFromDraft(state.draft);
    state.errors = validateSettings(settings, state.payload.choices);
    state.dirty = JSON.stringify(settings) !== JSON.stringify(state.payload.settings);
  }
  async function load() {
    if (state.phase === 'saving') return false;
    state.phase = 'loading'; state.problem = null; emit();
    try {
      const payload = await client.load();
      state = { phase: 'ready', payload, draft: toDraft(payload.settings), errors: {}, problem: null, conflict: false, dirty: false };
      refresh(); emit(); return true;
    } catch (error) {
      state.phase = 'error'; state.problem = error.code || 'network'; emit(); return false;
    }
  }
  function update(field, value) {
    if (!FIELDS.includes(field) || !state.draft || busy() || state.conflict) return;
    state.draft[field] = value;
    state.phase = 'ready';
    if (state.problem !== 'unauthorized') state.problem = null;
    refresh(); emit();
  }
  async function save() {
    if (!state.draft || busy() || state.conflict || state.problem === 'unauthorized') return false;
    refresh();
    if (Object.keys(state.errors).length) { state.problem = 'invalid'; emit(); return false; }
    const settings = settingsFromDraft(state.draft);
    state.phase = 'saving'; state.problem = null; emit();
    try {
      const payload = await client.save(settings, state.payload.settingsHash);
      state = { phase: 'saved', payload, draft: toDraft(payload.settings), errors: {}, problem: null, conflict: false, dirty: false };
      refresh(); emit(); return true;
    } catch (error) {
      state.phase = 'error'; state.problem = error.code || 'network';
      state.conflict = error.code === 'conflict'; emit(); return false;
    }
  }
  return { load, update, save, getState };
}

export function mountOptionsPage(doc, browser) {
  let locale = 'ko';
  let lastState;
  const node = (id) => doc.getElementById(id);
  const form = node('options-form');
  const controls = Object.fromEntries(FIELDS.map((field) => [field, node(field)]));
  const client = createOptionsClient({ token: takeSessionToken(browser.location), fetchImpl: browser.fetch.bind(browser) });

  function render(state) {
    lastState = state;
    const pending = state.phase === 'loading' || state.phase === 'saving';
    node('settings-fields').disabled = pending || !state.payload || state.conflict;
    form.setAttribute('aria-busy', String(pending));
    node('save').disabled = pending || !state.payload || state.conflict || Object.keys(state.errors).length > 0 || state.problem === 'unauthorized';
    node('save').textContent = textFor(locale, state.phase === 'saving' ? 'saving' : 'save');
    node('reload').hidden = !state.problem || ['invalid', 'missingToken', 'unauthorized'].includes(state.problem) || (Boolean(state.payload) && !state.conflict);
    node('reload').disabled = pending;
    node('reload').textContent = textFor(locale, state.conflict ? 'reload' : 'retry');
    node('error').hidden = !state.problem;
    node('error').textContent = state.problem ? textFor(locale, state.problem) : '';
    const status = pending ? state.phase : state.phase === 'saved' ? 'saved' : state.dirty ? 'dirty' : state.payload?.configured ? 'configured' : 'ready';
    node('status').textContent = textFor(locale, status);
    node('status').dataset.state = state.phase;
    if (!state.draft) return;
    const settings = settingsFromDraft(state.draft);
    for (const field of SELECT_FIELDS) {
      const options = displayChoices(state.payload.choices, field, settings, locale).map((entry) => {
        const option = doc.createElement('option');
        option.value = entry.value ?? ''; option.textContent = entry.label; option.disabled = entry.disabled;
        return option;
      });
      controls[field].replaceChildren(...options);
      controls[field].value = state.draft[field] ?? '';
    }
    for (const field of ['model', 'protectedTerms']) {
      if (controls[field].value !== state.draft[field]) controls[field].value = state.draft[field];
    }
    for (const field of FIELDS) {
      const error = state.errors[field];
      controls[field].setAttribute('aria-invalid', String(Boolean(error)));
      node(`${field}-error`).hidden = !error;
      node(`${field}-error`).textContent = error ? textFor(locale, error) : '';
    }
    node('persona-hint').textContent = textFor(locale, settings.language === 'auto' ? 'personaAutoHint' : 'personaHint');
    node('terms-count').textContent = `${settings.protectedTerms.length} / 20`;
  }

  function translate() {
    doc.documentElement.lang = locale;
    doc.title = textFor(locale, 'pageTitle');
    for (const element of doc.querySelectorAll('[data-i18n]')) element.textContent = textFor(locale, element.dataset.i18n);
    node('ui-language').setAttribute('aria-label', textFor(locale, 'uiLanguage'));
    node('workflow').setAttribute('aria-label', textFor(locale, 'workflow'));
    if (lastState) render(lastState);
  }

  const controller = createOptionsController({ client, onChange: render });
  for (const [field, control] of Object.entries(controls)) {
    control.addEventListener(SELECT_FIELDS.includes(field) ? 'change' : 'input', () => {
      const value = OPTIONAL_SELECTS.has(field) ? control.value || null : control.value;
      controller.update(field, value);
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saved = await controller.save();
    if (!saved) {
      const field = Object.keys(controller.getState().errors)[0];
      if (field) controls[field].focus();
    }
  });
  node('reload').addEventListener('click', () => controller.load());
  node('ui-language').addEventListener('change', (event) => { locale = event.target.value === 'en' ? 'en' : 'ko'; translate(); });
  browser.addEventListener('beforeunload', (event) => {
    if (!controller.getState().dirty) return;
    event.preventDefault(); event.returnValue = '';
  });
  translate();
  return { controller, ready: controller.load() };
}

if (typeof document !== 'undefined' && document.getElementById('aside-options')) mountOptionsPage(document, window);
