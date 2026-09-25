import { existsSync, readFileSync } from 'node:fs';
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

export const name = 'codex-cli';
export const supportsImages = true;
export const loginCommand = 'codex login';

// Codex feature flags that expose agent tools. A rewrite or score is a pure
// text transform, yet with these enabled `codex exec` behaves as an agent,
// issuing shell tool calls and re-sending the prompt on every turn. Disabling
// them removes the tool definitions from the request and leaves a single
// turn. Images still arrive through `-i`, which is model input, not a tool.
export const CODEX_DISABLED_FEATURES = Object.freeze(['shell_tool', 'unified_exec', 'multi_agent']);
export const installHint = 'Install it from https://github.com/openai/codex, then run `patina auth login codex-cli` again.';

export function isAvailable() {
  return probeCliAvailability('codex');
}

export function isAuthenticated() {
  return existsSync(join(homedir(), '.codex', 'auth.json'));
}

export function authHint() {
  return `Run \`${loginCommand}\` to authenticate (uses your ChatGPT Plus account, no API key needed).`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'codex',
    args: ['login'],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, images } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('codex-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal, 'codex-cli backend: aborted');

  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });

  // codex also runs with the read-only sandbox so a prompt injection cannot
  // write arbitrary files. The output file lives inside the temp dir so codex
  // can still drop the last message there.
  return withCliTempDir('patina-codex-', async (dir) => {
    const outFile = join(dir, 'last-message.txt');

    // Vision input: codex exec attaches images natively via -i; staging them
    // into the temp cwd keeps the read-only sandbox + empty-cwd containment.
    const imageArgs = [];
    if (Array.isArray(images) && images.length > 0) {
      for (const staged of stageCliImages(dir, images, name)) {
        imageArgs.push('-i', join(dir, staged));
      }
    }

    await runOwnedCliCapture({
      backendName: name,
      command: 'codex',
      args: [
        'exec',
        '--skip-git-repo-check',
        '--sandbox', 'read-only',
        '-C', dir,
        '--model', cliModel,
        ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
        '--output-last-message', outFile,
        ...imageArgs,
      ],
      cwd: dir,
      stdinText: prompt,
      // stdout is discarded, not piped: `codex exec` streams session/progress
      // output there, and a piped-but-undrained stdout deadlocks the child
      // once the ~64KB OS pipe buffer fills (#438). The final answer comes
      // from --output-last-message, so nothing on stdout is needed.
      captureStdout: false,
      timeout,
      signal,
      notFoundHint: 'Install it from https://github.com/openai/codex',
    });

    try {
      return readFileSync(outFile, 'utf8');
    } catch (err) {
      throw new Error(`codex-cli backend: failed to read output file (${err.message})`, { cause: err });
    }
  });
}
