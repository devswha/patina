#!/usr/bin/env node
// End-to-end scorer benchmark (deterministic; LLM mocked to overall 0).
//
// Complements tests/quality/benchmark.mjs, which is an ANALYZER-only regression
// harness: it runs analyzeText() and grades result.hot, and never exercises the
// production scoring path. This leg runs that path — scoreDeterministicSignals()
// + reconcileScoreOverall() — so it catches the class of false negatives the
// analyzer benchmark is structurally blind to: a short AI-leaked snippet that
// was scored 0 because skipped=true discarded the hard deterministic evidence
// floor (fixed by the reconcileScoreOverall evidence-floor branch).
//
// Worst-case LLM: every fixture is reconciled as if the LLM returned overall 0,
// so any non-zero final score must come from deterministic hard evidence alone,
// and any clean control that turns non-zero is a deterministic false positive.
//
// Gates (non-zero exit on any violation, even in --quiet):
//   positive_zero_score_rate    hard-evidence positives whose final == 0   -> must be 0
//   false_positive_rate         clean controls whose final > 0             -> must be 0
//   skipped_evidence_discarded  skipped && evidenceFloor>0 && final<floor  -> must be 0
//   per-fixture expectation      each fixture's pinned skipped/floor/final  -> must hold
//
// Usage: node tests/quality/scorer-benchmark.mjs [--quiet]

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

import {
  scoreDeterministicSignals,
  reconcileScoreOverall,
  LEAKAGE_SCORE_FLOOR,
} from '../../src/scoring.js';
import { analyzeText } from '../../src/features/index.js';
import { loadConfig } from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = resolve(__dirname, 'scorer-results.json');

// Fixture classes:
//   hard-evidence-positive  near-proof deterministic evidence (markup leakage /
//                           structural). Final must stay >= evidenceFloor even
//                           when the LLM says 0 — short OR long.
//   clean-control           ordinary human prose, no hard floor. Final must be 0
//                           at LLM 0 (the deterministic layer must not invent a
//                           score; the LLM owns the verdict).
//   stylometry-hot-no-floor analyzer-hot via a probabilistic signal but NO hard
//                           floor. The coarse per-paragraph hot ratio must NOT
//                           be treated as a floor, so final stays 0 at LLM 0.
const FIXTURES = [
  {
    id: 'short-leaked-en',
    lang: 'en',
    class: 'hard-evidence-positive',
    // One sentence => analyzer marks it skipped; the leaked tooling token is
    // near-proof. This is the exact regression the analyzer benchmark misses.
    text: 'According to turn0search1 the phrasing still needs work.',
    expect: { skipped: true, evidenceFloor: LEAKAGE_SCORE_FLOOR, final: LEAKAGE_SCORE_FLOOR },
  },
  {
    id: 'long-leaked-en',
    lang: 'en',
    class: 'hard-evidence-positive',
    // Three paragraphs => NOT skipped; exercises the normal divergence path,
    // which must still surface the leakage floor over an LLM 0.
    text: [
      'I rewrote the parser this morning and it finally handles nested quotes without choking.',
      'The reviewer left a few notes but the overall structure holds together fine for now.',
      'According to turn0search1 the phrasing still needs another pass before we ship it.',
    ].join('\n\n'),
    expect: { skipped: false, evidenceFloor: LEAKAGE_SCORE_FLOOR, final: LEAKAGE_SCORE_FLOOR },
  },
  {
    id: 'short-clean-en',
    lang: 'en',
    class: 'clean-control',
    text: 'same here, this saves me a ton of time every week.',
    expect: { skipped: true, evidenceFloor: 0, final: 0 },
  },
  {
    id: 'long-clean-en',
    lang: 'en',
    class: 'clean-control',
    text: [
      'I rewrote the parser this morning and it finally handles nested quotes without choking.',
      'The reviewer left a few notes but the overall structure holds together fine for now.',
      'We shipped the fix after lunch and the flaky test stopped failing on the retry.',
    ].join('\n\n'),
    expect: { skipped: false, evidenceFloor: 0, final: 0 },
  },
  {
    id: 'ko-monotony-short',
    lang: 'ko',
    class: 'stylometry-hot-no-floor',
    // Uniform declarative -다 register in one short paragraph: analyzer-hot via
    // ending-monotony, but with NO hard evidence floor. The coarse hot ratio
    // (1/1 = 100) must not be promoted to a floor, so the LLM 0 stands.
    text: '이 도구는 정말 유용하다. 이 모델은 매우 강력하다. 이 시스템은 아주 안정적이다. 이 방법은 꽤 효율적이다. 이 결과는 상당히 명확하다.',
    expect: { skipped: true, evidenceFloor: 0, final: 0 },
  },
];

