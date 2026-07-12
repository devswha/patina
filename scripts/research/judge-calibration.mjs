// Judge-calibration side study (pre-registration:
// docs/research/2026-judge-calibration-prereg.md, registered 2026-07-13
// before any data). Fully separated from Study 3.
//
// Subcommands:
//   node scripts/research/judge-calibration.mjs collect      # human side (network only)
//   node scripts/research/judge-calibration.mjs generate     # AI side (gpt/kimi/grok, NO claude)
//   node scripts/research/judge-calibration.mjs judge        # main pass + stability block (resumable)
//   node scripts/research/judge-calibration.mjs deterministic
//   node scripts/research/judge-calibration.mjs analyze
//
// Raw text stays gitignored under artifacts/judge-calibration-2026/.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractTextCandidates } from '../rebaseline-web-collect.mjs';
import { scoreText } from '../prose-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'artifacts', 'judge-calibration-2026');
const SOURCES = join(DIR, 'sources.jsonl');
const HUMAN = join(DIR, 'jc-human.private.jsonl');
const AI = join(DIR, 'jc-ai.private.jsonl');
const JUDGMENTS = join(DIR, 'jc-judgments.jsonl');
const DET = join(DIR, 'jc-deterministic.jsonl');
const LOG = join(DIR, 'jc-run.log');

const SEED = 20260713;
const CODEX = join(process.env.HOME || '', '.nvm', 'versions', 'node', 'v22.17.1', 'bin', 'codex');
const KIMI_ARGS = ['--print', '--input-format', 'text', '--output-format', 'text',
  '--final-message-only', '--no-thinking', '--max-steps-per-turn', '20'];
const CODEX_ARGS = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only'];
const JUDGES = [
  { id: 'judge-kimi', family: 'moonshot-family', cmd: 'kimi', args: KIMI_ARGS },
  { id: 'judge-gpt', family: 'gpt-family', cmd: CODEX, args: CODEX_ARGS },
  { id: 'judge-grok', family: 'xai-family', cmd: 'node', args: [join('scripts', 'research', 'xai-cli.mjs')] },
];
const JUDGE_TIMEOUT_MS = 120_000;
const JUDGE_ATTEMPTS = 3;
const CALL_SPACING_MS = 15_000;

// Corpus shape — S1 Arm-D document filter.
const MIN_PARAS = 3;
const MIN_CHARS = 1200;
const MAX_CHARS = 4000;
const PARA_MIN = 60;
const PARA_MAX = 2000;
const HUMAN_CAP = 20;
const AI_TARGET = 24;
const GEN_ROTATION = ['gpt-family', 'moonshot-family', 'xai-family'];
const GEN_FAMILIES = {
  'gpt-family': { provider: 'codex-cli', model: 'gpt-5.5' },
  'moonshot-family': { provider: 'kimi-cli', model: 'kimi-k2.5' },
  'xai-family': { provider: 'xai-api', model: process.env.XAI_MODEL || 'grok-4.5' },
};
const REGISTER_DESC = {
  blog: '기술 회사 블로그에 올릴 에세이 형식의 글',
  'academic-summary': '연구·정책 동향을 요약하는 보고서 형식의 글',
  'product-doc': '개발자를 위한 제품 문서·안내 형식의 글',
  'chat-update': '정책·사업 소식을 전하는 보도자료 형식의 글',
  'technical-how-to': '기술 개념이나 방법을 설명하는 해설 형식의 글',
};

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG, line + '\n');
};

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function run(cmd, args, { input = '', timeout = 120_000, cwd = ROOT } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise(v); } };
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

function lcg(seed = SEED) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------------------
// leakage audit — sha16 + URL exclusion sets

