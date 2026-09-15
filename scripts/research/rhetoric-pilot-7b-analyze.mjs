// Analysis for the H-RHETORIC §7.B pilot (see rhetoric-pilot-7b.mjs).
// Deterministic read-only aggregation of gen-rows.jsonl + judge-rows.jsonl
// against the pre-registered §7.B exit criteria. Prints a JSON summary and a
// markdown fragment; writes nothing outside stdout.
//
// Exit criteria (PLAN.md v2 §7.B, fixed before the run):
//   E1: >=3 of the 12 T cases safely improved over P (both judges agree H wins
//       the H/P comparison, no judge flags meaning damage or lost needed
//       rhetoric on H for that case)
//   E2: 0 T cases where H lost a safe correction (judge flags
//       lost_needed_rhetoric_H or over_deletion_H with agreement)
//   E3: 0 new core-meaning errors on C/N (judge meaning_damage on H with
//       agreement, corroborated by the deterministic number guard)
//   E4: 0 unresolved major judge disagreements (opposite non-tie winners on
//       the same comparison cell)
//   E5: two-judge H/P quality net wins (agreed wins - agreed losses) > 0
// Deterministic observation: droppedNumbers guard per arm output.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deterministicMeaningGuard } from '../../src/verify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'artifacts', 'rhetoric-pilot-20260916');
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const cases = readJsonl(join(DIR, 'sources.private.jsonl'));
const gen = readJsonl(join(DIR, 'gen-rows.jsonl')).filter((r) => r.ok);
const jud = readJsonl(join(DIR, 'judge-rows.jsonl')).filter((r) => r.parsed);
const judFail = readJsonl(join(DIR, 'judge-rows.jsonl')).filter((r) => !r.parsed);

const byCase = {};
for (const c of cases) byCase[c.id] = { c, arms: { N0: c.text }, judges: {} };
for (const r of gen) if (byCase[r.case_id]) byCase[r.case_id].arms[r.arm] = r.text;

// Deterministic guard per arm
const guard = {};
for (const [id, v] of Object.entries(byCase)) {
  guard[id] = {};
  for (const arm of ['G', 'P', 'H']) {
    if (v.arms[arm]) guard[id][arm] = deterministicMeaningGuard(v.c.text, v.arms[arm]);
  }
}

// Judge rows keyed; map winner letters back to arms via recorded order "a-b".
function armWinner(row) {
  const [a, b] = row.order.split('-');
  const w = row.parsed.winner;
  return w === 'tie' ? 'tie' : w === 'A' ? a : b;
}
function flag(row, arm, key) {
  const [a, b] = row.order.split('-');
  const suffix = arm === a ? '_A' : arm === b ? '_B' : null;
  if (!suffix) return null;
  return row.parsed[key + suffix] === true;
}

// Aggregate per case per comparison per judge (primary rows: flipped=false)
const cells = {}; // case|comp -> {judgeId: {winner, damageH, lostH, overH, damageOther}}
for (const r of jud.filter((x) => !x.flipped)) {
  const key = `${r.case_id}|${r.comp}`;
  (cells[key] ??= {})[r.judge] = r;
}
// Flip consistency
const flips = jud.filter((x) => x.flipped);
let flipChecked = 0, flipConsistent = 0;
for (const f of flips) {
  const primary = jud.find((x) => !x.flipped && x.case_id === f.case_id && x.comp === f.comp && x.judge === f.judge);
  if (!primary) continue;
  flipChecked += 1;
  const pw = armWinner(primary), fw = armWinner(f);
  if (pw === fw || (pw === 'tie' && fw === 'tie')) flipConsistent += 1;
}

const T = cases.filter((c) => c.group === 'T').map((c) => c.id);
const CN = cases.filter((c) => c.group !== 'T').map((c) => c.id);
const JUDGE_IDS = ['judge-gpt', 'judge-gemini-3.7-flash'];

