// Analysis for the pre-registered rewrite-efficacy pilot.
// Reads artifacts/rewrite-efficacy-pilot/pilot-rows-*.jsonl and applies the
// decision rules fixed in docs/research/2026-rewrite-efficacy-prereg.md.
//
// Statistics are implemented here rather than pulled in as a dependency (the
// project ships exactly one runtime dep, js-yaml). All are standard:
//   - Krippendorff's alpha (interval) for inter-judge agreement  -> RQ1 gate
//   - Cliff's delta + percentile bootstrap CI for paired effects -> RQ2
//   - Spearman rho for rater correlation
// No Math.random: the bootstrap uses a seeded LCG so runs are reproducible.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'artifacts', 'rewrite-efficacy-pilot');
// Primary panel (pre-registration Deviation 3). judge-gpt exhausted its quota
// mid-pilot; its surviving cells are a PARTIAL third rater, reported separately
// with their coverage stated and never merged into the primary panel.
const JUDGE_IDS = ['judge-gemini', 'judge-kimi'];
const PARTIAL_JUDGE = 'judge-gpt';
const ALPHA_GATE = 0.4; // pre-registered RQ1 stop rule
const BOOT = 5000;
// Pre-registration Deviation 4: HAP-E's `spok` human side is degraded ASR output,
// not written prose, so "AI-likeness of the prose" is undefined for it. Excluded
// from the primary analysis; the sensitivity analysis puts it back.
const EXCLUDED_REGISTERS = new Set(['spok']);
const isExcluded = (row) => EXCLUDED_REGISTERS.has(row.register);

// ---------------------------------------------------------------------------
// stats

/** Seeded LCG so bootstrap CIs are reproducible across runs. */
function lcg(seed = 20260710) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Krippendorff's alpha for interval data.
 * units: array of arrays; each inner array holds the ratings for one unit
 * (missing raters simply absent). alpha = 1 - Do/De.
 */
