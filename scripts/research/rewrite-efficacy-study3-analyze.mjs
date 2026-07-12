// Analysis for Study 3 (structure-plan-step intervention). Applies the
// decision rules fixed in docs/research/2026-rewrite-efficacy-prereg.md
// ("Study 3" section, registered 2026-07-12) to
// artifacts/rewrite-efficacy-study3/s3-rows-D3.jsonl.
//
// Baselines: Study 1 D-arm rows (original + rewrite1 panel scores) are reused
// exactly as in Study 2; Study 2 rewrite2 panel scores are a DESCRIPTIVE
// second comparator only. Stats and the H6 cue rubric are byte-identical to
// the Study 1 analyzer (fixed before data). Seeded bootstrap, no Math.random.
//
// Usage: node scripts/research/rewrite-efficacy-study3-analyze.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S1_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const S2_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study2');
const S3_DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study3');
const JUDGE_IDS = ['judge-kimi', 'judge-gpt', 'judge-grok'];
const QUORUM = 2;
const BOOT = 5000;

// H6 rubric — identical to the Study 1 analyzer (fixed before data).
const CUE_RUBRIC = [
  ['structure', /structur|arc\b|paragraph|topic.?sentence|organiz|organis|format|template|formulaic|outline|intro|conclusion|resolution|essay|listicle|transition|flow|progression|symmetr|parallel|구조|문단|서론|본론|결론|전개|형식|틀|목차|나열/i],
  ['lexical', /word|vocab|phras|lexic|diction|terminolog|term\b|buzzword|jargon|repetit|repeat|cliche|clich|hedg|adjective|adverb|punctuat|dash|comma|어휘|단어|표현|반복|상투|수식어|문장부호/i],
  ['specificity-absence', /generic|vague|abstract|lack.{0,20}(specific|detail|example)|no .{0,20}(specific|detail|example|anecdote)|impersonal|surface|shallow|bland|구체성|추상적|막연|밋밋|피상|일반론/i],
];
function classifyCue(cue) {
  for (const [label, re] of CUE_RUBRIC) if (re.test(cue)) return label;
  return 'other';
}

function lcg(seed = 20260710) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function bootstrapCI(values, stat, { iters = BOOT, seed = 20260710 } = {}) {
  if (values.length < 3) return null;
  const rnd = lcg(seed);
  const stats = [];
  for (let b = 0; b < iters; b += 1) {
    const sample = [];
    for (let i = 0; i < values.length; i += 1) sample.push(values[Math.floor(rnd() * values.length)]);
    stats.push(stat(sample));
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(iters * 0.025)], stats[Math.floor(iters * 0.975)]];
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function loadJsonl(dir, re) {
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => re.test(x))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* partial trailing line */ }
    }
  }
  return rows;
}

const panelOf = (judges) => {
  if (!judges) return null;
  const s = JUDGE_IDS.map((j) => judges[j])
    .filter((j) => j && typeof j.ai_likeness === 'number')
    .map((j) => j.ai_likeness);
  return s.length >= QUORUM ? mean(s) : null;
};
const aiCalls = (judges) => JUDGE_IDS.map((j) => judges?.[j])
  .filter((j) => j && (j.authorship === 'ai' || j.authorship === 'human'));

