// Study 2 runner — ko-doc-structure pack intervention (pre-registration:
// docs/research/2026-rewrite-efficacy-prereg.md, "Study 2" section).
//
// Re-rewrites the SAME Study 1 Arm-D documents with the ko-doc-structure pro
// pack installed (custom/patterns/ — the shipping `patina pack` destination),
// then judges only the NEW rewrites with the same fixed 3-judge panel.
// Study 1's original-condition ratings are reused as the shared baseline at
// analysis time, so this run never re-judges originals.
//
// Fails fast unless the intervention is actually present, and records the
// pack's sha256 in every row for provenance.
//
// Usage: node scripts/research/rewrite-efficacy-study2.mjs

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreText } from '../prose-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S1_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const OUT_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study2');
const OUT_JSONL = join(OUT_DIR, 's2-rows-D2.jsonl');
const TEXTS_JSONL = join(OUT_DIR, 's2-texts-D2.private.jsonl');
const LOG = join(OUT_DIR, 's2-run.log');
const PACK_PATH = join(ROOT, 'custom', 'patterns', 'ko-doc-structure.md');

const REWRITER = { backend: 'claude-cli', family: 'claude' };
const KIMI_ARGS = ['--print', '--input-format', 'text', '--output-format', 'text',
  '--final-message-only', '--no-thinking', '--max-steps-per-turn', '20'];
const CODEX_ARGS = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only'];
const JUDGES = [
  { id: 'judge-kimi', family: 'moonshot', cmd: 'kimi', args: KIMI_ARGS },
  { id: 'judge-gpt', family: 'gpt', cmd: 'codex', args: CODEX_ARGS },
  { id: 'judge-grok', family: 'xai', cmd: 'node', args: [join('scripts', 'research', 'xai-cli.mjs')] },
];

// Study 1 learned 300s times out on 13/54 ko docs; start at the top-up value.
const REWRITE_TIMEOUT_MS = 600_000;
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

/** S1 D-arm text store, TOPUP-deduped by original_sha (last write wins). */
function loadS1Texts() {
  const byKey = new Map();
  for (const f of readdirSync(S1_DIR).filter((x) => /^s1-texts(-.*)?\.private\.jsonl$/.test(x))) {
    for (const t of readJsonl(join(S1_DIR, f))) if (t.arm === 'D') byKey.set(t.original_sha, t);
  }
  return byKey;
}

async function patinaRewrite(text, lang) {
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
  return { text: body, error: null, gate_failed: gateFailed, gate_reason: gateReason };
}

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
  // Intervention gate: refuse to record anything unless the pack is present.
  if (!existsSync(PACK_PATH)) {
    console.error(`FATAL: intervention missing — ${PACK_PATH} not installed. Run patina pack install ko-doc-structure first.`);
    process.exit(1);
  }
  const packSha = sha(readFileSync(PACK_PATH, 'utf8'));
  mkdirSync(OUT_DIR, { recursive: true });
  if (!existsSync(LOG)) writeFileSync(LOG, '');

  const s1Rows = readJsonl(join(S1_DIR, 's1-rows-D.jsonl'));
  const texts = loadS1Texts();
  log(`study2 start — intervention pack sha ${packSha}; ${s1Rows.length} S1 D-arm rows; rewriter=${REWRITER.backend}`);

  const done = new Set(readJsonl(OUT_JSONL).map((r) => r.original_sha));

  for (const [idx, s1] of s1Rows.entries()) {
    if (done.has(s1.original_sha)) continue; // resume
    const stored = texts.get(s1.original_sha);
    if (!stored?.original) { log(`WARN no stored original for ${s1.original_sha}`); continue; }
    const label = `D2/${s1.source_class}/${idx + 1}`;

    log(`${label}: rewriting with pack (${stored.original.length} chars)…`);
    const rw = await patinaRewrite(stored.original, 'ko');
    if (rw.error) log(`${label}: REWRITE FAILED — ${rw.error}`);
    if (rw.gate_failed) log(`${label}: SAFETY GATE FAILED (text kept) — ${rw.gate_reason}`);

    let judged = null;
    if (rw.text) {
      log(`${label}: judging rewrite…`);
      judged = {};
      for (const judge of JUDGES) judged[judge.id] = await judgeOnce(judge, rw.text);
    }

    const row = {
      arm: 'D2',
      pack_sha: packSha,
      source_class: s1.source_class,
      pair_id: s1.pair_id,
      model_family: s1.model_family,
      register: s1.register,
      rewriter: REWRITER.backend,
      original_sha: s1.original_sha,
      rewrite2_sha: rw.text ? sha(rw.text) : null,
      original_chars: stored.original.length,
      rewrite2_chars: rw.text ? rw.text.length : null,
      rewrite_error: rw.error,
      gate_failed: rw.gate_failed ?? null,
      gate_reason: rw.gate_reason ?? null,
      internal_rewrite2: rw.text ? internalScore(rw.text) : null,
      judges_rewrite2: judged,
    };
    appendFileSync(OUT_JSONL, JSON.stringify(row) + '\n');
    appendFileSync(TEXTS_JSONL, JSON.stringify({
      original_sha: s1.original_sha, rewrite2_sha: row.rewrite2_sha,
      source_class: s1.source_class, original: stored.original, rewritten2: rw.text,
    }) + '\n');

    const summary = JUDGES.map((j) => `${j.id.replace('judge-', '')} ${judged?.[j.id]?.ai_likeness ?? '?'}`).join(' ');
    log(`${label}: done (${summary})`);
  }
  log('study2 complete');
}

main().catch((e) => { log(`FATAL ${e?.stack ?? e}`); process.exit(1); });
