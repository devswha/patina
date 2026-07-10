// Analysis for Study 1 of the pre-registered rewrite-efficacy program.
// Applies the decision rules fixed in docs/research/2026-rewrite-efficacy-prereg.md
// ("Study 1" section) to artifacts/rewrite-efficacy-study1/s1-rows-*.jsonl.
//
// Differences from the pilot analyzer, all pre-registered:
//   - fixed 3-judge panel (kimi/gpt/grok) with a 2-of-3 QUORUM: a
//     passage-condition with < 2 parseable ratings is a data loss, never scored
//   - Krippendorff's alpha over 2-3 rater units; Spearman/abs-gap become
//     mean-pairwise statistics
//   - H6: deterministic keyword rubric classifying surviving cues into
//     structure / lexical / specificity-absence / other; hypothesis = structure
//     is the modal category at document length, both arms
// Stats stay dependency-free and seeded (no Math.random).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-study1');
const JUDGE_IDS = ['judge-kimi', 'judge-gpt', 'judge-grok'];
const QUORUM = 2; // pre-registered 2-of-3
const ALPHA_GATE = 0.4;
const BOOT = 5000;
const EXCLUDED_REGISTERS = new Set(['spok']); // pilot Deviation 4, inherited
const isExcluded = (row) => EXCLUDED_REGISTERS.has(row.register);

// ---------------------------------------------------------------------------
// H6 rubric — FIXED BEFORE DATA. First match wins, in this precedence order;
// unmatched cues fall to `other` and are listed verbatim in the results.
const CUE_RUBRIC = [
  ['structure', /structur|arc\b|paragraph|topic.?sentence|organiz|organis|format|template|formulaic|outline|intro|conclusion|resolution|essay|listicle|transition|flow|progression|symmetr|parallel|구조|문단|서론|본론|결론|전개|형식|틀|목차|나열/i],
  ['lexical', /word|vocab|phras|lexic|diction|terminolog|term\b|buzzword|jargon|repetit|repeat|cliche|clich|hedg|adjective|adverb|punctuat|dash|comma|어휘|단어|표현|반복|상투|수식어|문장부호/i],
  ['specificity-absence', /generic|vague|abstract|lack.{0,20}(specific|detail|example)|no .{0,20}(specific|detail|example|anecdote)|impersonal|surface|shallow|bland|구체성|추상적|막연|밋밋|피상|일반론/i],
];
function classifyCue(cue) {
  for (const [label, re] of CUE_RUBRIC) if (re.test(cue)) return label;
  return 'other';
}

// ---------------------------------------------------------------------------
// stats (as pilot, extended to m-rater units)

function lcg(seed = 20260710) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Krippendorff's alpha, interval data, units with >=2 raters. */
function krippendorffAlpha(units) {
  const usable = units.filter((u) => u.length >= 2);
  if (usable.length < 2) return null;
  let Do = 0;
  let totalPairable = 0;
  for (const u of usable) {
    const m = u.length;
    let s = 0;
    for (let i = 0; i < m; i += 1) for (let j = 0; j < m; j += 1) if (i !== j) s += (u[i] - u[j]) ** 2;
    Do += s / (m - 1);
    totalPairable += m;
  }
  Do /= totalPairable;
  const all = usable.flat();
  const n = all.length;
  let De = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) if (i !== j) De += (all[i] - all[j]) ** 2;
  De /= (n * (n - 1));
  if (De === 0) return null;
  return 1 - Do / De;
}

