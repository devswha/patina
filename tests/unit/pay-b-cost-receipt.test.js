import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { canonicalJson, collectPayBCostSourceBundle, floorDiv, issuePayBCostReceipt, sha256Canonical, validatePayBCostReceipt } from '../../scripts/pay-b-cost-receipt.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const openaiUsage = { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 1 }, cost_usd: 0.001 };
const anthropicUsage = { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 64, cache_creation_input_tokens: 12 };
const billed = (attemptIndex, retryReason, usage = openaiUsage, outcome = 'success') => ({ attemptIndex, requestedModel: 'gpt-4.1-mini', effectiveModel: 'gpt-4.1-mini', usage, retryReason, minimumChargeApplied: false, outcome });
const unbilled = (attemptIndex, retryReason) => ({ attemptIndex, requestedModel: 'gpt-4.1-mini', effectiveModel: null, usage: null, retryReason, minimumChargeApplied: false, outcome: 'error' });
function billingEvidence(attempt, suffix) {
  return attempt.usage === null
    ? { version: 'provider-billing-v1', source: 'provider_usage', provider: 'openai-compatible', externalReferenceSha256: sha(`private-ref:${suffix}`), billed: false, rawUsageSha256: null, unbilledReason: 'provider request failed before billable usage', providerReportedAmountUsdMicros: null }
    : { version: 'provider-billing-v1', source: 'provider_invoice', provider: 'openai-compatible', externalReferenceSha256: sha(`private-ref:${suffix}`), billed: true, rawUsageSha256: sha256Canonical(attempt.usage), unbilledReason: null, providerReportedAmountUsdMicros: 1 };
}
function rawG002() {
  return { collectorVersion: 'g002-attempt-collector-v2', sourceCommitSha: 'a'.repeat(40), deploymentId: 'staging-deployment-g002', channel: 'staging', provider: 'openai-compatible', requestedModel: 'gpt-4.1-mini', effectiveModel: 'gpt-4.1-mini', probes: [
    { id: 'customer-001', inputChars: 1000, stages: { rewrite: [unbilled(1, 'initial'), billed(2, 'transport')], mps: [billed(1, 'initial', anthropicUsage, 'error'), billed(2, 'score_schema_parse', anthropicUsage, 'error'), billed(3, 'initial')], fidelity: [billed(1, 'initial')] } },
    { id: 'customer-002', inputChars: 1300, stages: { rewrite: [billed(1, 'initial', anthropicUsage)], mps: [billed(1, 'initial')], fidelity: [billed(1, 'initial', anthropicUsage)] } },
    { id: 'customer-003', inputChars: 700, stages: { rewrite: [billed(1, 'initial')], mps: [billed(1, 'initial', anthropicUsage)], fidelity: [billed(1, 'initial')] } },
  ] };
}
function facts(raw) { return raw.probes.flatMap((probe) => Object.entries(probe.stages).flatMap(([stage, attempts]) => attempts.map((attempt) => ({ probeId: probe.id, stage, attemptIndex: attempt.attemptIndex, billingEvidence: billingEvidence(attempt, `${probe.id}/${stage}/${attempt.attemptIndex}`) })))); }
function evidence(pricing = {}) {
  const raw = rawG002(); const sourceBundle = collectPayBCostSourceBundle(raw, facts(raw));
  const sourceChars = 'published staging rates with input, output, cache-read, cache-create, granularities, and minimum charge';
  return { schemaVersion: 'PAY-B-COST-v1', receiptId: '123e4567-e89b-42d3-a456-426614174000', issuedAt: '2026-07-15T12:00:00.000Z', sourceCommitSha: sourceBundle.sourceCommitSha, channel: sourceBundle.channel, collectorVersion: sourceBundle.collectorVersion, deploymentId: sourceBundle.deploymentId, provider: sourceBundle.provider, requestedModel: sourceBundle.requestedModel, effectiveModel: sourceBundle.effectiveModel, sourceBundle, sourceBundleSha256: sha256Canonical(sourceBundle), pricing: { source: 'provider staging rate card', sourceChars, sourceSha256: sha(sourceChars), inputUsdMicrosPerMillionTokens: 100, outputUsdMicrosPerMillionTokens: 200, cacheReadUsdMicrosPerMillionTokens: 50, cacheCreationUsdMicrosPerMillionTokens: 150, minimumChargeUsdMicros: 5, inputBillingGranularityTokens: 100, outputBillingGranularityTokens: 100, cacheReadBillingGranularityTokens: 100, cacheCreationBillingGranularityTokens: 100, ...pricing }, financial: { feeUsdMicros: 300_000, refundReserveUsdMicros: 100_000, unitChars: 1_000_000, bootstrap: { iterations: 10_000, confidenceBps: 9500, seed: 'g002-staging-20260715' } } };
}
const issued = (pricing) => issuePayBCostReceipt(evidence(pricing));

