import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { inputError } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * Load default config and merge global/project .patina.yaml overrides.
 *
 * Precedence (low → high): base path → ~/.patina.yaml → ./.patina.yaml → overridePath.
 * The explicit `--config` file is layered LAST so an ambient project .patina.yaml
 * cannot override explicit values. It is an overlay, not an execution snapshot.
 * Internal snapshotPath instead loads only the captured mapping: no defaults,
 * ambient files, or additive re-merging. Both paths share validation/normalization.
 *
 * @param {string} [path] Base YAML config path.
 * @param {object} [opts] Optional load options.
 * @param {string} [opts.overridePath] Explicit `--config` override path.
 * @param {string} [opts.snapshotPath] Internal complete config snapshot; excludes overridePath.
 * @returns {object} Merged patina configuration object.
 * @throws {Error} When a config file is missing, invalid YAML, or not a mapping.
 * @example
 * const config = loadConfig();
 */
export function loadConfig(path = resolve(REPO_ROOT, '.patina.default.yaml'), { overridePath, snapshotPath } = {}) {
  if (snapshotPath && overridePath) {
    throw inputError(
      '--config-snapshot and --config cannot be combined',
      'An execution snapshot must not be merged with other config files.',
      'Use --config for ordinary overlays, or only --config-snapshot for a captured configuration.'
    );
  }
  if (snapshotPath) path = resolve(snapshotPath);
  const raw = readFileSync(path, 'utf8');
  const parsed = yaml.load(raw);
  if (!isPlainObject(parsed)) {
    throw inputError(
      'config did not parse to a YAML mapping',
      `${path}: got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      'A patina config must be a YAML mapping (key: value pairs), not a list or scalar.'
    );
  }
  const config = parsed;

  if (!snapshotPath) {
    // User config: ~/.patina.yaml (global), then ./.patina.yaml (project, takes precedence).
    for (const userPath of [...new Set([resolve(homedir(), '.patina.yaml'), resolve(process.cwd(), '.patina.yaml')])]) {
      if (!existsSync(userPath)) continue;
      mergeYamlMapping(config, userPath, 'User config');
    }

    // Explicit --config wins over both defaults and the ambient project/global files.
    if (overridePath) {
      mergeYamlMapping(config, resolve(overridePath), 'Config');
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, 'profile')) {
    throw inputError(
      "config key 'profile' was removed in v7",
      "Document classification now uses 'document-type'; profile was easy to confuse with a voice persona.",
      "Rename 'profile:' to 'document-type:' in .patina.yaml."
    );
  }
  for (const retiredKey of ['tone', 'formality']) {
    if (!Object.prototype.hasOwnProperty.call(config, retiredKey)) continue;
    throw inputError(
      `config key '${retiredKey}' was removed in v7`,
      "The casual/professional axis is named 'register'.",
      `Rename '${retiredKey}:' to 'register:' in .patina.yaml and remove the unsupported value 'auto'.`
    );
  }
  config.documentType = config['document-type'] || 'default';
  delete config['document-type'];
  return config;
}

function mergeYamlMapping(config, filePath, label) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw inputError(
      `${label.toLowerCase()} file could not be read`,
      `${filePath}: ${err.message}`,
      'Check the --config path (or the ~/.patina.yaml / ./.patina.yaml location).'
    );
  }
  const parsed = yaml.load(raw);
  if (parsed === null || parsed === undefined) return; // empty file
  if (!isPlainObject(parsed)) {
    throw inputError(
      `${label.toLowerCase()} is not a YAML mapping`,
      `${filePath}: got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      'A patina config must be a YAML mapping (key: value pairs).'
    );
  }
  deepMerge(config, parsed);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const ADDITIVE_LIST_KEYS = new Set(['blocklist', 'allowlist', 'skip-patterns']);
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(target, source) {
  for (const key in source) {
    // Guard against prototype pollution from an auto-loaded .patina.yaml.
    if (!Object.prototype.hasOwnProperty.call(source, key) || PROTO_KEYS.has(key)) continue;
    if (isPlainObject(source[key])) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else if (Array.isArray(source[key]) && ADDITIVE_LIST_KEYS.has(key)) {
      const base = Array.isArray(target[key]) ? target[key] : [];
      target[key] = [...new Set([...base, ...source[key]])];
    } else if (Array.isArray(source[key])) {
      target[key] = [...source[key]];
    } else {
      target[key] = source[key];
    }
  }
}

/**
 * Return the repository root inferred from this source file location.
 *
 * @returns {string} Absolute repository root path.
 * @example
 * const root = getRepoRoot();
 */
export function getRepoRoot() {
  return REPO_ROOT;
}

const VALID_REGISTERS = ['casual', 'professional'];

function rejectRegister(value, where) {
  throw inputError(
    where === 'config' ? `invalid register '${value}' in config` : `unknown register '${value}'`,
    `${where === 'config' ? "The config 'register'" : '--register'} must be one of: ${VALID_REGISTERS.join(', ')}.`,
    where === 'config'
      ? "Fix the register value in .patina.yaml (or remove it to preserve the source register)."
      : 'Pass a supported register, or omit --register to preserve the source register.'
  );
}

/**
 * Resolve an explicit register override.
 *
 * Omitting the option preserves the source document's dominant register. There
 * is no `auto` mode: source-preserving behavior is the default and avoids a
 * second, model-dependent inference path.
 *
 * @param {object} options Register inputs.
 * @param {string|null} [options.cliRegister] CLI register override.
 * @param {string|null} [options.configRegister] Configured register value.
 * @returns {object|null} Prompt-ready register metadata, or null when omitted.
 * @throws {Error} When either value is unsupported.
 * @example
 * const register = resolveRegister({ cliRegister: 'casual' });
 */
export function resolveRegister({ cliRegister, configRegister }) {
  if (cliRegister !== undefined && cliRegister !== null && !VALID_REGISTERS.includes(cliRegister)) {
    rejectRegister(cliRegister, 'cli');
  }
  if (
    configRegister !== undefined
    && configRegister !== null
    && configRegister !== ''
    && !VALID_REGISTERS.includes(configRegister)
  ) {
    rejectRegister(configRegister, 'config');
  }

  const effective = cliRegister || (configRegister === '' ? null : configRegister) || null;
  if (!effective) return null;
  return {
    register: effective,
    register_source: cliRegister ? 'command' : 'config',
    register_evidence: ['user-specified'],
    register_confidence: 'high',
  };
}