function rank(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(xs, ys) {
  if (xs.length < 3) return null;
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

function cliffsDelta(xs, ys) {
  if (!xs.length || !ys.length) return null;
  let gt = 0; let lt = 0;
  for (const x of xs) for (const y of ys) { if (x > y) gt += 1; else if (x < y) lt += 1; }
  return (gt - lt) / (xs.length * ys.length);
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

// ---------------------------------------------------------------------------
// data access

function loadGlob(re) {
  const rows = [];
  for (const f of readdirSync(DIR).filter((x) => re.test(x))) {
    for (const line of readFileSync(join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* partial trailing line */ }
    }
  }
  return rows;
}
const loadRows = () => loadGlob(/^s1-rows.*\.jsonl$/);
/**
 * The top-up pass re-appends a repaired row's full text record to
 * s1-texts-TOPUP, so the same original appears twice across the glob. Dedupe
 * by (arm, original_sha), keeping the LAST occurrence (the repaired one) —
 * otherwise RQ4's human pool double-counts every repaired document.
 */
const loadTexts = () => {
  const byKey = new Map();
  for (const t of loadGlob(/^s1-texts.*\.private\.jsonl$/)) byKey.set(`${t.arm}:${t.original_sha}`, t);
  return [...byKey.values()];
};

const scoreOf = (row, cond, judge) => {
  const j = row.judges?.[cond]?.[judge];
  return j && typeof j.ai_likeness === 'number' ? j.ai_likeness : null;
};
const authorOf = (row, cond, judge) => {
  const j = row.judges?.[cond]?.[judge];
  return j && (j.authorship === 'ai' || j.authorship === 'human') ? j.authorship : null;
};
/** Panel score under the pre-registered 2-of-3 quorum. */
const panelScore = (row, cond) => {
  const s = JUDGE_IDS.map((j) => scoreOf(row, cond, j)).filter((v) => v !== null);
  return s.length >= QUORUM ? mean(s) : null;
};

// ---------------------------------------------------------------------------
// RQ4 fingerprint (identical to pilot)

function styleVector(text, lang) {
  const sentences = text.split(/[.!?。！？\n]+/).map((s) => s.trim()).filter(Boolean);
  const tokens = lang === 'ko' || lang === 'zh' || lang === 'ja'
    ? [...text.replace(/\s+/g, '')]
    : text.toLowerCase().match(/[a-z']+/g) || [];
  if (sentences.length < 2 || tokens.length < 10) return null;
  const lens = sentences.map((s) => s.length);
  const m = mean(lens);
  const sd = Math.sqrt(mean(lens.map((l) => (l - m) ** 2)));
  const types = new Set(tokens).size;
  const chars = text.length || 1;
  return [
    m / 100,
    m ? sd / m : 0,
    types / tokens.length,
    (text.match(/,/g) || []).length / chars * 100,
    (text.match(/[;:—–]/g) || []).length / chars * 100,
    mean(tokens.map((t) => t.length)) / 10,
  ];
}

const cosine = (a, b) => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

function meanPairwise(vs) {
  if (vs.length < 2) return null;
  const sims = [];
  for (let i = 0; i < vs.length; i += 1) for (let j = i + 1; j < vs.length; j += 1) sims.push(cosine(vs[i], vs[j]));
  return mean(sims);
}

function fingerprintTest(rewriteVs, humanVs, { iters = 2000, seed = 20260710 } = {}) {
  const obs = meanPairwise(rewriteVs);
  const base = meanPairwise(humanVs);
  if (obs === null || base === null) return null;
  const pool = [...rewriteVs, ...humanVs];
  const nR = rewriteVs.length;
  const rnd = lcg(seed);
  let extreme = 0;
  for (let it = 0; it < iters; it += 1) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const diff = meanPairwise(shuffled.slice(0, nR)) - meanPairwise(shuffled.slice(nR));
    if (diff >= obs - base) extreme += 1;
  }
  return { rewrite_cohesion: obs, human_cohesion: base, gap: obs - base, p: extreme / iters };
}

// ---------------------------------------------------------------------------
// per-arm blocks

function agreementFor(rows) {
  const units = [];
  const byJudge = Object.fromEntries(JUDGE_IDS.map((j) => [j, []]));
  for (const row of rows) {
    for (const cond of ['original', 'rewrite']) {
      const vals = JUDGE_IDS.map((j) => scoreOf(row, cond, j));
      const present = vals.filter((v) => v !== null);
      if (present.length >= 2) {
        units.push(present);
        for (let i = 0; i < JUDGE_IDS.length; i += 1) byJudge[JUDGE_IDS[i]].push(vals[i]);
      }
    }
  }
  // Mean pairwise Spearman / abs gap across judge pairs, aligned per unit.
  const rhos = [];
  const gaps = [];
  for (let i = 0; i < JUDGE_IDS.length; i += 1) {
    for (let j = i + 1; j < JUDGE_IDS.length; j += 1) {
      const xs = [];
      const ys = [];
      for (let k = 0; k < byJudge[JUDGE_IDS[i]].length; k += 1) {
        const a = byJudge[JUDGE_IDS[i]][k];
        const b = byJudge[JUDGE_IDS[j]][k];
        if (a !== null && b !== null) { xs.push(a); ys.push(b); }
      }
      const rho = spearman(xs, ys);
      if (rho !== null) rhos.push(rho);
      if (xs.length) gaps.push(mean(xs.map((x, k) => Math.abs(x - ys[k]))));
    }
  }
  return {
    n_units: units.length,
    full_panel_units: units.filter((u) => u.length === JUDGE_IDS.length).length,
    alpha: krippendorffAlpha(units),
    spearman_mean_pairwise: rhos.length ? mean(rhos) : null,
    mean_abs_gap: gaps.length ? mean(gaps) : null,
  };
}

function efficacyFor(rows, sourceClass) {
  const subset = rows.filter((r) => r.source_class === sourceClass && r.rewrite_sha);
  const deltas = [];
  const before = [];
  const after = [];
  const internalDeltas = [];
  let quorumLost = 0;
  for (const r of subset) {
    const b = panelScore(r, 'original');
    const a = panelScore(r, 'rewrite');
    if (b === null || a === null) { quorumLost += 1; continue; }
    before.push(b); after.push(a); deltas.push(a - b);
    const ib = r.internal?.original?.signal_score;
    const ia = r.internal?.rewrite?.signal_score;
    if (typeof ib === 'number' && typeof ia === 'number') internalDeltas.push(ia - ib);
  }
  const aiRate = (cond) => {
    const calls = subset.flatMap((r) => JUDGE_IDS.map((j) => authorOf(r, cond, j))).filter(Boolean);
    return calls.length ? calls.filter((c) => c === 'ai').length / calls.length : null;
  };
  return {
    n: deltas.length,
    quorum_lost: quorumLost,
    judge_before: mean(before),
    judge_after: mean(after),
    judge_delta_mean: mean(deltas),
    judge_delta_ci: bootstrapCI(deltas, (s) => mean(s)),
    cliffs_delta: cliffsDelta(after, before),
    ai_call_rate_original: aiRate('original'),
    ai_call_rate_rewrite: aiRate('rewrite'),
    internal_delta_mean: internalDeltas.length ? mean(internalDeltas) : null,
    internal_n: internalDeltas.length,
  };
}

function fmt(v, d = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  return typeof v === 'number' ? v.toFixed(d) : String(v);
}
const fmtCI = (ci, d = 1) => (ci ? `[${fmt(ci[0], d)}, ${fmt(ci[1], d)}]` : 'n/a');
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`);

function main() {
  const allRows = loadRows();
  if (!allRows.length) { console.error('no rows found in', DIR); process.exit(1); }
  const rows = allRows.filter((r) => !isExcluded(r));
  const droppedRows = allRows.length - rows.length;
  const arms = [...new Set(rows.map((r) => r.arm))].sort();

  const out = [];
  out.push('# Rewrite-efficacy Study 1 — results');
  out.push('');
  out.push(`Rows: ${rows.length} (of ${allRows.length}; ${droppedRows} excluded as register ${[...EXCLUDED_REGISTERS].join('/')} per pilot Deviation 4). Arms: ${arms.join(', ')}.`);
  out.push(`Panel: ${JUDGE_IDS.join(', ')} — ${QUORUM}-of-${JUDGE_IDS.length} quorum. Decision rules: pre-registration, "Study 1" section.`);
  out.push('');

  // Data losses first — silent truncation is a protocol violation.
  const failed = rows.filter((r) => r.rewrite_error);
  const unparseable = rows.filter((r) => ['original', 'rewrite'].some((c) =>
    JUDGE_IDS.some((j) => r.judges?.[c]?.[j] && r.judges[c][j].error)));
  out.push('## Data losses (logged, not hidden)');
  out.push('');
  out.push(`- rewrite failures: ${failed.length}/${rows.length}`);
  out.push(`- rows with >=1 unparseable judge response: ${unparseable.length}/${rows.length}`);
  const cells = rows.flatMap((r) => ['original', 'rewrite'].flatMap((c) => JUDGE_IDS.map((j) => r.judges?.[c]?.[j])));
  const present = cells.filter((c) => c && typeof c.ai_likeness === 'number');
  out.push(`- panel ratings present: ${present.length}/${cells.length}` +
    ` (${present.filter((c) => c.topped_up).length} topped up, ${present.filter((c) => c.retried).length} retried, ${present.filter((c) => c.score_key).length} drifted key)`);
  out.push('');

  // RQ5a — meaning gate.
  const gated = rows.filter((r) => r.rewrite_sha && r.gate_failed !== null && r.gate_failed !== undefined);
  if (gated.length) {
    const failedGate = gated.filter((r) => r.gate_failed);
    const passRate = ((gated.length - failedGate.length) / gated.length) * 100;
    out.push('## RQ5a — meaning-safety gate');
    out.push('');
    out.push(`Pass rate: **${fmt(passRate)}%** (${gated.length - failedGate.length}/${gated.length}). Target >= 95%. ${passRate >= 95 ? '**H5a: met.**' : '**H5a: NOT met.**'}`);
    if (failedGate.length) {
      const reasons = new Map();
      for (const r of failedGate) reasons.set(r.gate_reason || 'unspecified', (reasons.get(r.gate_reason || 'unspecified') ?? 0) + 1);
      for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) out.push(`- (${n}×) ${reason}`);
    }
    out.push('');
  }

  // RQ1 — agreement.
  out.push('## RQ1 — inter-judge agreement (3-rater)');
  out.push('');
  out.push('| arm | units (>=2 raters) | full-panel units | Krippendorff alpha | mean pairwise Spearman | mean abs gap |');
  out.push('|---|---:|---:|---:|---:|---:|');
  const alphaByArm = {};
  for (const arm of arms) {
    const a = agreementFor(rows.filter((r) => r.arm === arm));
    alphaByArm[arm] = a.alpha;
    out.push(`| ${arm} | ${a.n_units} | ${a.full_panel_units} | ${fmt(a.alpha, 3)} | ${fmt(a.spearman_mean_pairwise, 3)} | ${fmt(a.mean_abs_gap)} |`);
  }
  out.push('');
  for (const arm of arms) {
    const a = alphaByArm[arm];
    if (a === null || a === undefined) out.push(`**RQ1 (${arm}): cannot evaluate** — no usable agreement units.`);
    else if (a < ALPHA_GATE) out.push(`**RQ1 (${arm}): FAIL** — alpha ${fmt(a, 3)} < ${ALPHA_GATE}; this arm's efficacy estimates are NOT interpretable.`);
    else out.push(`**RQ1 (${arm}): PASS** — alpha ${fmt(a, 3)} >= ${ALPHA_GATE}.`);
  }
  out.push('');

  // RQ2 — efficacy.
  out.push('## RQ2 — perceptual efficacy (panel, quorum-scored)');
  out.push('');
  out.push('| arm | class | n | quorum-lost | before | after | delta (95% CI) | Cliff delta | "AI" call orig -> rewrite |');
  out.push('|---|---|---:|---:|---:|---:|---|---:|---|');
  const eff = {};
  for (const arm of arms) {
    const armRows = rows.filter((r) => r.arm === arm);
    for (const cls of ['ai', 'human']) {
      const e = efficacyFor(armRows, cls);
      if (!e.n && !e.quorum_lost) continue;
      eff[`${arm}/${cls}`] = e;
      out.push(`| ${arm} | ${cls} | ${e.n} | ${e.quorum_lost} | ${fmt(e.judge_before)} | ${fmt(e.judge_after)} | ${fmt(e.judge_delta_mean)} ${fmtCI(e.judge_delta_ci)} | ${fmt(e.cliffs_delta, 3)} | ${pct(e.ai_call_rate_original)} -> ${pct(e.ai_call_rate_rewrite)} |`);
    }
  }
  out.push('');

  for (const arm of arms) {
    const e = eff[`${arm}/ai`];
    if (!e) continue;
    const ci = e.judge_delta_ci;
    if (ci && ci[1] < 0) out.push(`**H2a (${arm}): SUPPORTED** — delta ${fmt(e.judge_delta_mean)}, CI ${fmtCI(ci)} entirely below 0.`);
    else if (ci && ci[0] > 0) out.push(`**H2a (${arm}): REFUTED IN REVERSE** — CI ${fmtCI(ci)} entirely ABOVE 0.`);
    else out.push(`**H2a (${arm}): NOT SUPPORTED** — delta ${fmt(e.judge_delta_mean)}, CI ${fmtCI(ci)} includes 0.`);
    const halved = e.ai_call_rate_original !== null && e.ai_call_rate_rewrite !== null
      && e.ai_call_rate_rewrite < e.ai_call_rate_original / 2;
    out.push(`**H2b (${arm}): ${halved ? 'met' : 'NOT met'}** — AI-call ${pct(e.ai_call_rate_original)} -> ${pct(e.ai_call_rate_rewrite)}.`);
    if (e.internal_delta_mean !== null && e.judge_delta_mean !== null) {
      const gaming = e.internal_delta_mean < -1 && e.judge_delta_mean > -1;
      out.push(gaming
        ? `**Anti-circularity (${arm}): DETECTOR-GAMING SIGNATURE** — internal ${fmt(e.internal_delta_mean)} vs judge ${fmt(e.judge_delta_mean)}.`
        : `Anti-circularity (${arm}): no gaming signature (internal ${fmt(e.internal_delta_mean)}, judge ${fmt(e.judge_delta_mean)}, n=${e.internal_n}).`);
    }
    out.push('');
  }

  // RQ5b — human collateral.
  for (const arm of arms) {
    const e = eff[`${arm}/human`];
    if (!e || !e.n) continue;
    out.push(`RQ5b (${arm}): human-control delta ${fmt(e.judge_delta_mean)} ${fmtCI(e.judge_delta_ci)}; "AI" call ${pct(e.ai_call_rate_original)} -> ${pct(e.ai_call_rate_rewrite)}.`);
  }
  out.push('');

  // H6 — structural-tell survival (pre-registered primary).
  out.push('## H6 — surviving-cue taxonomy (deterministic rubric)');
  out.push('');
  for (const arm of arms) {
    // Registered analysis: every strongest_cue on a rewritten AI passage.
    // Exploratory supplement: only cues from judgments that still CALLED the
    // passage "ai" — the cue then explains a genuinely surviving tell rather
    // than why a fooled judge found it human. Both reported; the registered
    // one carries the verdict.
    const tally = () => ({ structure: 0, lexical: 0, 'specificity-absence': 0, other: 0 });
    const counts = tally();
    const aiOnly = tally();
    const others = [];
    for (const r of rows.filter((x) => x.arm === arm && x.source_class === 'ai')) {
      for (const j of JUDGE_IDS) {
        const cell = r.judges?.rewrite?.[j];
        const cue = cell?.strongest_cue;
        if (!cue) continue;
        const label = classifyCue(cue);
        counts[label] += 1;
        if (cell.authorship === 'ai') aiOnly[label] += 1;
        if (label === 'other') others.push(cue);
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) continue;
    const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    out.push(`### Arm ${arm} (${total} cues on rewritten AI text)`);
    out.push('');
    for (const [k, v] of Object.entries(counts)) out.push(`- ${k}: ${v} (${((v / total) * 100).toFixed(0)}%)`);
    out.push('');
    out.push(`**H6 (${arm}): ${modal === 'structure' ? 'SUPPORTED — structure is the modal surviving cue.' : `NOT supported — modal category is ${modal}.`}**`);
    const aiTotal = Object.values(aiOnly).reduce((a, b) => a + b, 0);
    if (aiTotal) {
      const aiModal = Object.entries(aiOnly).sort((a, b) => b[1] - a[1])[0][0];
      const parts = Object.entries(aiOnly).map(([k, v]) => `${k} ${v} (${((v / aiTotal) * 100).toFixed(0)}%)`).join(', ');
      out.push('');
      out.push(`_Exploratory (not pre-registered): restricted to still-called-"ai" judgments (${aiTotal} cues): ${parts} — modal: ${aiModal}._`);
    }
    if (others.length) {
      out.push('');
      out.push(`Unclassified cues (verbatim, ${others.length}):`);
      for (const o of [...new Set(others)].slice(0, 20)) out.push(`- ${o}`);
    }
    out.push('');
  }

  // RQ4 — fingerprint, per arm.
  const texts = loadTexts();
  for (const arm of arms) {
    const armTexts = texts.filter((t) => t.arm === arm);
    const rewriteVs = armTexts.filter((t) => t.source_class === 'ai' && t.rewritten)
      .map((t) => styleVector(t.rewritten, t.lang)).filter(Boolean);
    const humanVs = armTexts.filter((t) => t.source_class === 'human' && t.original)
      .map((t) => styleVector(t.original, t.lang)).filter(Boolean);
    const fp = fingerprintTest(rewriteVs, humanVs);
    if (!fp) continue;
    out.push(`## RQ4 — humanizer fingerprint (Arm ${arm})`);
    out.push('');
    out.push(`Cohesion: rewrites ${fmt(fp.rewrite_cohesion, 4)} (n=${rewriteVs.length}) vs humans ${fmt(fp.human_cohesion, 4)} (n=${humanVs.length}); gap ${fmt(fp.gap, 4)}, permutation p = ${fmt(fp.p, 3)}.`);
    out.push(fp.gap > 0 && fp.p < 0.05
      ? '**H4: convergent house style detected.**'
      : '**H4: no significant convergence.**');
    out.push('');
  }

  // Sensitivity — spok restored (A1 only; D has no spok).
  if (droppedRows > 0) {
    out.push('## Sensitivity — excluded register restored (Arm A1)');
    out.push('');
    const aAll = allRows.filter((r) => r.arm === 'A1');
    const aPri = rows.filter((r) => r.arm === 'A1');
    const agAll = agreementFor(aAll);
    const agPri = agreementFor(aPri);
    const efAll = efficacyFor(aAll, 'ai');
    const efPri = efficacyFor(aPri, 'ai');
    out.push('| analysis | alpha | ai delta (95% CI) | n |');
    out.push('|---|---:|---|---:|');
    out.push(`| primary (excl. ${[...EXCLUDED_REGISTERS].join('/')}) | ${fmt(agPri.alpha, 3)} | ${fmt(efPri.judge_delta_mean)} ${fmtCI(efPri.judge_delta_ci)} | ${efPri.n} |`);
    out.push(`| sensitivity (incl.) | ${fmt(agAll.alpha, 3)} | ${fmt(efAll.judge_delta_mean)} ${fmtCI(efAll.judge_delta_ci)} | ${efAll.n} |`);
    const alphaFlip = (agPri.alpha >= ALPHA_GATE) !== (agAll.alpha >= ALPHA_GATE);
    const signFlip = efPri.judge_delta_ci && efAll.judge_delta_ci
      && (efPri.judge_delta_ci[1] < 0) !== (efAll.judge_delta_ci[1] < 0);
    out.push('');
    out.push(alphaFlip || signFlip
      ? '**The exclusion changes a verdict** — that dependence is itself the result.'
      : 'Both verdicts survive the exclusion.');
    out.push('');
  }

  const text = out.join('\n');
  writeFileSync(join(DIR, 'RESULTS.md'), text);
  console.log(text);
  console.error(`\n[written] ${join(DIR, 'RESULTS.md')}`);
}

main();
