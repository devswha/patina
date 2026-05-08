import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'gemini-cli';

export function isAvailable() {
  try {
    const result = spawnSync('gemini', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isAuthenticated() {
  // Two valid auth paths: OAuth (Code Assist) or API key. Either is enough
  // for `gemini -p` to run; checking both avoids false negatives.
  return (
    existsSync(join(homedir(), '.gemini', 'gemini-credentials.json')) ||
    !!process.env.GEMINI_API_KEY
  );
}

export function authHint() {
  if (process.env.GEMINI_API_KEY) {
    return 'Authenticated via GEMINI_API_KEY env var.';
  }
  return 'Run `gemini` once interactively to log in via Google OAuth, or set GEMINI_API_KEY.';
}

export async function invoke({ prompt, model, timeout = 240000 } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('gemini-cli backend: prompt must be a non-empty string');
  }

  // gemini -p '' reads the prompt from stdin (when -p arg is empty, stdin is
  // appended). --output-format text avoids JSON wrapping. Spawn from a temp
  // directory for the same prompt-injection containment reason as codex-cli;
  // --skip-trust is required because the temp dir isn't in gemini's trusted
  // workspace list (otherwise gemini exits 55).
  // Default timeout is higher than other CLIs because gemini's startup latency
  // is longer (model warmup + auth check on each invocation).
  const dir = mkdtempSync(join(tmpdir(), 'patina-gemini-'));
  const args = ['-p', '', '--output-format', 'text', '--skip-trust'];
  if (model) args.push('-m', model);

  return new Promise((resolve, reject) => {
    const proc = spawn('gemini', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      cleanup();
      reject(new Error(`gemini-cli backend: timed out after ${timeout}ms`));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      if (err.code === 'ENOENT') {
        reject(new Error('gemini-cli backend: `gemini` CLI not found. Install Gemini CLI first.'));
      } else {
        reject(new Error(`gemini-cli backend: failed to spawn gemini (${err.message})`));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        reject(new Error(`gemini-cli backend: gemini exited with code ${code}\n${stderr}`));
        return;
      }
      resolve(stripGeminiNoise(stdout));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    function cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
}

// Gemini CLI prepends benign warnings to stdout (e.g. "Ripgrep is not
// available. Falling back to GrepTool.", "MCP issues detected..."). They
// aren't part of the model's response, so strip leading lines that match
// known noise patterns before returning.
function stripGeminiNoise(text) {
  const lines = text.split(/\r?\n/);
  const noiseRe = /^(Warning:|Ripgrep is not available|MCP issues detected|Loaded cached credentials)/i;
  let i = 0;
  while (i < lines.length && (noiseRe.test(lines[i]) || lines[i].trim() === '')) {
    i++;
  }
  return lines.slice(i).join('\n');
}
