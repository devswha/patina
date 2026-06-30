import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchForbidden } from '../../scripts/check-no-private-assets.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Shapes that indicate a baked secret in source. Monetization sources must
 * read every secret from env/params; a literal key/token/secret is a leak.
 */
const BAKED_SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/,                                                  // OpenAI-style key incl. sk-proj-
  /['"][0-9a-fA-F]{32,}['"]/,                                                 // long hex literal (HMAC/digest), any case
  /PATINA_[A-Z0-9_]*(?:SECRET|TOKEN|KEY)\s*(?:[:=]|\|\||\?\?)\s*['"][^'"]+['"]/, // env secret with a NON-empty baked fallback/assignment
  /\b[A-Z][A-Z0-9]*_(?:SECRET|TOKEN|APIKEY|API_KEY)\b\s*[:=]\s*['"][^'"]+['"]/, // UPPER_SECRET/TOKEN/APIKEY = "literal"
];

// G008: the leak gate must catch monetization-shaped private assets, and the
// PUBLIC monetization modules added by G001-G007 must themselves be clean —
// open-core boundary (no enhanced engine, corpus, or baked secret ships here).

test('the leak gate flags monetization-shaped private/enhanced/corpus/server paths', () => {
  const plantedPrivate = [
    'src/pro-enhanced-engine.private.js',          // *.private.*
    'src/enhanced/ko-pro-pipeline.js',             // enhanced/
    'lexicon/ko-pro.reinforced.md',                // *.reinforced.*
    'corpus/lemon-license-keys.jsonl',             // corpus/
    'private/pro-hmac-secret.json',                // private/
    'server/lemon-webhook-secret.js',              // server/
  ];
  const hits = matchForbidden(plantedPrivate);
  assert.equal(hits.length, plantedPrivate.length, 'every monetization-private path must be flagged');
});

test('the actual PUBLIC monetization modules are NOT flagged (they ship in the open baseline)', () => {
  const publicModules = [
    'src/web-rewrite-contract.js',
    'src/pro-entitlements.js',
    'src/pro-session.js',
    'src/pro-metering.js',
    'src/pro-legal-copy.js',
    'src/lemon-webhook.js',
    'src/enhanced-rewrite-engine-contract.js',
    'api/pro-session.js',
    'api/lemon-webhook.js',
    'api/rewrite.js',
    'playground/rewrite-client.js',
    'docs/PRO.md',
    'docs/RELEASE-CHECKLIST.md',
  ];
  assert.deepEqual(matchForbidden(publicModules), []);
});

test('no monetization source file bakes in a secret or raw key', () => {
  const files = [
    'src/pro-entitlements.js', 'src/pro-session.js', 'src/pro-metering.js',
    'src/lemon-webhook.js', 'src/enhanced-rewrite-engine-contract.js',
    'api/pro-session.js', 'api/lemon-webhook.js', 'api/rewrite.js',
    'playground/rewrite-client.js',
  ];
  for (const rel of files) {
    const body = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    // Secrets must come from env/params, never a baked literal. These mirror
    // (and broaden) the secret shapes the contract already redacts.
    for (const re of BAKED_SECRET_PATTERNS) {
      assert.ok(!re.test(body), `${rel} appears to bake a secret (matched ${re})`);
    }
  }
});

test('the baked-secret patterns actually catch real secret shapes (not vacuous)', () => {
  const positives = [
    "const k = 'sk-proj-Abc123_def-456789xyz';",
    "const sig = 'deadBEEFdeadbeefdeadbeefdeadbeefdeadbeef';",            // 40 hex, mixed case
    "const s = env.PATINA_PRO_HMAC_SECRET || 'dev-fallback-secret';",      // non-empty fallback
    "PATINA_LEMON_WEBHOOK_SECRET = 'baked-value-123';",
    "LEMON_API_KEY = 'live_abcdef';",
  ];
  for (const sample of positives) {
    assert.ok(BAKED_SECRET_PATTERNS.some((re) => re.test(sample)), `expected a pattern to flag: ${sample}`);
  }
  // ...and benign shapes used by the real modules are NOT flagged.
  const benign = [
    "const apiKey = env.PATINA_FREE_API_KEY;",
    "webhookSecret: env.PATINA_LEMON_WEBHOOK_SECRET || '',",                // empty fallback ok
    "export const ENTITLEMENT_KEY_PREFIX = 'ent:';",
    "model: enhancedEngine.kind || 'enhanced',",
    "return { ok: false, status: 503, reason: 'pro session secret unavailable' };",
  ];
  for (const sample of benign) {
    assert.ok(!BAKED_SECRET_PATTERNS.some((re) => re.test(sample)), `false positive on benign: ${sample}`);
  }
});