function fmt(v, d = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  return typeof v === 'number' ? v.toFixed(d) : String(v);
}
const fmtCI = (ci, d = 1) => (ci ? `[${fmt(ci[0], d)}, ${fmt(ci[1], d)}]` : 'n/a');
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`);

function main() {
  const s1 = new Map(loadJsonl(S1_DIR, /^s1-rows-D\.jsonl$/).map((r) => [r.original_sha, r]));
  const s2 = new Map(loadJsonl(S2_DIR, /^s2-rows-D2\.jsonl$/).map((r) => [r.original_sha, r]));
  const s3 = loadJsonl(S3_DIR, /^s3-rows-D3\.jsonl$/);

  console.log(`rows: S1=${s1.size} S2=${s2.size} S3=${s3.length}`);
  const failed = s3.filter((r) => r.rewrite_error || !r.rewrite3_sha);
  if (failed.length) console.log(`⚠ fail-soft rows present (${failed.length}) — prune and resume before analysis`);

  for (const cls of ['ai', 'human']) {
    const subset = s3.filter((r) => r.source_class === cls && r.rewrite3_sha);
    const d31 = []; // panel(rw3) − panel(rw1)  == Δ3 − Δ1
    const d32 = []; // panel(rw3) − panel(rw2)  (descriptive)
    const orig = []; const rw1 = []; const rw3 = [];
    const ratios = [];
    let quorumLost = 0;
    for (const r of subset) {
      const base = s1.get(r.original_sha);
      if (!base) continue;
      const pO = panelOf(base.judges?.original);
      const p1 = panelOf(base.judges?.rewrite);
      const p3 = panelOf(r.judges_rewrite3);
      if (pO === null || p1 === null || p3 === null) { quorumLost += 1; continue; }
      orig.push(pO); rw1.push(p1); rw3.push(p3);
      d31.push(p3 - p1);
      const p2 = panelOf(s2.get(r.original_sha)?.judges_rewrite2);
      if (p2 !== null) d32.push(p3 - p2);
      if (r.original_chars && r.rewrite3_chars) ratios.push(r.rewrite3_chars / r.original_chars);
    }
    const ci = bootstrapCI(d31, (s) => mean(s));
    const aiRate = (get) => {
      const calls = subset.flatMap(get).filter(Boolean);
      return calls.length ? calls.filter((c) => c.authorship === 'ai').length / calls.length : null;
    };
    console.log(`\n== ${cls} (n=${d31.length}${quorumLost ? `, quorum lost ${quorumLost}` : ''}) ==`);
    console.log(`orig ${fmt(mean(orig))} | rw1(S1) ${fmt(mean(rw1))} | rw3(S3) ${fmt(mean(rw3))}`);
    console.log(`paired d = rw3−rw1: ${fmt(mean(d31))} ${fmtCI(ci)}   (descriptive rw3−rw2: ${fmt(mean(d32))}, n=${d32.length})`);
    console.log(`AI-call rate rw3: ${pct(aiRate((r) => aiCalls(r.judges_rewrite3)))} (S1 rw1: ${pct(aiRate((r) => aiCalls(s1.get(r.original_sha)?.judges?.rewrite)))})`);
    console.log(`length ratio rw3/orig: ${fmt(mean(ratios), 2)}`);
    if (cls === 'ai') {
      const verdict = ci && ci[1] < 0 && mean(d31) <= -5 ? 'H-S3a SUPPORTED' : 'H-S3a REJECTED';
      console.log(`>>> ${verdict} (needs CI upper < 0 AND mean d ≤ −5)`);
    } else {
      const harmed = ci && ci[0] > 0;
      console.log(`>>> guard rail 2 (over-editing): ${harmed ? 'VIOLATED (CI excludes 0, positive)' : 'held'}`);
    }
  }

  // H-S3b — structural share among still-"ai" judgments on rw3 (AI docs).
  const cues = s3.filter((r) => r.source_class === 'ai' && r.judges_rewrite3)
    .flatMap((r) => JUDGE_IDS.map((j) => r.judges_rewrite3[j]))
    .filter((j) => j && j.authorship === 'ai' && j.strongest_cue);
  const counts = {};
  for (const j of cues) { const c = classifyCue(j.strongest_cue); counts[c] = (counts[c] || 0) + 1; }
  const structShare = cues.length ? (counts.structure || 0) / cues.length : null;
  console.log(`\n== H-S3b cue mix (still-"ai" judgments on rw3, n=${cues.length}) ==`);
  console.log(JSON.stringify(counts));
  console.log(`structural share: ${pct(structShare)} (pre-registered target < 60%) → ${structShare !== null && structShare < 0.6 ? 'H-S3b SUPPORTED' : 'H-S3b REJECTED'}`);

  // Guard rail 1 — deterministic meaning gate.
  const judged = s3.filter((r) => r.rewrite3_sha);
  const gatePass = judged.filter((r) => r.gate_failed === false).length;
  console.log(`\n== guard rail 1 (meaning gate) ==`);
  console.log(`pass ${gatePass}/${judged.length} (${pct(judged.length ? gatePass / judged.length : null)}) — pre-registered ≥ 95% (≥52/54) → ${judged.length >= 54 && gatePass >= 52 ? 'held' : judged.length < 54 ? 'incomplete run' : 'VIOLATED'}`);
  const reasons = judged.filter((r) => r.gate_failed).map((r) => `${r.pair_id}: ${r.gate_reason}`);
  for (const x of reasons) console.log(`  gate fail — ${x}`);
}

main();
