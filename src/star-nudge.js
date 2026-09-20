/**
 * One-line GitHub star reminder, shared by the CLI and the skill helper.
 *
 * Shown after the 3rd and the 20th successful run, then never again. There is
 * no network call: patina does not check whether the user already starred, it
 * only counts successful runs in `<stateDir>/star-nudge.json`.
 *
 * Rules every caller relies on:
 * - Nothing here may fail a run. Every public function swallows its own errors
 *   and answers "do not show".
 * - A reminder is due only when the counter was persisted. A read-only home
 *   would otherwise re-show the line on every run.
 * - Opt out with `star-nudge: false` in config or `PATINA_NO_STAR_NUDGE=1`.
 *   CI is always silent.
 * - The CLI prints to stderr and only when stderr is a terminal, so piped
 *   output, hooks, and the skill helper's child CLI never see it. The skill
 *   helper reports the reminder as a `notice` field in its summary instead.
 */

import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const STAR_URL = 'https://github.com/devswha/patina';
/** `gh` has no `repo star` subcommand; the REST call is the terminal one-liner. */
export const STAR_COMMAND = 'gh api -X PUT user/starred/devswha/patina';
/** Successful-run counts at which the reminder is shown; one showing per entry. */
export const STAR_NUDGE_AT = Object.freeze([3, 20]);
export const STAR_NOTICE = 'star';

const STATE_FILE = 'star-nudge.json';

/**
 * Whether the reminder is allowed at all for this config and environment.
 *
 * @param {{ config?: object, env?: Record<string, string|undefined> }} [opts]
 * @returns {boolean}
 */
export function starNudgeEnabled({ config = {}, env = process.env } = {}) {
  if (config?.['star-nudge'] === false) return false;
  if (isSet(env?.PATINA_NO_STAR_NUDGE)) return false;
  if (isSet(env?.CI)) return false;
  return true;
}

/**
 * Directory that holds the counter: `PATINA_STATE_DIR`, else `~/.patina` (the
 * directory the skill helper already manages).
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function defaultStateDir(env = process.env) {
  return env?.PATINA_STATE_DIR || join(homedir(), '.patina');
}

/**
 * Count one successful run and say whether a reminder is due now.
 *
 * @param {{ stateDir: string, now?: () => Date }} opts
 * @returns {{ due: boolean, successes: number, shown: number }}
 */
export function recordSuccessfulRun({ stateDir, now = () => new Date() }) {
  try {
    const path = join(stateDir, STATE_FILE);
    const state = readState(path);
    // Both showings spent: stop counting, so later runs never touch the disk.
    if (state.shown >= STAR_NUDGE_AT.length) return { due: false, successes: state.successes, shown: state.shown };
    ensurePrivateDirectory(stateDir);
    state.successes += 1;
    const due = state.shown < STAR_NUDGE_AT.length && state.successes >= STAR_NUDGE_AT[state.shown];
    if (due) {
      state.shown += 1;
      state.lastShownAt = now().toISOString();
    }
    writeState(stateDir, path, state);
    return { due, successes: state.successes, shown: state.shown };
  } catch {
    return { due: false, successes: 0, shown: 0 };
  }
}

/** The CLI reminder line. */
export function formatStarNudge() {
  return `[patina] If patina is earning its keep, a GitHub star helps other people find it: ${STAR_URL} `
    + `(from a terminal: \`${STAR_COMMAND}\`). Shown twice at most; silence it with \`star-nudge: false\`.`;
}

/**
 * CLI hook: call once after a run finished without error.
 *
 * @param {{ config?: object, logger?: { info?: Function }, quiet?: boolean, exitCode?: number|string|null,
 *   stream?: { isTTY?: boolean }, env?: Record<string, string|undefined>, stateDir?: string, now?: () => Date }} [opts]
 * @returns {boolean} True when the reminder was printed.
 */
export function maybeStarNudge({
  config = {},
  logger,
  quiet = false,
  exitCode = process.exitCode,
  stream = process.stderr,
  env = process.env,
  stateDir,
  now,
} = {}) {
  try {
    if (quiet || Number(exitCode) > 0) return false;
    if (!stream?.isTTY) return false;
    if (!starNudgeEnabled({ config, env })) return false;
    const { due } = recordSuccessfulRun({ stateDir: stateDir || defaultStateDir(env), now });
    if (!due) return false;
    logger?.info?.('cli.star_nudge', { message: formatStarNudge() });
    return true;
  } catch {
    return false; // a reminder must never break a run
  }
}

/**
 * Skill-helper hook: call once after a verified rewrite was accepted.
 *
 * @param {{ config?: object, env?: Record<string, string|undefined>, stateDir: string, now?: () => Date }} opts
 * @returns {'star'|null} Value for the summary's `notice` field.
 */
export function skillStarNotice({ config = {}, env = process.env, stateDir, now } = {}) {
  try {
    if (!stateDir || !starNudgeEnabled({ config, env })) return null;
    return recordSuccessfulRun({ stateDir, now }).due ? STAR_NOTICE : null;
  } catch {
    return null;
  }
}

function isSet(value) {
  return typeof value === 'string' && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

function ensurePrivateDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A symlinked state directory could redirect the write somewhere unexpected.
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe state directory');
}

function readState(path) {
  const empty = { version: 1, successes: 0, shown: 0 };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return empty; // missing or corrupt counter starts over
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  return {
    version: 1,
    successes: countOrZero(parsed.successes),
    shown: countOrZero(parsed.shown),
    ...(typeof parsed.lastShownAt === 'string' ? { lastShownAt: parsed.lastShownAt } : {}),
  };
}

function countOrZero(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function writeState(dir, path, state) {
  const tmp = join(dir, `.star-nudge-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  // Exclusive create: never follow or clobber a preexisting temp path.
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
