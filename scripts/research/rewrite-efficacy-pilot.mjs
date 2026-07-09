// Study 0 (pilot) for the pre-registered rewrite-efficacy program.
// See docs/research/2026-rewrite-efficacy-prereg.md — hypotheses, decision
// rules, and anti-circularity controls were fixed BEFORE this ran.
//
// Three arms (see Deviation 1 in the pre-registration):
//   A  en / document length / HAP-E paired corpus   -> primary RQ1+RQ2
//   B  en / snippet length  / rebaseline intake     -> stimulus-length moderator
//   C  ko / snippet length  / rebaseline intake     -> limited, read through B
//
// Per arm:
//   1. sample AI texts + human controls (Arm A pairs them on prompt_id, so
//      topic and register are controlled by construction)
//   2. rewrite every text through the REAL patina CLI path (bin/patina.js), so
//      the study measures what ships, not a re-implemented prompt pipeline.
//      Human texts get rewritten too — that is RQ5b, the over-editing control.
//   3. score every text with patina's own analyzer (SANITY AXIS ONLY — it is
//      the rewriter's optimization target and never the primary metric)
//   4. cross-family judges rate every text independently and blind to
//      condition: AI-likeness 0-100 + a separate authorship call
//
// Anti-circularity (pre-reg control #1/#2): the rewriter is claude-family and is
// EXCLUDED from the judge panel (judges are gpt- and gemini-family). Judges see
// one passage at a time, never a sibling version, never the condition label.
//
// Raw text stays in artifacts/ (gitignored): scores+hashes go to pilot-rows.jsonl,
// text bodies to texts.private.jsonl.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreText } from '../prose-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-pilot');
// Arms can run as separate processes; each writes its own shard so a crash in one
// never truncates another's rows. `analyze` globs the shards back together.
const SHARD = process.env.PILOT_SHARD ? `-${process.env.PILOT_SHARD}` : '';
const OUT_JSONL = join(OUT_DIR, `pilot-rows${SHARD}.jsonl`);
const TEXTS_JSONL = join(OUT_DIR, `texts${SHARD}.private.jsonl`);
const LOG = join(OUT_DIR, `run${SHARD}.log`);

const PRIVATE = join(ROOT, 'artifacts', 'rebaseline-2025', 'private');

// Pre-registered pilot size (per arm). The env overrides exist ONLY so the same
// code path can be smoke-tested before the recorded run; any deviation is logged.
const N_AI = Number(process.env.PILOT_N_AI ?? 8);
const N_HUMAN = Number(process.env.PILOT_N_HUMAN ?? 8);

/** Snippet length for the length manipulation, matched to the ko/en intake median. */
const SNIPPET_CHARS = 450;

/**
 * Truncate to ~SNIPPET_CHARS at a sentence boundary. An excerpt of human writing
 * is still human writing, so this is a within-item LENGTH manipulation: Arm B
 * judges the very same documents as Arm A, only shorter. Comparing agreement
 * across A and B therefore isolates stimulus length from corpus/topic/register.
 */
