import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BEST_MODELS } from '../../src/model-defaults.js';
import { PROVIDERS } from '../../src/providers.js';
import { PROVIDER_PRESETS } from '../../src/web-rewrite-contract.js';
import { CHECKOUT_EVIDENCE_BINDINGS, checkoutEvidenceBindingKey } from '../../scripts/checkout-evidence-bindings.mjs';
import { validateCheckedInPreflightHold, validatePreflightHold } from '../../scripts/check-v6.4-preflight-hold.mjs';

const stateUrl = new URL('../../docs/operations/v6.4-preflight-hold.json', import.meta.url);
const scriptUrl = new URL('../../scripts/check-v6.4-preflight-hold.mjs', import.meta.url);
const evidenceUrl = new URL('../../docs/operations/pay-stg-binding-20260716.json', import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));
const checkedInState = () => JSON.parse(readFileSync(stateUrl, 'utf8'));
const checkedInEvidence = () => JSON.parse(readFileSync(evidenceUrl, 'utf8'));
function setAtPath(value, path, replacement) { const parent = path.slice(0, -1).reduce((current, key) => current[key], value); parent[path.at(-1)] = replacement; }
function leaves(value, path = []) { if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, [...path, index])); if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => leaves(entry, [...path, key])); return [path]; }
const validSources = () => ({ modelDefaults: clone(DEFAULT_BEST_MODELS), providers: clone(PROVIDERS), webProviderPresets: clone(PROVIDER_PRESETS), launch: { schemaVersion: 1, channel: 'disabled', enabled: false, checkoutOrigin: null, checkoutPath: null, evidence: null }, bindings: CHECKOUT_EVIDENCE_BINDINGS, checkHashes: false });

test('checked-in v6.4 preflight state is a staging-ready non-receipt hold', () => {
  const state = checkedInState();
  assert.deepEqual(validateCheckedInPreflightHold(), []);
  assert.equal(state.promotionRows.length, 5);
  assert.equal(state.completedDecisions.length, 7);
  assert.equal(state.blockers.length, 11);
  assert.equal(state.deferredActions.length, 3);
  assert.ok(state.blockers.every((blocker) => blocker.type === 'human_action' && blocker.evidence === null));
  assert.ok(state.deferredActions.every((action) => action.type === 'repo_action' && action.executable === false));
  assert.deepEqual(state.completedDecisions.slice(-2), [
    { id: 'PAY_STG_BINDING_APPROVAL', status: 'COMPLETED', evidence: 'PAY-STG-20260716-1199625-1875389' },
    { id: 'SOURCE_BINDING_STAGING_INTEGRATION', status: 'COMPLETED', evidence: 'PAY-STG-20260716-1199625-1875389' },
  ]);
});

test('validator rejects every held env-name, blocker, decision, deferred action, and freeze hash mutation', () => {
  const original = checkedInState();
  for (const path of leaves(original.blockers)) { const state = clone(original); setAtPath(state.blockers, path, '__mutated__'); assert.notDeepEqual(validatePreflightHold(state, validSources()), []); }
  for (const path of leaves(original.completedDecisions)) { const state = clone(original); setAtPath(state.completedDecisions, path, '__mutated__'); assert.notDeepEqual(validatePreflightHold(state, validSources()), []); }
  for (const path of leaves(original.deferredActions)) { const state = clone(original); setAtPath(state.deferredActions, path, '__mutated__'); assert.notDeepEqual(validatePreflightHold(state, validSources()), []); }
  for (const path of leaves(original.frozenSemantics.sourceHashes)) { const state = clone(original); setAtPath(state.frozenSemantics.sourceHashes, path, '0'.repeat(64)); assert.match(validatePreflightHold(state, validSources()).join('\n'), /frozenSemantics/); }
  const generatorHash = checkedInState(); generatorHash.frozenSemantics.sourceHashes['scripts/generate-launch-config.mjs'] = '0'.repeat(64); assert.match(validatePreflightHold(generatorHash, validSources()).join('\n'), /frozenSemantics/);
  const suppliedGeneratorHash = validSources(); delete suppliedGeneratorHash.checkHashes; suppliedGeneratorHash.hashFile = (file) => file === 'scripts/generate-launch-config.mjs' ? '0'.repeat(64) : original.frozenSemantics.sourceHashes[file]; assert.match(validatePreflightHold(original, suppliedGeneratorHash).join('\n'), /frozen SHA-256 mismatch: scripts\/generate-launch-config\.mjs/);
  const secretRecord = original.blockers.find((blocker) => blocker.id === 'SECRET_MANAGER').exitEvidence;
  for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'LS_STORE_ID', 'LS_PRO_PRODUCT_ID', 'LS_PRO_VARIANT_ID', 'PATINA_PRO_API_KEY', 'PATINA_LICENSE_HMAC_SECRET', 'PATINA_QUOTA_HMAC_SECRET', 'PATINA_FREE_API_KEY', 'PATINA_PRO_PROVIDER', 'PATINA_PRO_MODEL', 'PATINA_PRO_CHECKOUT_ENABLED', 'PATINA_PRO_CHECKOUT_URL', 'PATINA_PRO_GATE_EVIDENCE_ID', 'PATINA_DEPLOYMENT_CHANNEL', 'PATINA_OBSERVABILITY_REST_API_URL', 'PATINA_OBSERVABILITY_REST_API_TOKEN', 'CRON_SECRET', 'PATINA_PUBLIC_BASE_URL', 'PATINA_PUBLIC_BASE_URL_SHA256', 'PATINA_SYNTHETIC_PRO_LICENSE', 'PATINA_SYNTHETIC_OBSERVER_SECRET', 'PATINA_VERCEL_LOG_QUERY_URL', 'PATINA_VERCEL_LOG_QUERY_URL_SHA256', 'PATINA_VERCEL_LOG_QUERY_TOKEN', 'PATINA_ALERT_DISCORD_WEBHOOK', 'VERCEL_GIT_COMMIT_SHA', 'PATINA_PRO_ALLOW_FREE_KEY']) assert.match(secretRecord, new RegExp(name));
});

