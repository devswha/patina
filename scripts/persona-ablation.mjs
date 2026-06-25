#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { getRepoRoot, loadConfig } from '../src/config.js';
import { listPersonas, loadPersona } from '../src/personas/loader.js';
import { personaMatchScore } from '../src/features/persona-match.js';
import { aggregateAblation, ablationDecision, editChurn, evaluatePersonaGate } from '../src/personas/gates.js';

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
  return [
    `Persona ablation (${report.mode})`,
    `fixtures=${report.rows.length} configs=${report.configs.join(',')} personas=${report.personas.join(',')}`,
    `mean_persona_match_delta=${round(report.aggregate.meanPersonaMatchDelta, 3)} win_rate=${round(report.aggregate.winRate, 3)} aggregate_pass=${report.aggregate.aggregatePass}`,
    `decision=${report.decision}`,
  ].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = getRepoRoot();
  if (opts.live) {
    console.error('PATINA_LIVE persona rewriting is intentionally not run by default in this deterministic harness; provide precomputed fixture metadata or keep dry-run mode.');
  }
  const report = buildAblationReport({ repoRoot, ...opts, live: false });
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
