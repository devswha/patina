const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Infinity,
};

/**
 * Create a small stderr logger with text and progress modes.
 *
 * @param {object} [options] Logger options.
 * @param {string} [options.level=info] Minimum log level.
 * @param {boolean} [options.quiet=false] Suppress all log output.
 * @param {NodeJS.WritableStream} [options.stream=process.stderr] Progress stream.
 * @returns {{debug: Function, info: Function, warn: Function, error: Function, progress: Function, closeProgress: Function, child: Function}} Logger facade.
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
  let progressOpen = false;

  const emit = (levelName, event, fields = {}) => {
    if (LEVELS[levelName] < threshold) return;
    closeProgress();
    if (!fields.message) return;
    // Honor an injected custom stream (tests, child loggers) like progress/
    // closeProgress already do, instead of always hardcoding stderr (#449). The
    // default process.stderr stays on console.error so the common path keeps a
    // single write API on that fd.
    if (stream && stream !== process.stderr) stream.write(`${fields.message}\n`);
    else console.error(fields.message);
  };

  const progress = (_event, fields = {}) => {
    if (LEVELS.info < threshold) return;
    if (!fields.message || !stream?.write) return;
    stream.write(`\r${fields.message}`);
    progressOpen = true;
  };

  function closeProgress() {
    if (progressOpen && stream?.write) stream.write('\n');
    progressOpen = false;
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    progress,
    closeProgress,
    child(extra = {}) {
      return createLogger({ level, quiet, stream, ...extra });
    },
  };
}


/**
 * Default stderr logger used by simple callers.
 *
 * @type {Object}
 * @example
 * defaultLogger.info('patina.ready', { message: 'ready' });
 */
export const defaultLogger = createLogger();
