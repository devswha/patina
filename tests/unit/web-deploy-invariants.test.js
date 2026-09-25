import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  CHECKOUT_EVIDENCE_BINDINGS,
  checkoutEvidenceBindingKey,
} from '../../scripts/checkout-evidence-bindings.mjs';
import { createLaunchConfig, createLaunchConfigForTest } from '../../scripts/generate-launch-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function vercelConfig() {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
}

// Deployment invariant: the serverless rewrite function reuses the patina Node
// pipeline, which reads patterns/document-types/personas/core/lexicon and
// .patina.default.yaml from the filesystem. On Vercel those files are
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
  for (const asset of ['patterns', 'document-types', 'personas', 'core', 'lexicon', '.patina.default.yaml']) {
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

test('vercel.json serves only the playground as its static output', () => {
  const config = vercelConfig();
  const staticPaths = [
    'index.html',
    'chatgpt.js',
    'chatgpt.css',
    'rewrite-client.js',
    'analytics.js',
    'launch-config.js',
  ];

  assert.equal(config.outputDirectory, 'playground');
  assert.notEqual(config.outputDirectory, '.', 'repository root must not be a static output');
  assert.deepEqual(config.rewrites, [{ source: '/', destination: '/index.html' }]);
  for (const staticPath of staticPaths) {
    assert.ok(
      existsSync(resolve(REPO_ROOT, config.outputDirectory, staticPath)),
      `${staticPath} must resolve from the static output directory`,
    );
  }
});

test('vercel.json preserves API functions, cron, and security headers', () => {
  const config = vercelConfig();

  assert.deepEqual(config.functions, {
    'api/rewrite.js': {
      includeFiles: '{patterns/**,document-types/**,personas/**,core/**,lexicon/**,.patina.default.yaml}',
      // The stream budget (180s default) is a TOTAL across rewrite + scoring;
      // the function must be allowed to outlive it plus retry margin.
      maxDuration: 300,
    },
    'api/pro-monitor.js': {
      maxDuration: 60,
    },
  });
  assert.deepEqual(config.crons, [{ path: '/api/pro-monitor', schedule: '*/15 * * * *' }]);
  assert.deepEqual(config.headers, [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'clipboard-write=(self), camera=(), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy',
          value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
        },
      ],
    },
    {
      source: '/launch-config.js',
      headers: [
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
      ],
    },
  ]);
});
const PRODUCTION_CHECKOUT_BINDING = Object.freeze({
  channel: 'production',
  evidence: 'PAY-B-20260729-POLAR-ea8385dc-4c9c3f17',
  origin: 'https://buy.polar.sh',
  path: '/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW',
});
// No staging binding is source-controlled because the retired staging
// chain is exercised through the injected
// test-only binding below.
const TEST_STAGING_BINDING = Object.freeze({
  channel: 'staging',
  evidence: 'PAY-STG-test-injected',
  origin: 'https://sandbox.example.test',
  path: '/polar_cl_testonly',
});
const TEST_BINDINGS = Object.freeze({
  ...CHECKOUT_EVIDENCE_BINDINGS,
  [checkoutEvidenceBindingKey(TEST_STAGING_BINDING)]: true,
});

