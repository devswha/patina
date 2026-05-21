import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export const FIRST_RUN_STAR_NUDGE =
  '[patina] First run — thanks for trying it. ⭐ https://github.com/devswha/patina  (silence: PATINA_NO_NUDGE=1)';

export function maybeShowFirstRunNudge({
  parsed = {},
  inputTexts = [],
  env = process.env,
  stderr = process.stderr,
  stdout = process.stdout,
  stdinIsTTY = process.stdin.isTTY,
  processObj = process,
  statePath,
} = {}) {
  if (!shouldShowFirstRunNudge({ parsed, inputTexts, env, stderr, stdout, stdinIsTTY, processObj })) {
    return false;
  }

  const markerPath = statePath || resolveNudgeStatePath(env);
  if (!markerPath || hasFirstRunNudgeMarker(markerPath)) return false;
  if (!writeFirstRunNudgeMarker(markerPath)) return false;

  try {
    stderr.write(`${FIRST_RUN_STAR_NUDGE}\n`);
    return true;
  } catch {
    return false;
  }
}

export function shouldShowFirstRunNudge({
  parsed = {},
  inputTexts = [],
  env = process.env,
  stderr = process.stderr,
  stdout = process.stdout,
  stdinIsTTY = process.stdin.isTTY,
  processObj = process,
} = {}) {
  if (env.PATINA_NO_NUDGE === '1') return false;
  if (env.CI) return false;
  if (!stderr?.isTTY) return false;
  if (!stdout?.isTTY) return false;
  if (Number(processObj.exitCode || 0) !== 0) return false;
  if (parsed.quiet || parsed.jsonLogs || parsed.format === 'json') return false;
  if (parsed.batch) return false;
  if (parsed.files?.length === 0 && stdinIsTTY === false) return false;
  if (inputTexts.some((input) => input.path === '-') && stdinIsTTY === false) return false;
  return true;
}

export function resolveNudgeStatePath(env = process.env) {
  const stateRoot = env.XDG_STATE_HOME || (env.HOME ? resolve(env.HOME, '.local', 'state') : resolve(homedir(), '.local', 'state'));
  return resolve(stateRoot, 'patina', 'state.json');
}

export function hasFirstRunNudgeMarker(path) {
  try {
    if (!existsSync(path)) return false;
    const state = JSON.parse(readFileSync(path, 'utf8'));
    return Boolean(state?.firstRunStarNudgeShown);
  } catch {
    return false;
  }
}

export function writeFirstRunNudgeMarker(path) {
  try {
    let state = {};
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
    }
    state.firstRunStarNudgeShown = true;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}
