import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  runInteractiveCommand,
  probeCliAvailability,
  runOwnedCliCapture,
  stageCliImages,
  throwIfAborted,
  withCliTempDir,
} from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'gemini-cli';
export const supportsImages = true;
export const loginCommand = 'gemini';
export const installHint = 'Install Gemini CLI first, then run `patina auth login gemini-cli` again.';

// `--allowed-mcp-server-names` is an allowlist; naming one server that cannot
// exist is how the CLI expresses "no MCP servers".
const NO_MCP_SERVERS = '__patina_no_mcp__';

// Policy-engine rule passed per invocation via --policy. `*` matches every
// built-in and MCP tool; a global deny excludes them from the model's tool
// list entirely. 999 is the highest TOML priority within the User tier.
export const GEMINI_NO_TOOLS_POLICY = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';

export function isAvailable() {
  return probeCliAvailability('gemini');
}

export function isAuthenticated({ credentialsFile = join(homedir(), '.gemini', 'gemini-credentials.json') } = {}) {
  // Two valid auth paths: OAuth (Code Assist) or API key. Either is enough
  // for `gemini -p` to run; checking both avoids false negatives. The
  // credentials-file path is injectable so tests can classify owned fixtures;
  // the default is the real runtime path, so a no-argument call behaves
  // exactly as before.
  return (
    existsSync(credentialsFile) ||
    !!process.env.GEMINI_API_KEY?.trim()
  );
}

export function authHint() {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return 'Authenticated via GEMINI_API_KEY env var.';
  }
  return `Run \`${loginCommand}\` once interactively to log in via Google OAuth, or set GEMINI_API_KEY.`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'gemini',
    args: [],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, images } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('gemini-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal, 'gemini-cli backend: aborted');

  // gemini -p '' reads the prompt from stdin (when -p arg is empty, stdin is
  // appended). --output-format text avoids JSON wrapping. Spawn from a temp
  // directory for the same prompt-injection containment reason as codex-cli;
  // --skip-trust is required because the temp dir isn't in gemini's trusted
  // workspace list (otherwise gemini exits 55).
  //
  // MCP servers are disabled by allowing only a name that cannot exist. A
  // rewrite or score is a pure text transform with no tool need, while the
  // user's configured MCP servers are arbitrary third-party processes the CLI
  // starts on every invocation: they add startup cost, log "MCP issues
  // detected" noise into stdout, and a wedged server can hang the call until
  // the backend timeout (observed 2026-07-27: one scoring call sat for the
  // full 600s budget while sibling calls finished in ~30s). Same containment
  // rationale as the temp cwd — the agent gets nothing it does not need.
  //
  // Built-in tools are removed the same way through the policy engine: a
  // global `deny` for `*` drops every tool definition from the request (the
  // documented behaviour for rules without argsPattern), so the model cannot
  // spend turns on run_shell_command/write_file and source text that contains
  // instructions has nothing to act on. Earlier sessions (2026-08-18/19) show
  // the model doing exactly that on rewrite prompts. Image input uses
  // @-includes, which the CLI resolves before the model runs, not a tool.
  return withCliTempDir('patina-gemini-', async (dir) => {
    const policyFile = join(dir, 'patina-no-tools.toml');
    try {
      writeFileSync(policyFile, GEMINI_NO_TOOLS_POLICY, { mode: 0o600 });
    } catch (err) {
      throw new Error(`gemini-cli backend: failed to write tool policy (${err.message})`, { cause: err });
    }
    const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });
    const args = ['-p', '', '--output-format', 'text', '--skip-trust', '--allowed-mcp-server-names', NO_MCP_SERVERS, '--policy', policyFile, '-m', cliModel];

    // Vision input: gemini's @-includes are confined to the workspace root, so
    // images are staged into the temp cwd and referenced as @<filename>.
    let effectivePrompt = prompt;
    if (Array.isArray(images) && images.length > 0) {
      const staged = stageCliImages(dir, images, name);
      effectivePrompt = `${staged.map((f) => `@${f}`).join(' ')}\n${prompt}`;
    }

    const { stdout } = await runOwnedCliCapture({
      backendName: name,
      command: 'gemini',
      args,
      cwd: dir,
      stdinText: effectivePrompt,
      timeout,
      signal,
      notFoundHint: 'Install Gemini CLI first.',
    });
    return stripGeminiNoise(stdout);
  });
}

// Gemini CLI prepends benign warnings to stdout (e.g. "Ripgrep is not
// available. Falling back to GrepTool.", "MCP issues detected..."). They
// aren't part of the model's response, so strip leading lines that match
// known noise patterns before returning.
export function stripGeminiNoise(text) {
  const lines = text.split(/\r?\n/);
  // Anchor to the exact known gemini stdout banners, not a broad `Warning:`
  // prefix — a model response that legitimately begins with "Warning: ..."
  // must not be truncated (#446).
  const noiseRe = /^(?:Ripgrep is not available\b|MCP issues detected\b|Loaded cached credentials\b)/i;
  let i = 0;
  while (i < lines.length && (noiseRe.test(lines[i]) || lines[i].trim() === '')) {
    i++;
  }
  return lines.slice(i).join('\n');
}
