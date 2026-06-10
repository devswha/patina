// HTTP API key resolution helpers (env vars / key files) for the openai-http
// backend. The `patina auth` subcommand lives in src/commands/auth.js.
import { readFileSync } from 'node:fs';
import { inputError } from './errors.js';

/**
 * Environment variable names checked for HTTP provider authentication.
 *
 * @type {string[]}
 * @example
 * const supported = HTTP_KEY_ENV_VARS.includes('OPENAI_API_KEY');
 */
export const HTTP_KEY_ENV_VARS = [
  'PATINA_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
  'KIMI_API_KEY',
  'MOONSHOT_API_KEY',
];

// Default openai-http runs against the OpenAI-compatible default endpoint, so
// only generic/OpenAI keys make it authenticated without an explicit provider.
/**
 * Default key lookup order for the OpenAI-compatible HTTP provider.
 *
 * @type {string[]}
 * @example
 * const first = DEFAULT_HTTP_KEY_ENV_VARS[0]; // PATINA_API_KEY
 */
export const DEFAULT_HTTP_KEY_ENV_VARS = [
  'PATINA_API_KEY',
  'OPENAI_API_KEY',
];

/**
 * Build the key lookup order for a selected provider.
 *
 * @param {string} [providerApiKeyEnv] Provider-specific key env var, such as GEMINI_API_KEY.
 * @returns {string[]} Unique env var names in lookup order.
 * @throws {Error} Does not intentionally throw; invalid non-string env names can still propagate JavaScript runtime failures.
 * @example
 * const vars = providerHttpKeyEnvVars('GEMINI_API_KEY');
 */
export function providerHttpKeyEnvVars(providerApiKeyEnv) {
  if (!providerApiKeyEnv) return DEFAULT_HTTP_KEY_ENV_VARS;
  return uniqueEnvVars([providerApiKeyEnv, 'PATINA_API_KEY']);
}

/**
 * Inspect where an HTTP API key would be read from without exposing the secret.
 *
 * @param {object} [options] Inspection options.
 * @param {object} [options.env=process.env] Environment map to inspect.
 * @param {Function} [options.readFile] File reader for PATINA_API_KEY_FILE.
 * @param {string[]} [options.envVars=DEFAULT_HTTP_KEY_ENV_VARS] Env vars to check.
 * @returns {{ok: boolean, source: string|null, envVars: string[], filePath: string|null, detail: string}} Source diagnostics.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const source = inspectHttpApiKeySource({ env: { PATINA_API_KEY: 'sk-...' } });
 */
export function inspectHttpApiKeySource({
  env = process.env,
  readFile = readFileSync,
  envVars = DEFAULT_HTTP_KEY_ENV_VARS,
} = {}) {
  const filePath = env.PATINA_API_KEY_FILE;
  if (filePath) {
    const file = readApiKeyFile(filePath, readFile);
    return file.ok
      ? { ok: true, source: 'PATINA_API_KEY_FILE', envVars: [], filePath, detail: `Authenticated via PATINA_API_KEY_FILE (${filePath}).` }
      : { ok: false, source: 'PATINA_API_KEY_FILE', envVars: [], filePath, detail: file.detail };
  }

  const present = uniqueEnvVars(envVars).filter((key) => env[key]);
  if (present.length > 0) {
    return { ok: true, source: present[0], envVars: present, filePath: null, detail: `Authenticated via ${present.join(', ')}.` };
  }

  return {
    ok: false,
    source: null,
    envVars: [],
    filePath: null,
    detail: 'Set PATINA_API_KEY, PATINA_API_KEY_FILE, OPENAI_API_KEY, or select a provider with its key.',
  };
}

/**
 * Resolve the HTTP API key from a key file or environment.
 *
 * @param {object} [options] Resolution options.
 * @param {string} [options.apiKeyFile] Explicit key file path.
 * @param {object} [options.env=process.env] Environment map.
 * @param {Function} [options.readFile] File reader for key files.
 * @param {string[]} [options.envVars=DEFAULT_HTTP_KEY_ENV_VARS] Env var lookup order.
 * @returns {string|undefined} Resolved key value, or undefined when unauthenticated.
 * @throws {PatinaCliError} When the configured key file cannot be read or is empty.
 * @example
 * const key = resolveHttpApiKey({ env: process.env });
 */
export function resolveHttpApiKey({
  apiKeyFile,
  env = process.env,
  readFile = readFileSync,
  envVars = DEFAULT_HTTP_KEY_ENV_VARS,
} = {}) {
  const filePath = apiKeyFile || env.PATINA_API_KEY_FILE;
  if (filePath) {
    const file = readApiKeyFile(filePath, readFile);
    if (!file.ok) {
      throw inputError(
        file.what,
        file.detail,
        'Check the path, write the key into the file, or unset PATINA_API_KEY_FILE.'
      );
    }
    return file.key;
  }


  const source = inspectHttpApiKeySource({ env, readFile, envVars });
  return source.ok && source.source !== 'PATINA_API_KEY_FILE'
    ? env[source.source]
    : undefined;
}

function uniqueEnvVars(envVars) {
  return [...new Set(envVars.filter(Boolean))];
}

function readApiKeyFile(filePath, readFile) {
  let contents;
  try {
    contents = readFile(filePath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      what: 'cannot read API key file',
      detail: `${filePath}: ${err.message}`,
    };
  }

  const key = contents.replace(/[\r\n]+$/, '').trim();
  if (!key) {
    return {
      ok: false,
      what: 'API key file is empty',
      detail: filePath,
    };
  }

  return { ok: true, key };
}
