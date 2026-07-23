// Static contracts for the Pro playground surface. These tests deliberately avoid a
// DOM dependency: the browser controller is the boundary being protected.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const controller = readFileSync(join(root, 'playground', 'chatgpt.js'), 'utf8');
const rewriteClient = readFileSync(join(root, 'playground', 'rewrite-client.js'), 'utf8');
const stylesheet = readFileSync(join(root, 'playground', 'chatgpt.css'), 'utf8');

function sourceBetween(source, start, end) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, `expected source to contain ${start}`);
  const last = source.indexOf(end, first);
  assert.notEqual(last, -1, `expected source after ${start} to contain ${end}`);
  return source.slice(first, last + end.length);
}

test('launch configuration is imported from the deployment root path exactly', () => {
  assert.match(controller, /^import launchConfig from '\/launch-config\.js';$/m);
});

test('license state stays in the controller memory, never web storage', () => {
  assert.doesNotMatch(controller, /\b(?:localStorage|sessionStorage)\b/);
});

test('Pro sends its license only as a Bearer Authorization header, not in the request body', () => {
  const submit = sourceBetween(controller, 'async function submit(', '// One streaming attempt');
  assert.match(submit, /authorization:\s*tier === WEB_TIERS\.PRO \? `Bearer \$\{state\.license\}` : undefined/);
  assert.match(rewriteClient, /\.\.\.\(authorization \? \{ Authorization: authorization \} : \{\}\)/);

  const buildRequest = sourceBetween(rewriteClient, 'buildRequest({', 'return body;');
  assert.doesNotMatch(buildRequest, /\blicense(?:Key|_key)?\b/i);
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
  const syncTier = sourceBetween(controller, 'function syncTier()', '// Populate the Voice');
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

test('streaming output remains unapproved until an accepted DONE, then becomes actionable', () => {
  const attempt = sourceBetween(controller, 'async function runAttempt(attempt)', '// Stable error-kind');
  const done = sourceBetween(attempt, 'onDone: (frame) => {', '},\n    });');
  const rejected = sourceBetween(done, 'if (rejected) {', 'approveOutput(textEl, statusEl);');
  assert.match(attempt, /markOutputUnapproved\(textEl, statusEl\)/);
  assert.match(rejected, /textEl\.classList\.add\('msg__text--flagged'\)/);
  assert.match(rejected, /markOutputUnapproved\(textEl, statusEl\)/);
  assert.match(rejected, /return/);
  assert.match(done, /approveOutput\(textEl, statusEl\);\s*body\.appendChild\(buildOutputActions\(rewrite\)\);\s*convo\.messages\.push\([\s\S]*?convo\.thread\.commit\(/);
  assert.match(attempt, /if \(!ok\) \{[\s\S]*?textEl\.classList\.add\('msg__text--flagged'\);[\s\S]*?markOutputUnapproved\(textEl, statusEl\)/);
  assert.match(stylesheet, /\.msg__text--unapproved/);
  assert.match(controller, /dataset\.outputStatus = 'unapproved'/);
  assert.match(controller, /setAttribute\('aria-invalid', 'true'\)/);
});

test('output approval status is localized, announced, and associated with its output', () => {
  for (const lang of ['en', 'ko', 'zh', 'ja']) {
    const languageBlock = sourceBetween(controller, `  ${lang}: {`, '\n  },');
    assert.match(languageBlock, /outputUnapproved: '[^']+'/);
    assert.match(languageBlock, /outputApproved: '[^']+'/);
  }
  const builder = sourceBetween(controller, 'function buildPatinaMsg()', 'function buildTyping()');
  assert.match(builder, /const statusEl = el\('p', 'output-status'\)/);
  assert.match(builder, /statusEl\.setAttribute\('role', 'status'\)/);
  assert.match(builder, /statusEl\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(builder, /textEl\.setAttribute\('aria-describedby', statusEl\.id\)/);
  assert.match(builder, /statusEl\.textContent = i18n\(\)\.outputUnapproved/);
  assert.match(builder, /statusEl\.textContent = i18n\(\)\.outputApproved/);
  assert.match(stylesheet, /\.output-status/);
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
