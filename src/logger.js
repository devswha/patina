const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Infinity,
};

/**
 * Create a small stderr logger with text, JSON, and progress modes.
 *
 * @param {object} [options] Logger options.
 * @param {string} [options.level=info] Minimum log level.
 * @param {boolean} [options.quiet=false] Suppress all log output.
 * @param {boolean} [options.json=false] Emit structured JSON records.
 * @param {NodeJS.WritableStream} [options.stream=process.stderr] Progress stream.
 * @returns {{debug: Function, info: Function, warn: Function, error: Function, progress: Function, closeProgress: Function, child: Function}} Logger facade.
 * @throws {Error} Propagates stream write errors from the configured output stream.
 * @example
 * const logger = createLogger({ json: true });
 * logger.info('event', { message: 'ready' });
 */
export function createLogger({
  level = process.env.PATINA_LOG_LEVEL || 'info',
  quiet = false,
  json = false,
  stream = process.stderr,
} = {}) {
  const threshold = quiet ? LEVELS.silent : (LEVELS[String(level).toLowerCase()] ?? LEVELS.info);
  let progressOpen = false;

  const emit = (levelName, event, fields = {}) => {
    if (LEVELS[levelName] < threshold) return;
    closeProgress();
    if (json) {
      console.error(JSON.stringify(record(levelName, event, fields)));
      return;
    }
    if (fields.message) console.error(fields.message);
  };

  const progress = (event, fields = {}) => {
    if (LEVELS.info < threshold) return;
    if (json) {
      console.error(JSON.stringify(record('info', event, fields)));
      return;
    }
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
      return createLogger({ level, quiet, json, stream, ...extra });
    },
  };
}

function record(level, event, fields = {}) {
  const { message, model = null, latency_ms = null, ...rest } = fields;
  return {
    ts: new Date().toISOString(),
    level,
    event,
    model,
    latency_ms,
    ...(message ? { message } : {}),
    ...rest,
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
