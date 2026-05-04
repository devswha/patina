import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

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

function deepMerge(target, source) {
  for (const key in source) {
    if (isPlainObject(source[key])) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

export function getRepoRoot() {
  return REPO_ROOT;
}
