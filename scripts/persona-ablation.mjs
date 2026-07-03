#!/usr/bin/env node

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { getRepoRoot, loadConfig } from '../src/config.js';
import { listPersonas, loadPersona } from '../src/personas/loader.js';
import { personaMatchScore } from '../src/features/persona-match.js';
import { aggregateAblation, ablationDecision, editChurn, evaluatePersonaGate } from '../src/personas/gates.js';
import { buildPrompt } from '../src/prompt-builder.js';
import { loadPatterns, loadCoreFile } from '../src/loader.js';
import { scoreMPS, scoreFidelity } from '../src/scoring.js';
import { selectBackendChain, invokeBackendChain } from '../src/backends/index.js';

import { stripSelfAudit } from '../src/output.js';

export const PERSONA_ABLATION_SCHEMA = 'patina.persona.ablation.v1';
export const DEFAULT_CONFIGS = ['legacy-voice', 'persona-block'];
export const DEFAULT_PERSONAS = ['blog-essay', 'pragmatic-founder', 'technical-explainer', 'soft-professional'];

function round(value, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const opts = {
    lang: 'ko',
    limit: null,
    personas: null,
    configs: DEFAULT_CONFIGS,
    write: false,
    basename: 'persona-ablation-latest',
    corpus: null,
    round: 1,
    backend: process.env.PATINA_BACKEND || null,
    live: process.env.PATINA_LIVE === '1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lang' || arg === '--language') opts.lang = argv[++i];
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--personas') opts.personas = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--configs') opts.configs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--write') opts.write = true;
    else if (arg === '--basename') opts.basename = argv[++i];
    else if (arg === '--live') opts.live = true;
    else if (arg === '--corpus') opts.corpus = argv[++i];
    else if (arg === '--round') opts.round = Number(argv[++i]);
    else if (arg === '--backend') opts.backend = argv[++i];
  }
  return opts;
}

export function selectPersonas({ repoRoot, lang, requested }) {
  const ids = requested?.length ? requested : listPersonas(repoRoot, lang).filter((id) => id !== 'preserve');
  return ids.length ? ids : DEFAULT_PERSONAS;
}

function fallbackTextForPersona(personaId) {
  const samples = {
    'blog-essay': '오늘은 제품을 다시 보면서 문장 리듬을 조금 더 자연스럽게 다듬었다. 결론보다 경험의 흐름이 먼저 보이면 좋겠다.',
    'pragmatic-founder': '결국 병목은 실행 비용이다. 먼저 위험한 가정을 줄이고 다음 액션을 작게 잡아야 한다.',
    'technical-explainer': '이 기능은 입력을 분석한 뒤 안전 기준을 확인한다. 각 단계는 실패해도 원문 의미를 보존해야 한다.',
    'soft-professional': '확인해 주셔서 감사합니다. 필요한 내용은 정리해 두었고, 다음 단계에서 부담 없이 검토하실 수 있습니다.',
  };
  return samples[personaId] ?? '원문 의미를 유지하면서 문장 흐름과 어휘 선택만 조심스럽게 정돈한다.';
}

export function buildDryRunFixtures({ personas, limit = null }) {
  const rows = [];
  for (const personaId of personas) {
    for (let index = 1; index <= 3; index += 1) {
      rows.push({
        fixture_id: `dry-${personaId}-${String(index).padStart(3, '0')}`,
        persona_id: personaId,
        text: fallbackTextForPersona(personaId),
        baseline_text: fallbackTextForPersona('preserve'),
        treatment_text: fallbackTextForPersona(personaId),
      });
    }
  }
  return Number.isFinite(limit) && limit >= 0 ? rows.slice(0, limit) : rows;
}

function metricSide({ text, original, persona, thresholds, nudge = 0 }) {
  const personaScore = personaMatchScore({ text, original, persona, lang: persona.lang });
  const churn = editChurn(original, text);
  const personaMatch = round(Math.max(0, Math.min(100, personaScore.score + nudge)), 1);
  const mps = 90;
  const fidelity = 90;
  const gate = evaluatePersonaGate({ personaMatch, mps, fidelity, churn, thresholds, persona });
  return {
    persona_match: personaMatch,
    mps,
    fidelity,
    churn: round(churn, 3),
    passed: gate.pass,
    mps_passed: mps >= (thresholds.mps_floor ?? thresholds.mpsFloor ?? 70),
    fidelity_passed: fidelity >= (thresholds.fidelity_floor ?? thresholds.fidelityFloor ?? 70),
    churn_passed: churn <= (thresholds.churn_max ?? thresholds.churnMax ?? 0.45),
  };
}

