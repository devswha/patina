import { spawnSync } from 'node:child_process';
import { HTTP_KEY_ENV_VARS, inspectHttpApiKeySource, providerHttpKeyEnvVars } from '../auth.js';
import { listBackends } from '../backends/index.js';
import { PROVIDERS } from '../providers.js';
import { inputError } from '../errors.js';

const MIN_NODE_MAJOR = 18;

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
      ? 'available when you want tmux-based parallel workflows outside patina itself'
      : 'optional; patina no longer requires tmux for any built-in mode',
  });

  const apiKeySource = inspectHttpApiKeySource();
  const apiKeys = HTTP_KEY_ENV_VARS.map((name) => ({
    name,
    set: Boolean(process.env[name]),
  }));
  checks.push({
    name: 'api-key-env',
    status: apiKeySource.source === 'PATINA_API_KEY_FILE' && !apiKeySource.ok
      ? 'blocker'
      : (apiKeySource.ok ? 'ok' : 'warning'),
    summary: apiKeySource.ok
      ? 'default HTTP API key source detected'
      : 'no default HTTP API key source detected',
    detail: apiKeySource.detail,
  });

  const providerKeys = Object.values(PROVIDERS).map((provider) => ({
    name: provider.name,
    apiKeyEnv: provider.apiKeyEnv,
    providerEnvSet: Boolean(process.env[provider.apiKeyEnv]),
    keySource: getProviderKeySource(provider),
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
    // timeout so a hung shim on PATH (e.g. a wedged `tmux`) can't block
    // `patina doctor` indefinitely; fixed argv + no shell means no injection (#448).
    const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
    return {
      ok: result.status === 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (err) {
    return { ok: false, stdout: '', stderr: err.message };
  }
}

function getProviderKeySource(provider) {
  const source = inspectHttpApiKeySource({
    envVars: providerHttpKeyEnvVars(provider.apiKeyEnv),
  });
  return source.ok ? source.source : null;
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
    const images = backend.supportsImages ? ', images=yes' : '';
    lines.push(
      `  ${ok ? '✓' : '!'} ${backend.name}: available=${yesNo(backend.available)}, authenticated=${yesNo(backend.authenticated)}${images}`
    );
    if (!ok && backend.authHint) lines.push(`    → ${backend.authHint}`);
  }

  lines.push('', 'Provider keys:');
  for (const provider of report.providers) {
    lines.push(
      `  ${provider.keySource ? '✓' : '!'} ${provider.name}: key=${provider.keySource || 'missing'} ` +
      `(provider env ${provider.apiKeyEnv}=${provider.providerEnvSet ? 'set' : 'missing'})`
    );
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
