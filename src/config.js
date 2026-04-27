import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export function loadConfig(path = resolve(REPO_ROOT, '.patina.default.yaml')) {
  const raw = readFileSync(path, 'utf8');
  const config = yaml.load(raw);

  const userConfigPath = resolve(homedir(), '.patina.yaml');
  if (existsSync(userConfigPath)) {
    const userRaw = readFileSync(userConfigPath, 'utf8');
    const userConfig = yaml.load(userRaw);
    deepMerge(config, userConfig);
  }

  return config;
}

function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') {
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