function exclusionSets() {
  const shas = new Set();
  const urls = new Set();
  const addTexts = (dir, re, textKeys, urlKey) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((x) => re.test(x))) {
      for (const r of readJsonl(join(dir, f))) {
        for (const k of textKeys) if (typeof r[k] === 'string' && r[k]) shas.add(sha(r[k]));
        if (r.text_hash) shas.add(r.text_hash);
        if (urlKey && r[urlKey]) urls.add(r[urlKey]);
        if (r.source_url) urls.add(r.source_url);
        if (r.url) urls.add(r.url);
      }
    }
  };
  addTexts(join(ROOT, 'artifacts', 'rewrite-efficacy-study1'), /\.private\.jsonl$/, ['text', 'original', 'rewritten']);
  addTexts(join(ROOT, 'artifacts', 'rewrite-efficacy-study2'), /\.private\.jsonl$/, ['original', 'rewritten2']);
  addTexts(join(ROOT, 'artifacts', 'rewrite-efficacy-study3'), /\.private\.jsonl$/, ['original', 'plan', 'rewritten3']);
  addTexts(join(ROOT, 'artifacts', 'rewrite-efficacy-pilot'), /\.jsonl$/, ['text', 'original', 'rewritten']);
  addTexts(join(ROOT, 'artifacts', 'rebaseline-2025'), /\.jsonl$/, ['text']);
  addTexts(join(ROOT, 'artifacts', 'rebaseline-2025', 'private'), /\.jsonl$/, ['text']);
  const kat = join(ROOT, 'artifacts', 'rebaseline-2025', 'private', 'katfish');
  if (existsSync(kat)) addTexts(kat, /\.jsonl$/, ['text', 'content', 'document']);
  // suspect-zones fixtures (whole-file text)
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) shas.add(sha(readFileSync(p, 'utf8')));
    }
  };
  const sz = join(ROOT, 'tests', 'fixtures', 'suspect-zones');
  if (existsSync(sz)) walk(sz);
  return { shas, urls };
}

// ---------------------------------------------------------------------------
// collect