function toSnippet(text, chars = SNIPPET_CHARS) {
  if (text.length <= chars) return text.trim();
  const slice = text.slice(0, Math.floor(chars * 1.3));
  const bounds = [...slice.matchAll(/[.!?。！？]["')\]]?\s|\n\n/g)].map((m) => m.index + m[0].length);
  // Land as close to `chars` as possible: the last boundary at or before the
  // target, else the first one after it, else a hard cut.
  const before = bounds.filter((b) => b <= chars).pop();
  const after = bounds.find((b) => b > chars);
  const cut = before ?? after ?? chars;
  return slice.slice(0, cut).trim();
}

/**
 * Three arms, per Deviation 1 of the pre-registration.
 *  A: en, document length, HAP-E — paired on prompt_id (topic+register controlled)
 *  B: en, SAME HAP-E items truncated — within-item stimulus-length moderator
 *  C: ko, snippet length, register-matched controls — read only through B's penalty
 */
const hape = () => readJsonl(join(PRIVATE, 'hape-en.private.jsonl'));
const ARMS = {
  A: {
    id: 'A', lang: 'en', stimulus: 'document', paired: true, transform: (t) => t,
    ai: () => hape().filter((r) => r.class === 'ai-like' && r.text),
    human: () => hape().filter((r) => r.class === 'natural-human' && r.text),
  },
  B: {
    id: 'B', lang: 'en', stimulus: 'snippet', paired: true, transform: toSnippet,
    ai: () => hape().filter((r) => r.class === 'ai-like' && r.text),
    human: () => hape().filter((r) => r.class === 'natural-human' && r.text),
  },
  C: {
    id: 'C', lang: 'ko', stimulus: 'snippet', paired: false, transform: (t) => t,
    ai: () => readJsonl(join(ROOT, 'artifacts', 'rebaseline-2025', 'intake.ko.local.jsonl')).filter((r) => r.class === 'ai-like' && r.text),
    human: () => readJsonl(join(PRIVATE, 'web-human-controls.generated.private.jsonl')).filter((r) => r.text && r.language === 'ko'),
  },
};
const SELECTED = (process.env.PILOT_ARMS ?? 'A,B,C').split(',').filter(Boolean);

const REWRITER = { backend: 'claude-cli', family: 'claude' };
const JUDGES = [
  { id: 'judge-gpt', family: 'gpt', cmd: 'codex', args: ['exec'] },
  { id: 'judge-gemini', family: 'gemini', cmd: 'gemini', args: [] },
];

const REWRITE_TIMEOUT_MS = 300_000;
const JUDGE_TIMEOUT_MS = 240_000;

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const log = (m) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};

/** Spawn a command, feed stdin, collect stdout. Never throws on non-zero — returns what it got. */
function run(cmd, args, { input = '', timeout = 120_000, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      resolve({ ok: false, stdout, stderr, error: `timeout after ${timeout}ms` });
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, error: String(e?.message ?? e) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

/** Deterministic round-robin pick across model families (no Math.random). */
function stratifiedPick(rows, n) {
  const byFamily = new Map();
  for (const r of rows) {
    const k = r.model_family || 'unknown';
    if (!byFamily.has(k)) byFamily.set(k, []);
    byFamily.get(k).push(r);
  }
  const families = [...byFamily.keys()].sort();
  const picked = [];
  let guard = 0;
  while (picked.length < n && families.length && guard < n * 20) {
    for (const fam of families) {
      if (picked.length >= n) break;
      const pool = byFamily.get(fam);
      if (pool.length) picked.push(pool.shift());
    }
    guard += 1;
  }
  return picked.slice(0, n);
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Rewrite through the SHIPPING CLI path. `--format text` keeps stdout to the
 * rewritten prose; patina still prints a small YAML tone block after a `---`
 * separator, which we strip.
 */
async function patinaRewrite(text, lang) {
  // NOT --quiet: the persona safety gate reports on stderr, and exit code 4 means
  // "rewrite emitted, but the meaning-safety gate (MPS / fidelity / dropped
  // numbers) failed" — see src/cli/run.js. Treating 4 as a failure would silently
  // DISCARD exactly the meaning-drift cases, biasing RQ5a's pass rate toward 100%.
  // We keep the text and record the gate verdict instead.
  const res = await run('node', [
    'bin/patina.js', '--lang', lang, '--backend', REWRITER.backend,
    '--format', 'text', '--no-interactive',
  ], { input: text, timeout: REWRITE_TIMEOUT_MS });

  const GATE_FAILED_EXIT = 4;
  const gateFailed = res.code === GATE_FAILED_EXIT;
  const usable = res.ok || gateFailed;
  if (!usable) return { text: null, error: res.error || res.stderr.slice(0, 300) || `exit ${res.code}`, gate_failed: null, gate_reason: null };

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

/**
 * Judge prompt. The two sub-tasks stay SEPARATE (pre-reg control #3) so
 * self-preference/perplexity bias shows up as an authorship↔score divergence
 * rather than contaminating the efficacy signal.
 */
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

function parseJudge(raw) {
  if (!raw) return null;
  const matches = String(raw).match(/\{[^{}]*"ai_likeness"[^{}]*\}/g);
  const candidate = matches ? matches[matches.length - 1] : null;
  if (!candidate) return null;
  try {
    const o = JSON.parse(candidate);
    const score = Number(o.ai_likeness);
    const authorship = String(o.authorship || '').toLowerCase();
    if (!Number.isFinite(score)) return null;
    if (authorship !== 'human' && authorship !== 'ai') return null;
    return {
      authorship,
      ai_likeness: Math.max(0, Math.min(100, Math.round(score))),
      strongest_cue: String(o.strongest_cue || '').slice(0, 200),
    };
  } catch { return null; }
}

/** patina's own deterministic score — sanity axis ONLY. */
function internalScore(text, lang) {
  try {
    const r = scoreText(text, { lang, repoRoot: ROOT });
    return {
      score: r.score ?? null, // hot-paragraph ratio ×100 (the gate metric)
      floored_score: r.flooredScore ?? null, // ranking metric
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

async function judgeText(text, lang) {
  const out = {};
  for (const judge of JUDGES) {
    const res = await run(judge.cmd, judge.args, { input: judgePrompt(text, lang), timeout: JUDGE_TIMEOUT_MS });
    const parsed = parseJudge(res.stdout);
    out[judge.id] = parsed || {
      error: res.error || 'unparseable',
      raw_head: String(res.stdout).slice(0, 160),
    };
  }
  return out;
}

/**
 * Build the unit list for one arm.
 * Paired arms (A/B) select AI items first, then pull the human item that shares
 * the same `prompt_id`, so every AI text has a topic- and register-matched human
 * counterpart. Arm C cannot pair, so it register-matches the control pool.
 */
function buildUnits(arm) {
  const aiRows = arm.ai();
  const humanRows = arm.human();
  const notes = [];

  if (arm.paired) {
    const humanByPrompt = new Map(humanRows.map((r) => [r.prompt_id, r]));
    const pairableAi = aiRows.filter((r) => humanByPrompt.has(r.prompt_id));
    // Deterministic spread across registers rather than the file's head order.
    const byRegister = new Map();
    for (const r of pairableAi) {
      const k = r.register || 'unknown';
      if (!byRegister.has(k)) byRegister.set(k, []);
      byRegister.get(k).push(r);
    }
    const registers = [...byRegister.keys()].sort();
    const picked = [];
    let guard = 0;
    while (picked.length < N_AI && guard < N_AI * 20) {
      for (const reg of registers) {
        if (picked.length >= N_AI) break;
        const pool = byRegister.get(reg);
        if (pool.length) picked.push(pool.shift());
      }
      guard += 1;
    }
    const units = [];
    for (const aiRow of picked) {
      units.push({ ...aiRow, source_class: 'ai', pair_id: aiRow.prompt_id });
      const h = humanByPrompt.get(aiRow.prompt_id);
      if (h) units.push({ ...h, source_class: 'human', pair_id: aiRow.prompt_id });
    }
    notes.push(`paired on prompt_id: ${picked.length} pairs (of ${pairableAi.length} pairable)`);
    return { units, notes };
  }

  const ai = stratifiedPick(aiRows, N_AI);
  // Register-match the control pool to the AI registers actually sampled.
  const wantRegisters = new Set(ai.map((r) => r.register).filter(Boolean));
  const matched = humanRows.filter((r) => wantRegisters.has(r.register));
  const human = stratifiedPick(matched.length >= N_HUMAN ? matched : humanRows, N_HUMAN);
  notes.push(`unpaired; register-matched controls from ${matched.length} candidates`);
  return {
    units: [
      ...ai.map((r) => ({ ...r, source_class: 'ai', pair_id: null })),
      ...human.map((r) => ({ ...r, source_class: 'human', pair_id: null })),
    ],
    notes,
  };
}

async function runArm(arm) {
  const { units, notes } = buildUnits(arm);
  const aiN = units.filter((u) => u.source_class === 'ai').length;
  const humanN = units.filter((u) => u.source_class === 'human').length;
  log(`arm ${arm.id} (${arm.lang}/${arm.stimulus}): ${aiN} ai + ${humanN} human — ${notes.join('; ')}`);
  if (aiN < N_AI) log(`WARN arm ${arm.id}: AI cell ${aiN} < pre-registered ${N_AI}`);
  if (humanN < N_HUMAN) log(`WARN arm ${arm.id}: human cell ${humanN} < pre-registered ${N_HUMAN}`);

  for (const [idx, unit] of units.entries()) {
    const original = arm.transform(unit.text);
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
      // RQ5a: the persona safety gate (MPS / fidelity / dropped numbers).
      // A failed gate still emits usable text — recorded, never discarded.
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

    const jo = judgedOriginal['judge-gpt']?.ai_likeness;
    const jr = judgedRewrite?.['judge-gpt']?.ai_likeness;
    log(`${label}: done (gpt-judge ${jo ?? '?'} -> ${jr ?? '?'})`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(OUT_JSONL) || process.env.PILOT_FRESH !== '0') {
    writeFileSync(OUT_JSONL, '');
    writeFileSync(TEXTS_JSONL, '');
    writeFileSync(LOG, '');
  }
  log(`pilot start — rewriter=${REWRITER.backend} judges=${JUDGES.map((j) => j.id).join(',')}`);
  log(`config — arms=${SELECTED.join(',')} n_ai=${N_AI} n_human=${N_HUMAN} snippet=${SNIPPET_CHARS}ch`);

  for (const id of SELECTED) {
    const arm = ARMS[id];
    if (!arm) { log(`WARN unknown arm ${id}, skipped`); continue; }
    await runArm(arm);
  }
  log('pilot complete');
}

main().catch((e) => { log(`FATAL ${e?.stack ?? e}`); process.exit(1); });
