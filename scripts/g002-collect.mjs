#!/usr/bin/env node
// G002 in-process collector: runs the three PAY-B-COST probes through the real
// runWebRewriteStream pipeline (rewrite + MPS + fidelity on the production
// model), captures the exact per-attempt provider usage the stream privately
// aggregates, and issues the PAY-B-COST-v1 receipt.
//
// Design note (supersedes the log-scrape idea in g002-collector-redesign.md):
// the Vercel log-query service from the removed ops harness is gone, and the
// stream already RETURNS validated one-based attempt records to its in-process
// caller. Running the pinned source commit locally gives byte-exact attempt
// capture with no deployment scraping. deploymentId is recorded as
// `local-<commit>` to say exactly what it was.
//
// Usage:
//   node scripts/g002-collect.mjs --pricing docs/operations/pricing-claude-sonnet-5.json [--out docs/operations/pay-b-cost-<date>.json]
// Key: PATINA_PRO_API_KEY_LOCAL or ~/.patina/pro-key.local (never printed).
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runWebRewriteStream } from '../src/web-rewrite-stream.js';
import { collectPayBCostSourceBundle, derivePayBCostFinancial, issuePayBCostReceipt, sha256Canonical, canonicalJson } from './pay-b-cost-receipt.mjs';

const MODEL = process.env.G002_MODEL || 'claude-sonnet-5';
const BASE = 'https://api.anthropic.com/v1';
const PROVIDER = 'claude';
const EVIDENCE_ID = 'PAY-B-20260723-1236551-1932893';
const COLLECTOR_VERSION = 'g002-inproc-v1';

// Three realistic customer-register probes (KO business, EN blog, KO SNS).
const PROBES = [
  {
    id: 'probe-ko-business',
    lang: 'ko',
    text: [
      '금번 분기 실적 발표와 관련하여 안내드립니다. 당사는 빠르게 변화하는 시장 환경 속에서도 혁신적인 기술력을 바탕으로 고객 여러분께 차별화된 가치를 제공하기 위해 끊임없이 노력해 왔습니다.',
      '3분기 매출은 전년 동기 대비 12% 증가한 48억 원을 기록하였으며, 신규 가입 고객은 23,000명을 넘어섰습니다. 이는 단순한 수치상의 성장이 아니라, 당사가 추진해 온 디지털 전환 전략이 시장에서 긍정적인 평가를 받고 있음을 보여주는 결과라고 할 수 있습니다.',
      '앞으로도 당사는 고객 중심 경영을 최우선 가치로 삼아, 지속 가능한 성장을 위한 기반을 다져나가겠습니다. 여러분의 변함없는 관심과 성원을 부탁드립니다.',
    ].join('\n\n'),
  },
  {
    id: 'probe-en-blog',
    lang: 'en',
    text: [
      "In today's fast-paced digital landscape, building a personal brand isn't just an option — it's a necessity. Here's the thing: most creators focus on polishing their content, but what nobody tells you is that distribution matters far more than perfection.",
      'When I started my newsletter two years ago, I spent weeks agonizing over every sentence. The result: three subscribers, two of whom were my parents. Then I changed my approach and started publishing twice a week, imperfections and all. Within six months the list grew to 4,800 readers.',
      "The lesson isn't complicated. Consistent, good-enough publishing beats sporadic perfection, and the compounding effect of showing up regularly is what actually builds an audience over time.",
    ].join('\n\n'),
  },
  {
    id: 'probe-ko-sns',
    lang: 'ko',
    text: [
      '솔직히 말하면, 저는 이 앱을 처음 봤을 때 별 기대가 없었습니다. 시중에 비슷한 서비스가 이미 넘쳐나니까요.',
      '그런데 일주일 써보고 생각이 완전히 바뀌었습니다. 반전: 하루 10분 투자로 업무 정리 시간이 40% 넘게 줄었습니다. 아무도 말해주지 않는 사실 하나 — 도구는 기능이 아니라 습관을 만들어줄 때 가치가 있습니다.',
      '한 달 무료니까 일단 써보시고, 안 맞으면 지우면 됩니다. 저는 유료 전환했습니다.',
    ].join('\n\n'),
  },
];

