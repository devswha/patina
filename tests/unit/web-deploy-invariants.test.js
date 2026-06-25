import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function vercelConfig() {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
}

// Deployment invariant: the serverless rewrite function reuses the patina Node
// pipeline, which reads patterns/profiles/core/lexicon and .patina.default.yaml
// from the filesystem (src/loader.js, src/config.js). On Vercel those files are
// only present at runtime if the function bundle explicitly includes them, so
// the requirement is pinned here BEFORE the handler is built. Local fs tests
// alone cannot catch a missing bundle; this guards the config contract.
test('vercel.json bundles patina assets into the rewrite function', () => {
  const config = vercelConfig();
  assert.ok(config.functions, 'vercel.json must declare a functions block for the rewrite proxy');
  const fn = config.functions['api/rewrite.js'];
  assert.ok(fn, 'api/rewrite.js must have a functions entry');
  const include = fn.includeFiles;
  assert.equal(typeof include, 'string', 'includeFiles must be a glob string');
  for (const asset of ['patterns', 'profiles', 'core', 'lexicon', '.patina.default.yaml']) {
    assert.ok(
      include.includes(asset),
      `includeFiles must bundle ${asset} (got: ${include})`,
    );
  }
});

// Security invariant: same-origin BYOK proxy means the CSP stays self-only.
// Provider origins are NOT in connect-src for v1 (the browser talks only to the
// same-origin /api/rewrite). This must hold even after the rewrite mode ships.
test('vercel.json keeps a self-only CSP (no provider origins, no inline script)', () => {
  const config = vercelConfig();
  const csp = config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy')?.value;
  assert.ok(csp, 'CSP header must be present');
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /connect-src 'self'(?:;|$)/);
  // No external provider origins leaked into connect-src in v1.
  assert.doesNotMatch(csp, /connect-src[^;]*https?:\/\//);
  assert.doesNotMatch(csp, /api\.openai\.com/);
});

// The audit-only playground must remain reachable and documented as a preserved
// mode after the rewrite surface is added (regression guard for AC9/AC13).
test('audit-only mode stays documented and the rewrite contract is published', () => {
  assert.ok(existsSync(resolve(REPO_ROOT, 'src/web-rewrite-contract.js')), 'contract module must exist');
  const readme = readFileSync(resolve(REPO_ROOT, 'playground/README.md'), 'utf8');
  assert.match(readme, /audit-only/i, 'README must keep documenting the audit-only mode');
  assert.match(readme, /rewrite mode/i, 'README must document the rewrite mode contract');
  assert.match(readme, /no-store/i, 'README must document the no-store / no-persistence posture');
  assert.match(readme, /fail-closed/i, 'README must document fail-closed rate limiting');
});

// The root '/' route and the static audit entry rewrites must survive so the
// existing audit playground keeps working alongside the new rewrite mode.
test('vercel.json preserves the static playground rewrites', () => {
  const config = vercelConfig();
  const has = (source, destination) =>
    config.rewrites.some((r) => r.source === source && r.destination === destination);
  assert.ok(has('/', '/playground'));
  assert.ok(has('/app.js', '/playground/app.js'));
  assert.ok(has('/styles.css', '/playground/styles.css'));
});
