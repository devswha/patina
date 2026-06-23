import {
  SAMPLE_TEXT,
  SUPPORTED_LANGS,
  analyzePlaygroundText,
  buildCliCommand,
  buildFalsePositiveReportUrl,
  escapeHtml,
  renderAuditDiff,
  renderKoreanAdvisory,
} from './analyzer.js';
import { createAnalysisController } from './analysis-dispatch.js';
import {
  UI_LANGS,
  DEFAULT_UI_LANG,
  normalizeUiLang,
  t,
  bandLabel,
  reasonLabel,
} from './i18n.js';

const doc = globalThis.document;
const UI_LANG_STORAGE_KEY = 'patina-ui-lang';
const state = {
  lang: 'ko',
  uiLang: DEFAULT_UI_LANG,
  text: '',
  analysis: analyzePlaygroundText('', { lang: 'ko' }),
};

const nodes = {
  lang: doc.querySelector('#lang'),
  uiLang: doc.querySelector('#ui-lang'),
  sample: doc.querySelector('#sample'),
  input: doc.querySelector('#input'),
  analyze: doc.querySelector('#analyze'),
  copyCli: doc.querySelector('#copy-cli'),
  reportFp: doc.querySelector('#report-fp'),
  copyStatus: doc.querySelector('#copy-status'),
  scoreValue: doc.querySelector('#score-value'),
  scoreBand: doc.querySelector('#score-band'),
  scoreBar: doc.querySelector('#score-bar'),
  summary: doc.querySelector('#summary'),
  audit: doc.querySelector('#audit'),
  koreanAdvisory: doc.querySelector('#korean-advisory'),
  diff: doc.querySelector('#diff'),
  cliPreview: doc.querySelector('#cli-preview'),
};