test('validator rejects every held source default, provider semantic field, launch field, and binding mutation', () => {
  const sourceFields = [['webProviderPresets', 'openai', 'models', 0], ['modelDefaults', 'codexCli'], ['modelDefaults', 'claudeCli'], ['providers', 'gemini', 'defaultModel'], ['modelDefaults', 'geminiCli']];
  for (const path of sourceFields) { const sources = validSources(); setAtPath(sources, path, '__mutated__'); assert.match(validatePreflightHold(checkedInState(), sources).join('\n'), /held source default/); }
  for (const provider of Object.keys(PROVIDERS)) for (const field of ['name', 'baseURL', 'apiKeyEnv', 'defaultModel', 'freeTier', 'note']) { const sources = validSources(); sources.providers[provider][field] = field === 'freeTier' ? !sources.providers[provider][field] : '__mutated__'; assert.match(validatePreflightHold(checkedInState(), sources).join('\n'), new RegExp(`source provider ${provider}`)); }
  for (const field of ['schemaVersion', 'channel', 'enabled', 'checkoutOrigin', 'checkoutPath', 'evidence']) { const sources = validSources(); sources.launch[field] = field === 'enabled' ? true : '__mutated__'; assert.match(validatePreflightHold(checkedInState(), sources).join('\n'), /launch artifact/); }
  const binding = { channel: 'staging', evidence: 'PAY-STG-20260716-1199625-1875389', origin: 'https://vibetip.lemonsqueezy.com', path: '/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' };
  for (const overrides of [{ origin: 'https://other.example.test' }, { path: '/checkout/buy/other' }, { evidence: 'PAY-STG-other' }, { channel: 'production' }]) {
    const sources = validSources();
    sources.bindings = Object.freeze({ [checkoutEvidenceBindingKey({ ...binding, ...overrides })]: true });
    assert.match(validatePreflightHold(checkedInState(), sources).join('\n'), /binding table/);
  }
  const extra = validSources();
  extra.bindings = Object.freeze({ ...CHECKOUT_EVIDENCE_BINDINGS, extra: true });
  assert.match(validatePreflightHold(checkedInState(), extra).join('\n'), /binding table/);
  const unfrozen = validSources();
  unfrozen.bindings = { ...CHECKOUT_EVIDENCE_BINDINGS };
  assert.match(validatePreflightHold(checkedInState(), unfrozen).join('\n'), /binding table/);
});
test('validator cryptographically and semantically validates the staging Lemon evidence', () => {
  const state = checkedInState();
  const mutateEvidence = (mutate, expected) => {
    const sources = validSources();
    sources.evidence = checkedInEvidence();
    mutate(sources.evidence);
    assert.match(validatePreflightHold(state, sources).join('\n'), expected);
  };
  mutateEvidence((evidence) => { evidence.factsSha256 = '0'.repeat(64); }, /factsSha256/);
  mutateEvidence((evidence) => { evidence.product.extra = true; }, /must contain exactly/);
  mutateEvidence((evidence) => { evidence.store.id = 425473; }, /store.id/);
  mutateEvidence((evidence) => { evidence.product.testMode = false; }, /published and test mode/);
  mutateEvidence((evidence) => { evidence.variant.interval = 'year'; }, /monthly/);
  mutateEvidence((evidence) => { evidence.variant.priceCents = 1000; }, /monthly/);
  mutateEvidence((evidence) => { evidence.variant.hasLicenseKeys = false; }, /license keys/);
  mutateEvidence((evidence) => { evidence.prices = evidence.prices.filter((price) => price.category !== 'subscription'); }, /current subscription price/);
  mutateEvidence((evidence) => { evidence.product.buyNowUrl = 'https://other.example.test/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514'; }, /checkout URL/);
  const joined = validSources();
  joined.evidence = checkedInEvidence();
  joined.bindings = Object.freeze({ [checkoutEvidenceBindingKey({ channel: 'staging', evidence: joined.evidence.evidenceId, origin: 'https://other.example.test', path: '/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' })]: true });
  assert.match(validatePreflightHold(state, joined).join('\n'), /validated staging binding/);
  const historicalOneTime = validSources();
  historicalOneTime.evidence = checkedInEvidence();
  assert.deepEqual(validatePreflightHold(state, historicalOneTime), []);
});

