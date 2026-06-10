#!/usr/bin/env node
// Refresh deterministic metric ranges for suspect-zone benchmark fixtures.
//
// This script intentionally does not call tests/quality/benchmark.mjs, because
// the benchmark itself validates these ranges. It reads fixtures, runs the
// in-tree analyzer, and writes a tight but reviewable regression baseline.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { analyzeText } from '../src/features/index.js';
import { loadLexicon } from '../src/features/lexicon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_ROOT = resolve(REPO_ROOT, 'tests/fixtures/suspect-zones');
const OUT_PATH = resolve(FIXTURES_ROOT, 'expected-ranges.json');
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
const TOLERANCES = {
  cv: 0.025,
  mattr: 0.03,
  lexiconDensity: 5,
};

// Exported so fixture producers (scripts/fp-fixture-export.mjs) and their tests
// can lock themselves to this exact parse path instead of re-implementing it.
export function parseFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`Missing frontmatter: ${path}`);
  return { meta: yaml.load(m[1]), body: m[2].trim(), path };
}

function listFixtures() {
  const out = [];
  for (const lang of readdirSync(FIXTURES_ROOT)) {
    const langDir = resolve(FIXTURES_ROOT, lang);
    if (!statSync(langDir).isDirectory()) continue;
    for (const cls of readdirSync(langDir)) {
      const clsDir = resolve(langDir, cls);
      if (!statSync(clsDir).isDirectory()) continue;
      for (const file of readdirSync(clsDir)) {
        if (file.endsWith('.md')) out.push(resolve(clsDir, file));
      }
    }
  }
  return out.sort();
}

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function range(value, tolerance, floor = 0) {
  const low = Math.max(floor, round(value - tolerance));
  const high = round(value + tolerance);
  return [low, high];
}

function detectorHot(result) {
  return {
    burstiness: result.paragraphs.some((p) => p.burstiness?.band === 'low'),
    koDiagnostics: result.paragraphs.some((p) => p.koDiagnostics?.hot),
    mattr: result.paragraphs.some((p) => p.mattr?.band === 'low'),
    lexicon: result.paragraphs.some((p) => p.lexicon?.hot),
  };
}

function main() {
  const lexicons = {};
  const metrics = {};
  for (const path of listFixtures()) {
    const { meta, body } = parseFixture(path);
    const lang = meta.language;
    if (!lexicons[lang]) lexicons[lang] = loadLexicon(lang, REPO_ROOT);
    const result = analyzeText(body, { lang, lexicon: lexicons[lang] });
    const p = result.paragraphs[0] || {};
    const cv = round(p.burstiness?.cv ?? 0);
    const mattr = round(p.mattr?.value ?? 0);
    const lexiconDensity = round(p.lexicon?.density ?? 0);
    metrics[meta.fixture_id] = {
      path: relative(REPO_ROOT, path),
      lang,
      class: meta.class,
      expected_hot: meta.expected_hot,
      predicted_hot: result.hot,
      detectors: detectorHot(result),
      cv_band: p.burstiness?.band,
      cv_range: range(cv, TOLERANCES.cv),
      mattr_band: p.mattr?.band,
      mattr_range: range(mattr, TOLERANCES.mattr),
      lexicon_density_range: range(lexiconDensity, TOLERANCES.lexiconDensity),
      lexicon_hits: p.lexicon?.hits ?? [],
    };
  }

  const out = {
    schemaVersion: 1,
    generatedBy: 'node scripts/update-benchmark-ranges.mjs',
    generatedAt: new Date().toISOString(),
    fixtureCount: Object.keys(metrics).length,
    tolerances: TOLERANCES,
    metrics,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${relative(REPO_ROOT, OUT_PATH)} (${out.fixtureCount} fixtures)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
