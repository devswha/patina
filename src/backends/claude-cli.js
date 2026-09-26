import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  runInteractiveCommand,
  probeCliAvailability,
  runOwnedCliCapture,
  throwIfAborted,
  withCliTempDir,
} from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'claude-cli';
export const loginCommand = 'claude auth login';
export const installHint = 'Install Claude Code first, then run `patina auth login claude-cli` again.';

export function isAvailable() {
  return probeCliAvailability('claude');
}

function credentialsPath() {
  // Claude Code stores OAuth tokens in ~/.claude/.credentials.json after the
  // first interactive login. The path is consistent across platforms when the
  // CLI is installed via the standard installer.
  return join(homedir(), '.claude', '.credentials.json');
}

/**
 * Classify the Claude Code credentials file without touching the network.
 *
 * Claude Code keeps the file after a logout or a failed token refresh but
 * blanks the tokens and sets `expiresAt` to 0, so file presence alone would
 * report an expired session as authenticated. A session is usable when the
 * access token is live, or when a live refresh token lets the CLI mint a new
 * one. Only positive, finite, past timestamps count as expired; 0 or a
 * missing timestamp means "unknown", not "expired". An unrecognised layout keeps the old presence semantics so other
 * credential stores are not misreported.
 *
 * @param {string} file Credentials file path.
 * @param {number} [now=Date.now()] Comparison time in epoch milliseconds.
 * @returns {'missing'|'unreadable'|'expired'|'ok'} Credential state.
 */
export function readClaudeCredentialState(file, now = Date.now()) {
  if (!existsSync(file)) return 'missing';
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return 'unreadable';
  }
  const oauth = parsed?.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return 'ok';
  const live = (token, expiresAt) => typeof token === 'string' && token.trim() !== ''
    && !(Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now);
  return live(oauth.accessToken, oauth.expiresAt) || live(oauth.refreshToken, oauth.refreshTokenExpiresAt)
    ? 'ok'
    : 'expired';
}

/**
 * macOS Keychain probe. On macOS Claude Code stores OAuth credentials in the
 * login Keychain as the generic password `Claude Code-credentials` and never
 * writes ~/.claude/.credentials.json, so the file check alone reported an
 * authenticated install as unauthenticated there (#829). Only darwin runs
 * `security`; a missing binary, a lookup miss, or any spawn error reports
 * false and the file check decides, leaving every other platform untouched.
 * The probe is bounded at 5000ms (the same convention as doctor's
 * checkCommand, #448) and the timeout kills with SIGKILL, so the bound
 * holds even if a wedged `security` would ignore SIGTERM; a timeout
 * fails closed like any spawn error and the file check decides.
 *
 * @param {{platform?: string, spawnSyncImpl?: Function}} [deps] Test seam.
 * @returns {boolean} Whether the Keychain holds Claude Code credentials.
 */
export function hasMacOsKeychainCredentials({ platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  if (platform !== 'darwin') return false;
  try {
    const result = spawnSyncImpl('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Classify Claude Code authentication without touching the network. The
 * credentials file and the platform/spawn pair are injectable so tests can
 * classify owned fixtures instead of the host home.
 *
 * @param {{credentialsFile?: string, platform?: string, spawnSyncImpl?: Function}} [deps] Internal test seam.
 * @returns {boolean} Whether a usable Claude Code session exists.
 */
export function isAuthenticated({ credentialsFile = credentialsPath(), platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  return readClaudeCredentialState(credentialsFile) === 'ok' || hasMacOsKeychainCredentials({ platform, spawnSyncImpl });
}

export function authHint() {
  const state = readClaudeCredentialState(credentialsPath());
  if (state === 'expired') {
    return `Claude Code session expired or logged out; run \`${loginCommand}\` again (uses your Claude subscription, no API key needed).`;
  }
  if (state === 'unreadable') {
    return `Claude Code credentials file is not valid JSON; run \`${loginCommand}\` to recreate it.`;
  }
  return `Run \`${loginCommand}\` and follow the OAuth prompt to authenticate (uses your Claude subscription, no API key needed).`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'claude',
    args: ['auth', 'login'],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('claude-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal, 'claude-cli backend: aborted');

  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });

  // claude -p prints to stdout, so no output file plumbing is needed (unlike
  // codex-cli).
  return withCliTempDir('patina-claude-', async (dir) => {
    // A rewrite or score is a pure text transform, so the built-in tool set is
    // emptied (`--tools ""`) and the user's configured MCP servers are skipped
    // (`--strict-mcp-config` with no --mcp-config): source text that contains
    // instructions gets no tool to act on, no third-party MCP process starts
    // per call, and the request carries no tool definitions.
    const { stdout } = await runOwnedCliCapture({
      backendName: name,
      command: 'claude',
      args: ['-p', '--model', cliModel, '--tools', '', '--strict-mcp-config'],
      cwd: dir,
      stdinText: prompt,
      timeout,
      signal,
      notFoundHint: 'Install Claude Code first.',
    });
    return stdout;
  });
}