function krippendorffAlpha(units) {
  const usable = units.filter((u) => u.length >= 2);
  if (usable.length < 2) return null;

  let observed = 0;
  let pairCount = 0;
  for (const u of usable) {
    for (let i = 0; i < u.length; i += 1) {
      for (let j = 0; j < u.length; j += 1) {
        if (i === j) continue;
        observed += (u[i] - u[j]) ** 2;
        pairCount += 1;
      }
    }
  }
  // Do is the mean within-unit squared difference, weighted per Krippendorff by
  // 1/(m_u - 1) within each unit.
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
  void observed; void pairCount;
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

/** Cliff's delta: P(x>y) - P(x<y). Negative = xs tend to be lower than ys. */
function cliffsDelta(xs, ys) {
  if (!xs.length || !ys.length) return null;
  let gt = 0; let lt = 0;
  for (const x of xs) for (const y of ys) { if (x > y) gt += 1; else if (x < y) lt += 1; }
  return (gt - lt) / (xs.length * ys.length);
}

/** Percentile bootstrap CI of a statistic over paired deltas. */
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
// data

function loadRows() {
  const files = readdirSync(DIR).filter((f) => /^pilot-rows.*\.jsonl$/.test(f));
  const rows = [];
  for (const f of files) {
    for (const line of readFileSync(join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* skip partial trailing line */ }
    }
  }
  return rows;
}

function loadTexts() {
  const files = readdirSync(DIR).filter((f) => /^texts.*\.private\.jsonl$/.test(f));
  const rows = [];
  for (const f of files) {
    for (const line of readFileSync(join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* skip partial trailing line */ }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// RQ4 — humanizer fingerprint. Deterministic, no LLM: if patina imposes a
// convergent house style, its rewrites cluster tighter in style space than
// independently-authored human texts do.

/** Language-agnostic style vector (whitespace-free scripts use char counts). */
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
    m / 100, // mean sentence length
    m ? sd / m : 0, // burstiness (CV)
    types / tokens.length, // type-token ratio
    (text.match(/,/g) || []).length / chars * 100, // comma density
    (text.match(/[;:—–]/g) || []).length / chars * 100, // "AI punctuation" density
    mean(tokens.map((t) => t.length)) / 10, // mean token length
  ];
}

const cosine = (a, b) => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** Mean pairwise cosine similarity within a set of style vectors. */
function meanPairwise(vs) {
  if (vs.length < 2) return null;
  const sims = [];
  for (let i = 0; i < vs.length; i += 1) for (let j = i + 1; j < vs.length; j += 1) sims.push(cosine(vs[i], vs[j]));
  return mean(sims);
}

/**
 * Permutation test: is the rewrite set's internal cohesion higher than the human
 * set's, beyond what relabeling the same texts would produce by chance?
 */
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

const scoreOf = (row, cond, judge) => {
  const j = row.judges?.[cond]?.[judge];
  return j && typeof j.ai_likeness === 'number' ? j.ai_likeness : null;
};
const authorOf = (row, cond, judge) => {
  const j = row.judges?.[cond]?.[judge];
  return j && (j.authorship === 'ai' || j.authorship === 'human') ? j.authorship : null;
};
/** Mean judge score across judges that returned a parseable rating. */
const panelScore = (row, cond) => {
  const s = JUDGE_IDS.map((j) => scoreOf(row, cond, j)).filter((v) => v !== null);
  return s.length ? mean(s) : null;
};

// ---------------------------------------------------------------------------
// report

function agreementFor(rows) {
  // One unit per (row, condition): the ratings the judges gave the same passage.
  const units = [];
  const paired = [[], []];
  for (const row of rows) {
    for (const cond of ['original', 'rewrite']) {
      const vals = JUDGE_IDS.map((j) => scoreOf(row, cond, j)).filter((v) => v !== null);
      if (vals.length >= 2) {
        units.push(vals);
        paired[0].push(vals[0]);
        paired[1].push(vals[1]);
      }
    }
  }
  return {
    n_units: units.length,
    alpha: krippendorffAlpha(units),
    spearman: spearman(paired[0], paired[1]),
    mean_abs_gap: mean(units.map((u) => Math.abs(u[0] - u[1]))),
  };
}

function efficacyFor(rows, sourceClass) {
  const subset = rows.filter((r) => r.source_class === sourceClass && r.rewrite_sha);
  const deltas = [];
  const before = [];
  const after = [];
  const internalDeltas = [];
  for (const r of subset) {
    const b = panelScore(r, 'original');
    const a = panelScore(r, 'rewrite');
    if (b === null || a === null) continue;
    before.push(b); after.push(a); deltas.push(a - b);
    const ib = r.internal?.original?.signal_score;
    const ia = r.internal?.rewrite?.signal_score;
    if (typeof ib === 'number' && typeof ia === 'number') internalDeltas.push(ia - ib);
  }
  // "AI" authorship call rate, per condition.
  const aiRate = (cond) => {
    const calls = subset.flatMap((r) => JUDGE_IDS.map((j) => authorOf(r, cond, j))).filter(Boolean);
    return calls.length ? calls.filter((c) => c === 'ai').length / calls.length : null;
  };
  return {
    n: deltas.length,
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

function main() {
  const allRows = loadRows();
  if (!allRows.length) { console.error('no rows found in', DIR); process.exit(1); }
  // Primary analysis drops the excluded registers (Deviation 4); the sensitivity
  // section at the end puts them back, so the exclusion can be audited rather
  // than taken on trust.
  const rows = allRows.filter((r) => !isExcluded(r));
  const droppedRows = allRows.length - rows.length;

  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  const out = [];
  out.push('# Rewrite-efficacy pilot — results');
  out.push('');
  out.push(`Rows: ${rows.length} (of ${allRows.length}; ${droppedRows} excluded as register ${[...EXCLUDED_REGISTERS].join('/')} per Deviation 4). Arms: ${arms.join(', ')}. Judges: ${JUDGE_IDS.join(', ')}.`);
  out.push('Decision rules are those pre-registered in `2026-rewrite-efficacy-prereg.md`.');
  out.push('');

  // failures first — silent truncation is a protocol violation
  const failed = rows.filter((r) => r.rewrite_error);
  const unparseable = rows.filter((r) => ['original', 'rewrite'].some((c) =>
    JUDGE_IDS.some((j) => r.judges?.[c]?.[j] && r.judges[c][j].error)));
  out.push('## Data losses (logged, not hidden)');
  out.push('');
  out.push(`- rewrite failures: ${failed.length}/${rows.length}`);
  out.push(`- rows with >=1 unparseable judge response: ${unparseable.length}/${rows.length}`);
  out.push('');

  // RQ5a — meaning preservation. Exit code 4 = rewrite emitted but the persona
  // safety gate (MPS / fidelity / dropped numbers) failed. These rows are KEPT;
  // discarding them would bias this pass rate toward 100%.
  const gated = rows.filter((r) => r.rewrite_sha && r.gate_failed !== null && r.gate_failed !== undefined);
  if (gated.length) {
    const failedGate = gated.filter((r) => r.gate_failed);
    const passRate = ((gated.length - failedGate.length) / gated.length) * 100;
    out.push('## RQ5a — meaning-safety gate (MPS / fidelity / dropped numbers)');
    out.push('');
    out.push(`Pass rate: **${fmt(passRate)}%** (${gated.length - failedGate.length}/${gated.length}). Pre-registered target: >= 95%.`);
    out.push(passRate >= 95 ? '**H5a: met.**' : '**H5a: NOT met** — meaning drifted on more than 1 in 20 rewrites.');
    if (failedGate.length) {
      out.push('');
      out.push('Gate failures by reason:');
      const reasons = new Map();
      for (const r of failedGate) reasons.set(r.gate_reason || 'unspecified', (reasons.get(r.gate_reason || 'unspecified') ?? 0) + 1);
      for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
        out.push(`- (${n}×) ${reason}`);
      }
    }
    out.push('');
  }

  // Transparency: how much of the matrix needed repair, and how far the partial
  // third rater actually reaches. A complete-looking table with silent top-ups
  // behind it is worse than an incomplete one.
  const cells = rows.flatMap((r) => ['original', 'rewrite'].flatMap((c) => JUDGE_IDS.map((j) => r.judges?.[c]?.[j])));
  const present = cells.filter((c) => c && typeof c.ai_likeness === 'number');
  const toppedUp = present.filter((c) => c.topped_up).length;
  const retried = present.filter((c) => c.retried).length;
  const drifted = present.filter((c) => c.score_key).length;
  const partialCells = rows.flatMap((r) => ['original', 'rewrite'].map((c) => r.judges?.[c]?.[PARTIAL_JUDGE]))
    .filter((c) => c && typeof c.ai_likeness === 'number');
  out.push(`- primary-panel ratings present: ${present.length}/${cells.length}` +
    ` (of these ${toppedUp} repaired by the top-up pass, ${retried} needed a retry, ${drifted} used a drifted score key)`);
  out.push(`- \`${PARTIAL_JUDGE}\` (partial third rater, quota-exhausted): ${partialCells.length} ratings — reported separately, excluded from the primary panel`);
  out.push('');

  out.push('## RQ1 — construct validity (inter-judge agreement)');
  out.push('');
  out.push('| arm | stimulus | units | Krippendorff alpha | Spearman rho | mean abs gap |');
  out.push('|---|---|---:|---:|---:|---:|');
  const alphaByArm = {};
  for (const arm of arms) {
    const armRows = rows.filter((r) => r.arm === arm);
    const a = agreementFor(armRows);
    alphaByArm[arm] = a.alpha;
    out.push(`| ${arm} | ${armRows[0]?.stimulus ?? '?'} | ${a.n_units} | ${fmt(a.alpha, 3)} | ${fmt(a.spearman, 3)} | ${fmt(a.mean_abs_gap)} |`);
  }
  out.push('');
  const primary = alphaByArm.A;
  if (primary === null || primary === undefined) {
    out.push('**RQ1 verdict: cannot evaluate** (Arm A produced no usable agreement units).');
  } else if (primary < ALPHA_GATE) {
    out.push(`**RQ1 verdict: FAIL** — Arm A alpha ${fmt(primary, 3)} < ${ALPHA_GATE}. Per pre-registration the main study is STOPPED and the instrument redesigned.`);
  } else {
    out.push(`**RQ1 verdict: PASS** — Arm A alpha ${fmt(primary, 3)} >= ${ALPHA_GATE}. Efficacy estimates below are interpretable.`);
  }
  out.push('');

  if (alphaByArm.A !== undefined && alphaByArm.B !== undefined && alphaByArm.A !== null && alphaByArm.B !== null) {
    out.push('### Stimulus-length moderator (Arm A vs Arm B, same items)');
    out.push('');
    out.push(`Document-length alpha ${fmt(alphaByArm.A, 3)} vs snippet-length alpha ${fmt(alphaByArm.B, 3)} ` +
      `(penalty ${fmt(alphaByArm.A - alphaByArm.B, 3)}). Arm C (ko) is snippet-length and must be read through this penalty.`);
    out.push('');
  }

  out.push('## RQ2 — perceptual efficacy (independent judge panel)');
  out.push('');
  out.push('AI-likeness is 0-100; a NEGATIVE delta means the rewrite reads less AI-like.');
  out.push('');
  out.push('| arm | class | n | judge before | judge after | delta (95% CI) | Cliff delta | "AI" call: orig -> rewrite |');
  out.push('|---|---|---:|---:|---:|---|---:|---|');
  const eff = {};
  for (const arm of arms) {
    const armRows = rows.filter((r) => r.arm === arm);
    for (const cls of ['ai', 'human']) {
      const e = efficacyFor(armRows, cls);
      if (!e.n) continue;
      eff[`${arm}/${cls}`] = e;
      out.push(`| ${arm} | ${cls} | ${e.n} | ${fmt(e.judge_before)} | ${fmt(e.judge_after)} | ${fmt(e.judge_delta_mean)} ${fmtCI(e.judge_delta_ci)} | ${fmt(e.cliffs_delta, 3)} | ${fmt(e.ai_call_rate_original ? e.ai_call_rate_original * 100 : 0)}% -> ${fmt(e.ai_call_rate_rewrite ? e.ai_call_rate_rewrite * 100 : 0)}% |`);
    }
  }
  out.push('');

  const a_ai = eff['A/ai'];
  if (a_ai) {
    const ci = a_ai.judge_delta_ci;
    const d = fmt(a_ai.judge_delta_mean);
    if (ci && ci[1] < 0) {
      out.push(`**H2a (Arm A, AI texts): SUPPORTED** — mean judge delta ${d}, 95% CI ${fmtCI(ci)} lies entirely below 0.`);
    } else if (ci && ci[0] > 0) {
      // Worse than a null result: the rewrite moved the text AWAY from human.
      out.push(`**H2a (Arm A, AI texts): REFUTED IN REVERSE** — mean judge delta ${d}, 95% CI ${fmtCI(ci)} lies entirely ABOVE 0: the rewrite made the prose read MORE AI-like, not less.`);
    } else {
      out.push(`**H2a (Arm A, AI texts): NOT SUPPORTED** — mean judge delta ${d}, 95% CI ${fmtCI(ci)} includes 0.`);
    }
    out.push('');
    out.push('### Anti-circularity check (pre-registered)');
    out.push('');
    out.push(`Independent-judge delta ${fmt(a_ai.judge_delta_mean)} vs patina internal signal delta ${fmt(a_ai.internal_delta_mean)} (n=${a_ai.internal_n}).`);
    if (a_ai.internal_delta_mean !== null && a_ai.judge_delta_mean !== null) {
      const gaming = a_ai.internal_delta_mean < -1 && a_ai.judge_delta_mean > -1;
      out.push(gaming
        ? '**Verdict: DETECTOR-GAMING SIGNATURE.** patina\'s own score falls while independent judges barely move. Per pre-registration this is reported as a headline finding, not a success.'
        : '**Verdict: no gaming signature** — the internal drop is not decoupled from the independent-judge drop.');
    }
    out.push('');
  }

  const a_hu = eff['A/human'];
  if (a_hu) {
    out.push('## RQ5b — collateral damage on human writing');
    out.push('');
    out.push(`Rewriting human text moved judge AI-likeness by ${fmt(a_hu.judge_delta_mean)} ${fmtCI(a_hu.judge_delta_ci)} ` +
      `and its "AI" call rate from ${fmt(a_hu.ai_call_rate_original * 100)}% to ${fmt(a_hu.ai_call_rate_rewrite * 100)}%. ` +
      'A rise here means patina makes human prose read MORE machine-like — the real-usage failure mode.');
    out.push('');
  }

  // RQ4 — does the humanizer leave its own convergent style?
  const texts = loadTexts();
  const armA = texts.filter((t) => t.arm === 'A');
  const rewriteVs = armA.filter((t) => t.source_class === 'ai' && t.rewritten)
    .map((t) => styleVector(t.rewritten, t.lang)).filter(Boolean);
  const humanVs = armA.filter((t) => t.source_class === 'human' && t.original)
    .map((t) => styleVector(t.original, t.lang)).filter(Boolean);
  const fp = fingerprintTest(rewriteVs, humanVs);
  if (fp) {
    out.push('## RQ4 — humanizer fingerprint (Arm A, deterministic style space)');
    out.push('');
    out.push(`Mean pairwise style cohesion: rewrites ${fmt(fp.rewrite_cohesion, 4)} (n=${rewriteVs.length}) vs human controls ${fmt(fp.human_cohesion, 4)} (n=${humanVs.length}); gap ${fmt(fp.gap, 4)}, permutation p = ${fmt(fp.p, 3)}.`);
    out.push('');
    out.push(fp.gap > 0 && fp.p < 0.05
      ? '**H4: rewrites cluster tighter than independently-authored human prose.** patina imposes a detectable convergent house style — a second-order AI tell that a per-text AI-likeness score cannot see.'
      : '**H4: no significant convergence** — rewrites are no more stylistically alike than human texts are to each other.');
    out.push('');
    out.push('_Small-n pilot estimate; the style vector is 6 deterministic features (sentence length, burstiness, TTR, comma density, dash/colon/semicolon density, token length)._');
    out.push('');
  }

  out.push('## Surviving cues (judge free-text, rewrite condition)');
  out.push('');
  const cues = new Map();
  for (const r of rows) {
    for (const j of JUDGE_IDS) {
      const c = r.judges?.rewrite?.[j]?.strongest_cue;
      if (c) cues.set(c, (cues.get(c) ?? 0) + 1);
    }
  }
  for (const [cue, n] of [...cues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    out.push(`- (${n}×) ${cue}`);
  }
  out.push('');

  // Sensitivity: the same two headline numbers with the excluded register put
  // back. A post-hoc exclusion that changes the conclusion is a finding, not a
  // cleanup step.
  if (droppedRows > 0) {
    out.push('## Sensitivity — excluded register put back');
    out.push('');
    const aAll = allRows.filter((r) => r.arm === 'A');
    const aPri = rows.filter((r) => r.arm === 'A');
    const agAll = agreementFor(aAll);
    const agPri = agreementFor(aPri);
    const efAll = efficacyFor(aAll, 'ai');
    const efPri = efficacyFor(aPri, 'ai');
    out.push('| analysis | Arm A alpha | Arm A ai-delta (95% CI) | n |');
    out.push('|---|---:|---|---:|');
    out.push(`| primary (excl. ${[...EXCLUDED_REGISTERS].join('/')}) | ${fmt(agPri.alpha, 3)} | ${fmt(efPri.judge_delta_mean)} ${fmtCI(efPri.judge_delta_ci)} | ${efPri.n} |`);
    out.push(`| sensitivity (incl.) | ${fmt(agAll.alpha, 3)} | ${fmt(efAll.judge_delta_mean)} ${fmtCI(efAll.judge_delta_ci)} | ${efAll.n} |`);
    out.push('');
    const alphaFlip = (agPri.alpha >= ALPHA_GATE) !== (agAll.alpha >= ALPHA_GATE);
    const signFlip = efPri.judge_delta_ci && efAll.judge_delta_ci
      && (efPri.judge_delta_ci[1] < 0) !== (efAll.judge_delta_ci[1] < 0);
    out.push(alphaFlip || signFlip
      ? '**The exclusion changes a verdict.** That dependence is itself the result: the pilot cannot separate the effect from the corpus defect, and neither analysis should be quoted alone.'
      : 'Both verdicts survive the exclusion, so the headline does not rest on it.');
    out.push('');
  }

  const text = out.join('\n');
  const dest = join(DIR, 'RESULTS.md');
  writeFileSync(dest, text);
  console.log(text);
  console.error(`\n[written] ${dest}`);
}

main();
