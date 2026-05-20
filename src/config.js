import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/**
 * Load default config and merge global/project .patina.yaml overrides.
 *
 * @param {string} [path] Base YAML config path.
 * @returns {object} Merged patina configuration object.
 * @throws {Error} When a config file is missing, invalid YAML, or not a mapping.
 * @example
 * const config = loadConfig();
 */
export function loadConfig(path = resolve(REPO_ROOT, '.patina.default.yaml')) {
  const raw = readFileSync(path, 'utf8');
  const parsed = yaml.load(raw);
  if (!isPlainObject(parsed)) {
    throw new Error(`Config at ${path} did not parse to a YAML mapping (got ${typeof parsed})`);
  }
  const config = parsed;

  // User config: ~/.patina.yaml (global), then ./.patina.yaml (project, takes precedence).
  for (const userPath of [resolve(homedir(), '.patina.yaml'), resolve(process.cwd(), '.patina.yaml')]) {
    if (!existsSync(userPath)) continue;
    const userRaw = readFileSync(userPath, 'utf8');
    const userConfig = yaml.load(userRaw);
    if (userConfig === null || userConfig === undefined) continue; // empty file
    if (!isPlainObject(userConfig)) {
      throw new Error(`User config at ${userPath} must be a YAML mapping (got ${Array.isArray(userConfig) ? 'array' : typeof userConfig})`);
    }
    deepMerge(config, userConfig);
  }

  return config;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const ADDITIVE_LIST_KEYS = new Set(['blocklist', 'allowlist', 'skip-patterns']);

function deepMerge(target, source) {
  for (const key in source) {
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
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const root = getRepoRoot();
 */
export function getRepoRoot() {
  return REPO_ROOT;
}

const VALID_TONES = ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'];

// Resolve the effective tone from CLI flag and config (v3.10).
// Priority: cliTone > configTone > unset. zh/ja + explicit tone → fallback path.
// Returns: { tone, tone_source, tone_evidence, tone_confidence, warning? }
/**
 * Resolve CLI/config tone settings into prompt-ready tone metadata.
 *
 * @param {object} options Tone inputs.
 * @param {string|null} [options.cliTone] CLI tone override.
 * @param {string|null} [options.configTone] Configured tone value.
 * @param {string} [options.lang] Active language code.
 * @returns {Object} Tone metadata.
 * @throws {Error} When cliTone or configTone is not supported.
 * @example
 * const tone = resolveTone({ cliTone: 'casual', lang: 'ko' });
 */
export function resolveTone({ cliTone, configTone, lang }) {
  if (cliTone !== undefined && cliTone !== null) {
    if (!VALID_TONES.includes(cliTone)) {
      throw new Error(
        `Unknown tone '${cliTone}'. Valid tones: ${VALID_TONES.join(', ')}`
      );
    }
  }
  if (configTone !== undefined && configTone !== null && configTone !== '') {
    if (!VALID_TONES.includes(configTone)) {
      throw new Error(
        `Invalid tone '${configTone}' in config. Valid tones: ${VALID_TONES.join(', ')}`
      );
    }
  }

  const effective = cliTone || (configTone === '' ? null : configTone) || null;

  // Profile-only mode: nothing specified at all.
  if (!effective) {
    return {
      tone: null,
      tone_source: 'profile_only',
      tone_evidence: [],
      tone_confidence: null,
    };
  }

  // zh/ja + any tone (including auto) → warning + fallback.
  // Phase 4.5b heuristics only cover ko/en signals; auto on zh/ja would
  // silently degrade to residual "professional" without useful evidence.
  if ((lang === 'zh' || lang === 'ja') && effective) {
    const label = effective === 'auto' ? 'auto-detection' : `tone "${effective}"`;
    const warning = `${label} is en/ko-only in v1; falling back to default profile`;
    return {
      tone: null,
      tone_source: 'unsupported_language_fallback',
      tone_evidence: [warning],
      tone_confidence: null,
      warning,
    };
  }

  if (effective === 'auto') {
    // Detection runs in-prompt at SKILL.md Phase 4.5b. Mark request only.
    return {
      tone: 'auto',
      tone_source: 'auto',
      tone_evidence: [],
      tone_confidence: null,
    };
  }

  // User-specified named tone.
  return {
    tone: effective,
    tone_source: 'user',
    tone_evidence: ['user-specified'],
    tone_confidence: 'high',
  };
}
