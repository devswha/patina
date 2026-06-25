#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { getRepoRoot, loadConfig } from '../src/config.js';
import { aggregateAblation, ablationDecision } from '../src/personas/gates.js';
import { buildAblationReport } from './persona-ablation.mjs';

export const PERSONA_CALIBRATION_SCHEMA = 'patina.persona.calibration.v1';

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
    write: false,
    basename: 'persona-calibration-latest',
    round: 1,
    rounds: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lang' || arg === '--language') opts.lang = argv[++i];
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--personas') opts.personas = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--write') opts.write = true;
    else if (arg === '--basename') opts.basename = argv[++i];
    else if (arg === '--round') opts.round = Number(argv[++i]);
    else if (arg === '--rounds') opts.rounds = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return opts;
}

function sourceOf(thresholds) {
  return thresholds?.source ?? thresholds?.thresholdSource ?? 'placeholder';
}

function thresholdValue(thresholds, snake, camel, fallback) {
  return thresholds?.[snake] ?? thresholds?.[camel] ?? fallback;
}

function summarizeRows(rows, side) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const mean = (values) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 3) : 0;
  return {
    mean_persona_match: mean(safeRows.map((row) => row?.[side]?.persona_match ?? 0)),
    pass_rate_mps: mean(safeRows.map((row) => (row?.[side]?.mps_passed ?? ((row?.[side]?.mps ?? 0) >= 70)) ? 1 : 0)),
    pass_rate_fidelity: mean(safeRows.map((row) => (row?.[side]?.fidelity_passed ?? ((row?.[side]?.fidelity ?? 0) >= 70)) ? 1 : 0)),
    mean_churn: mean(safeRows.map((row) => row?.[side]?.churn ?? 0)),
  };
}

export function recommendedThresholdsFromRows(rows, thresholds = {}) {
  const treatmentMatches = rows.map((row) => row?.treatment?.persona_match).filter((value) => typeof value === 'number');
  treatmentMatches.sort((a, b) => a - b);
  const percentileIndex = treatmentMatches.length ? Math.max(0, Math.floor(treatmentMatches.length * 0.25) - 1) : -1;
  const personaMatchMin = percentileIndex >= 0 ? Math.max(70, Math.floor(treatmentMatches[percentileIndex])) : thresholdValue(thresholds, 'persona_match_min', 'personaMatchMin', 70);
  return {
    persona_match_min: personaMatchMin,
    mps_floor: thresholdValue(thresholds, 'mps_floor', 'mpsFloor', 70),
    fidelity_floor: thresholdValue(thresholds, 'fidelity_floor', 'fidelityFloor', 70),
    churn_max: thresholdValue(thresholds, 'churn_max', 'churnMax', 0.45),
  };
}

export function calibrationDecision({ round, aggregate, roundResults = null }) {
  const rounds = roundResults?.length ? roundResults : [aggregate];
  const decision = ablationDecision(rounds);
  if (decision === 'promote-thresholds' && (!(round >= 2) || aggregate?.aggregatePass !== true)) return 'keep-placeholder';
  return decision;
}

export function buildCalibrationArtifact({ round = 1, thresholds = {}, rows = [], roundResults = null }) {
  const aggregate = aggregateAblation(rows);
  const decision = calibrationDecision({ round, aggregate, roundResults });
  return {
    schema: PERSONA_CALIBRATION_SCHEMA,
    round,
    generated_at: new Date().toISOString(),
    threshold_source_before: sourceOf(thresholds),
    recommended_thresholds: recommendedThresholdsFromRows(rows, thresholds),
    baseline: summarizeRows(rows, 'baseline'),
    treatment: summarizeRows(rows, 'treatment'),
    decision,
  };
}

export function validateCalibrationArtifact(artifact) {
  const errors = [];
  if (artifact?.schema !== PERSONA_CALIBRATION_SCHEMA) errors.push('schema');
  if (!Number.isInteger(artifact?.round) || artifact.round < 1) errors.push('round');
  if (!artifact?.threshold_source_before) errors.push('threshold_source_before');
  for (const key of ['persona_match_min', 'mps_floor', 'fidelity_floor', 'churn_max']) {
    if (typeof artifact?.recommended_thresholds?.[key] !== 'number') errors.push(`recommended_thresholds.${key}`);
  }
  if (!['promote-thresholds', 'keep-placeholder', 'fallback-bridge-only'].includes(artifact?.decision)) errors.push('decision');
  if (artifact?.decision === 'promote-thresholds' && artifact.round < 2) errors.push('decision_round_guard');
  return { valid: errors.length === 0, errors };
}

function renderSummary(artifact) {
  return [
    `Persona calibration round=${artifact.round}`,
    `threshold_source_before=${artifact.threshold_source_before}`,
    `decision=${artifact.decision}`,
    `recommended=${JSON.stringify(artifact.recommended_thresholds)}`,
  ].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = getRepoRoot();
  const config = loadConfig();
  const thresholds = config.personas?.thresholds ?? {};
  const ablation = buildAblationReport({ repoRoot, lang: opts.lang, personas: opts.personas, limit: opts.limit, thresholds });
  const artifact = buildCalibrationArtifact({ round: opts.round, thresholds, rows: ablation.rows });
  const validation = validateCalibrationArtifact(artifact);
  if (!validation.valid) throw new Error(`invalid calibration artifact: ${validation.errors.join(', ')}`);
  if (opts.write) {
    const outDir = resolve(repoRoot, 'docs/benchmarks');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${opts.basename}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  console.log(renderSummary(artifact));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
