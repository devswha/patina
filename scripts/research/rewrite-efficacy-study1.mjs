// Study 1 (main study) runner for the pre-registered rewrite-efficacy program.
// Design fixed in docs/research/2026-rewrite-efficacy-prereg.md ("Study 1"
// section, registered 2026-07-10) BEFORE this ran.
//
// Two document-length arms:
//   A1  en / HAP-E paired on prompt_id, DISJOINT from pilot Arm A items
//   D   ko / new document corpus (ko-doc-collect + ko-doc-generate),
//       topic-paired via public titles
//
// Fixed 3-judge cross-family panel (rewriter = claude-cli):
//   judge-kimi (moonshot) + judge-gpt (codex) + judge-grok (xai)
// 2-of-3 quorum is applied at ANALYSIS time; the runner collects all three and
// records every failure. gemini is excluded before the first call (monthly
// spend cap — see pre-registration).
//
// Raw text stays gitignored: scores+hashes -> s1-rows-*.jsonl, bodies ->
// s1-texts-*.private.jsonl. Shard per arm via S1_SHARD like the pilot.
//
// Usage:
//   S1_ARMS=A1 S1_SHARD=A1 node scripts/research/rewrite-efficacy-study1.mjs
//   S1_ARMS=D  S1_SHARD=D  node scripts/research/rewrite-efficacy-study1.mjs

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreText } from '../prose-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const PILOT_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-pilot');
const PRIVATE = join(ROOT, 'artifacts', 'rebaseline-2025', 'private');

const SHARD = process.env.S1_SHARD ? `-${process.env.S1_SHARD}` : '';
const OUT_JSONL = join(OUT_DIR, `s1-rows${SHARD}.jsonl`);
const TEXTS_JSONL = join(OUT_DIR, `s1-texts${SHARD}.private.jsonl`);
const LOG = join(OUT_DIR, `s1-run${SHARD}.log`);

// Pre-registered cell target (20-30, target 25). Env override exists only for
// smoke-testing the code path before the recorded run.
const N_PAIRS = Number(process.env.S1_N_PAIRS ?? 25);

const REWRITER = { backend: 'claude-cli', family: 'claude' };
const KIMI_ARGS = ['--print', '--input-format', 'text', '--output-format', 'text',
  '--final-message-only', '--no-thinking', '--max-steps-per-turn', '20'];
// codex judges via `codex exec` with a read-only sandbox; the reply is the
// last message, captured from stdout (no repo side effects).
const CODEX_ARGS = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only'];
const JUDGES = [
  { id: 'judge-kimi', family: 'moonshot', cmd: 'kimi', args: KIMI_ARGS },
  { id: 'judge-gpt', family: 'gpt', cmd: 'codex', args: CODEX_ARGS },
  { id: 'judge-grok', family: 'xai', cmd: 'node', args: [join('scripts', 'research', 'xai-cli.mjs')] },
];

const REWRITE_TIMEOUT_MS = 300_000;
// Bimodal judge latency (pilot): healthy calls answer in seconds, hung ones
// never return. Cut fast, retry more.
const JUDGE_TIMEOUT_MS = 120_000;
const JUDGE_ATTEMPTS = 3;

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const log = (m) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};

