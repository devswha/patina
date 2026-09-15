// H-RHETORIC §7.B single-variable pilot runner (PLAN.md v2 §7.B; decision
// record docs/research/2026-09-15-rhetoric-confirmation-decision.md).
//
// 24 unique sources (KO 16 T8/C4/N4, EN 8 T4/C2/N2) × arms:
//   N0 = source unchanged (no call)
//   G  = generic polish prompt, same generation model, direct `claude -p`
//   P  = current-dev prompt with PATINA_RHETORIC_POLICY=legacy, REAL patina
//        CLI first draft (no --verify, no retries)
//   H  = patina CLI default (H-RHETORIC), first draft
// Judges: two non-claude families from study4-common JUDGE_DEFS
// (judge-gpt via codex exec; judge-gemini-3.7-flash via the HTTP CLI).
// Comparisons per case: H/P, H/G, H/N0, P/G × 2 judges = 192, plus 24
// pre-registered A/B flips (one cell per case) = 216 judge calls.
// A/B order and flip cells are fixed by deterministic formulas BEFORE any
// call (see orderSwap()/flipCell()); no data-dependent choices.
// Refusals/timeouts are recorded, never retried to success. A judge response
// that fails JSON parsing gets at most ONE re-ask (transport repair, logged).
//
// Raw texts stay in artifacts/rhetoric-pilot-20260916/ (gitignored).
// Usage: node scripts/research/rhetoric-pilot-7b.mjs [gen|judge|all] [limit]

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { JUDGE_DEFS } from './study4-common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'artifacts', 'rhetoric-pilot-20260916');
const SRC = join(DIR, 'sources.private.jsonl');
const GEN = join(DIR, 'gen-rows.jsonl');
const JUD = join(DIR, 'judge-rows.jsonl');
const LOG = join(DIR, 'run.log');

const MODEL = 'claude-sonnet-4-6';
const GEN_TIMEOUT = 240_000;
const JUDGE_TIMEOUT = 240_000;
const JUDGES = ['judge-gpt', 'judge-gemini-3.7-flash'];
const COMPS = [['H', 'P'], ['H', 'G'], ['H', 'N0'], ['P', 'G']];

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); appendFileSync(LOG, line + '\n'); };
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

function runCmd(cmd, args, { input, timeout, env, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: cwd || ROOT, env: { ...process.env, ...(env || {}) } });
    let stdout = '', stderr = '', done = false;
    const finish = (res) => { if (!done) { done = true; resolve(res); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } finish({ ok: false, stdout, stderr, error: 'timeout' }); }, timeout || 180_000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, stdout, stderr, error: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, code, stdout, stderr, error: code === 0 ? null : `exit ${code}` }); });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

// --- generation -------------------------------------------------------------
const genericPrompt = (lang, text) => lang === 'ko'
  ? `다음 글을 자연스럽게 다듬어 주세요. 의미를 바꾸지 마세요. 다듬은 글만 출력하세요.\n\n${text}`
  : `Please polish the following text so it reads naturally. Do not change its meaning. Output only the polished text.\n\n${text}`;

async function claudeRaw(prompt) {
  const dir = mkdtempSync(join(tmpdir(), 'rhet7b-claude-'));
  try {
    const res = await runCmd('claude', ['-p', '--model', MODEL], { input: prompt, timeout: GEN_TIMEOUT, cwd: dir });
    if (!res.ok) return { text: null, error: res.error || res.stderr.slice(0, 300) || `exit ${res.code}` };
    let out = String(res.stdout).trim();
    const fence = out.match(/^```[a-z]*\n([\s\S]*)\n```$/);
    if (fence) out = fence[1].trim();
    return out ? { text: out, error: null } : { text: null, error: 'empty output' };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }
}

async function patinaDraft(text, lang, policyEnv) {
  const res = await runCmd('node', [join(ROOT, 'bin', 'patina.js'), '--model', MODEL, '--lang', lang, '--format', 'text', '--quiet'],
    { input: text, timeout: GEN_TIMEOUT, env: policyEnv ? { PATINA_RHETORIC_POLICY: policyEnv } : {} });
  const out = String(res.stdout).trim();
  // Exit 4 = the CLI's deterministic meaning-safety gate rejected the draft
  // (e.g. dropped-numbers) but still prints the candidate for review. That is
  // a first-class §7.B observation: keep the draft, flag the gate failure.
  if (!res.ok && res.code === 4 && out) return { text: out, error: null, meaningSafety: 'failed' };
  if (!res.ok) return { text: null, error: res.error || res.stderr.slice(0, 300) };
  return out ? { text: out, error: null, meaningSafety: 'passed' } : { text: null, error: 'empty output' };
}

async function genPhase(cases, limit) {
  const have = new Set(readJsonl(GEN).filter((r) => r.ok).map((r) => `${r.case_id}|${r.arm}`));
  let n = 0;
  for (const c of cases) {
    for (const arm of ['G', 'P', 'H']) {
      const key = `${c.id}|${arm}`;
      if (have.has(key)) continue;
      if (n >= limit) return;
      n += 1;
      const t0 = Date.now();
      let out;
      if (arm === 'G') out = await claudeRaw(genericPrompt(c.lang, c.text));
      else out = await patinaDraft(c.text, c.lang, arm === 'P' ? 'legacy' : null);
      const row = { case_id: c.id, arm, ok: !!out.text, meaning_safety: out.meaningSafety ?? null, model: MODEL, ms: Date.now() - t0,
        out_sha: out.text ? sha(out.text) : null, out_chars: out.text ? out.text.length : null,
        text: out.text ?? null, error: out.error ?? null, at: new Date().toISOString() };
      appendFileSync(GEN, JSON.stringify(row) + '\n');
      log(`gen ${key} ${row.ok ? 'ok' : 'FAIL ' + row.error} ${row.ms}ms`);
    }
  }
}