async function collect() {
  const sources = readJsonl(SOURCES);
  const { shas, urls } = exclusionSets();
  log(`collect: ${sources.length} candidate sources; exclusion sets ${shas.size} shas / ${urls.size} urls`);
  const existing = new Set(readJsonl(HUMAN).map((r) => r.source_url));
  let kept = readJsonl(HUMAN).length;
  for (const src of sources) {
    if (kept >= HUMAN_CAP) break;
    if (existing.has(src.url)) continue;
    if (urls.has(src.url)) { log(`excluded (url leak): ${src.source_id}`); continue; }
    try {
      const res = await fetch(src.url, {
        headers: {
          'user-agent': 'patina-rebaseline-corpus-builder/1.0 (+https://github.com/devswha/patina)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) { log(`skip ${src.source_id}: HTTP ${res.status}`); continue; }
      const html = await res.text();
      const paras = extractTextCandidates(html, { language: 'ko', minChars: PARA_MIN, maxChars: PARA_MAX });
      const keptParas = [];
      let total = 0;
      for (const p of paras) {
        if (total + p.length > MAX_CHARS) break;
        keptParas.push(p);
        total += p.length + 2;
      }
      if (keptParas.length < MIN_PARAS || total < MIN_CHARS) { log(`thin ${src.source_id}: ${total}ch/${keptParas.length}p`); continue; }
      const doc = keptParas.join('\n\n');
      const h = sha(doc);
      if (shas.has(h)) { log(`excluded (sha leak): ${src.source_id}`); continue; }
      appendFileSync(HUMAN, JSON.stringify({
        sample_id: `jc-human-${src.source_id}`,
        language: 'ko', class: 'natural-human', register: src.register,
        source_url: src.url, source_title: src.source_title, source_license: src.source_license,
        collected_at: new Date().toISOString().slice(0, 10),
        paragraphs: keptParas.length, chars: doc.length, text_hash: h, text: doc,
      }) + '\n');
      kept += 1;
      log(`ok ${src.source_id} [${src.register}] ${doc.length}ch ${keptParas.length}p (${kept}/${HUMAN_CAP})`);
    } catch (e) {
      log(`err ${src.source_id}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    await sleep(400);
  }
  log(`collect done: ${kept} human docs (floor 12, target 20)`);
}

// ---------------------------------------------------------------------------
// generate (NO claude — Study 3 owns it)

function genPrompt(title, register, minCh, maxCh) {
  return [
    `다음 제목으로 ${REGISTER_DESC[register] ?? '글'}을 한국어로 작성하세요.`,
    '',
    `제목: ${title}`,
    '',
    `조건:`,
    `- 분량은 공백 포함 ${minCh}자 이상 ${maxCh}자 이하 — 반드시 ${minCh}자를 넘겨야 하며, 짧으면 실패로 처리됩니다. 각 문단을 충분히 상세하게 전개하세요.`,
    '- 최소 4개 문단, 문단 사이는 빈 줄로 구분',
    '- 제목이나 헤딩 없이 본문만 출력',
    '- 마크다운 문법(#, *, - 목록 등) 없이 일반 산문으로',
    '- 설명이나 인사 없이 곧바로 본문 시작',
  ].join('\n');
}

function cleanBody(raw) {
  let t = String(raw).replace(/\r/g, '').trim();
  t = t.replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/, '');
  t = t.split('\n').filter((line) => !/^#{1,4}\s/.test(line)).join('\n');
  t = t.replace(/\n?To resume this session:.*$/s, '');
  return t.trim();
}
const paraCount = (t) => t.split(/\n\s*\n/).filter((p) => p.trim()).length;

async function invokeGen(family, prompt) {
  const cfg = GEN_FAMILIES[family];
  if (cfg.provider === 'codex-cli') {
    const dir = mkdtempSync(resolve(tmpdir(), 'patina-jc-codex-'));
    const outFile = resolve(dir, 'last-message.txt');
    const res = await run(CODEX, [
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir,
      '-m', cfg.model, '--output-last-message', outFile,
    ], { input: prompt, cwd: dir, timeout: 8 * 60 * 1000 });
    const text = existsSync(outFile) ? readFileSync(outFile, 'utf8') : res.stdout;
    rmSync(dir, { recursive: true, force: true });
    if (!res.ok && !text.trim()) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text };
  }
  if (cfg.provider === 'kimi-cli') {
    const res = await run('kimi', KIMI_ARGS, { input: prompt, timeout: 8 * 60 * 1000 });
    if (!res.ok) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text: res.stdout };
  }
  if (cfg.provider === 'xai-api') {
    const res = await run('node', [join('scripts', 'research', 'xai-cli.mjs')], { input: prompt, timeout: 8 * 60 * 1000 });
    if (!res.ok) return { error: res.error || res.stderr.slice(-300) || `exit ${res.code}` };
    return { text: res.stdout };
  }
  return { error: `unknown provider ${cfg.provider}` };
}

async function generate() {
  const humans = readJsonl(HUMAN).sort((a, b) => a.sample_id.localeCompare(b.sample_id));
  if (humans.length < 12) { log(`generate: only ${humans.length} human docs (< floor 12) — collect more first`); process.exit(1); }
  const done = new Set(readJsonl(AI).map((r) => r.sample_id));
  for (let i = 0; i < AI_TARGET; i += 1) {
    const h = humans[i % humans.length];
    const family = GEN_ROTATION[i % GEN_ROTATION.length];
    const suffix = i >= humans.length ? `-r${Math.floor(i / humans.length)}` : '';
    const sampleId = h.sample_id.replace('jc-human-', 'jc-ai-') + suffix;
    if (done.has(sampleId)) continue;
    const minCh = Math.max(1200, Math.round(h.chars * 0.75));
    const maxCh = Math.min(4000, Math.round(h.chars * 1.25));
    log(`${sampleId} [${family}] target ${minCh}-${maxCh}ch…`);
    const inBand = (t) => t && t.length >= minCh && paraCount(t) >= 3;
    let text = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const nudge = attempt === 1 ? '' :
        `\n\n(이전 응답이 ${text ? text.length : 0}자로 최소 분량 ${minCh}자에 미달했습니다. 각 문단을 더 상세히 전개해 ${minCh}자 이상으로 다시 작성하세요.)`;
      const out = await invokeGen(family, genPrompt(h.source_title, h.register, minCh, maxCh) + nudge);
      lastError = out.error ?? null;
      const t = out.text ? cleanBody(out.text) : null;
      if (t && (!text || t.length > text.length)) text = t;
      if (inBand(text)) break;
      if (out.error) log(`  attempt ${attempt} error: ${out.error}`);
    }
    if (!text) { log(`  FAILED: ${lastError ?? 'empty'}`); continue; }
    appendFileSync(AI, JSON.stringify({
      sample_id: sampleId, language: 'ko', class: 'ai-like', register: h.register,
      model_family: family, provider: GEN_FAMILIES[family].provider, model: GEN_FAMILIES[family].model,
      pair_id: h.sample_id, source_title: h.source_title,
      generated_at: new Date().toISOString().slice(0, 10),
      target_chars: [minCh, maxCh], band_met: inBand(text),
      paragraphs: paraCount(text), chars: text.length, text_hash: sha(text), text,
    }) + '\n');
    log(`  ok ${text.length}ch ${paraCount(text)}p`);
    await sleep(CALL_SPACING_MS);
  }
  log(`generate done: ${readJsonl(AI).length} ai docs`);
}

// ---------------------------------------------------------------------------
// judge — byte-identical prompt/parse to the S2/S3 runners

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
      };
    } catch { /* next */ }
  }
  return null;
}

async function judgeOnce(judge, text) {
  const attempts = [];
  for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt += 1) {
    const res = await run(judge.cmd, judge.args, { input: judgePrompt(text), timeout: JUDGE_TIMEOUT_MS });
    const parsed = parseJudge(res.stdout);
    if (parsed) return attempt === 1 ? parsed : { ...parsed, retried: true };
    attempts.push(res.error || 'unparseable');
  }
  return { error: attempts.join(' | '), retries_exhausted: true };
}

function loadDocs() {
  const docs = [...readJsonl(HUMAN), ...readJsonl(AI)];
  // deterministic shuffle, seed 20260713
  const rnd = lcg(SEED);
  const keyed = docs.map((d) => ({ d, k: rnd() }));
  keyed.sort((a, b) => a.k - b.k);
  return keyed.map((x) => x.d);
}

function stabilityPicks(docs) {
  const ai = docs.filter((d) => d.class === 'ai-like').sort((a, b) => a.text_hash.localeCompare(b.text_hash)).slice(0, 3);
  const human = docs.filter((d) => d.class === 'natural-human').sort((a, b) => a.text_hash.localeCompare(b.text_hash)).slice(0, 2);
  return [...ai, ...human];
}

async function judge() {
  const docs = loadDocs();
  if (!docs.length) { log('judge: no docs'); process.exit(1); }
  const doneKeys = new Set(readJsonl(JUDGMENTS).map((r) => `${r.sample_id}:${r.judge}:${r.repeat}`));
  let consecutiveErrors = 0;
  const doCall = async (j, d, repeat) => {
    const key = `${d.sample_id}:${j.id}:${repeat}`;
    if (doneKeys.has(key)) return;
    const out = await judgeOnce(j, d.text);
    appendFileSync(JUDGMENTS, JSON.stringify({
      sample_id: d.sample_id, class: d.class, model_family: d.model_family ?? 'human-reference',
      register: d.register, judge: j.id, judge_family: j.family, repeat,
      ...out,
    }) + '\n');
    if (out.error) {
      consecutiveErrors += 1;
      log(`${key}: ERROR ${out.error}`);
      if (consecutiveErrors >= 3) { log('3 consecutive judge errors — backing off (resumable), exit 3'); process.exit(3); }
    } else {
      consecutiveErrors = 0;
      log(`${key}: ${out.authorship} ${out.ai_likeness}`);
    }
    await sleep(CALL_SPACING_MS);
  };
  // main pass
  for (const d of docs) for (const j of JUDGES) await doCall(j, d, 0);
  // stability block
  for (const d of stabilityPicks(docs)) {
    for (let repeat = 1; repeat <= 4; repeat += 1) for (const j of JUDGES) await doCall(j, d, repeat);
  }
  log('judge pass complete');
}

// ---------------------------------------------------------------------------
// deterministic

function deterministic() {
  const done = new Set(readJsonl(DET).map((r) => r.sample_id));
  for (const d of loadDocs()) {
    if (done.has(d.sample_id)) continue;
    let r;
    try {
      const s = scoreText(d.text, { lang: 'ko', repoRoot: ROOT });
      r = { score: s.score ?? null, signal_score: s.signalScore ?? null, hot_count: s.hotCount ?? null, paragraph_count: s.paragraphCount ?? null, pattern_hits: s.patternHits ?? null };
    } catch (e) {
      r = { error: String(e?.message ?? e).slice(0, 200) };
    }
    appendFileSync(DET, JSON.stringify({ sample_id: d.sample_id, class: d.class, ...r }) + '\n');
  }
  log(`deterministic done: ${readJsonl(DET).length} rows`);
}

// ---------------------------------------------------------------------------
// analyze — pre-registered metrics and verdicts

function cliffsDelta(xs, ys) {
  if (!xs.length || !ys.length) return null;
  let gt = 0; let lt = 0;
  for (const x of xs) for (const y of ys) { if (x > y) gt += 1; else if (x < y) lt += 1; }
  return (gt - lt) / (xs.length * ys.length);
}
const auc = (aiScores, humanScores) => {
  const d = cliffsDelta(aiScores, humanScores);
  return d === null ? null : (d + 1) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function bootstrapAucCI(aiRows, humanRows, { iters = 5000, seed = SEED } = {}) {
  if (aiRows.length < 3 || humanRows.length < 3) return null;
  const rnd = lcg(seed);
  const stats = [];
  for (let b = 0; b < iters; b += 1) {
    const ai = [];
    for (let i = 0; i < aiRows.length; i += 1) ai.push(aiRows[Math.floor(rnd() * aiRows.length)]);
    const hu = [];
    for (let i = 0; i < humanRows.length; i += 1) hu.push(humanRows[Math.floor(rnd() * humanRows.length)]);
    stats.push(auc(ai, hu));
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(iters * 0.025)], stats[Math.floor(iters * 0.975)]];
}

const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d));
const fmtCI = (ci, d = 2) => (ci ? `[${fmt(ci[0], d)}, ${fmt(ci[1], d)}]` : 'n/a');

function analyze() {
  const rows = readJsonl(JUDGMENTS).filter((r) => typeof r.ai_likeness === 'number');
  const main = rows.filter((r) => r.repeat === 0);
  const det = readJsonl(DET).filter((r) => typeof r.score === 'number');
  console.log(`judgment rows: ${rows.length} (main ${main.length}); deterministic ${det.length}`);

  const bestAuc = [];
  for (const j of JUDGES) {
    const mine = main.filter((r) => r.judge === j.id);
    const cross = mine.filter((r) => r.class === 'natural-human' || r.model_family !== j.family);
    const aiS = cross.filter((r) => r.class === 'ai-like').map((r) => r.ai_likeness);
    const huS = cross.filter((r) => r.class === 'natural-human').map((r) => r.ai_likeness);
    const acc = cross.length
      ? cross.filter((r) => (r.class === 'ai-like') === (r.authorship === 'ai')).length / cross.length : null;
    const a = auc(aiS, huS);
    const ci = bootstrapAucCI(aiS, huS);
    const selfAi = mine.filter((r) => r.class === 'ai-like' && r.model_family === j.family).map((r) => r.ai_likeness);
    const selfPref = selfAi.length && aiS.length ? mean(selfAi) - mean(aiS) : null;
    const reps = rows.filter((r) => r.judge === j.id);
    const byDoc = {};
    for (const r of reps) { (byDoc[r.sample_id] ??= []).push(r.ai_likeness); }
    const sds = Object.values(byDoc).filter((v) => v.length >= 5).map(sd);
    const stab = median(sds);
    bestAuc.push(a ?? 0);
    const pass = a !== null && a >= 0.75 && stab !== null && stab <= 12;
    const demote = (a !== null && a < 0.65) || (stab !== null && stab > 20);
    console.log(`\n== ${j.id} (cross-family n=${cross.length}: ai ${aiS.length} / human ${huS.length}) ==`);
    console.log(`accuracy ${fmt(acc)} | AUC ${fmt(a)} ${fmtCI(ci)} | bias human ${fmt(mean(huS), 1)} / ai ${fmt(mean(aiS), 1)}`);
    console.log(`stability median per-doc SD ${fmt(stab, 1)} over ${sds.length} docs | self-preference ${fmt(selfPref, 1)}`);
    console.log(`>>> ${demote ? 'DEMOTE candidate' : pass ? 'PASS' : 'WATCH'} (PASS: AUC≥0.75 & SD≤12; DEMOTE: AUC<0.65 | SD>20)`);
  }

  // pooled panel (2-of-3 mean per doc)
  const byDoc = {};
  for (const r of main) { (byDoc[r.sample_id] ??= { class: r.class, scores: [] }).scores.push(r.ai_likeness); }
  const panel = Object.values(byDoc).filter((d) => d.scores.length >= 2).map((d) => ({ class: d.class, score: mean(d.scores) }));
  const pAi = panel.filter((d) => d.class === 'ai-like').map((d) => d.score);
  const pHu = panel.filter((d) => d.class === 'natural-human').map((d) => d.score);
  const pAuc = auc(pAi, pHu);
  console.log(`\n== pooled panel (n=${panel.length}) ==`);
  console.log(`AUC ${fmt(pAuc)} ${fmtCI(bootstrapAucCI(pAi, pHu))} → panel ${pAuc !== null && pAuc >= 0.8 ? 'PASS' : 'BELOW pre-set 0.80'}`);

  // deterministic layer
  const dAi = det.filter((r) => r.class === 'ai-like').map((r) => r.score);
  const dHu = det.filter((r) => r.class === 'natural-human').map((r) => r.score);
  const dAuc = auc(dAi, dHu);
  const best = Math.max(...bestAuc);
  console.log(`\n== deterministic stylometry ==`);
  console.log(`AUC ${fmt(dAuc)} ${fmtCI(bootstrapAucCI(dAi, dHu))} | mean score human ${fmt(mean(dHu), 1)} / ai ${fmt(mean(dAi), 1)}`);
  const hotAcc = det.length
    ? det.filter((r) => (r.class === 'ai-like') === ((r.hot_count ?? 0) > 0)).length / det.length : null;
  console.log(`hot-verdict accuracy (any hot paragraph = AI call): ${fmt(hotAcc)}`);
  console.log(`promotion review threshold: best judge AUC − 0.05 = ${fmt(best - 0.05)} → ${dAuc !== null && dAuc >= best - 0.05 ? 'FILE PROMOTION DECISION' : 'no promotion proposal'}`);
}

// ---------------------------------------------------------------------------

const cmd = process.argv[2];
if (cmd === 'collect') await collect();
else if (cmd === 'generate') await generate();
else if (cmd === 'judge') await judge();
else if (cmd === 'deterministic') deterministic();
else if (cmd === 'analyze') analyze();
else { console.error('usage: judge-calibration.mjs <collect|generate|judge|deterministic|analyze>'); process.exit(2); }