function evaluateFixture(fixture) {
  const config = { ...loadConfig(), language: fixture.lang };
  const deterministic = scoreDeterministicSignals({ text: fixture.text, config });
  // Worst-case: the LLM finds nothing (overall 0). A non-zero final must be
  // deterministic hard evidence; a non-zero clean control is a false positive.
  const reconciled = reconcileScoreOverall({
    llmOverall: 0,
    deterministicScore: deterministic,
    config,
  });
  const analyzer = analyzeText(fixture.text, { lang: fixture.lang });

  const observed = {
    skipped: Boolean(deterministic.skipped),
    evidenceFloor: deterministic.evidenceFloor,
    deterministicOverall: deterministic.overall,
    analyzerHot: Boolean(analyzer.hot),
    final: reconciled.overall,
    reason: reconciled.scorePreference?.reason ?? null,
  };

  const failures = [];
  const { expect } = fixture;
  if (typeof expect.skipped === 'boolean' && observed.skipped !== expect.skipped) {
    failures.push(`skipped expected ${expect.skipped}, got ${observed.skipped}`);
  }
  if (typeof expect.evidenceFloor === 'number' && observed.evidenceFloor !== expect.evidenceFloor) {
    failures.push(`evidenceFloor expected ${expect.evidenceFloor}, got ${observed.evidenceFloor}`);
  }
  if (typeof expect.final === 'number' && observed.final !== expect.final) {
    failures.push(`final expected ${expect.final}, got ${observed.final}`);
  }
  // A discarded hard floor is the P0 class: skipped text with real evidence
  // whose final dropped below that evidence.
  const evidenceDiscarded =
    observed.skipped &&
    typeof observed.evidenceFloor === 'number' &&
    observed.evidenceFloor > 0 &&
    typeof observed.final === 'number' &&
    observed.final < observed.evidenceFloor;

  return { ...fixture, observed, failures, evidenceDiscarded };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const rows = FIXTURES.map(evaluateFixture);

  const positives = rows.filter((r) => r.class === 'hard-evidence-positive');
  const cleans = rows.filter((r) => r.class === 'clean-control');

  const positiveZero = positives.filter((r) => r.observed.final === 0);
  const falsePositives = cleans.filter((r) => r.observed.final > 0);
  const discarded = rows.filter((r) => r.evidenceDiscarded);
  const perFixtureFails = rows.filter((r) => r.failures.length > 0);

  const metrics = {
    fixtures: rows.length,
    positive_zero_score_rate: positives.length ? positiveZero.length / positives.length : 0,
    false_positive_rate: cleans.length ? falsePositives.length / cleans.length : 0,
    skipped_evidence_discarded: discarded.length,
    skipped_with_evidence: rows.filter((r) => r.observed.skipped && r.observed.evidenceFloor > 0).length,
    per_fixture_failures: perFixtureFails.length,
  };

  const results = {
    schema: 'patina.scorer-benchmark.v1',
    generatedAt: new Date().toISOString(),
    metrics,
    fixtures: rows.map((r) => ({
      id: r.id,
      lang: r.lang,
      class: r.class,
      observed: r.observed,
      failures: r.failures,
      evidenceDiscarded: r.evidenceDiscarded,
    })),
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');

  if (!quiet) {
    console.log(`# Scorer benchmark — ${rows.length} fixtures (LLM mocked to overall 0)`);
    console.log();
    console.log('| fixture | lang | class | skipped | evidenceFloor | final | reason | ok |');
    console.log('|---------|------|-------|---------|---------------|-------|--------|----|');
    for (const r of rows) {
      const ok = r.failures.length === 0 ? 'ok' : 'FAIL';
      console.log(
        `| ${r.id} | ${r.lang} | ${r.class} | ${r.observed.skipped} | ${r.observed.evidenceFloor} | ${r.observed.final} | ${r.observed.reason ?? '-'} | ${ok} |`
      );
    }
    console.log();
    console.log(`positive_zero_score_rate: ${(metrics.positive_zero_score_rate * 100).toFixed(1)}% (must be 0)`);
    console.log(`false_positive_rate: ${(metrics.false_positive_rate * 100).toFixed(1)}% (must be 0)`);
    console.log(`skipped_evidence_discarded: ${metrics.skipped_evidence_discarded} (must be 0)`);
    console.log(`skipped_with_evidence: ${metrics.skipped_with_evidence} (informational)`);
    console.log();
    if (perFixtureFails.length > 0) {
      console.log(`Failures (${perFixtureFails.length}):`);
      for (const r of perFixtureFails) {
        console.log(`  ${r.id}: ${r.failures.join('; ')}`);
      }
    } else {
      console.log('All scorer fixtures behaved as expected.');
    }
    console.log(`\nFull log: ${RESULTS_PATH}`);
  }

  // Non-zero exit on any gate violation so CI catches scorer-path regressions
  // the analyzer benchmark cannot see.
  const gateViolated =
    metrics.positive_zero_score_rate > 0 ||
    metrics.false_positive_rate > 0 ||
    metrics.skipped_evidence_discarded > 0 ||
    metrics.per_fixture_failures > 0;
  if (gateViolated) process.exitCode = 1;
}

main();
