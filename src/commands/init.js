import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import yaml from 'js-yaml';
import { listBackends } from '../backends/index.js';
import { inputError } from '../errors.js';
import { createLogger } from '../logger.js';

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
  'casual-conversation',
  'code-comment',
  'commit-message',
  'release-notes',
  'namuwiki',
];
const TONES = ['profile-only', 'casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'];

export async function runInit(args = [], { logger = createLogger() } = {}) {
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
    : await promptForConfig(detected, { target, force: parsed.force, logger });

  if (!answers) {
    logger.info('init.kept_existing', { message: '[patina] kept existing .patina.yaml' });
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

  return {
    language: 'ko',
    profile: 'default',
    tone: 'profile-only',
    backend: preferredBackend,
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

async function promptForConfig(defaults, { target, force, logger = createLogger() }) {
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
      const overwrite = await ask(rl, `Overwrite existing .patina.yaml?`, 'no', ['yes', 'no'], logger);
      if (overwrite !== 'yes') return null;
    }

    const language = await ask(rl, 'Language', defaults.language, LANGUAGES, logger);
    const profile = await ask(rl, 'Profile', defaults.profile, PROFILES, logger);
    const tone = await ask(rl, 'Tone', defaults.tone, TONES, logger);
    const backendChoices = listBackends().map((b) => b.name);
    const backend = await ask(rl, 'Backend', defaults.backend, backendChoices, logger);
    return { language, profile, tone, backend };
  } finally {
    rl.close();
  }
}

async function ask(rl, label, defaultValue, choices, logger = createLogger()) {
  const choiceHint = choices ? ` (${choices.join('/')})` : '';
  const raw = (await rl.question(`${label}${choiceHint} [${defaultValue}]: `)).trim();
  const value = raw || defaultValue;
  if (choices && !choices.includes(value)) {
    logger.warn('init.unknown_value', { message: `[patina] ${label}: unknown value "${value}", keeping ${defaultValue}` });
    return defaultValue;
  }
  return value;
}


function buildInitConfig(answers) {
  return {
    language: answers.language,
    profile: answers.profile,
    tone: answers.tone === 'profile-only' ? null : answers.tone,
    backend: answers.backend,
  };
}


function printInitHelp() {
  console.log(`patina init — create a project .patina.yaml

Usage: patina init [--defaults] [--force]

Guided mode asks for language, profile, tone, and backend. It preselects
authenticated local backends when available.

Options:
  --defaults   Write detected defaults without prompts
  --force      Overwrite an existing .patina.yaml
`);
}
