import { randomBytes } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKOUT_EVIDENCE_BINDINGS, checkoutEvidenceBindingKey } from './checkout-evidence-bindings.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, '../playground/launch-config.js');
const DISABLED_CONFIG = Object.freeze({
  schemaVersion: 1,
  channel: 'disabled',
  enabled: false,
  checkoutOrigin: null,
  checkoutPath: null,
  evidence: null,
});

function invalid(name, message) {
  throw new Error(`Invalid ${name}: ${message}`);
}

function checkoutEnabled(value) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  invalid('PATINA_PRO_CHECKOUT_ENABLED', 'must be "true" or "false"');
}

function checkoutUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    invalid('PATINA_PRO_CHECKOUT_URL', 'is required when checkout is enabled');
  }
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority || /[\\\s]/.test(authority)) {
    invalid('PATINA_PRO_CHECKOUT_URL', 'must be an absolute HTTPS URL');
  }
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const hasExplicitPort = hostPort.startsWith('[')
    ? hostPort.slice(hostPort.indexOf(']') + 1).startsWith(':')
    : hostPort.includes(':');

  let url;
  try {
    url = new URL(value);
  } catch {
    invalid('PATINA_PRO_CHECKOUT_URL', 'must be an absolute HTTPS URL');
  }

  if (url.protocol !== 'https:' || url.username || url.password || hasExplicitPort || value.includes('?') || value.includes('#')) {
    invalid('PATINA_PRO_CHECKOUT_URL', 'must be HTTPS without userinfo, port, query, or fragment');
  }

  return { checkoutOrigin: url.origin, checkoutPath: url.pathname };
}

function enabledTarget(env, channel, { allowNonVercel = false } = {}) {
  const target = env.VERCEL_ENV;
  if (target === undefined && allowNonVercel) return;

  const expected = channel === 'staging' ? 'preview' : 'production';
  if (target !== expected) {
    invalid('VERCEL_ENV', `must be "${expected}" when ${channel} checkout is enabled`);
  }
}

function createLaunchConfigWithBindings(env, bindings, options) {
  // An explicit false (and the safe default) wins over every other input.
  if (!checkoutEnabled(env.PATINA_PRO_CHECKOUT_ENABLED)) return DISABLED_CONFIG;

  const channel = env.PATINA_DEPLOYMENT_CHANNEL;
  if (channel !== 'staging' && channel !== 'production') {
    invalid('PATINA_DEPLOYMENT_CHANNEL', 'must be "staging" or "production" when checkout is enabled');
  }
  enabledTarget(env, channel, options);
  const evidence = env.PATINA_PRO_GATE_EVIDENCE_ID;
  const evidencePattern = channel === 'staging'
    ? /^PAY-STG-[A-Za-z0-9][A-Za-z0-9_-]*$/
    : /^PAY-B-[A-Za-z0-9][A-Za-z0-9_-]*$/;
  if (typeof evidence !== 'string' || !evidencePattern.test(evidence)) {
    invalid('PATINA_PRO_GATE_EVIDENCE_ID', `must match the ${channel === 'staging' ? 'PAY-STG-*' : 'PAY-B-*'} release evidence format`);
  }

  const url = checkoutUrl(env.PATINA_PRO_CHECKOUT_URL);
  const binding = {
    channel,
    evidence,
    origin: url.checkoutOrigin,
    path: url.checkoutPath,
  };
  const matchesBinding = Object.hasOwn(bindings, checkoutEvidenceBindingKey(binding))
    && env.PATINA_PRO_CHECKOUT_URL === `${binding.origin}${binding.path}`;

  if (!matchesBinding) {
    invalid('PATINA_PRO_CHECKOUT_URL', 'must exactly match a source-controlled checkout evidence binding');
  }

  return Object.freeze({
    schemaVersion: 1,
    channel,
    enabled: true,
    checkoutOrigin: binding.origin,
    checkoutPath: binding.path,
    evidence,
  });
}

export function createLaunchConfig(env = process.env) {
  return createLaunchConfigWithBindings(env, CHECKOUT_EVIDENCE_BINDINGS);
}

// Test-only seams allow binding injection and an explicit local-development target.
export function createLaunchConfigForTest(env, bindings, options) {
  return createLaunchConfigWithBindings(env, bindings, options);
}

function render(config) {
  return `const launchConfig = Object.freeze(${JSON.stringify(config, null, 2)});\n\nexport { launchConfig };\nexport default launchConfig;\n`;
}

export function writeLaunchConfig(config, outputPath = OUTPUT_PATH) {
  const outputDir = dirname(outputPath);
  const temporaryPath = resolve(outputDir, `.launch-config.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let writeFailed = false;
  let writeError;
  try {
    writeFileSync(temporaryPath, render(config), { encoding: 'utf8', mode: 0o644 });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    writeFailed = true;
    writeError = error;
  }

  let cleanupError;
  try {
    unlinkSync(temporaryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') cleanupError = error;
  }

  if (writeFailed) throw writeError;
  if (cleanupError) throw cleanupError;
}

function isEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntrypoint()) {
  // Validation completes before writeLaunchConfig creates a replacement file.
  writeLaunchConfig(createLaunchConfig());
}
