import { loadInputText } from '../loader.js';
import { inputError } from '../errors.js';
import { createLogger } from '../logger.js';

export async function loadInputs(parsed, logger = createLogger()) {
  if (parsed.files.length === 0) {
    if (process.stdin.isTTY) {
      if (parsed.noInteractive) {
        throw inputError(
          'no input provided',
          'No file path or piped stdin was available.',
          'Pass a file path, pipe text via stdin, or omit --no-interactive to paste text and press Ctrl-D.'
        );
      }
      logger.info('stdin.prompt', { message: '[patina] Paste text, then press Ctrl-D to run (Ctrl-C to cancel).' });
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
    const text = loadInputText(file);
    inputs.push({ path: file, text });
  }
  return inputs;
}

function readStdin({ interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    let data = '';
    let cleanupSigint = () => {};
    if (interactive) {
      const onSigint = () => {
        cleanupSigint();
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
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      cleanupSigint();
      resolve(data);
    });
    process.stdin.on('error', (err) => {
      cleanupSigint();
      reject(err);
    });
    if (interactive) process.stdin.resume();
  });
}