function run(cmd, args, { input = '', timeout = 120_000, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    // detached => own process group; kill the group on timeout so CLI helper
    // processes cannot linger and block the next invocation (pilot Deviation 3).
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

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// arms

/** prompt_ids the pilot already consumed in its Arm A/B — Study 1 stays disjoint. */
function pilotPromptIds() {
  const ids = new Set();
  for (const f of ['pilot-rows-A.jsonl', 'pilot-rows-B.jsonl']) {
    for (const r of readJsonl(join(PILOT_DIR, f))) if (r.pair_id) ids.add(r.pair_id);
  }
  return ids;
}

/**
 * Arm A1: HAP-E pairs, register-round-robin as in the pilot, skipping pilot
 * items. `spok` IS sampled (its exclusion happens in the analysis, so the
 * pre-registered sensitivity check has data to restore).
 */
function buildA1() {
  const rows = readJsonl(join(PRIVATE, 'hape-en.private.jsonl'));
  const used = pilotPromptIds();
  const ai = rows.filter((r) => r.class === 'ai-like' && r.text && !used.has(r.prompt_id));
  const humanByPrompt = new Map(rows.filter((r) => r.class === 'natural-human' && r.text).map((r) => [r.prompt_id, r]));
  const pairable = ai.filter((r) => humanByPrompt.has(r.prompt_id));

  const byRegister = new Map();
  for (const r of pairable) {
    const k = r.register || 'unknown';
    if (!byRegister.has(k)) byRegister.set(k, []);
    byRegister.get(k).push(r);
  }
  const registers = [...byRegister.keys()].sort();
  const picked = [];
  let guard = 0;
  while (picked.length < N_PAIRS && guard < N_PAIRS * 20) {
    for (const reg of registers) {
      if (picked.length >= N_PAIRS) break;
      const pool = byRegister.get(reg);
      if (pool.length) picked.push(pool.shift());
    }
    guard += 1;
  }
  const units = [];
  for (const aiRow of picked) {
    units.push({ ...aiRow, source_class: 'ai', pair_id: aiRow.prompt_id });
    units.push({ ...humanByPrompt.get(aiRow.prompt_id), source_class: 'human', pair_id: aiRow.prompt_id });
  }
  return { units, notes: [`HAP-E pairs disjoint from pilot (${used.size} pilot prompt_ids skipped); ${picked.length} pairs`] };
}

/** Arm D: the new ko document corpus, topic-paired by construction. */
function buildD() {
  const humans = readJsonl(join(OUT_DIR, 'ko-human-docs.private.jsonl'));
  const ais = readJsonl(join(OUT_DIR, 'ko-ai-docs.private.jsonl'));
  const units = [];
  for (const a of ais) units.push({
    text: a.text, register: a.register, model_family: a.model_family, model: a.model,
    source_class: 'ai', pair_id: a.pair_id, sample_id: a.sample_id,
  });
  for (const h of humans) units.push({
    text: h.text, register: h.register, model_family: 'human-reference', model: null,
    source_class: 'human', pair_id: h.sample_id, sample_id: h.sample_id,
  });
  return { units, notes: [`ko doc corpus: ${ais.length} ai (topic-paired) + ${humans.length} human`] };
}

const ARMS = {
  A1: { id: 'A1', lang: 'en', stimulus: 'document', build: buildA1 },
  D: { id: 'D', lang: 'ko', stimulus: 'document', build: buildD },
};
const SELECTED = (process.env.S1_ARMS ?? 'A1,D').split(',').filter(Boolean);

// ---------------------------------------------------------------------------
// rewrite / judge (same contracts as the pilot, panel widened to 3)

async function patinaRewrite(text, lang) {
  // Exit 4 = rewrite emitted but the persona safety gate failed. Kept, recorded
  // (docs/EXIT-CODES.md); discarding would bias RQ5a toward 100%.
  const res = await run('node', [
    'bin/patina.js', '--lang', lang, '--backend', REWRITER.backend,
    '--format', 'text', '--no-interactive',
  ], { input: text, timeout: REWRITE_TIMEOUT_MS });

  const gateFailed = res.code === 4;
  if (!res.ok && !gateFailed) return { text: null, error: res.error || res.stderr.slice(0, 300) || `exit ${res.code}`, gate_failed: null, gate_reason: null };
  const body = String(res.stdout).split(/\n---\n/)[0].trim();
  if (!body) return { text: null, error: 'empty rewrite', gate_failed: null, gate_reason: null };

  let gateReason = null;
  if (gateFailed) {
    const m = String(res.stderr).match(/persona safety gate failed:\s*([^\n]*)/);
    gateReason = m ? m[1].trim().slice(0, 200) : 'unspecified';
  }
  const advisory = [...String(res.stderr).matchAll(/persona advisory:\s*([^\n]*)/g)].map((m) => m[1].trim().slice(0, 200));
  return { text: body, error: null, gate_failed: gateFailed, gate_reason: gateReason, advisory };
}

function judgePrompt(text, lang) {
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
    `The passage is in ${lang === 'ko' ? 'Korean' : 'English'}.`,
    '',
    'Respond with ONLY a JSON object, no code fence, no prose:',
    '{"authorship":"human"|"ai","ai_likeness":<0-100 integer>,"strongest_cue":"<short phrase>"}',
    '',
    '--- PASSAGE START ---',
    text,
    '--- PASSAGE END ---',
  ].join('\n');
}

// Alias set for judge schema drift (pilot Deviation 2). Drift is recorded via
// score_key, never silently dropped.
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
    } catch { /* next candidate */ }
  }
  return null;
}

