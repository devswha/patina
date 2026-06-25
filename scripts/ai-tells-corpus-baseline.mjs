#!/usr/bin/env node
// Deterministic baseline measurement of the in-tree analyzer (analyzeText)
// against the persona-calibration AI-tell evidence corpus.
//
// This is MEASUREMENT ONLY. It never mutates the analyzer, never hardcodes
// corpus terms into detector hot logic, and never calls an LLM. Corpus terms
// are reported as `term_family_coverage` (a measurement of how many rows map to
// a known term family), explicitly NOT a detector signal.
//
// AI-positive rows (sycophancy + lexical/structural tells) have expected_hot
// = true; human-controls have expected_hot = false. We run analyzeText() on
// each and compute confusion metrics + Wilson intervals so Phase B detector
// deltas and Phase D gates have a fixed, reproducible reference.
//
// Privacy: output contains only stable row hashes, ids, and aggregate metrics.
// Raw corpus phrases and human-control body text are NEVER emitted.
//
// Usage:
//   node scripts/ai-tells-corpus-baseline.mjs [--json] [--no-timestamp] [--strict] [--quiet]
//
// In --strict mode the committed corpus must be present and exact counts must
// hold (drift guard): sycophancy = 298 lines = 298 unique phrases, tells = 85,
// human_controls = 7. Human-control RAW bodies live under human-controls/raw/
// (gitignored); when absent (e.g. CI) FP is reported as not-evaluated smoke,
// never as proof of low FPR.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { analyzeText } from '../src/features/index.js';
import { wilsonInterval } from './lib/wilson.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CORPUS_DIR = process.env.PATINA_CORPUS_DIR
  ? resolve(process.env.PATINA_CORPUS_DIR)
  : resolve(REPO_ROOT, 'artifacts/persona-calibration-2026');

export const EXPECTED_COUNTS = Object.freeze({
  sycophancy: 298,
  sycophancy_unique: 298,
  tells: 85,
  human_controls: 7,
});

function round(n, digits = 4) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function shortHash(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 16);
}

