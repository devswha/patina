// Static contracts for the Pro playground surface. These tests deliberately avoid a
// DOM dependency: the browser controller is the boundary being protected.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const controller = readFileSync(join(root, 'playground', 'chatgpt.js'), 'utf8');

function sourceBetween(source, start, end) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, `expected source to contain ${start}`);
  const last = source.indexOf(end, first);
  assert.notEqual(last, -1, `expected source after ${start} to contain ${end}`);
  return source.slice(first, last + end.length);
}

test('the pricing CTA is localized in every supported language, never hardcoded English', () => {
  // Every language dict must carry both CTA states, and the wiring must use
  // them — a hardcoded English string in wireProCta once shipped ko/zh/ja
  // users an untranslated button (review finding, 2026-08-31).
  for (const lang of ['en', 'ko', 'zh', 'ja']) {
    const dictStart = controller.indexOf(`  ${lang}: {`);
    assert.ok(dictStart >= 0, `missing ${lang} dictionary`);
    const dict = sourceBetween(controller, `  ${lang}: {`, '  },');
    assert.match(dict, /proBuy:\s*'[^']+\$9\.99/, `${lang} must localize proBuy with the price`);
    assert.match(dict, /proSoon:\s*'[^']+'/, `${lang} must localize proSoon`);
  }
  assert.match(controller, /btn\.textContent = i18n\(\)\.proBuy;/, 'active CTA must use the localized string');
  assert.match(controller, /btn\.textContent = i18n\(\)\.proSoon;/, 'disabled CTA must use the localized string');
  assert.doesNotMatch(controller, /textContent = `Get API access/, 'no hardcoded English template may remain');
  assert.match(controller, /classList\.contains\('is-soon'\) \? t\.proSoon : t\.proBuy/, 'applyI18n must refresh the CTA with the current state');
});

test('launch configuration is imported from the deployment root path exactly', () => {
  assert.match(controller, /^import launchConfig from '\/launch-config\.js';$/m);
});

test('license state stays in the controller memory, never web storage', () => {
  assert.doesNotMatch(controller, /\b(?:localStorage|sessionStorage)\b/);
});

test('sign-out invalidates active work and clears all in-memory license session state', () => {
  const signOut = sourceBetween(controller, 'function signOutLicense()', 'function signInLicense()');
  assert.match(signOut, /state\.sessionEpoch \+= 1/);
  assert.match(signOut, /active\.cancelled = true; active\.controller\.abort\(\); active = null/);
  assert.match(signOut, /state\.license = ''/);
  assert.match(signOut, /els\.licenseKey\.value = ''/);
  assert.match(signOut, /state\.convos = \[\]/);
  assert.match(signOut, /newConvo\(\)/);
});

test('signed-in licenses are immutable until the full sign-out transition', () => {
  const syncTier = sourceBetween(controller, 'function syncTier()', '// Populate opt-in voices.');
  const signIn = sourceBetween(controller, 'function signInLicense()', 'function inlineErrorNode');
  assert.match(syncTier, /els\.licenseKey\.disabled = signedIn/);
  assert.match(signIn, /if \(state\.license\) return/);
  assert.match(signIn, /state\.license = license/);
});

test('checkout attribution has an exact six-key allowlist and rejects secret-shaped values', () => {
  const safeUtm = sourceBetween(controller, 'function isSafeUtm(value)', '\n}');
  const utmValue = sourceBetween(controller, 'const UTM_VALUE = ', ';\n');
  assert.match(controller, /const UTM_KEYS = \['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'\];/);
  assert.match(controller, /const UTM_VALUE = \/\^\[A-Za-z0-9._~-\]\{1,64\}\$\//);
  assert.match(safeUtm, /\^\[0-9a-f\]\{8\}-\(\?:\[0-9a-f\]\{4\}-\)\{3\}\[0-9a-f\]\{12\}\$/i);
  assert.match(safeUtm, /\^\[0-9a-f\]\{16,\}\$/i);
  assert.match(safeUtm, /sk\|pk\|rk\|api\|key\|token\|secret\|auth\|bearer/);
  assert.match(safeUtm, /value\.length < 16/);
  assert.match(safeUtm, /entropy < 3\.8/);
  const isSafeUtm = Function(`${utmValue}${safeUtm}; return isSafeUtm;`)();
  const adversarial = {
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    hex: '0123456789abcdef0123456789abcdef',
    credential: 'sk_live_abc123',
    base64url: 'QmFzZTY0VXJsVG9rZW4',
  };
  for (const value of Object.values(adversarial)) assert.equal(isSafeUtm(value), false, value);
  assert.equal(isSafeUtm('summer-sale-2026'), true);
});

test('all streaming callbacks require current ownership, epoch, and a non-cancelled run', () => {
  const attempt = sourceBetween(controller, 'async function runAttempt(attempt)', '// Stable error-kind');
  assert.match(attempt, /const current = \(\) => active === run && !run\.cancelled && state\.sessionEpoch === epoch/);
  for (const callback of ['onStart', 'onDelta', 'onDone']) {
    const pattern = new RegExp(`${callback}: [\\s\\S]*?current\\(\\)`);
    assert.match(attempt, pattern);
  }
  assert.match(attempt, /stop: \(\) => \{[\s\S]*?markOutputUnapproved\(textEl, statusEl\)/);
  assert.doesNotMatch(sourceBetween(attempt, 'if (!ok) {', '} catch (e)'), /buildOutputActions\(|convo\.thread\.commit\(/);
});
