// `patina auth` subcommand: backend status table and guided login flows.
// Distinct from src/auth.js, which holds the HTTP API key resolution
// helpers (env vars / key files) used by the openai-http backend.
import { createInterface } from 'node:readline/promises';
import { listBackends, listBackendNames, resolveBackend } from '../backends/index.js';
import { inputError, runtimeError } from '../errors.js';
import { formatLimit } from '../backends/contract.js';

export function printBackendStatus() {
  const list = listBackends();
  const rows = list.map((b) => ({
    name: b.name,
    kind: b.kind,
    selectWith: b.selectWith,
    defaultModel: b.defaultModel || '-',
    available: b.available ? 'yes' : 'no',
    authenticated: b.authenticated ? 'yes' : 'no',
    note: `${backendSafetyNote(b)} ${backendStatusNote(b)}`.trim(),
  }));
  const widths = {
    name: Math.max('Backend'.length, ...rows.map((r) => r.name.length)),
    kind: Math.max('Kind'.length, ...rows.map((r) => r.kind.length)),
    selectWith: Math.max('Select with'.length, ...rows.map((r) => r.selectWith.length)),
    defaultModel: Math.max('Default model'.length, ...rows.map((r) => r.defaultModel.length)),
    available: Math.max('Available'.length, ...rows.map((r) => r.available.length)),
    authenticated: Math.max('Authenticated'.length, ...rows.map((r) => r.authenticated.length)),
  };
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('Backend', widths.name)}  ${pad('Kind', widths.kind)}  ${pad('Select with', widths.selectWith)}  ${pad('Default model', widths.defaultModel)}  ${pad('Available', widths.available)}  ${pad('Authenticated', widths.authenticated)}  Notes`
  );
  console.log(
    `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.kind)}  ${'-'.repeat(widths.selectWith)}  ${'-'.repeat(widths.defaultModel)}  ${'-'.repeat(widths.available)}  ${'-'.repeat(widths.authenticated)}  -----`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.kind, widths.kind)}  ${pad(r.selectWith, widths.selectWith)}  ${pad(r.defaultModel, widths.defaultModel)}  ${pad(r.available, widths.available)}  ${pad(r.authenticated, widths.authenticated)}  ${r.note}`
    );
  }
}

function backendStatusNote(backend) {
  if (!backend.available) return backend.installHint || backend.authHint;
  if (backend.name === 'openai-http') return backend.authHint;
  if (backend.authenticated && backend.name === 'gemini-cli' && backend.authHint.startsWith('Authenticated via ')) {
    return backend.authHint;
  }
  if (backend.authenticated) return 'ready';
  if (backend.loginCommand) return `${backend.authHint} Use \`patina auth login ${backend.name}\` for the guided flow.`;
  return backend.authHint;
}

function backendSafetyNote(backend) {
  return `cap=${formatLimit(backend.maxConcurrency)}, retries=${backend.maxRetries}, prompt=${backend.promptMode};`;
}

export async function handleAuth(subArgs) {
  const sub = subArgs[0] || 'status';
  if (sub === 'status') {
    printBackendStatus();
    return;
  }
  if (sub === 'login') {
    const parsed = parseAuthLoginArgs(subArgs.slice(1));
    if (parsed.backendName) {
      await runAuthLogin(parsed);
      return;
    }

    console.log('To authenticate a backend, follow the per-backend instructions:\n');
    for (const b of listBackends()) {
      const status = b.authenticated ? '✓ already authenticated' : '✗ not authenticated';
      console.log(`  ${b.name}: ${status}`);
      if (!b.authenticated) console.log(`    → ${b.authHint}`);
    }
    return;
  }
  throw inputError(
    `unknown auth subcommand ${sub}`,
    'Supported auth subcommands are status and login.',
    'Try `patina auth status`, `patina auth login`, or `patina auth login codex-cli`.'
  );
}

function parseAuthLoginArgs(args) {
  let assumeYes = false;
  let backendName = null;

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      assumeYes = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw inputError(
        `unknown auth login option ${arg}`,
        'Only --yes/-y is supported for non-interactive confirmation.',
        'Run `patina auth login <backend> --yes` or omit --yes to confirm interactively.'
      );
    }
    if (backendName) {
      throw inputError(
        'auth login expects at most one backend',
        `Received both ${backendName} and ${arg}.`,
        `Available backends are: ${listBackendNames().join(', ')}.`
      );
    }
    backendName = arg;
  }

  return { backendName, assumeYes };
}

async function runAuthLogin({ backendName, assumeYes }) {
  const backend = resolveBackend(backendName);
  if (typeof backend.login !== 'function') {
    throw inputError(
      `${backend.name} does not support interactive login`,
      backend.authHint ? backend.authHint() : 'This backend authenticates outside local CLI OAuth.',
      'Set PATINA_API_KEY, PATINA_API_KEY_FILE, or the provider-specific API key env var for HTTP backends.'
    );
  }

  if (!backend.isAvailable()) {
    throw runtimeError(
      `${backend.name} CLI is not installed or not on PATH`,
      backend.installHint || backend.authHint(),
      'Install the CLI named above, then rerun this command.'
    );
  }

  const commandLabel = backend.loginCommand || backend.name;
  const confirmed = await confirmAuthLogin(commandLabel, { assumeYes });
  if (!confirmed) {
    console.log('Cancelled.');
    return;
  }

  const wasAuthenticated = backend.isAuthenticated();
  await backend.login();
  const authenticated = backend.isAuthenticated();

  if (authenticated) {
    console.log(`${backend.name}: authenticated.`);
  } else if (wasAuthenticated) {
    console.log(`${backend.name}: login command completed; previous authentication is still present.`);
  } else {
    console.log(`${backend.name}: login command completed, but patina could not confirm authentication yet.`);
    console.log(`→ ${backend.authHint()}`);
  }
}

async function confirmAuthLogin(commandLabel, { assumeYes = false } = {}) {
  if (assumeYes) {
    console.log(`Run ${commandLabel}? yes (--yes)`);
    return true;
  }

  if (!process.stdin.isTTY) {
    throw inputError(
      `cannot confirm ${commandLabel} in a non-interactive session`,
      'patina will not launch an interactive OAuth flow without explicit confirmation.',
      `Rerun with \`patina auth login <backend> --yes\` if you intentionally want to start ${commandLabel}.`
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Run ${commandLabel}? [Y/n] `);
    return answer.trim() === '' || /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