function internalScore(text, lang) {
  try {
    const r = scoreText(text, { lang, repoRoot: ROOT });
    return {
      score: r.score ?? null,
      floored_score: r.flooredScore ?? null,
      signal_score: r.signalScore ?? null,
      pattern_hits: r.patternHits ?? null,
      hot_count: r.hotCount ?? null,
      paragraph_count: r.paragraphCount ?? null,
      analysis_skipped: r.analysisSkipped ?? r.skipped ?? null,
    };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function judgeOnce(judge, text, lang) {
  const attempts = [];
  let lastOut = '';
  let lastErr = '';
  for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt += 1) {
    const res = await run(judge.cmd, judge.args, { input: judgePrompt(text, lang), timeout: JUDGE_TIMEOUT_MS });
    const parsed = parseJudge(res.stdout);
    if (parsed) return attempt === 1 ? parsed : { ...parsed, retried: true };
    attempts.push(res.error || 'unparseable');
    lastOut = String(res.stdout);
    lastErr = String(res.stderr);
  }
  // Keep the reply tail — a quota error must stay distinguishable from a
  // formatting error (pilot Deviation 3).
  return {
    error: attempts.join(' | '),
    raw_head: (lastOut || lastErr).slice(-240),
    retries_exhausted: true,
  };
}

async function judgeText(text, lang) {
  const out = {};
  for (const judge of JUDGES) {
    out[judge.id] = await judgeOnce(judge, text, lang);
  }
  return out;
}

// ---------------------------------------------------------------------------

async function runArm(arm) {
  const { units, notes } = arm.build();
  const aiN = units.filter((u) => u.source_class === 'ai').length;
  const humanN = units.filter((u) => u.source_class === 'human').length;
  log(`arm ${arm.id} (${arm.lang}/${arm.stimulus}): ${aiN} ai + ${humanN} human — ${notes.join('; ')}`);
  if (aiN < 20) log(`WARN arm ${arm.id}: AI cell ${aiN} < pre-registered floor 20 (report as underpowered)`);
  if (humanN < 20) log(`WARN arm ${arm.id}: human cell ${humanN} < pre-registered floor 20 (report as underpowered)`);

  const done = new Set(readJsonl(OUT_JSONL).map((r) => `${r.arm}:${r.original_sha}`));

  for (const [idx, unit] of units.entries()) {
    const original = unit.text;
    if (done.has(`${arm.id}:${sha(original)}`)) continue; // resume
    const label = `${arm.id}/${arm.lang}/${unit.source_class}/${idx + 1}`;

    log(`${label}: rewriting (${original.length} chars)…`);
    const rw = await patinaRewrite(original, arm.lang);
    if (rw.error) log(`${label}: REWRITE FAILED — ${rw.error}`);
    if (rw.gate_failed) log(`${label}: SAFETY GATE FAILED (text kept) — ${rw.gate_reason}`);

    log(`${label}: judging original…`);
    const judgedOriginal = await judgeText(original, arm.lang);
    let judgedRewrite = null;
    if (rw.text) {
      log(`${label}: judging rewrite…`);
      judgedRewrite = await judgeText(rw.text, arm.lang);
    }

    const row = {
      arm: arm.id,
      stimulus: arm.stimulus,
      lang: arm.lang,
      source_class: unit.source_class,
      pair_id: unit.pair_id ?? null,
      model_family: unit.model_family ?? null,
      model: unit.model ?? null,
      register: unit.register ?? null,
      rewriter: REWRITER.backend,
      original_sha: sha(original),
      rewrite_sha: rw.text ? sha(rw.text) : null,
      original_chars: original.length,
      rewrite_chars: rw.text ? rw.text.length : null,
      rewrite_error: rw.error,
      gate_failed: rw.gate_failed ?? null,
      gate_reason: rw.gate_reason ?? null,
      advisory: rw.advisory ?? null,
      internal: {
        original: internalScore(original, arm.lang),
        rewrite: rw.text ? internalScore(rw.text, arm.lang) : null,
      },
      judges: { original: judgedOriginal, rewrite: judgedRewrite },
    };
    appendFileSync(OUT_JSONL, JSON.stringify(row) + '\n');
    appendFileSync(TEXTS_JSONL, JSON.stringify({
      arm: arm.id, original_sha: row.original_sha, rewrite_sha: row.rewrite_sha,
      lang: arm.lang, source_class: unit.source_class, original, rewritten: rw.text,
    }) + '\n');

    const summary = JUDGES.map((j) => {
      const o = judgedOriginal[j.id]?.ai_likeness;
      const r = judgedRewrite?.[j.id]?.ai_likeness;
      return `${j.id.replace('judge-', '')} ${o ?? '?'}->${r ?? '?'}`;
    }).join(' ');
    log(`${label}: done (${summary})`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(LOG)) writeFileSync(LOG, '');
  log(`study1 start — rewriter=${REWRITER.backend} judges=${JUDGES.map((j) => j.id).join(',')}`);
  log(`config — arms=${SELECTED.join(',')} n_pairs=${N_PAIRS} shard=${SHARD || '(none)'} resume=on`);

  for (const id of SELECTED) {
    const arm = ARMS[id];
    if (!arm) { log(`WARN unknown arm ${id}, skipped`); continue; }
    await runArm(arm);
  }
  log('study1 complete');
}

main().catch((e) => { log(`FATAL ${e?.stack ?? e}`); process.exit(1); });
