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
  for (const asset of ['patterns', 'profiles', 'personas', 'core', 'lexicon', '.patina.default.yaml']) {
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

// The rewrite chat is the sole playground surface. The contract module must be
// published and the README must document the privacy/abuse posture.
test('rewrite chat is documented and the rewrite contract is published', () => {
  assert.ok(existsSync(resolve(REPO_ROOT, 'src/web-rewrite-contract.js')), 'contract module must exist');
  const readme = readFileSync(resolve(REPO_ROOT, 'playground/README.md'), 'utf8');
  assert.match(readme, /rewrite/i, 'README must document the rewrite chat');
  assert.match(readme, /no-store/i, 'README must document the no-store / no-persistence posture');
  assert.match(readme, /fail-closed/i, 'README must document fail-closed rate limiting');
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
      includeFiles: '{patterns/**,profiles/**,personas/**,core/**,lexicon/**,.patina.default.yaml}',
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
const STAGING_CHECKOUT_BINDING = Object.freeze({
  channel: 'staging',
  evidence: 'PAY-STG-20260716-1199625-1875389',
  origin: 'https://vibetip.lemonsqueezy.com',
  path: '/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514',
});

test('launch config defaults fail closed, requires a trusted Vercel target, and pins the exact staging evidence binding', () => {
  assert.deepEqual(CHECKOUT_EVIDENCE_BINDINGS, {
    [checkoutEvidenceBindingKey(STAGING_CHECKOUT_BINDING)]: true,
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
    PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514',
    PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-STG-20260716-1199625-1875389',
    VERCEL_ENV: 'preview',
  };
  const expectedEnabledConfig = {
    schemaVersion: 1,
    channel: 'staging',
    enabled: true,
    checkoutOrigin: 'https://vibetip.lemonsqueezy.com',
    checkoutPath: '/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514',
    evidence: 'PAY-STG-20260716-1199625-1875389',
  };
  assert.deepEqual(createLaunchConfig(enabled), expectedEnabledConfig);

  assert.throws(
    () => createLaunchConfig({ ...enabled, VERCEL_ENV: 'production' }),
    /Invalid VERCEL_ENV: must be "preview" when staging checkout is enabled/,
  );
  assert.throws(
    () => createLaunchConfig({
      ...enabled,
      PATINA_DEPLOYMENT_CHANNEL: 'production',
      PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-B-20260716-1199625-1875389',
    }),
    /Invalid VERCEL_ENV: must be "production" when production checkout is enabled/,
  );
  for (const VERCEL_ENV of [undefined, 'development']) {
    assert.throws(
      () => createLaunchConfig({ ...enabled, VERCEL_ENV }),
      /Invalid VERCEL_ENV: must be "preview" when staging checkout is enabled/,
    );
    assert.throws(
      () => createLaunchConfigForTest({ ...enabled, VERCEL_ENV }, CHECKOUT_EVIDENCE_BINDINGS),
      /Invalid VERCEL_ENV: must be "preview" when staging checkout is enabled/,
    );
  }
  assert.deepEqual(
    createLaunchConfigForTest(
      { ...enabled, VERCEL_ENV: undefined },
      CHECKOUT_EVIDENCE_BINDINGS,
      { allowNonVercel: true },
    ),
    expectedEnabledConfig,
  );

  for (const overrides of [
    { PATINA_PRO_CHECKOUT_URL: 'https://other.example.test/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' },
    { PATINA_PRO_CHECKOUT_URL: 'https://sub.vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' },
    { PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com/checkout/buy/other' },
    { PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514/' },
    { PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com/checkout/buy/%39e53eb90-c8a8-4cef-b06d-3ca0b429e514' },
    { PATINA_PRO_GATE_EVIDENCE_ID: 'PAY-STG-other-evidence' },
  ]) {
    assert.throws(
      () => createLaunchConfigForTest({ ...enabled, ...overrides }, CHECKOUT_EVIDENCE_BINDINGS),
      /source-controlled checkout evidence binding/,
    );
  }

  for (const overrides of [
    { PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514#fragment' },
    { PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com:443/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' },
    { PATINA_PRO_CHECKOUT_URL: 'http://vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' },
    { PATINA_PRO_CHECKOUT_URL: 'https://buyer@vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514' },
    { PATINA_PRO_CHECKOUT_URL: 'https://vibetip.lemonsqueezy.com/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514?campaign=1' },
    { PATINA_DEPLOYMENT_CHANNEL: 'preview' },
  ]) {
    assert.throws(() => createLaunchConfigForTest({ ...enabled, ...overrides }, CHECKOUT_EVIDENCE_BINDINGS));
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
test('local dev server resolves the launch config with matching no-store headers', () => {
  const devServer = readFileSync(resolve(REPO_ROOT, 'scripts/dev-server.mjs'), 'utf8');

  assert.match(devServer, /\['\/launch-config\.js', '\/playground\/launch-config\.js'\]/);
  assert.match(devServer, /'Content-Type': 'application\/javascript; charset=utf-8'/);
  assert.match(devServer, /'Cache-Control': 'no-store, max-age=0'/);
});
