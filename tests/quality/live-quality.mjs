#!/usr/bin/env node

/**
 * Opt-in live rewrite quality scaffold.
 *
 * Default execution never calls a model: it scores fixture inputs and reports a
 * skipped live pass. Set OPENCODE_AVAILABLE=1 to run the OpenCode rewrite path,
 * or pass --candidate-dir with precomputed rewrites for offline metric checks.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, getRepoRoot } from '../../src/config.js';
import { loadCoreFile, loadPatterns, loadProfile } from '../../src/loader.js';
import { stripSelfAudit } from '../../src/output.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import { scoreText as scoreProseText } from '../../scripts/prose-score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const DEFAULT_FIXTURE_PATH = resolve(REPO_ROOT, 'tests/quality/live-fixtures.jsonl');
const DEFAULT_OPENCODE_MODEL = 'opencode/hy3-preview-free';
const REQUIRED_FIXTURE_FIELDS = [
  'fixture_id',
  'language',
  'register',
  'source_type',
  'model_family',
  'prompt_id',
  'redistribution',
  'facts',
  'text',
];

export function loadLiveFixtures(fixturePath = DEFAULT_FIXTURE_PATH) {
  const body = readFileSync(fixturePath, 'utf8');
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => validateFixture(JSON.parse(line), `${fixturePath}:${index + 1}`));
}

function validateFixture(fixture, source) {
  for (const field of REQUIRED_FIXTURE_FIELDS) {
    if (!(field in fixture)) throw new Error(`missing ${field} in ${source}`);
  }
  if (!Array.isArray(fixture.facts) || fixture.facts.length === 0) {
    throw new Error(`facts must be a non-empty array in ${source}`);
  }
  if (!['en', 'ko', 'zh', 'ja'].includes(fixture.language)) {
    throw new Error(`unsupported language ${fixture.language} in ${source}`);
  }
  return fixture;
}

export async function buildPatinaRewritePrompt(fixture, { repoRoot = getRepoRoot() } = {}) {
  const config = loadConfig();
  config.language = fixture.language;

  const patterns = loadPatterns(repoRoot, fixture.language);
  const profile = loadProfile(repoRoot, config.profile || 'default');
  const voice = loadCoreFile(repoRoot, 'voice.md');

  return buildPrompt({
    config,
    patterns,
    profile: profile.body ? profile : null,
    voice: voice.body ? voice : null,
    scoring: null,
    text: fixture.text,
    mode: 'rewrite',
  });
}

export function evaluateRewriteQuality(fixture, rawRewrite, { repoRoot = REPO_ROOT } = {}) {
  const rewrite = stripSelfAudit(String(rawRewrite || ''), { logger: { warn() {} } }).trim();
  const before = scoreProseText(fixture.text, {
    file: `${fixture.fixture_id}.md`,
    lang: fixture.language,
    repoRoot,
  });
  const after = scoreProseText(rewrite, {
    file: `${fixture.fixture_id}.rewrite.md`,
    lang: fixture.language,
    repoRoot,
  });
  const humanizationGain = round1(before.score - after.score);
  const meaningSafety = round1(computeMeaningSafety(fixture, rewrite));
  const safeGain = round1(Math.max(0, humanizationGain) * (meaningSafety / 100));
  const status = classifyQuality({ afterScore: after.score, meaningSafety, safeGain });
  const facts = preservedFacts(fixture.facts, rewrite, fixture.language);

  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    before_score: round1(before.score),
    after_score: round1(after.score),
    humanization_gain: humanizationGain,
    meaning_safety: meaningSafety,
    safe_gain: safeGain,
    status,
    preserved_facts: facts.preserved,
    total_facts: facts.total,
  };
}

export function computeMeaningSafety(fixture, rewrite) {
  const facts = preservedFacts(fixture.facts, rewrite, fixture.language);
  const factScore = facts.total ? (facts.preserved.length / facts.total) * 100 : 100;
  const lengthScore = lengthSafetyScore(fixture.text, rewrite);
  return Math.min(factScore, lengthScore);
}

export function classifyQuality({ afterScore, meaningSafety, safeGain }) {
  if (afterScore <= 30 && meaningSafety >= 70 && safeGain > 0) return 'pass';
  if (meaningSafety >= 70 && safeGain > 0) return 'warn';
  return 'fail';
}

export async function runLiveQuality(options = {}) {
  const fixtures = selectFixtures(options.fixtures ?? loadLiveFixtures(options.fixturePath), options);
  const shouldRunLive = options.live ?? (process.env.OPENCODE_AVAILABLE === '1' && !options.dryRun);
  const candidateDir = options.candidateDir ? resolve(options.candidateDir) : null;
  const results = [];

  for (const fixture of fixtures) {
    const candidate = candidateDir ? readCandidate(candidateDir, fixture.fixture_id) : null;
    if (!shouldRunLive && !candidate) {
      results.push(skippedResult(fixture, 'live rewrite disabled; set OPENCODE_AVAILABLE=1 or pass --candidate-dir'));
      continue;
    }

    try {
      const rawRewrite = candidate ?? runWithOpenCode(
        await buildPatinaRewritePrompt(fixture),
        {
          model: options.model || process.env.OPENCODE_MODEL || DEFAULT_OPENCODE_MODEL,
          timeoutMs: options.timeoutMs,
        }
      );
      results.push(evaluateRewriteQuality(fixture, rawRewrite, options));
    } catch (err) {
      results.push(failedResult(fixture, err));
    }
  }

  return results;
}

export function renderMarkdownReport(results) {
  const lines = [
    '# Patina live rewrite quality',
    '',
    '| status | fixture | lang | before | after | gain | meaning safety | safe gain | facts |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const result of results) {
    const cells = [
      result.status,
      result.fixture_id,
      result.language,
      formatNumber(result.before_score),
      formatNumber(result.after_score),
      formatNumber(result.humanization_gain),
      formatNumber(result.meaning_safety),
      formatNumber(result.safe_gain),
      `${result.preserved_facts?.length ?? 0}/${result.total_facts ?? 0}`,
    ];
    lines.push(`| ${cells.join(' | ')} |`);
    if (result.reason) lines.push(`<!-- ${result.fixture_id}: ${result.reason} -->`);
  }

  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--fixtures') options.fixturePath = resolve(argv[++i]);
    else if (arg === '--candidate-dir') options.candidateDir = argv[++i];
    else if (arg === '--language') options.language = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--model') options.model = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }

  const results = await runLiveQuality(options);
  if (options.json) console.log(JSON.stringify({ results }, null, 2));
  else process.stdout.write(renderMarkdownReport(results));

  if (results.some((result) => result.status === 'fail')) process.exitCode = 1;
}

function selectFixtures(fixtures, { language, limit } = {}) {
  let selected = fixtures;
  if (language) selected = selected.filter((fixture) => fixture.language === language);
  if (Number.isFinite(limit) && limit >= 0) selected = selected.slice(0, limit);
  return selected;
}

function runWithOpenCode(prompt, { model = DEFAULT_OPENCODE_MODEL, timeoutMs = 120000 } = {}) {
  return execFileSync('opencode', ['run', '-m', model, '--pure', prompt], {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd: REPO_ROOT,
  });
}

function readCandidate(candidateDir, fixtureId) {
  for (const ext of ['.txt', '.md']) {
    const path = resolve(candidateDir, `${fixtureId}${ext}`);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return null;
}

function skippedResult(fixture, reason) {
  const before = scoreProseText(fixture.text, {
    file: `${fixture.fixture_id}.md`,
    lang: fixture.language,
    repoRoot: REPO_ROOT,
  });
  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    before_score: round1(before.score),
    after_score: null,
    humanization_gain: null,
    meaning_safety: null,
    safe_gain: null,
    status: 'skipped',
    reason,
    preserved_facts: [],
    total_facts: fixture.facts.length,
  };
}

function failedResult(fixture, err) {
  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    before_score: null,
    after_score: null,
    humanization_gain: null,
    meaning_safety: null,
    safe_gain: null,
    status: 'fail',
    reason: err?.message || 'live rewrite failed',
    preserved_facts: [],
    total_facts: fixture.facts.length,
  };
}

function preservedFacts(facts, text, language = 'en') {
  const haystack = normalizeForMatch(text, language);
  const preserved = facts.filter((fact) => haystack.includes(normalizeForMatch(fact, language)));
  return { preserved, total: facts.length };
}

function normalizeForMatch(value, language) {
  const normalized = String(value || '').normalize('NFC');
  return language === 'en' ? normalized.toLowerCase() : normalized;
}

function lengthSafetyScore(original, rewrite) {
  const originalLength = String(original || '').trim().length;
  const rewriteLength = String(rewrite || '').trim().length;
  if (!originalLength || !rewriteLength) return 0;
  const ratio = rewriteLength / originalLength;
  if (ratio >= 0.5 && ratio <= 1.5) return 100;
  if (ratio < 0.5) return (ratio / 0.5) * 100;
  return (1.5 / ratio) * 100;
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function helpText() {
  return `Usage: node tests/quality/live-quality.mjs [options]\n\nOptions:\n  --dry-run              Force no live model call\n  --json                 Print JSON instead of markdown\n  --fixtures <path>      JSONL fixture file\n  --candidate-dir <dir>  Score precomputed rewrites named <fixture_id>.txt|.md\n  --language <lang>      Filter fixtures by en|ko|zh|ja\n  --limit <n>            Limit selected fixtures\n  --model <provider/id>  Override OPENCODE_MODEL\n\nDefault run skips live rewrite. Set OPENCODE_AVAILABLE=1 to call opencode.\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