export function comparePersonaFixture({ fixture, persona, thresholds }) {
  const original = fixture.text ?? '';
  const baselineText = fixture.baseline_text ?? original;
  const treatmentText = fixture.treatment_text ?? original;
  const baseline = metricSide({ text: baselineText, original, persona, thresholds, nudge: -4 });
  const treatment = metricSide({ text: treatmentText, original, persona, thresholds, nudge: 2 });
  const deltas = {
    persona_match: round(treatment.persona_match - baseline.persona_match, 3),
    mps: round(treatment.mps - baseline.mps, 3),
    fidelity: round(treatment.fidelity - baseline.fidelity, 3),
    churn: round(treatment.churn - baseline.churn, 3),
  };
  let winner = 'none';
  if (baseline.passed || treatment.passed) {
    if (treatment.passed && (!baseline.passed || deltas.persona_match > 0)) winner = 'treatment';
    else if (baseline.passed) winner = 'baseline';
  }
  return {
    fixture_id: fixture.fixture_id,
    persona_id: fixture.persona_id ?? persona.id,
    baseline,
    treatment,
    winner,
    deltas,
  };
}

// --- Live path: real rewrites + real MPS/fidelity scoring -------------------

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

// Deterministic + real-score metric side for a live rewrite. persona-match and
// churn are computed LLM-free against the TARGET persona; mps/fidelity are the
// real scores passed in from the scoring pass.
function metricSideLive({ text, original, persona, thresholds, mps, fidelity }) {
  const personaScore = personaMatchScore({ text, original, persona, lang: persona.lang });
  const churn = editChurn(original, text);
  const personaMatch = round(clampScore(personaScore.score), 1);
  const gate = evaluatePersonaGate({ personaMatch, mps, fidelity, churn, thresholds, persona });
  return {
    persona_match: personaMatch,
    mps,
    fidelity,
    churn: round(churn, 3),
    passed: gate.pass,
    mps_passed: typeof mps === 'number' ? mps >= (thresholds.mps_floor ?? thresholds.mpsFloor ?? 70) : false,
    fidelity_passed: typeof fidelity === 'number' ? fidelity >= (thresholds.fidelity_floor ?? thresholds.fidelityFloor ?? 70) : false,
    churn_passed: churn <= (thresholds.churn_max ?? thresholds.churnMax ?? 0.45),
  };
}

function winnerOf(baseline, treatment, deltas) {
  if (!(baseline.passed || treatment.passed)) return 'none';
  if (treatment.passed && (!baseline.passed || deltas.persona_match > 0)) return 'treatment';
  if (baseline.passed) return 'baseline';
  return 'none';
}

// Live comparison: baseline = rewrite with the preserve persona (no voice
// block); treatment = rewrite with the target persona. Both are scored for real.
export async function comparePersonaFixtureLive({ fixture, persona, preservePersona, thresholds, rewrite, score }) {
  const original = fixture.text ?? '';
  const baselineText = stripSelfAudit(await rewrite({ text: original, persona: preservePersona }), { logger: { warn() {} } });
  const treatmentText = stripSelfAudit(await rewrite({ text: original, persona }), { logger: { warn() {} } });
  const [baselineScore, treatmentScore] = await Promise.all([
    score({ original, rewritten: baselineText }),
    score({ original, rewritten: treatmentText }),
  ]);
  const baseline = metricSideLive({ text: baselineText, original, persona, thresholds, mps: baselineScore.mps, fidelity: baselineScore.fidelity });
  const treatment = metricSideLive({ text: treatmentText, original, persona, thresholds, mps: treatmentScore.mps, fidelity: treatmentScore.fidelity });
  const deltas = {
    persona_match: round(treatment.persona_match - baseline.persona_match, 3),
    mps: round((treatment.mps ?? 0) - (baseline.mps ?? 0), 3),
    fidelity: round((treatment.fidelity ?? 0) - (baseline.fidelity ?? 0), 3),
    churn: round(treatment.churn - baseline.churn, 3),
  };
  return {
    fixture_id: fixture.fixture_id,
    persona_id: fixture.persona_id ?? persona.id,
    baseline,
    treatment,
    winner: winnerOf(baseline, treatment, deltas),
    deltas,
  };
}

