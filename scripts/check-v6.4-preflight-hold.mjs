import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BEST_MODELS } from '../src/model-defaults.js';
import { PROVIDERS } from '../src/providers.js';
import { PROVIDER_PRESETS } from '../src/web-rewrite-contract.js';
import { CHECKOUT_EVIDENCE_BINDINGS, checkoutEvidenceBindingKey } from './checkout-evidence-bindings.mjs';
import launchConfig from '../playground/launch-config.js';

const STATE_URL = new URL('../docs/operations/v6.4-preflight-hold.json', import.meta.url);
const EVIDENCE_URL = new URL('../docs/operations/pay-stg-binding-20260716.json', import.meta.url);
const RUNTIME_EVIDENCE_URL = new URL('../docs/operations/pay-stg-runtime-20260716.json', import.meta.url);
const PRODUCTION_EVIDENCE_URL = new URL('../docs/operations/pay-b-binding-20260723.json', import.meta.url);
const ROOT_URL = new URL('../', import.meta.url);
const REQUIRED_EVIDENCE_ID = 'PAY-STG-20260716-1199625-1875389';
const REQUIRED_RUNTIME_EVIDENCE_ID = 'PAY-STG-RUNTIME-20260716-8973866';
const REQUIRED_PRODUCTION_EVIDENCE_ID = 'PAY-B-20260723-1236551-1932893';
const REQUIRED_ROWS = [['OpenAI HTTP', 'gpt-5.5', 'gpt-5.6'], ['Codex CLI', 'gpt-5.5', 'gpt-5.6'], ['Claude CLI', 'claude-sonnet-4-6', 'claude-sonnet-5'], ['Gemini HTTP', 'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'opt_in_only'], ['Gemini CLI', 'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'opt_in_only']];
const SECRET_NAMES = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'LS_STORE_ID', 'LS_PRO_PRODUCT_ID', 'LS_PRO_VARIANT_ID', 'PATINA_PRO_API_KEY', 'PATINA_LICENSE_HMAC_SECRET', 'PATINA_QUOTA_HMAC_SECRET', 'PATINA_FREE_API_KEY', 'PATINA_PRO_PROVIDER', 'PATINA_PRO_MODEL', 'PATINA_PRO_CHECKOUT_ENABLED', 'PATINA_PRO_CHECKOUT_URL', 'PATINA_PRO_GATE_EVIDENCE_ID', 'PATINA_DEPLOYMENT_CHANNEL', 'PATINA_OBSERVABILITY_REST_API_URL', 'PATINA_OBSERVABILITY_REST_API_TOKEN', 'CRON_SECRET', 'PATINA_PUBLIC_BASE_URL', 'PATINA_PUBLIC_BASE_URL_SHA256', 'PATINA_SYNTHETIC_PRO_LICENSE', 'PATINA_SYNTHETIC_OBSERVER_SECRET', 'PATINA_VERCEL_LOG_QUERY_URL', 'PATINA_VERCEL_LOG_QUERY_URL_SHA256', 'PATINA_VERCEL_LOG_QUERY_TOKEN', 'PATINA_ALERT_DISCORD_WEBHOOK', 'VERCEL_GIT_COMMIT_SHA'];
const SECRET_EVIDENCE = `Secret-manager presence-only record, without values, for ${SECRET_NAMES.join(', ')}; PATINA_PRO_ALLOW_FREE_KEY is absent or exactly false.`;
const REQUIRED_BLOCKERS = [['LS_APPROVAL', 'Lemon Squeezy Approval Owner', 'Immutable Lemon Squeezy approval naming the exact store, product, and variant identities; exact staging and production HTTPS checkout URLs; and approval that is immutable.'], ['SECRET_MANAGER', 'Secret Manager Owner', SECRET_EVIDENCE], ['PAY_STG', 'Deployment Owner', 'Immutable private-staging PAY-STG deployment record naming the exact staging HTTPS checkout URL and completed staging source-binding integration commit or artifact.'], ['GATE_B', 'Payment Runtime Owner + maintainer', 'Gate-B approval by the Payment Runtime Owner and maintainer proving completed production source-binding integration commit or artifact, hosted identity, usage, dedicated runtime, content-valid PAY-B-COST evidence, and real-path OBS evidence.'], ['DEP_PROD_DISABLED', 'Deployment Owner', 'Immutable production-disabled artifact/config with the exact disabled launch shape; browser evidence that checkout is disabled; health, monitor, and operator evidence; and UTC timestamps.'], ['GATE_D', 'Release Authority', 'Gate-D record proving mandatory gates passed and naming the approving Release Authority.'], ['ROLLBACK_DRILLS', 'Deployment Owner', 'Timestamped rollback records: sale-close completed within 10 minutes, plus correctness evidence for service-kill and fallback without a 10-minute claim.'], ['PAY_OPEN', 'Maintainer', 'Maintainer authorization to open payment after the required gates and immutable evidence are complete.'], ['PAY_LIVE', 'Payment Runtime Owner', 'Bounded real-production payment, refund, revoke, license-denial, and recovery evidence, including denial and recovery within the documented propagation bound.'], ['REL_PUBLISH', 'Release Authority', 'Final Release Authority approval for the v6.4 tag and registry publication.']];
const REQUIRED_DECISIONS = [['GATE_C_OPENAI_HTTP_NO_PROMOTION', 'HOLD_NO_PROMOTION'], ['GATE_C_CODEX_CLI_NO_PROMOTION', 'HOLD_NO_PROMOTION'], ['GATE_C_CLAUDE_CLI_NO_PROMOTION', 'HOLD_NO_PROMOTION'], ['GATE_C_GEMINI_HTTP_NO_PROMOTION', 'HOLD_NO_PROMOTION'], ['GATE_C_GEMINI_CLI_NO_PROMOTION', 'HOLD_NO_PROMOTION'], ['PAY_STG_BINDING_APPROVAL', 'COMPLETED'], ['SOURCE_BINDING_STAGING_INTEGRATION', 'COMPLETED'], ['PAY_STG_RUNTIME_TEST_SMOKE', 'COMPLETED'], ['PAY_B_BINDING_APPROVAL', 'COMPLETED'], ['SOURCE_BINDING_PRODUCTION_INTEGRATION', 'COMPLETED']];
const REQUIRED_DEFERRED_ACTIONS = [['V6_4_METADATA_COPY_RECONCILIATION', ['GATE_B'], 'Cannot reconcile 6.4 metadata and copy until Gate B evidence exists; Gate-C no-promotion cutoff decisions are complete.'], ['FINAL_TAG_PUBLISH_COMMAND', ['PAY_LIVE', 'REL_PUBLISH'], 'Cannot run the final tag and publish command until named external evidence exists.']];
const FROZEN_SEMANTICS = Object.freeze({ manifestVersion: 3, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([key, provider]) => [key, Object.fromEntries(['name', 'baseURL', 'apiKeyEnv', 'defaultModel', 'freeTier', 'note'].map((field) => [field, provider[field]]))])), sourceHashes: {
  '.env.example': '7f33aea2fbd9649c350d071c900c097c950d17ebf02f1fa758fab91ec9d504f6', 'src/model-defaults.js': 'c568977fcac8ea44d5387a8a8745b062675ec94d73d39ce528c492ad35f87176', 'src/providers.js': '92415eacaf87da2d0f2aed7db97feeb98b8b087adfe584a02c4478353b807d90', 'src/web-rewrite-contract.js': 'af4b970eb56c5738ffca6a00a7c03eb4366f1d67c3c9e6e7efc5a70a646484bc', 'playground/launch-config.js': '4d19fc8ce36651f73f94d80bbcd108a2ccbb50fa3fc25b54d75f193b42ac6bf4', 'vercel.json': '37a54c0850db54e80eec963c570d4b8a047fcfb4bf56d1a133e5a3934b28260e', 'scripts/checkout-evidence-bindings.mjs': '8dcdf4b23787f91c773b6d8b30857ae3bc90b9f6e1552561749b00c8502e1408', 'scripts/generate-launch-config.mjs': 'c5047625479bc687c510b6faf5045cf6118359ba978d219cea834325de5e8a07', 'scripts/check-v6.4-release-ready.mjs': 'fc4521db8f4677e03ac6a2199a86917b6332033030a9e8fe248cd166b0a59313', 'docs/AUTHENTICATION.md': 'e8c335550c4a0f0b144b79f4286d467a968962821a1c88049f1e679810751cfe', 'docs/AUTHENTICATION_KR.md': '5e077cd3a13c2299a11fc831c8303a204880c91dd0d465148d34a435dbe00796', 'docs/operations/pro-launch.md': '5a3ecb35a60374ee34111ad91e646a02f974439e9a2052ceb18b3ebc729d5acc', 'docs/operations/pay-stg-binding-20260716.json': '2f523259de91f640f056fe7acfe00264e493d9891b7a61152fe5e91704c0ecdf', 'docs/operations/pay-stg-runtime-20260716.json': 'b0229e892b06e1ec303a001c1317c4c63fc3c98fd7e10243e64db07df4803d29', 'docs/operations/pay-b-binding-20260723.json': '96eb8e0aba9fcb4ce67dd356bd35aaf678d8abea96a7ec134218eab7cd20f132', 'tests/e2e/providers.test.js': '47958be678e9bbfd06bcdd849ec0df37ed765f886e245b7b528e7d596b6d9dfe', 'tests/unit/backend-model-defaults.test.js': 'a9a0428bd53cb470505df58b25d7bd75d59200a7565809eb9f457fda1d22db29', 'tests/unit/web-deploy-invariants.test.js': '0c858c964a350115af6b567d8f3f707cc6749ede5e2967ab56f30b2fa0fb8bcd', 'tests/unit/web-rewrite-contract.test.js': 'd802df1b7f44ef05bcb11e3e68307f577da5529a406e5e92fa206d08bdcf2b2a', 'tests/unit/web-rewrite-contract.redteam.test.js': '3c7591926e168b14f486199297fd1e84ed447c1b8d339c9b4860f79da0f6a7bb', 'tests/unit/v6.4-preflight-hold.test.js': 'a14660535c998cde52e8810fec7812305d1688af67927cc868524040c2eafd17', 'tests/unit/v6.4-release-ready.test.js': '8d88aab35ce75bc40b4782932329c0402001afabc380ac349ccc1b82d01c12d7', 'package.json': 'f630732601b46fbc7a4fdd49924a7444cc5ff94fa8b4efb3559df19562ee416b', 'package-lock.json': 'd4a0814cc96fd2b46d9c5453345e41623a53149b7e5bdf5e79213101d700680c', '.github/workflows/release.yml': '43900a0966a52c500d54b1971d4141fe2d380a893364b4cb7b9976e9e3795f8f', 'README.md': 'f8b8cc52f646b44fc94da2f7ee3872303ae6cb52b81868423c9f9235987e91b8', 'README_KR.md': 'eb8310a10040e5c3653344349d6feda5978f6b86db3e363dbe6af8f6575b3be1', 'README_ZH.md': '2fbeb8ef8dfbd4bf61b11ece14d551efc3d8b0274b39b28f1377046d92f46bdc', 'README_JA.md': 'e7a59cc4a462f4a3b992bcacd49f801522f76270111a5080ee74a634db2ab2f0', 'SKILL.md': '5c8c09492bf01f88bc2eb088fb0e246b4fefb0b272b7af24dd97b202f8889b93', '.patina.default.yaml': '540a12d5f6a2234fd348e2a22548bbb37bb293fbb03cecdfee16e745cae3eac8', 'packages/patina-humanizer/package.json': '0a21036548a4b2be6e2fb0d9412fa481fc2310b9e4ab2b8f0fd18505c897662c', '.claude-plugin/plugin.json': 'baa2ddf798791d7f4edacedd70bd6b32b15e68c505ab77dfd1bf20f6e73cac5e', '.claude-plugin/marketplace.json': '95a2847f1248752eceb77762cf8d67e58d8405e291036372363f678040041e81', 'CHANGELOG.md': 'cfc3af68e2723dd27d87c26f9c66aff4e0242bcbfd2772c39448dd6aa0ba45ef' } });
