// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { inputError } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = resolve(__dirname, '..');

/**
 * Return the repository/bundle root inferred from this source file location.
 *
 * Serverless functions use this to resolve bundled patina assets relative to the
 * deployed module rather than `process.cwd()`.
 *
 * @returns {string} Absolute bundle root path.
 */
export function resolveBundleRoot() {
  return BUNDLE_ROOT;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Load the web-safe baseline config only.
 *
 * This intentionally does not call `loadConfig()` from config.js because the CLI
 * loader merges ambient `~/.patina.yaml` and `./.patina.yaml`, which must never
 * influence the public serverless rewrite path.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot] Bundle root containing .patina.default.yaml.
 * @returns {object} Parsed baseline patina config.
 * @throws {import('./errors.js').PatinaCliError} When the baseline is unreadable, invalid YAML, or not a mapping.
 */
export function loadWebConfig({ repoRoot = resolveBundleRoot() } = {}) {
  const configPath = resolve(repoRoot, '.patina.default.yaml');
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err) {
    throw inputError(
      'web baseline config could not be read',
      `${configPath}: ${/** @type {Error} */ (err).message}`,
      'Ensure .patina.default.yaml is included in the serverless bundle.'
    );
  }

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw inputError(
      'web baseline config is invalid YAML',
      `${configPath}: ${/** @type {Error} */ (err).message}`,
      'Fix .patina.default.yaml so it parses as YAML.'
    );
  }

  if (!isPlainObject(parsed)) {
    throw inputError(
      'web baseline config did not parse to a YAML mapping',
      `${configPath}: got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      'A patina config must be a YAML mapping (key: value pairs), not a list or scalar.'
    );
  }

  return parsed;
}