// --- judging ----------------------------------------------------------------
// Pre-registered order assignment: swap A/B when (caseIdx+compIdx+judgeIdx) is
// odd — balanced by construction across the fixed enumeration order.
const orderSwap = (ci, pi, ji) => (ci + pi + ji) % 2 === 1;
// Pre-registered flip cell per case: comparison caseIdx%4, judge caseIdx%2.
const flipCell = (ci) => ({ pi: ci % 4, ji: ci % 2 });

function judgePrompt(c, aText, bText) {
  const lang = c.lang === 'ko' ? 'Korean' : 'English';
  return [
    'You are comparing two rewrites of the same source passage. Judge only from the texts given.',
    `Language: ${lang}. Document purpose: ${c.purpose}.`,
    'Definitions:',
    '- "empty hype": decorative exaggeration/cliché that adds no information for the stated purpose.',
    '- "needed rhetoric": quoted wording, attributed evaluations, technical terms, warnings, or intensity that carries information — removing or weakening it is damage.',
    'Evaluate which version better serves the stated purpose while preserving the source meaning (numbers, entities, conditions, causation, attribution, modality).',
    'Answer with EXACTLY one JSON object, no markdown, no extra text:',
    '{"winner":"A"|"B"|"tie","meaning_damage_A":true|false,"meaning_damage_B":true|false,"removed_empty_hype_A":true|false,"removed_empty_hype_B":true|false,"lost_needed_rhetoric_A":true|false,"lost_needed_rhetoric_B":true|false,"over_deletion_A":true|false,"over_deletion_B":true|false,"note":"<one short sentence>"}',
    '',
    `SOURCE:\n${c.text}`,
    '',
    `VERSION A:\n${aText}`,
    '',
    `VERSION B:\n${bText}`,
  ].join('\n');
}

function parseJudge(stdout) {
  const s = String(stdout);
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  for (const cand of [m[0], m[0].replace(/,\s*\}/, '}')]) {
    try {
      const j = JSON.parse(cand);
      if (j && ['A', 'B', 'tie'].includes(j.winner)) return j;
    } catch { /* try next */ }
  }
  return null;
}

async function judgeOneTask(c, arms, pi, ji, flipped) {
  const judge = JUDGE_DEFS[JUDGES[ji]];
  const [x, y] = COMPS[pi];
  let a = x, b = y;
  const swap = orderSwap(c.idx, pi, ji) !== flipped; // flip reverses the assigned order
  if (swap) { a = y; b = x; }
  const prompt = judgePrompt(c, arms[a], arms[b]);
  let parsed = null, error = null, retried = false, raw = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await runCmd(judge.cmd, judge.args, { input: prompt, timeout: JUDGE_TIMEOUT, env: judge.env ?? {} });
    parsed = parseJudge(res.stdout);
    raw = String(res.stdout).slice(-200);
    if (parsed) { retried = attempt > 1; error = null; break; }
    error = res.error || 'unparseable';
    if (error === 'timeout') break; // never retry timeouts to success
  }
  return { case_id: c.id, comp: `${x}/${y}`, judge: JUDGES[ji], order: `${a}-${b}`, flipped,
    ...(parsed ? { parsed, retried } : { error, raw_tail: raw }), at: new Date().toISOString() };
}

async function judgePhase(cases, limit) {
  const genRows = readJsonl(GEN).filter((r) => r.ok);
  const byCase = {};
  for (const r of genRows) { (byCase[r.case_id] ??= {})[r.arm] = r.text; }
  const have = new Set(readJsonl(JUD).filter((r) => r.parsed).map((r) => `${r.case_id}|${r.comp}|${r.judge}|${r.flipped}`));
  let n = 0;
  for (const c of cases) {
    const arms = { N0: c.text, ...(byCase[c.id] || {}) };
    if (!arms.G || !arms.P || !arms.H) { log(`judge skip ${c.id}: incomplete arms`); continue; }
    for (let pi = 0; pi < COMPS.length; pi += 1) {
      for (let ji = 0; ji < JUDGES.length; ji += 1) {
        const tasks = [{ flipped: false }];
        const f = flipCell(c.idx);
        if (f.pi === pi && f.ji === ji) tasks.push({ flipped: true });
        for (const t of tasks) {
          const key = `${c.id}|${COMPS[pi][0]}/${COMPS[pi][1]}|${JUDGES[ji]}|${t.flipped}`;
          if (have.has(key)) continue;
          if (n >= limit) return;
          n += 1;
          const row = await judgeOneTask(c, arms, pi, ji, t.flipped);
          appendFileSync(JUD, JSON.stringify(row) + '\n');
          log(`judge ${key} ${row.parsed ? 'ok ' + row.parsed.winner : 'FAIL ' + row.error}`);
        }
      }
    }
  }
}

// --- main -------------------------------------------------------------------
const mode = process.argv[2] || 'all';
const limit = Number(process.argv[3] || Infinity);
const cases = readJsonl(SRC).map((c, idx) => ({ ...c, idx }));
if (cases.length !== 24) { log(`FATAL: expected 24 cases, got ${cases.length}`); process.exit(1); }
log(`pilot start mode=${mode} limit=${limit} model=${MODEL} judges=${JUDGES.join(',')}`);
if (mode === 'gen' || mode === 'all') await genPhase(cases, limit);
if (mode === 'judge' || mode === 'all') await judgePhase(cases, limit);
log('pilot phase complete');
