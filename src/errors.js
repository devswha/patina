/**
 * Structured CLI error with separate what/why/action fields and exit code.
 *
 * @param {object} options Error fields.
 * @param {string} options.what Short failure headline.
 * @param {string} options.why Explanation of the failure.
 * @param {string} options.action Suggested user action.
 * @param {number} [options.exitCode=1] Process exit code.
 * @example
 * throw new PatinaCliError({ what: 'missing input', why: 'No file was provided', action: 'Pass a file path.' });
 */
export class PatinaCliError extends Error {
  constructor({ what, why, action, exitCode = 1 }) {
    super([what, why, action].filter(Boolean).join('\n'));
    this.name = 'PatinaCliError';
    this.what = what;
    this.why = why;
    this.action = action;
    this.exitCode = exitCode;
  }
}

/**
 * Create a user-input error that should exit with code 2.
 *
 * @param {string} what Short failure headline.
 * @param {string} why Explanation of the invalid input.
 * @param {string} action Suggested user action.
 * @returns {PatinaCliError} Structured input error.
 * @example
 * throw inputError('missing input', 'No file was provided.', 'Pass a file path.');
 */
export function inputError(what, why, action) {
  return new PatinaCliError({ what, why, action, exitCode: 2 });
}

/**
 * Create a runtime error that should exit with code 1.
 *
 * @param {string} what Short failure headline.
 * @param {string} why Explanation of the runtime failure.
 * @param {string} action Suggested user action.
 * @returns {PatinaCliError} Structured runtime error.
 * @example
 * throw runtimeError('provider failed', 'The API timed out.', 'Retry later.');
 */
export function runtimeError(what, why, action) {
  return new PatinaCliError({ what, why, action, exitCode: 1 });
}

/**
 * Render any thrown value into the patina CLI error format.
 *
 * @param {unknown} err Error-like value to render.
 * @returns {string} Multi-line user-facing error text.
 * @example
 * const message = renderCliError(inputError('bad flag', 'Unknown flag.', 'Run --help.'));
 */
export function renderCliError(err) {
  const normalized = normalizeError(err);
  return [
    `[patina] Error: ${normalized.what}`,
    `         ${normalized.why}`,
    `         → ${normalized.action}`,
  ].join('\n');
}

/**
 * Extract a safe process exit code from an error-like value.
 *
 * @param {unknown} err Error-like value.
 * @param {number} [fallback=1] Exit code used when err.exitCode is absent or invalid.
 * @returns {number} Non-negative integer exit code.
 * @example
 * const code = getExitCode(inputError('bad', 'why', 'fix')); // 2
 */
export function getExitCode(err, fallback = 1) {
  const n = Number(err ? /** @type {any} */ (err).exitCode : undefined);
  // Reject exitCode 0 on a thrown error: a fatal catch must never exit 0 after
  // printing an error. Only a positive integer overrides the fallback (#449).
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/**
 * Merge a thrown error's exit code with an already-recorded process exit code.
 *
 * Score gates set `process.exitCode = 3` without throwing so batch mode can keep
 * processing files. If a later non-fatal batch summary error is thrown, the bin
 * catch must preserve the stricter existing gate code instead of masking it with
 * the runtime error's `1` (#526).
 *
 * @param {unknown} err Error-like value.
 * @param {number|string|undefined} currentExitCode Current process exit code.
 * @param {number} [fallback=1] Fallback for the thrown error.
 * @returns {number} Positive integer process exit code.
 */
export function getProcessExitCode(err, currentExitCode = process.exitCode, fallback = 1) {
  const errCode = getExitCode(err, fallback);
  const current = Number(currentExitCode);
  return Number.isInteger(current) && current >= 1 ? Math.max(current, errCode) : errCode;
}

function normalizeError(err) {
  if (err instanceof PatinaCliError) {
    return {
      what: err.what || 'command failed',
      why: err.why || 'patina could not complete the request.',
      action: err.action || 'Run `patina --help` or `patina doctor` for next steps.',
    };
  }

  const lines = String(err?.message || err || 'unknown error')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    what: lines[0] || 'command failed',
    why: lines.slice(1).join(' ') || 'The command hit a runtime failure before it could finish.',
    action: 'Run `patina doctor` to inspect your environment, or rerun with `--help` for usage.',
  };
}