function readJsonl(path) {
  if (!existsSync(path)) return null;
  const rows = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Discover all human-control metadata files (human-controls/*.jsonl), language-tag
// each row from its filename unless the row carries an explicit lang. Today only
// ko.jsonl exists; non-KO controls drop in as {lang}.jsonl with no code change.
function readHumanControls(corpusDir) {
  const dir = join(corpusDir, 'human-controls');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort();
  if (files.length === 0) return null;
  const rows = [];
  for (const file of files) {
    const fileLang = file.replace(/\.jsonl$/, '');
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      rows.push({ ...rec, lang: rec.lang || fileLang });
    }
  }
  return rows;
}

// Which detector hot disjuncts fired, mirroring tests/quality/benchmark.mjs
// detectorHot() plus the document-level/discourse/KO signals analyzeText emits.
function detectorSignals(result) {
  const paras = result.paragraphs ?? [];
  return {
    burstiness: paras.some((p) => p.burstiness?.band === 'low'),
    mattr: paras.some((p) => p.mattr?.band === 'low'),
    lexicon: paras.some((p) => p.lexicon?.hot),
    koDiagnostics: paras.some((p) => p.koDiagnostics?.hot),
    candor: paras.some((p) => p.candorHot),
    thematicBreak: paras.some((p) => p.thematicBreakHot),
    endingMonotony: paras.some((p) => p.endingMonotonyHot),
    markupLeakage: Boolean(result.markupLeakage?.leaked),
    structuralClassifier: result.structuralClassifier?.hot === true,
  };
}

const SIGNAL_NAMES = [
  'burstiness', 'mattr', 'lexicon', 'koDiagnostics', 'candor',
  'thematicBreak', 'endingMonotony', 'markupLeakage', 'structuralClassifier',
];

function emptyConfusion() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function confusionMetrics(c) {
  const positives = c.tp + c.fn;
  const negatives = c.fp + c.tn;
  const recall = positives ? c.tp / positives : null;
  const fpr = negatives ? c.fp / negatives : null;
  const precDenom = c.tp + c.fp;
  const precision = precDenom ? c.tp / precDenom : null;
  const out = {
    tp: c.tp, fp: c.fp, fn: c.fn, tn: c.tn,
    positives, negatives,
    recall: recall == null ? null : round(recall),
    precision: precision == null ? null : round(precision),
    fpr: fpr == null ? null : round(fpr),
  };
  // Wilson intervals are reported as INTERVALS, never as public claims.
  out.recall_wilson_95 = positives
    ? intervalRound(wilsonInterval(c.tp, positives)) : null;
  out.fpr_wilson_95 = negatives
    ? intervalRound(wilsonInterval(c.fp, negatives)) : null;
  return out;
}

function intervalRound(iv) {
  return { low: round(iv.low), high: round(iv.high) };
}

// Build the deterministic baseline report object.
export function buildBaseline({ strict = false, corpusDir = CORPUS_DIR } = {}) {
  const warnings = [];
  const sycophancy = readJsonl(join(corpusDir, 'sycophancy-corpus.jsonl'));
  const tells = readJsonl(join(corpusDir, 'tells-corpus.jsonl'));
  const humanControls = readHumanControls(corpusDir);
  const sycophancyTerms = readJson(join(corpusDir, 'sycophancy-terms.json'));
  const tellsTerms = readJson(join(corpusDir, 'tells-terms.json'));

  if (strict) {
    const missing = [];
    if (!sycophancy) missing.push('sycophancy-corpus.jsonl');
    if (!tells) missing.push('tells-corpus.jsonl');
    if (!humanControls) missing.push('human-controls/*.jsonl');
    if (!sycophancyTerms) missing.push('sycophancy-terms.json');
    if (!tellsTerms) missing.push('tells-terms.json');
    if (missing.length) {
      throw new Error(`strict: required corpus file(s) missing: ${missing.join(', ')}`);
    }
  }

  const syco = sycophancy ?? [];
  const tll = tells ?? [];
  const humans = humanControls ?? [];

  // Drift guard: exact counts must hold in strict mode.
  const uniqueSyco = new Set(
    syco.map((r) => String(r.phrase ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
  ).size;
  const counts = {
    sycophancy: syco.length,
    sycophancy_unique: uniqueSyco,
    tells: tll.length,
    human_controls: humans.length,
  };
  if (strict) {
    const drift = [];
    for (const key of Object.keys(EXPECTED_COUNTS)) {
      if (counts[key] !== EXPECTED_COUNTS[key]) {
        drift.push(`${key}: expected ${EXPECTED_COUNTS[key]}, got ${counts[key]}`);
      }
    }
    if (drift.length) {
      throw new Error(`strict: corpus count drift detected (update consensus before changing the contract):\n  ${drift.join('\n  ')}`);
    }
  }

  // Term family coverage (MEASUREMENT ONLY — never a detector signal).
  const sycoTermSet = new Set((sycophancyTerms ?? []).map((t) => String(t).trim().toLowerCase()));
  const tellsTermSet = new Set((tellsTerms ?? []).map((t) => String(t).trim().toLowerCase()));
  function coversTerm(phrase, set) {
    const p = String(phrase ?? '').trim().toLowerCase();
    if (!p) return false;
    if (set.has(p)) return true;
    for (const t of set) {
      if (t.length >= 3 && p.includes(t)) return true;
    }
    return false;
  }

  // Confusion accumulators.
  const overall = emptyConfusion();
  const ko = emptyConfusion();
  const slices = {
    sycophancy: emptyConfusion(),
    lexical: emptyConfusion(),
    structural: emptyConfusion(),
    human_controls: emptyConfusion(),
  };
  const signalFires = Object.fromEntries(SIGNAL_NAMES.map((s) => [s, 0]));
  let sycoCovered = 0;
  let tellsCovered = 0;

  const rows = [];

  function evaluatePositive(rec, sliceKey, termCovered) {
    const lang = rec.lang || 'en';
    const result = analyzeText(rec.phrase ?? '', { lang, repoRoot: REPO_ROOT });
    const hot = result.hot === true;
    const signals = detectorSignals(result);
    for (const s of SIGNAL_NAMES) if (signals[s]) signalFires[s] += 1;
    // expected_hot = true
    bump(overall, true, hot);
    bump(slices[sliceKey], true, hot);
    if (lang === 'ko') bump(ko, true, hot);
    rows.push({
      hash: shortHash(rec.phrase ?? ''),
      lang,
      category: sliceKey,
      expected_hot: true,
      predicted_hot: hot,
      skipped: Boolean(result.skipped),
      signals: SIGNAL_NAMES.filter((s) => signals[s]),
      term_family: termCovered,
    });
  }

  for (const rec of syco) {
    const covered = coversTerm(rec.phrase, sycoTermSet);
    if (covered) sycoCovered += 1;
    evaluatePositive(rec, 'sycophancy', covered);
  }
  for (const rec of tll) {
    const covered = coversTerm(rec.phrase, tellsTermSet);
    if (covered) tellsCovered += 1;
    const sliceKey = rec.category === 'structural' ? 'structural' : 'lexical';
    evaluatePositive(rec, sliceKey, covered);
  }

  // Human-controls: expected_hot = false. Body text lives in raw/ (gitignored).
  const rawDir = join(corpusDir, 'human-controls/raw');
  let humanEvaluated = 0;
  let humanNotEvaluated = 0;
  for (const rec of humans) {
    const rawPath = join(rawDir, `${rec.id}.txt`);
    if (!existsSync(rawPath)) {
      humanNotEvaluated += 1;
      rows.push({
        hash: rec.sha256 ? String(rec.sha256).slice(0, 16) : shortHash(rec.id),
        lang: rec.lang || 'ko',
        category: 'human_controls',
        expected_hot: false,
        predicted_hot: null,
        evaluated: false,
        signals: [],
      });
      continue;
    }
    humanEvaluated += 1;
    const lang = rec.lang || 'ko';
    const body = readFileSync(rawPath, 'utf8');
    const result = analyzeText(body, { lang, repoRoot: REPO_ROOT });
    const hot = result.hot === true;
    const signals = detectorSignals(result);
    bump(overall, false, hot);
    bump(slices.human_controls, false, hot);
    if (lang === 'ko') bump(ko, false, hot);
    rows.push({
      hash: rec.sha256 ? String(rec.sha256).slice(0, 16) : shortHash(rec.id),
      lang,
      category: 'human_controls',
      expected_hot: false,
      predicted_hot: hot,
      evaluated: true,
      signals: SIGNAL_NAMES.filter((s) => signals[s]),
    });
  }
  if (humanNotEvaluated > 0) {
    warnings.push(
      `human-controls raw bodies absent for ${humanNotEvaluated}/${humans.length} rows (gitignored). FP is smoke-only and not evaluated for those rows.`
    );
  }

  rows.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

  return {
    schema: 'patina.ai-tells-corpus-baseline.v1',
    corpus_dir: 'artifacts/persona-calibration-2026',
    counts,
    expected_counts: EXPECTED_COUNTS,
    drift_guard: 'strict mode asserts exact counts; any drift fails the run',
    metrics: {
      overall: confusionMetrics(overall),
      ko: confusionMetrics(ko),
      slices: Object.fromEntries(
        Object.entries(slices).map(([k, v]) => [k, confusionMetrics(v)])
      ),
    },
    detector_signal_fires: signalFires,
    term_family_coverage: {
      note: 'measurement only; NOT a detector signal',
      sycophancy_covered: sycoCovered,
      sycophancy_total: syco.length,
      tells_covered: tellsCovered,
      tells_total: tll.length,
    },
    human_controls: {
      evaluated: humanEvaluated,
      not_evaluated: humanNotEvaluated,
      basis: 'smoke ceiling only; n=7 cannot bound FPR (0/7 still ~35% Wilson upper). Expand before any hard FP gate or public FPR claim.',
    },
    rows,
    warnings,
  };
}

function bump(conf, expectedHot, predictedHot) {
  if (expectedHot && predictedHot) conf.tp += 1;
  else if (expectedHot && !predictedHot) conf.fn += 1;
  else if (!expectedHot && predictedHot) conf.fp += 1;
  else conf.tn += 1;
}

function renderHuman(report) {
  const m = report.metrics;
  const lines = [];
  lines.push('# AI-tells corpus baseline (deterministic, measurement-only)');
  lines.push('');
  lines.push(`counts: sycophancy=${report.counts.sycophancy} (unique ${report.counts.sycophancy_unique}) tells=${report.counts.tells} human_controls=${report.counts.human_controls}`);
  lines.push('');
  const fmt = (c) => `tp=${c.tp} fn=${c.fn} fp=${c.fp} tn=${c.tn} recall=${c.recall} precision=${c.precision} fpr=${c.fpr}`;
  lines.push(`overall : ${fmt(m.overall)}`);
  lines.push(`ko      : ${fmt(m.ko)}`);
  for (const [k, v] of Object.entries(m.slices)) lines.push(`${k.padEnd(8)}: ${fmt(v)}`);
  lines.push('');
  lines.push(`recall Wilson95 overall: [${m.overall.recall_wilson_95?.low}, ${m.overall.recall_wilson_95?.high}]`);
  lines.push(`detector signal fires: ${JSON.stringify(report.detector_signal_fires)}`);
  lines.push(`term_family_coverage: sycophancy ${report.term_family_coverage.sycophancy_covered}/${report.term_family_coverage.sycophancy_total}, tells ${report.term_family_coverage.tells_covered}/${report.term_family_coverage.tells_total} (measurement only)`);
  lines.push(`human-controls evaluated=${report.human_controls.evaluated} not_evaluated=${report.human_controls.not_evaluated} (smoke only)`);
  if (report.warnings.length) {
    lines.push('');
    for (const w of report.warnings) lines.push(`WARN: ${w}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
    noTimestamp: argv.includes('--no-timestamp'),
    quiet: argv.includes('--quiet'),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildBaseline({ strict: args.strict });
  if (!args.noTimestamp) {
    report.generated_at = new Date().toISOString();
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (!args.quiet) {
    process.stdout.write(renderHuman(report) + '\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`ai-tells-corpus-baseline: ${err.message}\n`);
    process.exit(1);
  }
}
