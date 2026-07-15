// Study 3 runner — structure-plan-step intervention (pre-registration:
// docs/research/2026-rewrite-efficacy-prereg.md, "Study 3" section,
// registered 2026-07-12 before any Study 3 data).
//
// Two-stage rewrite, same rewriter model for both stages (claude-cli's
// default model, invoked exactly as patina's backend invokes it):
//   1. PLAN    — the model reads the original and emits a reorganization plan
//                under a fixed contract: every number/date/named entity is
//                enumerated KEEP-verbatim; merge/split/reorder decisions;
//                paragraph-size asymmetry; dismantle checklist parallelism;
//                no new content units; no deletion of content units.
//   2. EXECUTE — the model receives the original plus the plan and produces
//                the rewrite by carrying out the plan.
//
// Both stage prompts are FIXED before the first row; their sha256 is recorded
// in every row (prompt provenance, like Study 2's pack_sha). The meaning gate
// is the deterministic dropped-numbers guard (src/verify.js
// deterministicMeaningGuard) — the component that produced 100% of Study 1/2
// gate failures — applied identically to every rewrite.
//
// Resume: rows are appended per document and skipped by original_sha on
// restart (fail-soft rows must be pruned before resuming, per S2 practice).
//
// Usage: node scripts/research/rewrite-efficacy-study3.mjs
//   env S3_LIMIT=<n> — process at most n pending documents (smoke/batch control)

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreText } from '../prose-score.mjs';
import { deterministicMeaningGuard } from '../../src/verify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S1_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const OUT_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study3');
const OUT_JSONL = join(OUT_DIR, 's3-rows-D3.jsonl');
const TEXTS_JSONL = join(OUT_DIR, 's3-texts-D3.private.jsonl');
const LOG = join(OUT_DIR, 's3-run.log');

// Same model, same invocation shape as patina's claude-cli backend
// (src/backends/claude-cli.js: `claude -p --model <model>` in a fresh tmpdir).
const REWRITER_MODEL = 'claude-sonnet-4-6';

const KIMI_ARGS = ['--print', '--input-format', 'text', '--output-format', 'text',
  '--final-message-only', '--no-thinking', '--max-steps-per-turn', '20'];
const CODEX_ARGS = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only'];
const JUDGES = [
  { id: 'judge-kimi', family: 'moonshot', cmd: 'kimi', args: KIMI_ARGS },
  { id: 'judge-gpt', family: 'gpt', cmd: join(process.env.HOME || '', '.nvm', 'versions', 'node', 'v22.17.1', 'bin', 'codex'), args: CODEX_ARGS },
  { id: 'judge-grok', family: 'xai', cmd: 'node', args: [join('scripts', 'research', 'xai-cli.mjs')] },
];

// Plan stage matches S1/S2's rewrite budget; the execute stage's input is
// original + plan (larger), and two distinct documents hit the 600s wall in
// the live run (docs 20, 25) — raised to 900s mid-run as an execution note
// (harness plumbing, same precedent as S1's 300→600 top-up; no analysis
// criterion changes). Prompts untouched.
const PLAN_TIMEOUT_MS = 600_000;
const EXEC_TIMEOUT_MS = 900_000;
const JUDGE_TIMEOUT_MS = 120_000;
const JUDGE_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// FIXED STAGE PROMPTS — registered by sha in every row. Do not edit after the
// first data row exists.

function planPrompt(text) {
  return [
    'You are a document-structure editor. Read the Korean document below and produce a',
    'REORGANIZATION PLAN that will make its architecture read like an individual human',
    'wrote it — asymmetric, opinionated, imperfect — WITHOUT changing any content.',
    '',
    'AI-typical architecture you must plan away where present: uniform same-size',
    'paragraphs, checklist-complete parallel sections, tidy intro→body→conclusion arcs,',
    'symmetric coverage of every subtopic, template-like headings.',
    '',
    'Output the plan in EXACTLY this format (Korean or English, either is fine):',
    '',
    'KEEP-VERBATIM:',
    '- enumerate EVERY number, date, unit, price, percentage, and named entity in the',
    '  document, one per line, exactly as written. These strings MUST survive the',
    '  rewrite character-for-character.',
    '',
    'CONTENT-UNITS:',
    '- list each distinct fact/claim/step the document asserts (short paraphrase, one',
    '  per line). The rewrite must keep every one — no deletions, no additions.',
    '',
    'OPERATIONS:',
    '- numbered merge/split/reorder decisions at paragraph/section level (e.g. "merge',
    '  paragraphs 2+3", "move the caveat before the steps", "break the 4-item parallel',
    '  list into one sentence plus one short paragraph"). Be specific and modest: only',
    '  operations that break templated shape. Reordering must never change meaning,',
    '  causality, or which claim supports which.',
    '',
    'TARGET-SHAPE:',
    '- one short line describing the intended paragraph-length rhythm (e.g. "one long',
    '  opening paragraph, two short ones, no closing summary").',
    '',
    'Hard constraints on the plan itself:',
    '- NO new content units; NO deleted content units; NO compression that drops facts.',
    '- Every KEEP-VERBATIM string must appear in the plan exactly as in the source.',
    '',
    '--- DOCUMENT START ---',
    text,
    '--- DOCUMENT END ---',
  ].join('\n');
}

