import { spawnSync } from 'node:child_process';
import { HTTP_KEY_ENV_VARS, inspectHttpApiKeySource, providerHttpKeyEnvVars, resolveHttpApiKey } from '../auth.js';
import { listBackends } from '../backends/index.js';
import { PROVIDERS, resolveProviderConfig } from '../providers.js';
import { inputError } from '../errors.js';

const MIN_NODE_MAJOR = 18;

export async function runDoctor(args = [], { version, fetchImpl } = {}) {
  const parsed = parseDoctorArgs(args);
  if (parsed.help) {
    printDoctorHelp();
    return;
  }

  const report = buildDoctorReport({ version });
  if (parsed.probe) {
    await appendApiKeyProbe(report, { fetchImpl });
  } else {
    report.apiKeyProbe = { attempted: false, host: null, status: null, ok: null, error: null };
  }
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
const API_KEY_PROBE_TIMEOUT_MS = 3000;

/**
 * Ask the default HTTP endpoint whether the configured key is actually
 * accepted, and fold the answer into the report.
 *
 * `api-key-env` only proves a key is present. A revoked or mistyped key
 * still reads `authenticated=yes` and fails on the first real call
 * (observed 2026-09-10: OPENAI_API_KEY set, provider answering 401). The
 * probe is one `GET {baseURL}/models` with the same bearer header a rewrite
 * would send, so nothing is sent anywhere the key would not go anyway.
 *
 * Outcomes: 2xx = accepted (ok); 401/403 = rejected (warning, and the
 * openai-http backend stops counting as authenticated so `usable-backend`
 * tells the truth); anything else (timeout, DNS, 5xx, odd status) =
 * inconclusive (informational ok, never a blocker). Never throws.
 */
export async function appendApiKeyProbe(report, { fetchImpl = globalThis.fetch, timeoutMs = API_KEY_PROBE_TIMEOUT_MS } = {}) {
  const backend = report.backends.find((b) => b.name === 'openai-http');
  let apiKey = null;
  try {
    apiKey = resolveHttpApiKey() || null;
  } catch {
    apiKey = null;
  }
  if (!apiKey || !backend) {
    report.apiKeyProbe = { attempted: false, host: null, status: null, ok: null, error: null };
    return report;
  }

  const { baseURL } = resolveProviderConfig({});
  const url = `${String(baseURL).replace(/\/+$/, '')}/models`;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    host = String(baseURL);
  }

  let status = null;
  let error = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    status = Number(response.status) || null;
  } catch (err) {
    error = err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(err?.message ?? err);
  } finally {
    clearTimeout(timer);
  }

  const accepted = status !== null && status >= 200 && status < 300;
  const rejected = status === 401 || status === 403;
  const ok = accepted ? true : (rejected ? false : null);
  report.apiKeyProbe = { attempted: true, host, status, ok, error };
  backend.keyProbe = ok === null ? 'inconclusive' : (ok ? 'accepted' : 'rejected');

  if (rejected) {
    // Presence is not validity: a key the provider refuses cannot run a
    // rewrite, so the backend is not usable and the aggregate check must
    // recount rather than keep the presence-based verdict.
    backend.authenticated = false;
    backend.authHint = `The provider at ${host} rejected the configured key (HTTP ${status}). Replace the key or point PATINA_API_BASE at the right endpoint.`;
    recountUsableBackends(report);
  }

  report.checks.push({
    name: 'api-key-probe',
    status: rejected ? 'warning' : 'ok',
    summary: accepted
      ? `default HTTP key accepted by ${host}`
      : (rejected ? `default HTTP key rejected by ${host} (HTTP ${status})` : 'default HTTP key not verified'),
    detail: accepted
      ? 'GET /models answered 2xx with the configured bearer key'
      : (rejected
        ? 'presence alone is not authentication; replace the key or select a working backend'
        : `could not probe ${host} (${error || `HTTP ${status}`}); the key may still work`),
  });
  return report;
}

function recountUsableBackends(report) {
  const usable = report.backends.filter((b) => b.available && b.authenticated);
  const check = report.checks.find((c) => c.name === 'usable-backend');
  if (check) {
    check.status = usable.length > 0 ? 'ok' : 'blocker';
    check.summary = usable.length > 0 ? `${usable.length} authenticated backend(s)` : 'no authenticated backend';
    check.detail = usable.length > 0
      ? usable.map((b) => b.name).join(', ')
      : 'Set a working API key or authenticate one local backend (`codex login`, `claude`, `gemini`, or `agy`).';
  }
  const blockers = report.checks.filter((c) => c.status === 'blocker');
  report.ok = blockers.length === 0;
  report.blockers = blockers.map((c) => ({ name: c.name, summary: c.summary, detail: c.detail }));
}

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
  const parsed = { format: 'text', updateCheck: true, probe: true };
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
      case '--no-probe':
        parsed.probe = false;
        break;
      case '--offline':
        parsed.updateCheck = false;
        parsed.probe = false;
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
          'The doctor command only accepts --json, --format, --no-update-check, --no-probe, --offline, and --help.',
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
    const probe = backend.keyProbe ? `, key=${backend.keyProbe}` : '';
    lines.push(
      `  ${ok ? '✓' : '!'} ${backend.name}: available=${yesNo(backend.available)}, authenticated=${yesNo(backend.authenticated)}${probe}${images}`
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

Usage: patina doctor [--json] [--no-update-check] [--no-probe] [--offline]

Checks Node version, patina CLI version, backend availability/authentication,
tmux, PATINA/provider API key environment variables, whether the default HTTP
key is actually accepted (one GET /models against the configured base URL;
skip with --no-probe), and whether a newer patina-cli is on npm (skip with
--no-update-check). --offline skips both network checks. Network failures are
informational, never blockers; a key the provider rejects with 401/403 is a
warning and no longer counts as an authenticated backend. Exits 0 when no
blockers are found, or 1 when a blocking setup issue is detected.
`);
}