test('validator rejects unknown, self-referential, cyclic, and reversed dependency edges', () => {
  const unknown = checkedInState(); unknown.deferredActions[0].blockedBy = ['NOT_A_DEFINED_ID']; assert.match(validatePreflightHold(unknown, validSources()).join('\n'), /unknown ID/);
  const self = checkedInState(); self.deferredActions[0].blockedBy = ['SOURCE_BINDING_PRODUCTION_INTEGRATION']; assert.match(validatePreflightHold(self, validSources()).join('\n'), /self reference/);
  const cyclic = checkedInState(); cyclic.deferredActions[0].blockedBy = ['V6_4_METADATA_COPY_RECONCILIATION']; cyclic.deferredActions[1].blockedBy = ['SOURCE_BINDING_PRODUCTION_INTEGRATION']; assert.match(validatePreflightHold(cyclic, validSources()).join('\n'), /cycle/);
  const reversed = checkedInState(); reversed.deferredActions[0].blockedBy = ['GATE_B']; assert.match(validatePreflightHold(reversed, validSources()).join('\n'), /reverses release order/);
});
test('validator retains production source-binding and deployment evidence blockers', () => {
  const productionDependency = checkedInState();
  productionDependency.deferredActions[0].blockedBy = ['GATE_B'];
  assert.match(validatePreflightHold(productionDependency, validSources()).join('\n'), /SOURCE_BINDING_PRODUCTION_INTEGRATION/);
  const stagingEvidence = checkedInState();
  stagingEvidence.blockers.find((blocker) => blocker.id === 'PAY_STG').exitEvidence = stagingEvidence.blockers.find((blocker) => blocker.id === 'PAY_STG').exitEvidence.replace('completed staging source-binding integration commit or artifact', 'completed staging source-binding integration');
  assert.match(validatePreflightHold(stagingEvidence, validSources()).join('\n'), /PAY_STG/);
  const gateBEvidence = checkedInState();
  gateBEvidence.blockers.find((blocker) => blocker.id === 'GATE_B').exitEvidence = gateBEvidence.blockers.find((blocker) => blocker.id === 'GATE_B').exitEvidence.replace('completed production source-binding integration commit or artifact', 'completed production source-binding integration');
  assert.match(validatePreflightHold(gateBEvidence, validSources()).join('\n'), /GATE_B/);
});

test('validator rejects missing keys, reorderings, fake receipts, and changed freeze hashes', () => {
  const missing = checkedInState(); delete missing.deferredActions; assert.match(validatePreflightHold(missing, validSources()).join('\n'), /exactly/);
  const reordered = checkedInState(); [reordered.blockers[0], reordered.blockers[1]] = [reordered.blockers[1], reordered.blockers[0]]; assert.match(validatePreflightHold(reordered, validSources()).join('\n'), /LS_APPROVAL/);
  const fakeReceipt = checkedInState(); fakeReceipt.receipt = 'fabricated'; assert.match(validatePreflightHold(fakeReceipt, validSources()).join('\n'), /forbidden/);
  const hash = checkedInState(); hash.frozenSemantics.sourceHashes['src/providers.js'] = '0'.repeat(64); assert.match(validatePreflightHold(hash, validSources()).join('\n'), /frozenSemantics/);
});

test('validator executable accepts the checked-in state', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [fileURLToPath(scriptUrl)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight hold is valid/);
});
