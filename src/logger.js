const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Infinity,
};

/**
 * The logger facade every patina module accepts as an injected `logger`.
 *
 * @typedef {{debug: Function, info: Function, warn: Function, error: Function}} Logger
 */

/**
 * Create a small stderr logger.
 *
 * @param {object} [options] Logger options.
 * @param {string} [options.level=info] Minimum log level.
 * @param {boolean} [options.quiet=false] Suppress all log output.
 * @param {NodeJS.WritableStream} [options.stream=process.stderr] Output stream.
 * @returns {Logger} Logger facade.
 * @example
 * const logger = createLogger();
 * logger.info('event', { message: 'ready' });
 */
export function createLogger({
  level = process.env.PATINA_LOG_LEVEL || 'info',
  quiet = false,
  stream = process.stderr,
} = {}) {
  const threshold = quiet ? LEVELS.silent : (LEVELS[String(level).toLowerCase()] ?? LEVELS.info);

  const emit = (levelName, event, fields = {}) => {
    if (LEVELS[levelName] < threshold) return;
    const text = fields.message || event;
    if (!text) return;
    // Honor an injected custom stream (tests) instead of always hardcoding
    // stderr. The default process.stderr stays on console.error so the
    // common path keeps a single write API on that fd.
    if (stream && stream !== process.stderr) stream.write(`${text}\n`);
    else console.error(text);
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