// Interface language resolution order: explicit ?ui= query > saved preference >
// browser language (Korean → ko) > English default. Independent from #lang,
// which selects the language of the text being audited.
function readStoredUiLang() {
  try {
    return globalThis.localStorage?.getItem(UI_LANG_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistUiLang(value) {
  try {
    globalThis.localStorage?.setItem(UI_LANG_STORAGE_KEY, value);
  } catch {
    // Storage can throw in private mode; the URL query still carries the choice.
  }
}

function resolveInitialUiLang(url) {
  const fromQuery = url.searchParams.get('ui');
  if (UI_LANGS.includes(fromQuery)) return fromQuery;
  const stored = readStoredUiLang();
  if (UI_LANGS.includes(stored)) return stored;
  const navLang = (globalThis.navigator?.language ?? '').toLowerCase();
  if (navLang.startsWith('ko')) return 'ko';
  return DEFAULT_UI_LANG;
}

function readQueryState() {
  const url = new URL(globalThis.location?.href ?? 'https://patina.vibetip.help/');
  const lang = url.searchParams.get('lang');
  if (SUPPORTED_LANGS.includes(lang)) state.lang = lang;
  state.uiLang = normalizeUiLang(resolveInitialUiLang(url));
}

function updateQuery() {
  if (!globalThis.history || !globalThis.location) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set('lang', state.lang);
  url.searchParams.set('ui', state.uiLang);
  globalThis.history.replaceState(null, '', url);
}

// Translate every static element tagged with data-i18n (text content) or
// data-i18n-attr="attr:key;attr2:key2" (attributes). Re-run on language switch.
function applyStaticI18n() {
  const ui = state.uiLang;
  if (doc.documentElement) doc.documentElement.lang = ui;
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    el.textContent = t(ui, el.dataset.i18n);
  }
  for (const el of doc.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (attr && key) el.setAttribute(attr, t(ui, key));
    }
  }
}

function localizeReasonLabel(uiLang, reason) {
  return normalizeUiLang(uiLang) === 'ko' ? reasonLabel('ko', reason.code) : reason.label;
}

function setSample() {
  state.text = SAMPLE_TEXT[state.lang];
  nodes.input.value = state.text;
  runAnalysis();
}

function metricsTable(analysis) {
  const ui = state.uiLang;
  if (analysis.paragraphCount === 0) return `<p class="empty-state">${t(ui, 'audit.empty')}</p>`;
  const na = t(ui, 'value.na');
  const rows = analysis.paragraphs.map((p) => {
    const reasons = p.reasons.map((r) => localizeReasonLabel(ui, r)).join(', ') || t(ui, 'value.none');
    const cv = p.burstiness.cv == null ? na : p.burstiness.cv.toFixed(2);
    const mattr = p.mattr.value == null ? na : p.mattr.value.toFixed(2);
    const density = p.lexicon.density.toFixed(1);
    return `<tr>
      <td>${escapeHtml(p.id)}</td>
      <td><span class="pill ${p.hot ? 'hot' : 'clean'}">${p.hot ? t(ui, 'pill.review') : t(ui, 'pill.ok')}</span></td>
      <td>${p.sentenceCount}</td>
      <td>${p.tokenCount}</td>
      <td>${cv} <span class="muted">${escapeHtml(p.burstiness.band ?? '')}</span></td>
      <td>${mattr} <span class="muted">${escapeHtml(p.mattr.band ?? '')}</span></td>
      <td>${p.lexicon.matches} <span class="muted">${density}/1k</span></td>
      <td>${escapeHtml(reasons)}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>${t(ui, 'audit.th.para')}</th><th>${t(ui, 'audit.th.status')}</th><th>${t(ui, 'audit.th.sent')}</th><th>${t(ui, 'audit.th.tokens')}</th><th>${t(ui, 'audit.th.burst')}</th><th>${t(ui, 'audit.th.mattr')}</th><th>${t(ui, 'audit.th.lexicon')}</th><th>${t(ui, 'audit.th.signals')}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function render() {
  const ui = state.uiLang;
  const analysis = state.analysis;
  const band = analysis.band;
  nodes.scoreValue.textContent = String(analysis.overall);
  nodes.scoreBand.textContent = bandLabel(ui, band.key);
  nodes.scoreBand.dataset.tone = band.tone;
  nodes.scoreBar.style.setProperty('--score', `${analysis.overall}%`);
  nodes.summary.innerHTML = `
    <li>${t(ui, 'summary.review', { hot: analysis.hotCount, total: analysis.paragraphCount })}</li>
    <li>${t(ui, 'summary.tokens', { tokens: analysis.totalTokens })}</li>
    <li>${t(ui, 'summary.disclaimer')}</li>
  `;
  nodes.audit.innerHTML = metricsTable(analysis);
  nodes.koreanAdvisory.innerHTML = renderKoreanAdvisory(analysis, ui);
  nodes.diff.innerHTML = renderAuditDiff(analysis, ui);
  nodes.cliPreview.textContent = buildCliCommand(state.text, state.lang);
}

// Analysis runs in a Web Worker so a long paste never blocks rendering. The
// worker is loaded by relative URL for static hosting; if Worker is missing or
// the worker errors, the controller transparently falls back to same-thread
// analysis. Only the latest request id is rendered, so stale worker responses
// from earlier keystrokes can never overwrite newer input (#450 follow-up).
function createAnalysisWorker() {
  const WorkerCtor = globalThis.Worker;
  if (typeof WorkerCtor !== 'function') return null;
  return new WorkerCtor(new URL('./analyzer-worker.js', import.meta.url), { type: 'module' });
}

const analysisController = createAnalysisController({
  analyze: analyzePlaygroundText,
  createWorker: createAnalysisWorker,
  onResult: (analysis) => {
    state.analysis = analysis;
    render();
  },
});

function runAnalysis() {
  state.text = nodes.input.value;
  analysisController.request(state.text, state.lang);
}

async function copyText(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  doc.body.append(area);
  area.select();
  const ok = doc.execCommand('copy');
  area.remove();
  return ok;
}

async function copyCli() {
  const command = buildCliCommand(state.text, state.lang);
  try {
    const ok = await copyText(command);
    nodes.copyStatus.textContent = ok ? t(state.uiLang, 'status.copied') : t(state.uiLang, 'status.copyFailed');
  } catch (_err) {
    nodes.copyStatus.textContent = t(state.uiLang, 'status.copyFailed');
  }
}

function reportFalsePositive() {
  if (!state.text.trim()) {
    nodes.copyStatus.textContent = t(state.uiLang, 'status.reportFirst');
    return;
  }
  const url = buildFalsePositiveReportUrl(state.text, state.lang, state.analysis);
  const opened = globalThis.open?.(url, '_blank', 'noopener');
  nodes.copyStatus.textContent = opened
    ? t(state.uiLang, 'status.reportOpened')
    : t(state.uiLang, 'status.reportBlocked');
}

function setUiLang(value) {
  state.uiLang = normalizeUiLang(value);
  if (nodes.uiLang) nodes.uiLang.value = state.uiLang;
  persistUiLang(state.uiLang);
  updateQuery();
  applyStaticI18n();
  render();
}

// Re-analysis runs detectTranslationese + per-paragraph stylometry + three
// innerHTML re-renders; debounce keystrokes so a long paste does not block the
// main thread on every character. The 'Run audit' button stays immediate (#450).
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function bind() {
  nodes.lang.value = state.lang;
  nodes.input.value = state.text;
  if (nodes.uiLang) {
    nodes.uiLang.value = state.uiLang;
    nodes.uiLang.addEventListener('change', () => setUiLang(nodes.uiLang.value));
  }
  nodes.lang.addEventListener('change', () => {
    state.lang = nodes.lang.value;
    updateQuery();
    runAnalysis();
  });
  nodes.input.addEventListener('input', debounce(runAnalysis, 200));
  nodes.analyze.addEventListener('click', runAnalysis);
  nodes.sample.addEventListener('click', setSample);
  nodes.copyCli.addEventListener('click', copyCli);
  nodes.reportFp.addEventListener('click', reportFalsePositive);
}

readQueryState();
bind();
applyStaticI18n();
setSample();
