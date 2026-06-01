import {
  SAMPLE_TEXT,
  SUPPORTED_LANGS,
  analyzePlaygroundText,
  buildCliCommand,
  buildFalsePositiveReportUrl,
  escapeHtml,
  renderAuditDiff,
} from './analyzer.js';

const doc = globalThis.document;
const state = {
  lang: 'ko',
  text: '',
  analysis: analyzePlaygroundText('', { lang: 'ko' }),
};

const nodes = {
  lang: doc.querySelector('#lang'),
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
  diff: doc.querySelector('#diff'),
  cliPreview: doc.querySelector('#cli-preview'),
};

function readQueryState() {
  const url = new URL(globalThis.location?.href ?? 'https://patina.vibetip.help/');
  const lang = url.searchParams.get('lang');
  if (SUPPORTED_LANGS.includes(lang)) state.lang = lang;
}

function updateQuery() {
  if (!globalThis.history || !globalThis.location) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set('lang', state.lang);
  globalThis.history.replaceState(null, '', url);
}

function setSample() {
  state.text = SAMPLE_TEXT[state.lang];
  nodes.input.value = state.text;
  runAnalysis();
}

function metricsTable(analysis) {
  if (analysis.paragraphCount === 0) return '<p class="empty-state">No audit rows yet.</p>';
  const rows = analysis.paragraphs.map((p) => {
    const reasons = p.reasons.map((r) => r.label).join(', ') || '—';
    const cv = p.burstiness.cv == null ? 'n/a' : p.burstiness.cv.toFixed(2);
    const mattr = p.mattr.value == null ? 'n/a' : p.mattr.value.toFixed(2);
    const density = p.lexicon.density.toFixed(1);
    return `<tr>
      <td>${escapeHtml(p.id)}</td>
      <td><span class="pill ${p.hot ? 'hot' : 'clean'}">${p.hot ? 'review' : 'ok'}</span></td>
      <td>${p.sentenceCount}</td>
      <td>${p.tokenCount}</td>
      <td>${cv} <span class="muted">${escapeHtml(p.burstiness.band ?? '')}</span></td>
      <td>${mattr} <span class="muted">${escapeHtml(p.mattr.band ?? '')}</span></td>
      <td>${p.lexicon.matches} <span class="muted">${density}/1k</span></td>
      <td>${escapeHtml(reasons)}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Para</th><th>Status</th><th>Sent</th><th>Tokens</th><th>Burst</th><th>MATTR</th><th>Lexicon</th><th>Signals</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function render() {
  const analysis = state.analysis;
  const band = analysis.band;
  nodes.scoreValue.textContent = String(analysis.overall);
  nodes.scoreBand.textContent = band.label;
  nodes.scoreBand.dataset.tone = band.tone;
  nodes.scoreBar.style.setProperty('--score', `${analysis.overall}%`);
  nodes.summary.innerHTML = `
    <li><strong>${analysis.hotCount}</strong> / ${analysis.paragraphCount} paragraphs marked for review</li>
    <li><strong>${analysis.totalTokens}</strong> deterministic tokens checked</li>
    <li>Score is an editing signal, not an authorship verdict.</li>
  `;
  nodes.audit.innerHTML = metricsTable(analysis);
  nodes.diff.innerHTML = renderAuditDiff(analysis);
  nodes.cliPreview.textContent = buildCliCommand(state.text, state.lang);
}

function runAnalysis() {
  state.text = nodes.input.value;
  state.analysis = analyzePlaygroundText(state.text, { lang: state.lang });
  render();
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
    nodes.copyStatus.textContent = ok ? 'Copied CLI command.' : 'Copy failed; select the command below.';
  } catch (_err) {
    nodes.copyStatus.textContent = 'Copy failed; select the command below.';
  }
}

function reportFalsePositive() {
  if (!state.text.trim()) {
    nodes.copyStatus.textContent = 'Paste text and run the audit first, then report the false positive.';
    return;
  }
  const url = buildFalsePositiveReportUrl(state.text, state.lang, state.analysis);
  const opened = globalThis.open?.(url, '_blank', 'noopener');
  nodes.copyStatus.textContent = opened
    ? 'Opened a pre-filled GitHub report — review it, then submit. Your text only leaves the browser if you submit.'
    : 'Pop-up blocked. Allow pop-ups, or open an issue from the GitHub link in the header.';
}

function bind() {
  nodes.lang.value = state.lang;
  nodes.input.value = state.text;
  nodes.lang.addEventListener('change', () => {
    state.lang = nodes.lang.value;
    updateQuery();
    runAnalysis();
  });
  nodes.input.addEventListener('input', runAnalysis);
  nodes.analyze.addEventListener('click', runAnalysis);
  nodes.sample.addEventListener('click', setSample);
  nodes.copyCli.addEventListener('click', copyCli);
  nodes.reportFp.addEventListener('click', reportFalsePositive);
}

readQueryState();
bind();
setSample();
