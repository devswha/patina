import { loadInputText, MAX_INPUT_BYTES } from '../loader.js';
import { inputError } from '../errors.js';

// The second parameter used to be a logger for the stdin prompt; the prompt
// now writes straight to stderr (#440). Kept as `_logger` so existing callers
// passing a logger stay source-compatible.
export async function loadInputs(parsed, _logger) {
  if (parsed.files.length === 0) {
    if (process.stdin.isTTY) {
      if (parsed.noInteractive) {
        throw inputError(
          'no input provided',
          'No file path or piped stdin was available.',
          'Pass a file path, pipe text via stdin, or omit --no-interactive to paste text and press Ctrl-D.'
        );
      }
      // Interaction-critical UI, not a status log: --quiet silences the
      // logger, which would leave a TTY user blocked on Ctrl-D with zero
      // indication (#440). Write straight to stderr.
      process.stderr.write('[patina] Paste text, then press Ctrl-D to run (Ctrl-C to cancel).\n');
    }
    const stdin = await readStdin({ interactive: Boolean(process.stdin.isTTY) });
    if (!stdin.trim()) {
      throw inputError(
        'empty input on stdin',
        'patina received stdin, but it contained no non-whitespace text.',
        'Try `echo "This is a draft." | patina --lang en` or pass a file path.'
      );
    }
    return [{ path: '-', text: stdin }];
  }

  const inputs = [];
  for (const file of parsed.files) {
    if (parsed.batch) {
      // Batch mode (#503): one unreadable file must not abort the whole run
      // before the circuit breaker exists. Collect the typed read error and let
      // run.js's per-file loop route it through recordFailure/shouldStop so
      // --max-failures/--max-failure-rate stay in control (exit 2 still applies
      // if the breaker trips or this is effectively a single-file batch).
      try {
        const text = loadInputText(file);
        inputs.push({ path: file, text });
      } catch (readError) {
        inputs.push({ path: file, text: null, readError });
      }
    } else {
      // Single-file mode stays fail-fast: surface the typed inputError (exit 2)
      // immediately.
      const text = loadInputText(file);
      inputs.push({ path: file, text });
    }
  }
  return inputs;
}

function readStdin({ interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let cleanupSigint = () => {};

    const onData = (chunk) => {
      // Track bytes (not chars) so the cap matches the on-disk file cap and
      // multi-byte input cannot silently slip past it (#508 G1).
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MAX_INPUT_BYTES) {
        cleanup();
        const mb = (MAX_INPUT_BYTES / (1024 * 1024)).toFixed(0);
        reject(inputError(
          'stdin input too large',
          `Piped stdin exceeded the ${MAX_INPUT_BYTES}-byte (~${mb} MB) limit.`,
          'Pass a file path instead of piping, or split the input into smaller chunks.'
        ));
        return;
      }
      data += chunk;
    };
    const onEnd = () => {
      cleanup();
      resolve(data);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      cleanupSigint();
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    }

    if (interactive) {
      const onSigint = () => {
        cleanup();
        const err = inputError(
          'interrupted',
          'Ctrl-C canceled interactive stdin before patina could process text.',
          'Run the command again, or pass --no-interactive in scripts.'
        );
        err.exitCode = 130;
        reject(err);
        process.exitCode = 130;
      };
      process.once('SIGINT', onSigint);
      cleanupSigint = () => process.removeListener('SIGINT', onSigint);
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    if (interactive) process.stdin.resume();
  });
}
