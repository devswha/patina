import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { listBackends } from '../backends/index.js';
import { PROVIDERS } from '../providers.js';
import { inputError } from '../errors.js';

const MIN_NODE_MAJOR = 18;
const API_KEY_ENVS = [
  'PATINA_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
];

export function runDoctor(args = [], { version } = {}) {
  const parsed = parseDoctorArgs(args);
  if (parsed.help) {
    printDoctorHelp();
    return;
  }

  const report = buildDoctorReport({ version });
  if (parsed.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorText(report));
  }

  if (!report.ok) {
    process.exitCode = Math.max(Number(process.exitCode) || 0, 1);
  }
}

export function buildDoctorReport({ version } = {}) {
  const checks = [];
  const backends = listBackends();
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split('.')[0]);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR;

  checks.push({
    name: 'node',
    status: nodeOk ? 'ok' : 'blocker',
    summary: `Node ${nodeVersion}`,
    detail: nodeOk
      ? `meets package engine >=${MIN_NODE_MAJOR}`
      : `requires Node >=${MIN_NODE_MAJOR}`,
  });

  checks.push({
    name: 'cli-version',
    status: version ? 'ok' : 'warning',
    summary: `patina ${version || 'unknown'}`,
    detail: 'read from package metadata',
  });

  const tmux = checkCommand('tmux', ['-V']);
  checks.push({
    name: 'tmux',
    status: tmux.ok ? 'ok' : 'warning',
    summary: tmux.ok ? tmux.stdout.trim() : 'tmux not found',
    detail: tmux.ok
      ? 'available for MAX omc dispatch workflows'
      : 'only needed for tmux-based MAX dispatch; direct/API modes still work',
  });

  const apiKeys = API_KEY_ENVS.map((name) => ({
    name,
    set: Boolean(process.env[name]),
  }));
  const apiKeyFile = checkApiKeyFile(process.env.PATINA_API_KEY_FILE);
  checks.push({
    name: 'api-key-env',
    status: apiKeyFile.status === 'blocker'
      ? 'blocker'
      : (apiKeys.some((k) => k.set) || apiKeyFile.status === 'ok' ? 'ok' : 'warning'),
    summary: apiKeys.some((k) => k.set) || apiKeyFile.status === 'ok'
      ? 'API key source detected'
      : 'no API key env var detected',
    detail: apiKeyFile.detail || 'HTTP provider use requires PATINA_API_KEY or a provider-specific key',
  });

  const providerKeys = Object.values(PROVIDERS).map((provider) => ({
    name: provider.name,
    apiKeyEnv: provider.apiKeyEnv,
    keySet: Boolean(process.env[provider.apiKeyEnv] || process.env.PATINA_API_KEY),
    baseURL: provider.baseURL,
    defaultModel: provider.defaultModel,
  }));

  const usableBackends = backends.filter((b) => b.available && b.authenticated);
  checks.push({
    name: 'usable-backend',
    status: usableBackends.length > 0 ? 'ok' : 'blocker',
    summary: usableBackends.length > 0
      ? `${usableBackends.length} authenticated backend(s)`
      : 'no authenticated backend',
    detail: usableBackends.length > 0
      ? usableBackends.map((b) => b.name).join(', ')
      : 'Set an API key or authenticate one local backend (`codex login`, `claude`, or `gemini`).',
  });

  const blockers = checks.filter((check) => check.status === 'blocker');
  return {
    ok: blockers.length === 0,
    version: version || null,
    node: {
      version: nodeVersion,
      required: `>=${MIN_NODE_MAJOR}.0.0`,
      ok: nodeOk,
    },
    checks,
    backends,
    providers: providerKeys,
    env: {
      apiKeys,
      PATINA_API_KEY_FILE: process.env.PATINA_API_KEY_FILE || null,
    },
    blockers: blockers.map((check) => ({
      name: check.name,
      summary: check.summary,
      detail: check.detail,
    })),
  };
}

function parseDoctorArgs(args) {
  const parsed = { format: 'text' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--json':
        parsed.format = 'json';
        break;
      case '--format': {
        const value = args[++i];
        if (!['json', 'text'].includes(value)) {
          throw inputError(
            'patina doctor --format expects json or text',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `patina doctor --json` for CI-readable output.'
          );
        }
        parsed.format = value;
        break;
      }
      default:
        throw inputError(
          `unknown doctor option ${arg}`,
          'The doctor command only accepts --json, --format, and --help.',
          'Run `patina doctor --help` for usage.'
        );
    }
  }
  return parsed;
}

function checkCommand(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    return {
      ok: result.status === 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (err) {
    return { ok: false, stdout: '', stderr: err.message };
  }
}

function checkApiKeyFile(path) {
  if (!path) return { status: 'missing', detail: '' };
  if (!existsSync(path)) {
    return { status: 'blocker', detail: `PATINA_API_KEY_FILE points to a missing file: ${path}` };
  }
  try {
    const contents = readFileSync(path, 'utf8').trim();
    if (!contents) {
      return { status: 'blocker', detail: `PATINA_API_KEY_FILE is empty: ${path}` };
    }
    return { status: 'ok', detail: `PATINA_API_KEY_FILE is readable: ${path}` };
  } catch (err) {
    return { status: 'blocker', detail: `Cannot read PATINA_API_KEY_FILE ${path}: ${err.message}` };
  }
}

function formatDoctorText(report) {
  const icon = (status) => status === 'ok' ? '✓' : (status === 'warning' ? '!' : '✗');
  const lines = [
    `patina doctor — ${report.ok ? 'ok' : 'blockers found'}`,
    '',
    'Checks:',
  ];
  for (const check of report.checks) {
    lines.push(`  ${icon(check.status)} ${check.summary}`);
    if (check.detail) lines.push(`    ${check.detail}`);
  }

  lines.push('', 'Backends:');
  for (const backend of report.backends) {
    const ok = backend.available && backend.authenticated;
    lines.push(
      `  ${ok ? '✓' : '!'} ${backend.name}: available=${yesNo(backend.available)}, authenticated=${yesNo(backend.authenticated)}`
    );
    if (!ok && backend.authHint) lines.push(`    → ${backend.authHint}`);
  }

  lines.push('', 'Provider keys:');
  for (const provider of report.providers) {
    lines.push(`  ${provider.keySet ? '✓' : '!'} ${provider.name}: ${provider.apiKeyEnv}=${provider.keySet ? 'set' : 'missing'}`);
  }

  if (report.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of report.blockers) {
      lines.push(`  - ${blocker.summary}: ${blocker.detail}`);
    }
  }

  return lines.join('\n');
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function printDoctorHelp() {
  console.log(`patina doctor — check local CLI readiness

Usage: patina doctor [--json]

Checks Node version, patina CLI version, backend availability/authentication,
tmux, and PATINA/provider API key environment variables. Exits 0 when no
blockers are found, or 1 when a blocking setup issue is detected.
`);
}