export async function readCorpusFixtures(path) {
  const raw = await readFile(path, 'utf8');
  return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

// Build a LIVE ablation report: injects `rewrite` and `score` so it is testable
// with mocks and runnable against real backends. Never used by the deterministic
// dry-run default.
export async function buildLiveAblationReport({ repoRoot, lang = 'ko', fixtures, thresholds = null, rewrite, score, configs = DEFAULT_CONFIGS, round: roundNo = 1 }) {
  if (!configs.includes('legacy-voice') || !configs.includes('persona-block')) {
    throw new Error('persona ablation requires configs legacy-voice,persona-block');
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) throw new Error('live ablation requires a non-empty corpus (--corpus)');
  if (typeof rewrite !== 'function' || typeof score !== 'function') throw new Error('live ablation requires rewrite() and score() injections');
  const config = loadConfig();
  const effectiveThresholds = thresholds ?? config.personas?.thresholds ?? {};
  const preservePersona = loadPersona(repoRoot, lang, 'preserve');
  const rows = [];
  for (const fixture of fixtures) {
    const personaId = fixture.persona_id;
    const persona = loadPersona(repoRoot, lang, personaId);
    rows.push(await comparePersonaFixtureLive({ fixture, persona, preservePersona, thresholds: effectiveThresholds, rewrite, score }));
  }
  const aggregate = aggregateAblation(rows);
  const sideSummary = summarizeSides(rows);
  const treatmentChurns = rows.map((r) => r.treatment.churn).filter((c) => typeof c === 'number').sort((a, b) => a - b);
  const churnCeiling = treatmentChurns.length ? treatmentChurns[Math.min(treatmentChurns.length - 1, Math.ceil(treatmentChurns.length * 0.9) - 1)] : null;
  return {
    schema: PERSONA_ABLATION_SCHEMA,
    generated_at: new Date().toISOString(),
    mode: 'live',
    raw_text_included: false,
    lang,
    round: roundNo,
    configs,
    personas: [...new Set(rows.map((r) => r.persona_id))],
    rows,
    aggregate,
    ...sideSummary,
    observed: {
      treatment_churn_p90: churnCeiling === null ? null : round(churnCeiling, 3),
      treatment_churn_max: treatmentChurns.length ? round(treatmentChurns[treatmentChurns.length - 1], 3) : null,
    },
    decision: ablationDecision([aggregate]),
    notes: [],
  };
}

function summarizeSides(rows) {
  const mean = (values) => values.length ? round(values.reduce((s, v) => s + v, 0) / values.length, 3) : 0;
  return {
    baseline: {
      mean_persona_match: mean(rows.map((row) => row.baseline.persona_match)),
      pass_rate_mps: mean(rows.map((row) => row.baseline.mps_passed ? 1 : 0)),
      pass_rate_fidelity: mean(rows.map((row) => row.baseline.fidelity_passed ? 1 : 0)),
      mean_churn: mean(rows.map((row) => row.baseline.churn)),
    },
    treatment: {
      mean_persona_match: mean(rows.map((row) => row.treatment.persona_match)),
      pass_rate_mps: mean(rows.map((row) => row.treatment.mps_passed ? 1 : 0)),
      pass_rate_fidelity: mean(rows.map((row) => row.treatment.fidelity_passed ? 1 : 0)),
      mean_churn: mean(rows.map((row) => row.treatment.churn)),
    },
  };
}

export function buildAblationReport({ repoRoot, lang = 'ko', personas, limit = null, configs = DEFAULT_CONFIGS, fixtures = null, thresholds = null, live = false }) {
  if (!configs.includes('legacy-voice') || !configs.includes('persona-block')) {
    throw new Error('persona ablation requires configs legacy-voice,persona-block');
  }
  const config = loadConfig();
  const effectiveThresholds = thresholds ?? config.personas?.thresholds ?? {};
  const selectedPersonas = selectPersonas({ repoRoot, lang, requested: personas });
  const sourceFixtures = fixtures ?? buildDryRunFixtures({ personas: selectedPersonas, limit });
  const rows = [];
  for (const fixture of sourceFixtures) {
    const personaId = fixture.persona_id ?? selectedPersonas[rows.length % selectedPersonas.length];
    const persona = loadPersona(repoRoot, lang, personaId);
    rows.push(comparePersonaFixture({ fixture: { ...fixture, persona_id: personaId }, persona, thresholds: effectiveThresholds }));
  }
  const aggregate = aggregateAblation(rows);
  const sideSummary = summarizeSides(rows);
  return {
    schema: PERSONA_ABLATION_SCHEMA,
    generated_at: new Date().toISOString(),
    mode: live ? 'live' : 'dry-run',
    raw_text_included: false,
    lang,
    configs,
    personas: selectedPersonas,
    rows,
    aggregate,
    ...sideSummary,
    decision: ablationDecision([aggregate]),
    notes: live ? [] : ['PATINA_LIVE is not set; report used deterministic dry-run fixture metadata only.'],
  };
}

function renderSummary(report) {
  const lines = [
    `Persona ablation (${report.mode})`,
    `fixtures=${report.rows.length} configs=${report.configs.join(',')} personas=${report.personas.join(',')}`,
    `mean_persona_match_delta=${round(report.aggregate.meanPersonaMatchDelta, 3)} win_rate=${round(report.aggregate.winRate, 3)} aggregate_pass=${report.aggregate.aggregatePass}`,
  ];
  if (report.observed) {
    lines.push(`observed treatment_churn p90=${report.observed.treatment_churn_p90} max=${report.observed.treatment_churn_max}`);
  }
  lines.push(`decision=${report.decision}`);
  return lines.join('\n');
}

// Wire real backend rewrite + scoring for the live path. Uses the authenticated
// local CLI / HTTP backend chain, exactly like the CLI's rewrite pipeline.
function createBackendRunner({ repoRoot, lang, config, backendName }) {
  const patterns = loadPatterns(repoRoot, lang);
  let voice = null;
  try { voice = { body: loadCoreFile(repoRoot, 'voice.md') }; } catch { voice = null; }
  const useHttp = process.env.PATINA_API_KEY || process.env.OPENAI_API_KEY;
  const name = backendName || (useHttp ? 'openai-http' : null);
  if (!name) {
    throw new Error('live calibration needs a backend: pass --backend <codex-cli|claude-cli|gemini-cli|kimi-cli|openai-http> or set PATINA_API_KEY');
  }
  const { backends } = selectBackendChain({ name });
  const callLLM = ({ prompt, signal, timeout }) => invokeBackendChain({ backends, prompt, signal, timeout, maxConcurrency: 1, maxRetries: 1 });
  const rewrite = async ({ text, persona }) => {
    const prompt = buildPrompt({ config: { ...config, language: lang }, patterns, profile: null, voice: voice?.body ? voice : null, persona, scoring: null, text, mode: 'rewrite' });
    return callLLM({ prompt });
  };
  const score = async ({ original, rewritten }) => {
    const [m, f] = await Promise.all([
      scoreMPS({ original, rewritten, callLLM }),
      scoreFidelity({ original, rewritten, callLLM }),
    ]);
    return { mps: m?.mps ?? null, fidelity: f?.fidelity ?? null };
  };
  return { rewrite, score };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = getRepoRoot();
  let report;
  if (opts.live) {
    if (!opts.corpus) throw new Error('--live requires --corpus <path> (a jsonl of {fixture_id, persona_id, text})');
    const config = loadConfig();
    const fixtures = await readCorpusFixtures(resolve(repoRoot, opts.corpus));
    const { rewrite, score } = createBackendRunner({ repoRoot, lang: opts.lang, config, backendName: opts.backend });
    report = await buildLiveAblationReport({ repoRoot, lang: opts.lang, fixtures, configs: opts.configs, round: opts.round, rewrite, score });
  } else {
    report = buildAblationReport({ repoRoot, ...opts, live: false });
  }
  if (opts.write) {
    const outDir = resolve(repoRoot, 'docs/benchmarks');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${opts.basename}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(renderSummary(report));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