// E1/E5 on H/P
let tImproved = [], tLostSafe = [], hpAgreedWins = 0, hpAgreedLosses = 0, disagreements = [];
for (const c of cases) {
  const cell = cells[`${c.id}|H/P`] || {};
  const rows = JUDGE_IDS.map((j) => cell[j]).filter(Boolean);
  if (rows.length < 2) continue;
  const winners = rows.map(armWinner);
  const bothH = winners.every((w) => w === 'H');
  const bothP = winners.every((w) => w === 'P');
  if (winners.filter((w) => w !== 'tie').length === 2 && winners[0] !== winners[1]) disagreements.push(`${c.id}|H/P`);
  const hDamage = rows.some((r) => flag(r, 'H', 'meaning_damage'));
  const hLost = rows.some((r) => flag(r, 'H', 'lost_needed_rhetoric') || flag(r, 'H', 'over_deletion'));
  if (bothH) hpAgreedWins += 1;
  if (bothP) hpAgreedLosses += 1;
  if (T.includes(c.id)) {
    if (bothH && !hDamage && !hLost) tImproved.push(c.id);
    const bothLost = rows.every((r) => flag(r, 'H', 'lost_needed_rhetoric') === true || flag(r, 'H', 'over_deletion') === true);
    if (bothLost) tLostSafe.push(c.id);
  }
}
// E3: C/N meaning damage on H across all comparisons involving H, agreement = both judges of a cell flag it
let cnDamage = [];
for (const id of CN) {
  for (const comp of ['H/P', 'H/G', 'H/N0']) {
    const cell = cells[`${id}|${comp}`] || {};
    const rows = JUDGE_IDS.map((j) => cell[j]).filter(Boolean);
    if (rows.length === 2 && rows.every((r) => flag(r, 'H', 'meaning_damage'))) cnDamage.push(`${id}|${comp}`);
  }
}
// deterministic guard corroboration
const guardWarn = {};
for (const [id, arms] of Object.entries(guard)) for (const [arm, warns] of Object.entries(arms)) if (warns.length) (guardWarn[id] ??= {})[arm] = warns;

// disagreements across all comps
for (const [key, cell] of Object.entries(cells)) {
  const rows = JUDGE_IDS.map((j) => cell[j]).filter(Boolean);
  if (rows.length < 2) continue;
  const w = rows.map(armWinner).filter((x) => x !== 'tie');
  if (w.length === 2 && w[0] !== w[1] && !disagreements.includes(key)) disagreements.push(key);
}

const genFail = readJsonl(join(DIR, 'gen-rows.jsonl')).filter((r) => !r.ok);
const summary = {
  cases: cases.length,
  gen_ok: gen.length, gen_failed: genFail.map((r) => `${r.case_id}|${r.arm}:${r.error}`),
  judge_ok: jud.length, judge_failed: judFail.map((r) => `${r.case_id}|${r.comp}|${r.judge}|${r.flipped}:${r.error}`),
  E1_t_safely_improved: { count: tImproved.length, cases: tImproved, pass: tImproved.length >= 3 },
  E2_t_lost_safe_correction: { count: tLostSafe.length, cases: tLostSafe, pass: tLostSafe.length === 0 },
  E3_cn_new_meaning_errors: { count: cnDamage.length, cells: cnDamage, pass: cnDamage.length === 0 },
  E4_unresolved_disagreements: { count: disagreements.length, cells: disagreements, pass: disagreements.length === 0 },
  E5_hp_net_wins: { agreed_wins: hpAgreedWins, agreed_losses: hpAgreedLosses, net: hpAgreedWins - hpAgreedLosses, pass: hpAgreedWins - hpAgreedLosses > 0 },
  flips: { checked: flipChecked, consistent: flipConsistent },
  deterministic_number_guard_warnings: guardWarn,
};
summary.all_pass = ['E1_t_safely_improved', 'E2_t_lost_safe_correction', 'E3_cn_new_meaning_errors', 'E4_unresolved_disagreements', 'E5_hp_net_wins'].every((k) => summary[k].pass);
console.log(JSON.stringify(summary, null, 1));
