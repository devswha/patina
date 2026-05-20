import { readFileSync } from 'node:fs';
import { inputError } from './errors.js';

export const HTTP_KEY_ENV_VARS = [
  'PATINA_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
];

// Default openai-http runs against the OpenAI-compatible default endpoint, so
// only generic/OpenAI keys make it authenticated without an explicit provider.
export const DEFAULT_HTTP_KEY_ENV_VARS = [
  'PATINA_API_KEY',
  'OPENAI_API_KEY',
];

export function providerHttpKeyEnvVars(providerApiKeyEnv) {
  if (!providerApiKeyEnv) return DEFAULT_HTTP_KEY_ENV_VARS;
  return uniqueEnvVars([providerApiKeyEnv, 'PATINA_API_KEY']);
}

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

export function resolveHttpApiKey({
  explicitApiKey,
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

  if (explicitApiKey) return explicitApiKey;

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