function loadKey() {
  if (process.env.PATINA_PRO_API_KEY_LOCAL) return process.env.PATINA_PRO_API_KEY_LOCAL.trim();
  try { return readFileSync(join(homedir(), '.patina', 'pro-key.local'), 'utf8').trim(); } catch {}
  console.error('no key: set PATINA_PRO_API_KEY_LOCAL or write ~/.patina/pro-key.local');
  process.exit(2);
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const pricingPath = arg('--pricing');
if (!pricingPath) { console.error('usage: g002-collect.mjs --pricing <pricing.json> [--out <receipt.json>]'); process.exit(2); }
const pricing = JSON.parse(readFileSync(pricingPath, 'utf8'));
const sourceCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const outPath = arg('--out', `docs/operations/pay-b-cost-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.json`);
const apiKey = loadKey();

const rawProbes = [];
let effectiveModel = null;
for (const probe of PROBES) {
  // The rewrite model is nondeterministic: a run can trip the number-safety
  // guard (rewrite mutated a numeric claim -> scoring never runs) and a probe
  // then lacks complete stage records. Retry the probe wholesale, up to three
  // runs, and keep the first run whose three stages all terminated in success.
  // floor_failed is acceptable: scoring completed, so its cost data is whole;
  // probe-level retry overhead is covered by the receipt's retry_failure
  // sensitivity cases.
  let accepted = null;
  for (let attempt = 1; attempt <= 3 && !accepted; attempt += 1) {
    console.error(`[g002] running ${probe.id} (${probe.text.length} chars), try ${attempt}…`);
    const result = await runWebRewriteStream({
      request: { mode: 'first', lang: probe.lang, tier: 'pro', text: probe.text, apiKey, baseURL: BASE, model: MODEL },
      emit: () => {},
      timeout: 180_000,
    });
    if (!result.attempts?.valid) throw new Error(`${probe.id}: attempt records invalid`);
    if (!result.ok) console.error(`[g002] ${probe.id} terminal: ${result.code}`);
    const complete = ['rewrite', 'mps', 'fidelity'].every((stage) => result.attempts[stage].length > 0 && result.attempts[stage].at(-1).outcome === 'success');
    if (complete) accepted = result;
    else console.error(`[g002] ${probe.id}: incomplete stages, retrying`);
  }
  if (!accepted) throw new Error(`${probe.id}: no complete run in 3 tries`);
  for (const stage of ['rewrite', 'mps', 'fidelity']) {
    const terminal = accepted.attempts[stage].at(-1);
    if (effectiveModel === null) effectiveModel = terminal.effectiveModel;
    if (terminal.effectiveModel !== effectiveModel) throw new Error(`${probe.id}/${stage}: effective model drift ${terminal.effectiveModel}`);
  }
  rawProbes.push({ id: probe.id, inputChars: probe.text.length, stages: { rewrite: accepted.attempts.rewrite, mps: accepted.attempts.mps, fidelity: accepted.attempts.fidelity } });
}

const rawG002 = { channel: 'staging', collectorVersion: COLLECTOR_VERSION, deploymentId: `local-${sourceCommitSha}`, effectiveModel, provider: PROVIDER, requestedModel: MODEL, sourceCommitSha, probes: rawProbes };
const providerBillingFacts = [];
for (const probe of rawProbes) {
  for (const stage of ['rewrite', 'mps', 'fidelity']) {
    for (const record of probe.stages[stage]) {
      // Paid means the provider metered it: an errored attempt that still
      // carries usage (e.g. a schema-parse retry after a full response) was
      // billed all the same.
      const billed = record.usage !== null;
      providerBillingFacts.push({
        probeId: probe.id,
        stage,
        attemptIndex: record.attemptIndex,
        billingEvidence: {
          version: 'provider-billing-v1',
          source: 'provider_usage',
          provider: PROVIDER,
          billed,
          rawUsageSha256: billed ? sha256Canonical(record.usage) : null,
          providerReportedAmountUsdMicros: null,
          externalReferenceSha256: createHash('sha256').update(`${probe.id}:${stage}:${record.attemptIndex}:${sourceCommitSha}`).digest('hex'),
          unbilledReason: billed ? null : 'provider_error_without_usage',
        },
      });
    }
  }
}

const sourceBundle = collectPayBCostSourceBundle(rawG002, providerBillingFacts);
const evidence = {
  schemaVersion: 'PAY-B-COST-v1',
  receiptId: randomUUID(),
  issuedAt: new Date().toISOString(),
  channel: 'staging',
  collectorVersion: COLLECTOR_VERSION,
  deploymentId: rawG002.deploymentId,
  provider: PROVIDER,
  requestedModel: MODEL,
  effectiveModel,
  sourceCommitSha,
  sourceBundle,
  sourceBundleSha256: sha256Canonical(sourceBundle),
  pricing,
  financial: {
    unitChars: 1_000_000,
    feeUsdMicros: 999_500,
    refundReserveUsdMicros: 499_500,
    bootstrap: { seed: EVIDENCE_ID, iterations: 10_000, confidenceBps: 9500 },
  },
};
writeFileSync(`${outPath}.bundle.json`, `${canonicalJson({ rawG002, providerBillingFacts, pricing, financialInputs: evidence.financial })}\n`);
console.error(`[g002] raw bundle persisted: ${outPath}.bundle.json (offline scenario re-analysis needs no further spend)`);
try {
  const receipt = issuePayBCostReceipt(evidence);
  writeFileSync(outPath, `${canonicalJson(receipt)}\n`);
  console.error(`[g002] receipt written: ${outPath}`);
  console.error(`[g002] upper COGS/1M chars: $${(receipt.financial.selectedUpperCogsUsdMicros / 1e6).toFixed(2)} | gross margin: ${(receipt.financial.grossMarginBps / 100).toFixed(1)}% (gate >=60%) — PASSED`);
} catch (error) {
  // The issuer mutates financial with the derived numbers before enforcing the
  // margin gate, so a rejection still leaves the real measurements available.
  console.error(`[g002] receipt REFUSED: ${error.message}`);
  const f = { ...evidence.financial, ...derivePayBCostFinancial(evidence) };
  if (Number.isFinite(f.selectedUpperCogsUsdMicros)) {
    console.error(`[g002] measured upper COGS/1M chars: $${(f.selectedUpperCogsUsdMicros / 1e6).toFixed(2)}`);
    console.error(`[g002] net revenue/mo: $${(f.netRevenueUsdMicros / 1e6).toFixed(2)} | gross margin at the 1M-char cap: ${(f.grossMarginBps / 100).toFixed(1)}%`);
    const cap60 = Math.floor((f.netRevenueUsdMicros * 0.4) / (f.selectedUpperCogsUsdMicros / 1_000_000));
    console.error(`[g002] monthly char cap that clears 60% margin at this COGS: ~${cap60.toLocaleString()} chars`);
  }
  process.exitCode = 3;
}