const DISABLED_LAUNCH = { schemaVersion: 1, channel: 'disabled', enabled: false, checkoutOrigin: null, checkoutPath: null, evidence: null };
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function exactKeys(value, keys, label, errors) { if (!isObject(value)) { errors.push(`${label} must be an object`); return false; } const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (!sameJson(actual, expected)) errors.push(`${label} must contain exactly: ${expected.join(', ')}`); return sameJson(actual, expected); }
function validUtcTimestamp(value) { const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value); if (!match || Number.isNaN(Date.parse(value))) return false; const [, year, month, day, hour, minute, second] = match.map(Number); const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second; }
function requireString(value, label, errors) { if (typeof value !== 'string' || value.length === 0) errors.push(`${label} must be a non-empty string`); }
function validateEvidence(evidence, errors) {
  const errorCount = errors.length;
  exactKeys(evidence, ['schemaVersion', 'evidenceId', 'observedAt', 'source', 'store', 'product', 'variant', 'prices', 'approval', 'factsSha256'], 'staging evidence', errors);
  if (!isObject(evidence)) return null;
  if (evidence.schemaVersion !== 'PAY-STG-BINDING-v1') errors.push('staging evidence schemaVersion must be PAY-STG-BINDING-v1');
  if (evidence.evidenceId !== REQUIRED_EVIDENCE_ID) errors.push('staging evidence ID must be exact');
  requireString(evidence.evidenceId, 'staging evidence.evidenceId', errors);
  requireString(evidence.source, 'staging evidence.source', errors);
  if (!validUtcTimestamp(evidence.observedAt)) errors.push('staging evidence.observedAt must be a valid UTC timestamp');
  exactKeys(evidence.store, ['id', 'domain'], 'staging evidence.store', errors);
  requireString(evidence.store?.id, 'staging evidence.store.id', errors);
  requireString(evidence.store?.domain, 'staging evidence.store.domain', errors);
  exactKeys(evidence.product, ['id', 'name', 'status', 'testMode', 'buyNowUrl', 'createdAt', 'updatedAt'], 'staging evidence.product', errors);
  requireString(evidence.product?.id, 'staging evidence.product.id', errors);
  requireString(evidence.product?.name, 'staging evidence.product.name', errors);
  requireString(evidence.product?.status, 'staging evidence.product.status', errors);
  requireString(evidence.product?.buyNowUrl, 'staging evidence.product.buyNowUrl', errors);
  if (evidence.product?.status !== 'published' || evidence.product?.testMode !== true) errors.push('staging evidence product must be published and test mode');
  for (const key of ['createdAt', 'updatedAt']) if (!validUtcTimestamp(evidence.product?.[key])) errors.push(`staging evidence.product.${key} must be a valid UTC timestamp`);
  exactKeys(evidence.variant, ['id', 'name', 'status', 'testMode', 'isSubscription', 'interval', 'intervalCount', 'priceCents', 'hasLicenseKeys', 'createdAt', 'updatedAt'], 'staging evidence.variant', errors);
  requireString(evidence.variant?.id, 'staging evidence.variant.id', errors);
  requireString(evidence.variant?.name, 'staging evidence.variant.name', errors);
  requireString(evidence.variant?.status, 'staging evidence.variant.status', errors);
  if (evidence.variant?.testMode !== true || evidence.variant?.isSubscription !== true || evidence.variant?.interval !== 'month' || evidence.variant?.intervalCount !== 1 || evidence.variant?.priceCents !== 999 || evidence.variant?.hasLicenseKeys !== true) errors.push('staging evidence variant must be a test-mode monthly $9.99 subscription with license keys');
  for (const key of ['createdAt', 'updatedAt']) if (!validUtcTimestamp(evidence.variant?.[key])) errors.push(`staging evidence.variant.${key} must be a valid UTC timestamp`);
  if (!Array.isArray(evidence.prices)) errors.push('staging evidence.prices must be an array');
  else {
    evidence.prices.forEach((price, index) => {
      exactKeys(price, ['id', 'category', 'scheme', 'unitPrice', 'renewalInterval', 'renewalIntervalQuantity', 'createdAt', 'updatedAt'], `staging evidence.prices[${index}]`, errors);
      requireString(price?.id, `staging evidence.prices[${index}].id`, errors);
      for (const key of ['category', 'scheme', 'createdAt', 'updatedAt']) if (key.endsWith('At') ? !validUtcTimestamp(price?.[key]) : typeof price?.[key] !== 'string') errors.push(`staging evidence.prices[${index}].${key} must be valid`);
      if (!Number.isInteger(price?.unitPrice) || (price?.renewalInterval !== null && typeof price?.renewalInterval !== 'string') || (price?.renewalIntervalQuantity !== null && !Number.isInteger(price?.renewalIntervalQuantity))) errors.push(`staging evidence.prices[${index}] has invalid price fields`);
    });
    const currentSubscription = evidence.prices.filter((price) => price?.category === 'subscription' && price.unitPrice === evidence.variant?.priceCents && price.updatedAt === evidence.variant?.updatedAt);
    if (currentSubscription.length !== 1) errors.push('staging evidence must contain exactly one current subscription price record');
  }
  exactKeys(evidence.approval, ['kind', 'directive', 'scope'], 'staging evidence.approval', errors);
  for (const key of ['kind', 'directive', 'scope']) requireString(evidence.approval?.[key], `staging evidence.approval.${key}`, errors);
  if (typeof evidence.factsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.factsSha256)) errors.push('staging evidence.factsSha256 must be a SHA-256 hex string');
  const { factsSha256, ...facts } = evidence;
  if (typeof factsSha256 === 'string' && createHash('sha256').update(JSON.stringify(facts)).digest('hex') !== factsSha256) errors.push('staging evidence factsSha256 does not match compact insertion-ordered facts');
  let url;
  try { url = new URL(evidence.product?.buyNowUrl); } catch { errors.push('staging evidence.product.buyNowUrl must be a URL'); return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.origin !== `https://${evidence.store?.domain}` || !url.pathname.startsWith('/checkout/buy/')) errors.push('staging evidence checkout URL must be the store HTTPS checkout path');
  return errors.length === errorCount ? { channel: 'staging', evidence: evidence.evidenceId, origin: url.origin, path: url.pathname } : null;
}
function validateProductionBindingEvidence(evidence, errors) {
  const errorCount = errors.length;
  exactKeys(evidence, ['schemaVersion', 'evidenceId', 'approvedAt', 'source', 'approvalCommit', 'approver', 'store', 'product', 'variant', 'checkoutUrl', 'reviewedStagingEvidence', 'factsSha256'], 'production binding evidence', errors);
  if (!isObject(evidence)) return null;
  if (evidence.schemaVersion !== 'PAY-B-BINDING-v1') errors.push('production binding evidence schemaVersion must be PAY-B-BINDING-v1');
  if (evidence.evidenceId !== REQUIRED_PRODUCTION_EVIDENCE_ID) errors.push('production binding evidence ID must be exact');
  if (!validUtcTimestamp(evidence.approvedAt)) errors.push('production binding evidence.approvedAt must be a valid UTC timestamp');
  requireString(evidence.source, 'production binding evidence.source', errors);
  if (typeof evidence.approvalCommit !== 'string' || !/^[a-f0-9]{40}$/.test(evidence.approvalCommit)) errors.push('production binding evidence.approvalCommit must be a 40-hex owner approval commit');
  requireString(evidence.approver, 'production binding evidence.approver', errors);
  exactKeys(evidence.store, ['id', 'domain'], 'production binding evidence.store', errors);
  if (evidence.store?.id !== '425473' || evidence.store?.domain !== 'vibetip.lemonsqueezy.com') errors.push('production binding evidence store identity must be exact');
  exactKeys(evidence.product, ['id'], 'production binding evidence.product', errors);
  if (evidence.product?.id !== '1236551') errors.push('production binding evidence product identity must be exact');
  exactKeys(evidence.variant, ['id', 'isSubscription', 'interval', 'intervalCount', 'priceCents', 'hasLicenseKeys', 'activationLimit'], 'production binding evidence.variant', errors);
  if (evidence.variant?.id !== '1932893' || evidence.variant?.isSubscription !== true || evidence.variant?.interval !== 'month' || evidence.variant?.intervalCount !== 1 || evidence.variant?.priceCents !== 999 || evidence.variant?.hasLicenseKeys !== true || evidence.variant?.activationLimit !== 3) errors.push('production binding evidence variant must be the live monthly $9.99 subscription with license keys');
  if (evidence.reviewedStagingEvidence !== REQUIRED_EVIDENCE_ID) errors.push('production binding evidence must name the reviewed staging evidence');
  if (typeof evidence.factsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.factsSha256)) errors.push('production binding evidence.factsSha256 must be a SHA-256 hex string');
  const { factsSha256, ...facts } = evidence;
  if (typeof factsSha256 === 'string' && createHash('sha256').update(JSON.stringify(facts)).digest('hex') !== factsSha256) errors.push('production binding evidence factsSha256 does not match compact insertion-ordered facts');
  let url;
  try { url = new URL(evidence.checkoutUrl); } catch { errors.push('production binding evidence.checkoutUrl must be a URL'); return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.origin !== `https://${evidence.store?.domain}` || !url.pathname.startsWith('/checkout/buy/')) errors.push('production binding evidence checkout URL must be the store HTTPS checkout path');
  return errors.length === errorCount ? { channel: 'production', evidence: evidence.evidenceId, origin: url.origin, path: url.pathname } : null;
}
function rejectRuntimeSecrets(value, path, errors) { if (Array.isArray(value)) return value.forEach((entry, index) => rejectRuntimeSecrets(entry, `${path}[${index}]`, errors)); if (!isObject(value)) return; for (const [key, entry] of Object.entries(value)) { if (/(?:secret|token|api.?key|password|license.?key)/i.test(key)) errors.push(`${path}.${key} is secret-like`); rejectRuntimeSecrets(entry, `${path}.${key}`, errors); } }
function validateRuntimeEvidence(evidence, errors) {
  const errorCount = errors.length;
  const expected = { schemaVersion: 'PAY-STG-RUNTIME-v1', evidenceId: REQUIRED_RUNTIME_EVIDENCE_ID, observedAt: '2026-07-16T03:35:03.000000Z', mode: 'test', order: { id: '8973866', status: 'paid', totalCents: 999, currency: 'USD', paidAt: '2026-07-16T03:35:03.000000Z' }, subscription: { id: '2347121', status: 'active', storeId: '425473', productId: '1199625', variantId: '1875389', orderId: '8973866', createdAt: '2026-07-16T03:34:59.000000Z' }, licenseRecord: { id: '1487257', status: 'inactive', issuanceStatus: 'issued', activationLimit: 3, rawMaterialPresent: false }, deployment: { environment: 'preview', id: 'dpl_67KJsb92zsiWHGMSQx53zVET84UE', immutableUrl: 'https://patina-9ouqbaa1r-devshwas-projects.vercel.app', stableAlias: 'https://patina-devswha-3436-devshwas-projects.vercel.app' }, checkoutBrowser: { environment: 'test', attempt: 1, confirmation: 'Thanks for your order!' }, proEntitlement: { environment: 'staging', attempt: 1, url: 'https://patina-devswha-3436-devshwas-projects.vercel.app', httpStatus: 200, terminal: 'done', rawLicensePresent: false }, numberSafety: { environment: 'staging', attempt: 1, terminal: 'error', code: 'number_safety_failed' }, stagingConfiguration: { environment: 'staging', model: 'claude-sonnet-4-5', allowlisted: true, scope: 'staging_configuration_only' } };
  exactKeys(evidence, [...Object.keys(expected), 'factsSha256'], 'staging runtime evidence', errors);
  rejectRuntimeSecrets(evidence, 'staging runtime evidence', errors);
  if (!isObject(evidence) || !sameJson(Object.fromEntries(Object.keys(expected).map((key) => [key, evidence[key]])), expected)) errors.push('staging runtime evidence must exactly retain the test-mode purchase, preview smoke, fail-closed number safety, and staging-only configuration facts');
  if (!validUtcTimestamp(evidence?.observedAt)) errors.push('staging runtime evidence.observedAt must be a valid UTC timestamp');
  if (typeof evidence?.factsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.factsSha256)) errors.push('staging runtime evidence.factsSha256 must be a SHA-256 hex string');
  const { factsSha256, ...facts } = isObject(evidence) ? evidence : {};
  if (typeof factsSha256 === 'string' && createHash('sha256').update(JSON.stringify(facts)).digest('hex') !== factsSha256) errors.push('staging runtime evidence factsSha256 does not match compact insertion-ordered facts');
  return errors.length === errorCount ? evidence.evidenceId : null;
}
function rejectReceiptFields(value, path, errors) { if (Array.isArray(value)) return value.forEach((entry, index) => rejectReceiptFields(entry, `${path}[${index}]`, errors)); if (!isObject(value)) return; for (const [key, entry] of Object.entries(value)) { if (/pass|receipt/i.test(key)) errors.push(`${path}.${key} is forbidden in a non-receipt hold`); if (key === 'evidence' && !path.startsWith('state.completedDecisions[') && entry !== null) errors.push(`${path}.evidence must be null outside completed decisions`); rejectReceiptFields(entry, `${path}.${key}`, errors); } }
function hashFile(path) { return createHash('sha256').update(readFileSync(new URL(path, ROOT_URL))).digest('hex'); }
function validateFrozenSources(sources, errors) { const modelDefaults = sources.modelDefaults ?? DEFAULT_BEST_MODELS; const providers = sources.providers ?? PROVIDERS; const presets = sources.webProviderPresets ?? PROVIDER_PRESETS; const defaults = [presets.openai?.models?.[0], modelDefaults.codexCli, modelDefaults.claudeCli, providers.gemini?.defaultModel, modelDefaults.geminiCli]; REQUIRED_ROWS.forEach(([, expected], index) => { if (defaults[index] !== expected) errors.push(`held source default ${REQUIRED_ROWS[index][0]} changed`); }); for (const [key, expected] of Object.entries(FROZEN_SEMANTICS.providers)) { const provider = providers[key]; if (!sameJson(provider && Object.fromEntries(Object.keys(expected).map((field) => [field, provider[field]])), expected)) errors.push(`source provider ${key} changed from frozen semantics`); } }
function validateHashes(errors, hash = hashFile) { for (const [file, expected] of Object.entries(FROZEN_SEMANTICS.sourceHashes)) { try { if (hash(file) !== expected) errors.push(`frozen SHA-256 mismatch: ${file}`); } catch { errors.push(`frozen manifest entry unreadable: ${file}`); } } }
function validateDependencyGraph(state, errors) { const blockers = new Set(REQUIRED_BLOCKERS.map(([id]) => id)); const decisions = new Set(REQUIRED_DECISIONS.map(([id]) => id)); const actions = new Set(REQUIRED_DEFERRED_ACTIONS.map(([id]) => id)); const known = new Set([...blockers, ...decisions, ...actions]); const ranks = { LS_APPROVAL: 1, PAY_STG_BINDING_APPROVAL: 2, PAY_B_BINDING_APPROVAL: 2, SOURCE_BINDING_STAGING_INTEGRATION: 3, SOURCE_BINDING_PRODUCTION_INTEGRATION: 3, PAY_STG: 4, GATE_B: 4, V6_4_METADATA_COPY_RECONCILIATION: 5, PAY_LIVE: 6, REL_PUBLISH: 6, FINAL_TAG_PUBLISH_COMMAND: 7 }; const graph = new Map((state.deferredActions || []).map((action) => [action.id, action.blockedBy])); for (const [id, dependencies] of graph) for (const dependency of dependencies || []) { if (!known.has(dependency)) errors.push(`dependency graph references unknown ID: ${dependency}`); if (dependency === id) errors.push(`dependency graph contains self reference: ${id}`); if (ranks[id] !== undefined && ranks[dependency] !== undefined && ranks[dependency] >= ranks[id]) errors.push(`dependency graph reverses release order: ${id} -> ${dependency}`); } const visiting = new Set(); const visited = new Set(); const visit = (id) => { if (visiting.has(id)) { errors.push(`dependency graph contains cycle at: ${id}`); return; } if (visited.has(id)) return; visiting.add(id); for (const dependency of graph.get(id) || []) if (actions.has(dependency)) visit(dependency); visiting.delete(id); visited.add(id); }; for (const id of graph.keys()) visit(id); }
/** Validate the closed non-receipt v6.4 preflight state. */
export function validatePreflightHold(state, sources = {}) {
  const errors = [];
  if (!isObject(state)) return ['preflight state must be an object'];
  const evidence = sources.evidence ?? JSON.parse(readFileSync(EVIDENCE_URL, 'utf8'));
  const binding = validateEvidence(evidence, errors);
  const runtimeEvidence = sources.runtimeEvidence ?? JSON.parse(readFileSync(RUNTIME_EVIDENCE_URL, 'utf8'));
  const runtimeEvidenceId = validateRuntimeEvidence(runtimeEvidence, errors);
  const productionEvidence = sources.productionEvidence ?? JSON.parse(readFileSync(PRODUCTION_EVIDENCE_URL, 'utf8'));
  const productionBinding = validateProductionBindingEvidence(productionEvidence, errors);
  rejectReceiptFields(state, 'state', errors);
  exactKeys(state, ['schemaVersion', 'release', 'state', 'promotionRows', 'completedDecisions', 'checkout', 'frozenSemantics', 'blockers', 'deferredActions', 'prohibitions'], 'state', errors);
  if (state.schemaVersion !== 3) errors.push('schemaVersion must be 3');
  if (state.release !== 'v6.4') errors.push('release must be v6.4');
  if (state.state !== 'HOLD_NO_PROMOTION') errors.push('state must be HOLD_NO_PROMOTION');
  if (!Array.isArray(state.promotionRows) || state.promotionRows.length !== REQUIRED_ROWS.length) errors.push('promotionRows must contain exactly five ordered hold rows');
  else state.promotionRows.forEach((row, index) => { const [surface, currentDefault, candidate, ceiling] = REQUIRED_ROWS[index]; exactKeys(row, ceiling ? ['surface', 'currentDefault', 'candidate', 'ceiling', 'status'] : ['surface', 'currentDefault', 'candidate', 'status'], `promotionRows[${index}]`, errors); if (!isObject(row) || row.surface !== surface || row.currentDefault !== currentDefault || row.candidate !== candidate || row.status !== 'HOLD_NO_PROMOTION' || row.ceiling !== ceiling) errors.push(`promotionRows[${index}] must exactly retain ${surface}'s HOLD_NO_PROMOTION row`); });
  if (!Array.isArray(state.completedDecisions) || state.completedDecisions.length !== REQUIRED_DECISIONS.length) errors.push('completedDecisions must contain exactly five Gate-C, three staging, and two production-binding decisions');
  else state.completedDecisions.forEach((decision, index) => { const [id, status] = REQUIRED_DECISIONS[index]; const evidenceId = ({ PAY_STG_BINDING_APPROVAL: binding?.evidence, SOURCE_BINDING_STAGING_INTEGRATION: binding?.evidence, PAY_STG_RUNTIME_TEST_SMOKE: runtimeEvidenceId, PAY_B_BINDING_APPROVAL: productionBinding?.evidence, SOURCE_BINDING_PRODUCTION_INTEGRATION: productionBinding?.evidence })[id]; exactKeys(decision, evidenceId ? ['id', 'status', 'evidence'] : ['id', 'status'], `completedDecisions[${index}]`, errors); if (!isObject(decision) || decision.id !== id || decision.status !== status || (evidenceId ? decision.evidence !== evidenceId : Object.hasOwn(decision, 'evidence'))) errors.push(`completedDecisions[${index}] must exactly retain ${id}`); });
  exactKeys(state.checkout, ['enabled'], 'checkout', errors);
  if (!isObject(state.checkout) || state.checkout.enabled !== false) errors.push('state checkout must be disabled');
  const launch = sources.launch ?? launchConfig;
  exactKeys(launch, Object.keys(DISABLED_LAUNCH), 'checked-in launch artifact', errors);
  if (!sameJson(launch, DISABLED_LAUNCH)) errors.push('checked-in launch artifact must exactly retain six-field disabled shape');
  const bindings = sources.bindings ?? CHECKOUT_EVIDENCE_BINDINGS;
  const requiredBindings = binding && productionBinding ? Object.freeze({ [checkoutEvidenceBindingKey(binding)]: true, [checkoutEvidenceBindingKey(productionBinding)]: true }) : null;
  if (!isObject(bindings) || !Object.isFrozen(bindings) || !sameJson(bindings, requiredBindings)) errors.push('checkout evidence binding table must exactly retain the validated staging and production bindings');
  if (!sameJson(state.frozenSemantics, FROZEN_SEMANTICS)) errors.push('frozenSemantics must exactly match manifest version 3');
  validateFrozenSources(sources, errors);
  if (sources.checkHashes !== false) validateHashes(errors, sources.hashFile);
  if (!Array.isArray(state.blockers) || state.blockers.length !== REQUIRED_BLOCKERS.length) errors.push('blockers must contain exactly the ordered required blockers');
  else state.blockers.forEach((blocker, index) => { const [id, owner, exitEvidence] = REQUIRED_BLOCKERS[index]; exactKeys(blocker, ['id', 'type', 'owner', 'exitEvidence', 'evidence'], `blockers[${index}]`, errors); if (!isObject(blocker) || blocker.id !== id || blocker.type !== 'human_action' || blocker.owner !== owner || blocker.exitEvidence !== exitEvidence || blocker.evidence !== null) errors.push(`blockers[${index}] must exactly retain ${id}'s owner, human type, exit artifact, and null evidence`); });
  if (!Array.isArray(state.deferredActions) || state.deferredActions.length !== REQUIRED_DEFERRED_ACTIONS.length) errors.push('deferredActions must contain exactly the closed deferred repo actions');
  else state.deferredActions.forEach((action, index) => { const [id, blockedBy, reason] = REQUIRED_DEFERRED_ACTIONS[index]; exactKeys(action, ['id', 'type', 'blockedBy', 'reason', 'executable'], `deferredActions[${index}]`, errors); if (!isObject(action) || action.id !== id || action.type !== 'repo_action' || !sameJson(action.blockedBy, blockedBy) || action.reason !== reason || action.executable !== false) errors.push(`deferredActions[${index}] must exactly retain ${id}'s closed external-evidence hold`); });
  validateDependencyGraph(state, errors);
  exactKeys(state.prohibitions, ['tag', 'publish'], 'prohibitions', errors);
  if (!isObject(state.prohibitions) || state.prohibitions.tag !== true || state.prohibitions.publish !== true) errors.push('tag and publish prohibitions must be explicit');
  return [...new Set(errors)];
}
export function validateCheckedInPreflightHold() { return validatePreflightHold(JSON.parse(readFileSync(STATE_URL, 'utf8'))); }
if (process.argv[1] === fileURLToPath(import.meta.url)) { const errors = validateCheckedInPreflightHold(); if (errors.length) { console.error(errors.map((error) => `v6.4 preflight hold: ${error}`).join('\n')); process.exitCode = 1; } else console.log('v6.4 preflight hold is valid.'); }
