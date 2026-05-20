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

export function inputError(what, why, action) {
  return new PatinaCliError({ what, why, action, exitCode: 2 });
}

export function runtimeError(what, why, action) {
  return new PatinaCliError({ what, why, action, exitCode: 1 });
}

export function renderCliError(err) {
  const normalized = normalizeError(err);
  return [
    `[patina] Error: ${normalized.what}`,
    `         ${normalized.why}`,
    `         → ${normalized.action}`,
  ].join('\n');
}

export function getExitCode(err, fallback = 1) {
  const n = Number(err?.exitCode);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
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