function executePrompt(text, plan) {
  return [
    'Rewrite the Korean document below by CARRYING OUT the reorganization plan that',
    'follows it. The goal: the rewritten document should read like an individual human',
    'wrote it — in its architecture (per the plan) and its sentences (natural, plain,',
    'no AI-typical phrasing) — while preserving the content exactly.',
    '',
    'Hard rules:',
    '- Execute the plan\'s OPERATIONS and TARGET-SHAPE.',
    '- Every string in the plan\'s KEEP-VERBATIM list MUST appear in your rewrite',
    '  exactly as written (character-for-character).',
    '- Every item in CONTENT-UNITS must survive: no dropped facts, no invented facts,',
    '  no changed claims, polarity, or causation.',
    '- Keep the original register and language (Korean). Do not add a summary or',
    '  conclusion the original does not have.',
    '- Output ONLY the rewritten document. No preamble, no commentary, no code fence.',
    '',
    '--- DOCUMENT START ---',
    text,
    '--- DOCUMENT END ---',
    '',
    '--- REORGANIZATION PLAN START ---',
    plan,
    '--- REORGANIZATION PLAN END ---',
  ].join('\n');
}

// ---------------------------------------------------------------------------

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const log = (m) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};

function run(cmd, args, { input = '', timeout = 120_000, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
      finish({ ok: false, stdout, stderr, error: `timeout after ${timeout}ms` });
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ ok: false, stdout, stderr, error: String(e?.message ?? e) }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

/** claude -p in a fresh temp cwd (same containment as patina's backend). */
async function claudeCall(prompt, { timeout }) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-s3-claude-'));
  try {
    const res = await run('claude', ['-p', '--model', REWRITER_MODEL], { input: prompt, timeout, cwd: dir });
    if (!res.ok) return { text: null, error: res.error || res.stderr.slice(0, 300) || `exit ${res.code}` };
    let out = String(res.stdout).trim();
    // Deterministic cleanup: unwrap a single fully-fencing code block if present.
    const fence = out.match(/^```[a-z]*\n([\s\S]*)\n```$/);
    if (fence) out = fence[1].trim();
    if (!out) return { text: null, error: 'empty output' };
    return { text: out, error: null };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** S1 D-arm text store, TOPUP-deduped by original_sha (last write wins). */
function loadS1Texts() {
  const byKey = new Map();
  for (const f of readdirSync(S1_DIR).filter((x) => /^s1-texts(-.*)?\.private\.jsonl$/.test(x))) {
    for (const t of readJsonl(join(S1_DIR, f))) if (t.arm === 'D') byKey.set(t.original_sha, t);
  }
  return byKey;
}

// Judge prompt/parse — byte-identical to the Study 2 runner.
function judgePrompt(text) {
  return [
    'You are evaluating a single passage of writing. You do not know its origin.',
    '',
    'Answer BOTH questions independently. Do not let one answer drive the other.',
    '',
    'Q1 (authorship): Was this passage most likely written by a human, or generated by an AI language model?',
    'Q2 (AI-likeness): On a 0-100 scale, how AI-like does the PROSE read?',
    '   0 = reads unmistakably like an individual human wrote it',
    '   100 = reads unmistakably like generic AI output',
    '   Judge the writing itself (rhythm, word choice, structure, specificity), not the topic.',
    '',
    'Then name the single strongest cue that drove your judgement.',
    '',
    'The passage is in Korean.',
    '',
    'Respond with ONLY a JSON object, no code fence, no prose:',
    '{"authorship":"human"|"ai","ai_likeness":<0-100 integer>,"strongest_cue":"<short phrase>"}',
    '',
    '--- PASSAGE START ---',
    text,
    '--- PASSAGE END ---',
  ].join('\n');
}

const SCORE_KEYS = ['ai_likeness', 'ai_status', 'ai_score', 'score', 'aiLikeness'];

function parseJudge(raw) {
  if (!raw) return null;
  const matches = String(raw).match(/\{[^{}]*"authorship"[^{}]*\}/g);
  if (!matches) return null;
  for (const candidate of [...matches].reverse()) {
    try {
      const o = JSON.parse(candidate);
      const authorship = String(o.authorship || '').toLowerCase();
      if (authorship !== 'human' && authorship !== 'ai') continue;
      const key = SCORE_KEYS.find((k) => Number.isFinite(Number(o[k])));
      if (!key) continue;
      return {
        authorship,
        ai_likeness: Math.max(0, Math.min(100, Math.round(Number(o[key])))),
        strongest_cue: String(o.strongest_cue || '').slice(0, 200),
        score_key: key === 'ai_likeness' ? undefined : key,
      };
    } catch { /* next */ }
  }
  return null;
}

async function judgeOnce(judge, text) {
  const attempts = [];
  let lastOut = '';
  let lastErr = '';
  for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt += 1) {
    const res = await run(judge.cmd, judge.args, { input: judgePrompt(text), timeout: JUDGE_TIMEOUT_MS });
    const parsed = parseJudge(res.stdout);
    if (parsed) return attempt === 1 ? parsed : { ...parsed, retried: true };
    attempts.push(res.error || 'unparseable');
    lastOut = String(res.stdout);
    lastErr = String(res.stderr);
  }
  return { error: attempts.join(' | '), raw_head: (lastOut || lastErr).slice(-240), retries_exhausted: true };
}

function internalScore(text) {
  try {
    const r = scoreText(text, { lang: 'ko', repoRoot: ROOT });
    return { signal_score: r.signalScore ?? null, score: r.score ?? null, pattern_hits: r.patternHits ?? null };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(LOG)) writeFileSync(LOG, '');

  const planPromptSha = sha(planPrompt('PROBE'));
  const execPromptSha = sha(executePrompt('PROBE', 'PROBE'));

  const s1Rows = readJsonl(join(S1_DIR, 's1-rows-D.jsonl'));
  const texts = loadS1Texts();
  const limit = Number(process.env.S3_LIMIT) > 0 ? Number(process.env.S3_LIMIT) : Infinity;
  log(`study3 start — plan_prompt ${planPromptSha} exec_prompt ${execPromptSha}; model ${REWRITER_MODEL}; ${s1Rows.length} S1 D-arm rows; limit ${limit === Infinity ? 'none' : limit}`);

  const done = new Set(readJsonl(OUT_JSONL).map((r) => r.original_sha));
  let processed = 0;
  // Circuit breaker: consecutive rewrite failures usually mean quota/login
  // exhaustion — stop instead of minting fail-soft rows for every remaining doc.
  let consecutiveFailures = 0;

  for (const [idx, s1] of s1Rows.entries()) {
    if (done.has(s1.original_sha)) continue; // resume
    if (processed >= limit) { log(`limit ${limit} reached — stopping (resumable)`); break; }
    const stored = texts.get(s1.original_sha);
    if (!stored?.original) { log(`WARN no stored original for ${s1.original_sha}`); continue; }
    const label = `D3/${s1.source_class}/${idx + 1}`;
    processed += 1;
    if (consecutiveFailures >= 3) { log('3 consecutive rewrite failures — circuit breaker OPEN, stopping (prune failed rows, then resume)'); break; }

    log(`${label}: plan stage (${stored.original.length} chars)…`);
    const plan = await claudeCall(planPrompt(stored.original), { timeout: PLAN_TIMEOUT_MS });
    if (plan.error) log(`${label}: PLAN FAILED — ${plan.error}`);

    let rw = { text: null, error: plan.error ? `plan: ${plan.error}` : null };
    if (plan.text) {
      log(`${label}: execute stage…`);
      rw = await claudeCall(executePrompt(stored.original, plan.text), { timeout: EXEC_TIMEOUT_MS });
      if (rw.error) log(`${label}: EXECUTE FAILED — ${rw.error}`);
    }
    if (rw.error) consecutiveFailures += 1; else consecutiveFailures = 0;

    let gateFailed = null;
    let gateReason = null;
    if (rw.text) {
      const warnings = deterministicMeaningGuard(stored.original, rw.text);
      gateFailed = warnings.length > 0;
      gateReason = gateFailed ? warnings.join(' | ').slice(0, 200) : null;
      if (gateFailed) log(`${label}: MEANING GATE FAILED — ${gateReason}`);
    }

    let judged = null;
    if (rw.text) {
      log(`${label}: judging rewrite…`);
      judged = {};
      for (const judge of JUDGES) judged[judge.id] = await judgeOnce(judge, rw.text);
    }

    const row = {
      arm: 'D3',
      plan_prompt_sha: planPromptSha,
      exec_prompt_sha: execPromptSha,
      rewriter_model: REWRITER_MODEL,
      source_class: s1.source_class,
      pair_id: s1.pair_id,
      model_family: s1.model_family,
      register: s1.register,
      original_sha: s1.original_sha,
      plan_sha: plan.text ? sha(plan.text) : null,
      plan_chars: plan.text ? plan.text.length : null,
      rewrite3_sha: rw.text ? sha(rw.text) : null,
      original_chars: stored.original.length,
      rewrite3_chars: rw.text ? rw.text.length : null,
      rewrite_error: rw.error,
      gate_failed: gateFailed,
      gate_reason: gateReason,
      internal_rewrite3: rw.text ? internalScore(rw.text) : null,
      judges_rewrite3: judged,
    };
    appendFileSync(OUT_JSONL, JSON.stringify(row) + '\n');
    appendFileSync(TEXTS_JSONL, JSON.stringify({
      original_sha: s1.original_sha, rewrite3_sha: row.rewrite3_sha,
      source_class: s1.source_class, original: stored.original,
      plan: plan.text, rewritten3: rw.text,
    }) + '\n');

    const summary = JUDGES.map((j) => `${j.id.replace('judge-', '')} ${judged?.[j.id]?.ai_likeness ?? '?'}`).join(' ');
    log(`${label}: done (${summary})`);
  }
  log('study3 runner pass complete');
}

main().catch((e) => { log(`FATAL ${e?.stack ?? e}`); process.exit(1); });