test('launch config defaults fail closed, requires a trusted Vercel target, and pins the exact production evidence binding', () => {
  assert.deepEqual(CHECKOUT_EVIDENCE_BINDINGS, {
    [checkoutEvidenceBindingKey(PRODUCTION_CHECKOUT_BINDING)]: true,
  });
  assert.ok(Object.isFrozen(CHECKOUT_EVIDENCE_BINDINGS));
  assert.deepEqual(createLaunchConfig({
    PATINA_PRO_CHECKOUT_ENABLED: 'false',
    PATINA_DEPLOYMENT_CHANNEL: 'production',
    PATINA_PRO_CHECKOUT_URL: 'http://unsafe.example/checkout?campaign=1',
    PATINA_PRO_GATE_EVIDENCE_ID: 'not-evidence',
  }), {
    schemaVersion: 1,
    channel: 'disabled',
    enabled: false,
    checkoutOrigin: null,
    checkoutPath: null,
    evidence: null,
  });

  const enabled = {
    PATINA_PRO_CHECKOUT_ENABLED: 'true',
    PATINA_DEPLOYMENT_CHANNEL: 'staging',
    PATINA_PRO_CHECKOUT_URL: 'https://sandbox.example.test/polar_cl_testonly',
    PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-STG-test-injected',
    VERCEL_ENV: 'preview',
  };
  const expectedEnabledConfig = {
    schemaVersion: 1,
    channel: 'staging',
    enabled: true,
    checkoutOrigin: 'https://sandbox.example.test',
    checkoutPath: '/polar_cl_testonly',
    evidence: 'PAY-STG-test-injected',
  };
  assert.deepEqual(createLaunchConfigForTest(enabled, TEST_BINDINGS), expectedEnabledConfig);
  // The real table contains no staging binding, so a staging enable against it
  // must fail closed.
  assert.throws(
    () => createLaunchConfig(enabled),
    /source-controlled checkout evidence binding/,
  );

  const enabledProduction = {
    PATINA_PRO_CHECKOUT_ENABLED: 'true',
    PATINA_DEPLOYMENT_CHANNEL: 'production',
    PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW',
    PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-B-20260729-POLAR-ea8385dc-4c9c3f17',
    VERCEL_ENV: 'production',
  };
  assert.deepEqual(createLaunchConfig(enabledProduction), {
    schemaVersion: 1,
    channel: 'production',
    enabled: true,
    checkoutOrigin: 'https://buy.polar.sh',
    checkoutPath: '/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW',
    evidence: 'PAY-B-20260729-POLAR-ea8385dc-4c9c3f17',
  });
  assert.throws(
    () => createLaunchConfig({ ...enabledProduction, VERCEL_ENV: 'preview' }),
    /Invalid VERCEL_ENV: must be "production" when production checkout is enabled/,
  );
  assert.throws(
    () => createLaunchConfig({ ...enabledProduction, PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-B-other' }),
    /source-controlled checkout evidence binding/,
  );

  assert.throws(
    () => createLaunchConfigForTest({ ...enabled, VERCEL_ENV: 'production' }, TEST_BINDINGS),
    /Invalid VERCEL_ENV: must be "preview" when staging checkout is enabled/,
  );
  assert.throws(
    () => createLaunchConfigForTest({
      ...enabled,
      PATINA_DEPLOYMENT_CHANNEL: 'production',
      PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-B-test-injected',
    }, TEST_BINDINGS),
    /Invalid VERCEL_ENV: must be "production" when production checkout is enabled/,
  );
  for (const VERCEL_ENV of [undefined, 'development']) {
    assert.throws(
      () => createLaunchConfigForTest({ ...enabled, VERCEL_ENV }, TEST_BINDINGS),
      /Invalid VERCEL_ENV: must be "preview" when staging checkout is enabled/,
    );
  }
  assert.deepEqual(
    createLaunchConfigForTest(
      { ...enabled, VERCEL_ENV: undefined },
      TEST_BINDINGS,
      { allowNonVercel: true },
    ),
    expectedEnabledConfig,
  );

  for (const overrides of [
    { PATINA_PRO_CHECKOUT_URL: 'https://other.example.test/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW' },
    { PATINA_PRO_CHECKOUT_URL: 'https://sub.buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh/polar_cl_other' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW/' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh/%70olar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW' },
    { PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-B-other-evidence' },
  ]) {
    assert.throws(
      () => createLaunchConfigForTest({ ...enabledProduction, ...overrides }, CHECKOUT_EVIDENCE_BINDINGS),
      /source-controlled checkout evidence binding/,
    );
  }

  for (const overrides of [
    { PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW#fragment' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh:443/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW' },
    { PATINA_PRO_CHECKOUT_URL: 'http://buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buyer@buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buy.polar.sh/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW?campaign=1' },
    { PATINA_DEPLOYMENT_CHANNEL: 'preview' },
  ]) {
    assert.throws(() => createLaunchConfigForTest({ ...enabledProduction, ...overrides }, CHECKOUT_EVIDENCE_BINDINGS));
  }
});

test('invalid enabled launch configuration does not replace the checked-in artifact', () => {
  const artifactPath = resolve(REPO_ROOT, 'playground/launch-config.js');
  const before = readFileSync(artifactPath, 'utf8');
  const result = spawnSync(process.execPath, ['scripts/generate-launch-config.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATINA_PRO_CHECKOUT_ENABLED: 'true',
      PATINA_DEPLOYMENT_CHANNEL: 'staging',
      PATINA_PRO_CHECKOUT_URL: 'https://checkout.example.test/store/pro',
      PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-B-wrong-channel',
    },
  });

  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(artifactPath, 'utf8'), before);
});

test('checked-in browser launch config is disabled and Vercel serves it without caching', async () => {
  const launchConfig = (await import('../../playground/launch-config.js')).default;
  assert.deepEqual(launchConfig, {
    schemaVersion: 1,
    channel: 'disabled',
    enabled: false,
    checkoutOrigin: null,
    checkoutPath: null,
    evidence: null,
  });

  const config = vercelConfig();
  assert.equal(config.buildCommand, 'npm run launch-config:generate');
  assert.equal(config.outputDirectory, 'playground');
  assert.ok(existsSync(resolve(REPO_ROOT, config.outputDirectory, 'launch-config.js')));
  const routeHeaders = config.headers.find((header) => header.source === '/launch-config.js')?.headers;
  assert.equal(routeHeaders?.find((header) => header.key === 'Content-Type')?.value, 'application/javascript; charset=utf-8');
  assert.equal(routeHeaders?.find((header) => header.key === 'Cache-Control')?.value, 'no-store, max-age=0');
});