test('collector deterministically joins every raw G002 attempt with one billing fact', () => {
  const raw = rawG002(); const bundle = collectPayBCostSourceBundle(raw, facts(raw));
  assert.equal(bundle.usageAdapterVersion, 'g002-provider-usage-v2');
  assert.deepEqual(bundle.probes[0].stages.rewrite[1].usage, openaiUsage); // fixture shape from API tests, including cost_usd and verified total_tokens
  assert.equal(bundle.probes[0].stages.rewrite[1].billingEvidence.rawUsageSha256, sha256Canonical(openaiUsage));
  const unbilledAttempt = bundle.probes[0].stages.rewrite[0];
  assert.deepEqual(unbilledAttempt, { attemptIndex: 1, requestedModel: bundle.requestedModel, effectiveModel: null, usage: null, retryReason: 'initial', minimumChargeApplied: false, outcome: 'error', billingDisposition: 'unbilled', billingEvidence: billingEvidence(unbilledAttempt, 'customer-001/rewrite/1'), billingEvidenceSha256: sha256Canonical(billingEvidence(unbilledAttempt, 'customer-001/rewrite/1')) });
  const nullRequestedModel = rawG002(); nullRequestedModel.probes[0].stages.rewrite[0].requestedModel = null;
  assert.throws(() => collectPayBCostSourceBundle(nullRequestedModel, facts(nullRequestedModel)), /exact requested-model pin/);
  const wrongRequestedModel = rawG002(); wrongRequestedModel.probes[0].stages.rewrite[0].requestedModel = 'other-model';
  assert.throws(() => collectPayBCostSourceBundle(wrongRequestedModel, facts(wrongRequestedModel)), /exact requested-model pin/);
  assert.throws(() => collectPayBCostSourceBundle(raw, facts(raw).slice(1)), /missing fact/);
  assert.throws(() => collectPayBCostSourceBundle(raw, [...facts(raw), facts(raw)[0]]), /duplicate/);
  assert.throws(() => collectPayBCostSourceBundle(raw, [...facts(raw), { ...facts(raw)[0], probeId: 'extra' }]), /extra/);
});

test('issues hash-closed receipt and enforces exact bundle identity, provider, and billing evidence', () => {
  const receipt = issued();
  assert.deepEqual(validatePayBCostReceipt(receipt), receipt);
  assert.deepEqual(receipt.attemptCosts.probes[0].stages.rewrite[0], { amountUsdMicros: 0, inputUsdMicros: 0, outputUsdMicros: 0, cacheReadUsdMicros: 0, cacheCreationUsdMicros: 0, minimumChargeApplied: false });
  const model = evidence(); model.sourceBundle.probes[0].stages.rewrite[1].effectiveModel = 'alias'; model.sourceBundleSha256 = sha256Canonical(model.sourceBundle);
  assert.throws(() => issuePayBCostReceipt(model), /identities must equal exact bundle pins/);
  const nullRequestedModel = evidence(); nullRequestedModel.sourceBundle.probes[0].stages.rewrite[0].requestedModel = null; nullRequestedModel.sourceBundleSha256 = sha256Canonical(nullRequestedModel.sourceBundle);
  assert.throws(() => issuePayBCostReceipt(nullRequestedModel), /exact requested-model pin/);
  const wrongRequestedModel = evidence(); wrongRequestedModel.sourceBundle.probes[0].stages.rewrite[0].requestedModel = 'other-model'; wrongRequestedModel.sourceBundleSha256 = sha256Canonical(wrongRequestedModel.sourceBundle);
  assert.throws(() => issuePayBCostReceipt(wrongRequestedModel), /exact requested-model pin/);
  const provider = evidence(); provider.sourceBundle.probes[0].stages.rewrite[1].billingEvidence.provider = 'other'; provider.sourceBundle.probes[0].stages.rewrite[1].billingEvidenceSha256 = sha256Canonical(provider.sourceBundle.probes[0].stages.rewrite[1].billingEvidence); provider.sourceBundleSha256 = sha256Canonical(provider.sourceBundle);
  assert.throws(() => issuePayBCostReceipt(provider), /provider must equal/);
  const tampered = issued(); tampered.sourceBundle.probes[0].stages.rewrite[1].billingEvidence.providerReportedAmountUsdMicros = 2; tampered.sourceBundleSha256 = sha256Canonical(tampered.sourceBundle);
  assert.throws(() => validatePayBCostReceipt(tampered), /billingEvidenceSha256/);
});

