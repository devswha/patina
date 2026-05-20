import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import yaml from 'js-yaml';
import { listBackends } from '../backends/index.js';
import { inputError } from '../errors.js';

const LANGUAGES = ['ko', 'en', 'zh', 'ja'];
const PROFILES = [
  'default',
  'blog',
  'academic',
  'technical',
  'formal',
  'social',
  'email',
  'legal',
  'medical',
  'marketing',
  'narrative',
  'instructional',
];
const TONES = ['profile-only', 'casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'];
const DISPATCH_MODES = ['omc', 'direct', 'api'];

export async function runInit(args = []) {
  const parsed = parseInitArgs(args);
  if (parsed.help) {
    printInitHelp();
    return;
  }

  const target = resolve(process.cwd(), '.patina.yaml');
  if (existsSync(target) && !parsed.force) {
    if (parsed.defaults || !process.stdin.isTTY) {
      throw inputError(
        '.patina.yaml already exists',
        'init will not overwrite an existing project config without confirmation.',
        'Run `patina init --force` to replace it, or edit .patina.yaml manually.'
      );
    }
  }

  const detected = detectInitDefaults();
  const answers = parsed.defaults
    ? detected
    : await promptForConfig(detected, { target, force: parsed.force });

  if (!answers) {
    console.error('[patina] kept existing .patina.yaml');
    return;
  }

  const config = buildInitConfig(answers);
  writeFileSync(target, `${yaml.dump(config, { lineWidth: 100 }).trimEnd()}\n`, 'utf8');
  console.log(`[patina] wrote ${target}`);
}

export function detectInitDefaults() {
  const backends = listBackends();
  const authenticated = backends.filter((b) => b.available && b.authenticated);
  const preferredBackend = (
    authenticated.find((b) => b.name !== 'openai-http') ||
    authenticated[0] ||
    backends.find((b) => b.name === 'openai-http')
  )?.name || 'openai-http';

  const maxModels = authenticated
    .map((b) => MODEL_BY_BACKEND[b.name])
    .filter(Boolean);

  return {
    language: 'ko',
    profile: 'default',
    tone: 'profile-only',
    backend: preferredBackend,
    maxModels: maxModels.length > 0 ? maxModels : ['claude', 'gemini'],
    dispatch: commandAvailable('tmux') ? 'omc' : 'direct',
  };
}

function parseInitArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--defaults':
        parsed.defaults = true;
        break;
      case '--force':
      case '--yes':
      case '-y':
        parsed.force = true;
        break;
      default:
        throw inputError(
          `unknown init option ${arg}`,
          'The init command only accepts --defaults, --force, and --help.',
          'Run `patina init --help` for usage.'
        );
    }
  }
  return parsed;
}

async function promptForConfig(defaults, { target, force }) {
  if (!process.stdin.isTTY) {
    throw inputError(
      'init needs an interactive terminal',
      'guided setup asks questions before writing .patina.yaml.',
      'Run `patina init --defaults` for a non-interactive config.'
    );
  }

  const rl = createInterface({ input, output });
  try {
    if (existsSync(target) && !force) {
      const overwrite = await ask(rl, `Overwrite existing .patina.yaml?`, 'no', ['yes', 'no']);
      if (overwrite !== 'yes') return null;
    }

    const language = await ask(rl, 'Language', defaults.language, LANGUAGES);
    const profile = await ask(rl, 'Profile', defaults.profile, PROFILES);
    const tone = await ask(rl, 'Tone', defaults.tone, TONES);
    const backendChoices = listBackends().map((b) => b.name);
    const backend = await ask(rl, 'Backend', defaults.backend, backendChoices);
    const maxModels = await askMulti(rl, 'MAX models', defaults.maxModels, ['claude', 'codex', 'gemini']);
    const dispatch = await ask(rl, 'Dispatch mode', defaults.dispatch, DISPATCH_MODES);
    return { language, profile, tone, backend, maxModels, dispatch };
  } finally {
    rl.close();
  }
}

async function ask(rl, label, defaultValue, choices) {
  const choiceHint = choices ? ` (${choices.join('/')})` : '';
  const raw = (await rl.question(`${label}${choiceHint} [${defaultValue}]: `)).trim();
  const value = raw || defaultValue;
  if (choices && !choices.includes(value)) {
    console.error(`[patina] ${label}: unknown value "${value}", keeping ${defaultValue}`);
    return defaultValue;
  }
  return value;
}

async function askMulti(rl, label, defaultValues, choices) {
  const raw = (await rl.question(`${label} (${choices.join(',')}) [${defaultValues.join(',')}]: `)).trim();
  const values = (raw ? raw.split(',') : defaultValues)
    .map((value) => value.trim())
    .filter(Boolean);
  const valid = values.filter((value) => choices.includes(value));
  if (valid.length === 0) {
    console.error(`[patina] ${label}: no valid values, keeping ${defaultValues.join(',')}`);
    return defaultValues;
  }
  return [...new Set(valid)];
}

function buildInitConfig(answers) {
  return {
    language: answers.language,
    profile: answers.profile,
    tone: answers.tone === 'profile-only' ? null : answers.tone,
    backend: answers.backend,
    'max-models': answers.maxModels,
    dispatch: answers.dispatch,
  };
}

function commandAvailable(name) {
  try {
    const result = spawnSync(name, ['-V'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

const MODEL_BY_BACKEND = {
  'codex-cli': 'codex',
  'claude-cli': 'claude',
  'gemini-cli': 'gemini',
};

function printInitHelp() {
  console.log(`patina init — create a project .patina.yaml

Usage: patina init [--defaults] [--force]

Guided mode asks for language, profile, tone, backend, MAX models, and dispatch
mode. It preselects authenticated local backends when available.

Options:
  --defaults   Write detected defaults without prompts
  --force      Overwrite an existing .patina.yaml
`);
}
