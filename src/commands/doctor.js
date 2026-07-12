import { spawnSync } from 'node:child_process';
import { HTTP_KEY_ENV_VARS, inspectHttpApiKeySource, providerHttpKeyEnvVars } from '../auth.js';
import { listBackends } from '../backends/index.js';
import { PROVIDERS } from '../providers.js';
import { inputError } from '../errors.js';

const MIN_NODE_MAJOR = 18;

export async function runDoctor(args = [], { version, fetchImpl } = {}) {
  const parsed = parseDoctorArgs(args);
  if (parsed.help) {
    printDoctorHelp();
    return;
  }

  const report = buildDoctorReport({ version });
  if (parsed.updateCheck) {
    await appendUpdateCheck(report, { version, fetchImpl });
  }
  if (parsed.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorText(report));
  }

  if (!report.ok) {
    process.exitCode = Math.max(Number(process.exitCode) || 0, 1);
  }
}

export const NPM_LATEST_URL = 'https://registry.npmjs.org/patina-cli/latest';
const UPDATE_CHECK_TIMEOUT_MS = 3000;

/** Numeric x.y.z compare; returns 1/0/-1, or null when either side is unparseable. */
export function compareSemver(a, b) {
  const parse = (v) => {
    const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Ask the npm registry for the latest published patina-cli version and append
 * the verdict to the report. Diagnostics must degrade gracefully offline: any
 * failure (timeout, DNS, 404, bad JSON) becomes an informational "could not
 * check" line, never a warning or blocker, and never throws.
 */
export async function appendUpdateCheck(report, { version, fetchImpl = globalThis.fetch, timeoutMs = UPDATE_CHECK_TIMEOUT_MS } = {}) {
  let latest = null;
  let error = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(NPM_LATEST_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) error = `registry answered ${response.status}`;
    else latest = String((await response.json())?.version || '') || null;
  } catch (err) {
    error = err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(err?.message ?? err);
  } finally {
    clearTimeout(timer);
  }

  const cmp = latest ? compareSemver(latest, version) : null;
  const updateAvailable = cmp === 1;
  report.update = { latest, current: version || null, updateAvailable, error };
  report.checks.push({
    name: 'update',
    // An available update is worth a visible `!`, but never a blocker — and an
    // unreachable registry (air-gapped CI) stays a quiet informational line.
    status: updateAvailable ? 'warning' : 'ok',
    summary: updateAvailable
      ? `update available: ${version} -> ${latest}`
      : (latest ? `up to date (latest ${latest})` : 'update check skipped'),
    detail: updateAvailable
      ? 'npm: `npm update -g patina-cli` · plugin: `/plugin` -> Marketplaces -> patina -> update (or enable auto-update) · git: `git pull --ff-only`'
      : (error ? `could not reach the npm registry (${error})` : 'patina-cli on the npm registry'),
  });
  return report;
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
  const parsed = { format: 'text', updateCheck: true };
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
      case '--no-update-check':
        parsed.updateCheck = false;
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
          'The doctor command only accepts --json, --format, --no-update-check, and --help.',
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

Usage: patina doctor [--json] [--no-update-check]

Checks Node version, patina CLI version, backend availability/authentication,
tmux, PATINA/provider API key environment variables, and whether a newer
patina-cli is on npm (skip with --no-update-check; offline failures are
informational, never blockers). Exits 0 when no blockers are found, or 1 when
a blocking setup issue is detected.
`);
}
