// Optional local loader for private structural classifier weights. The public
// repo ships this resolver so the same `patina` CLI can use a private local
// model when one is installed, while the model file itself remains outside this
// repository and outside the npm tarball.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { normalizeStructuralModel } from './structural-classifier.js';

const MODEL_ENV_KEYS = Object.freeze(['PATINA_STRUCTURAL_MODEL', 'PATINA_MODEL_PATH']);
const MODEL_PATH_KEYS = Object.freeze([
  ['stylometry', 'structural_model', 'path'],
  ['stylometry', 'classifier', 'model_path'],
  ['private_model', 'path'],
]);

function getPathValue(object, keys) {
  let cursor = object;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = cursor[key];
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
}

function expandHome(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return path;
}

function resolvePath(path, cwd) {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function defaultCandidatePaths(lang, cwd) {
  const name = `model-${lang}.json`;
  return [
    resolve(cwd, '.patina/models', name),
    resolve(cwd, '.patina', name),
    resolve(homedir(), '.patina/models', name),
    resolve(homedir(), '.patina', name),
  ];
}

/**
 * Resolve the structural model file path, if any.
 *
 * Explicit env/config paths are required and fail when missing. Default search
 * locations are optional and simply mean "no private model installed" when
 * absent.
 *
 * @param {object} [config] Effective patina config.
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {string} [opts.cwd]
 * @returns {{path:string, source:string, required:boolean}|null}
 */
export function resolveStructuralModelPath(config = {}, { lang = 'ko', env = process.env, cwd = process.cwd() } = {}) {
  for (const key of MODEL_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
      return { path: resolvePath(value.trim(), cwd), source: key, required: true };
    }
  }

  for (const keys of MODEL_PATH_KEYS) {
    const value = getPathValue(config, keys);
    if (value) {
      return { path: resolvePath(value, cwd), source: keys.join('.'), required: true };
    }
  }

  for (const path of defaultCandidatePaths(lang, cwd)) {
    if (existsSync(path)) return { path, source: 'default-search', required: false };
  }

  return null;
}

/**
 * Load and validate a private structural classifier model, if installed.
 *
 * @param {object} [config] Effective patina config.
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {string} [opts.cwd]
 * @returns {object|null} Normalized model or null when no optional default model exists.
 */
export function loadStructuralModel(config = {}, opts = {}) {
  const resolved = resolveStructuralModelPath(config, opts);
  if (!resolved) return null;
  if (!existsSync(resolved.path)) {
    if (resolved.required) {
      throw new Error(`Configured structural model not found (${resolved.source}): ${resolved.path}`);
    }
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved.path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read structural model at ${resolved.path}: ${err.message}`);
  }

  try {
    return normalizeStructuralModel(parsed);
  } catch (err) {
    throw new Error(`Invalid structural model at ${resolved.path}: ${err.message}`);
  }
}