test('usage adapter validates actual OpenAI fields and rejects unsafe usage', () => {
  const invalid = evidence(); invalid.sourceBundle.probes[0].stages.rewrite[1].usage.cost_usd = -1; invalid.sourceBundle.probes[0].stages.rewrite[1].billingEvidence.rawUsageSha256 = sha256Canonical(invalid.sourceBundle.probes[0].stages.rewrite[1].usage); invalid.sourceBundle.probes[0].stages.rewrite[1].billingEvidenceSha256 = sha256Canonical(invalid.sourceBundle.probes[0].stages.rewrite[1].billingEvidence); invalid.sourceBundleSha256 = sha256Canonical(invalid.sourceBundle);
  assert.throws(() => issuePayBCostReceipt(invalid), /cost_usd/);
  const total = evidence(); total.sourceBundle.probes[0].stages.rewrite[1].usage.total_tokens = 99; total.sourceBundle.probes[0].stages.rewrite[1].billingEvidence.rawUsageSha256 = sha256Canonical(total.sourceBundle.probes[0].stages.rewrite[1].usage); total.sourceBundle.probes[0].stages.rewrite[1].billingEvidenceSha256 = sha256Canonical(total.sourceBundle.probes[0].stages.rewrite[1].billingEvidence); total.sourceBundleSha256 = sha256Canonical(total.sourceBundle);
  assert.throws(() => issuePayBCostReceipt(total), /total_tokens/);
});

test('conservative minimum and price sensitivity each win independent vectors', () => {
  const minimum = issued(); const minimumCase = minimum.financial.sensitivity.find((item) => item.case === 'minimum_charge_worst_case'); const priceCase = minimum.financial.sensitivity.find((item) => item.case === 'price_20');
  assert.equal(minimumCase.upperCogsUsdMicros, 42870); // 6 attempts × 5 micros × ceil(1M / 700 chars)
  assert.ok(minimumCase.upperCogsUsdMicros > priceCase.upperCogsUsdMicros);
  const price = issued({ minimumChargeUsdMicros: 1, inputUsdMicrosPerMillionTokens: 100_000, outputUsdMicrosPerMillionTokens: 200_000, cacheReadUsdMicrosPerMillionTokens: 50_000, cacheCreationUsdMicrosPerMillionTokens: 150_000 });
  const highPrice = price.financial.sensitivity.find((item) => item.case === 'price_20'); const lowMinimum = price.financial.sensitivity.find((item) => item.case === 'minimum_charge_worst_case');
  assert.ok(highPrice.upperCogsUsdMicros > lowMinimum.upperCogsUsdMicros);
});

test('floor division rounds negative gross-margin numerators toward negative infinity', () => {
  assert.equal(floorDiv(-1n, 3n), -1n);
  assert.equal(floorDiv(-10_001n, 10_000n), -2n);
});

test('CLI emits only a canonical valid receipt', () => {
  const result = spawnSync(process.execPath, ['scripts/pay-b-cost-receipt.mjs'], { input: JSON.stringify(evidence()), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), issued());
  assert.equal(canonicalJson(issued()), result.stdout.trim());
});
