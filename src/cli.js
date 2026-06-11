import { getRepoRoot } from './config.js';
import { runDoctor } from './commands/doctor.js';
import { handleAuth, printBackendStatus } from './commands/auth.js';
import { parseArgs, validateModeExclusivity, validateBrowserRequest, validatePreviewRequest, printHelp } from './cli/args.js';
import { runDefault } from './cli/run.js';
import { inputError, renderCliError, getExitCode } from './errors.js';
import { createLogger } from './logger.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The default-run pipeline and its helpers moved to src/cli/run.js (#411).
// Re-exported so existing imports from src/cli.js keep working unchanged.
export { createCancellationController, resolvePromptMode, resolveProfileForLanguage } from './cli/run.js';

const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(getRepoRoot(), 'package.json'), 'utf8')
).version;

/**
 * Run the patina CLI command dispatcher.
 *
 * @param {string[]} args Command-line arguments excluding node and script path.
 * @returns {Promise<void>} Resolves after command output is written.
 * @throws {Error} For validation, provider, file, or runtime failures.
 * @example
 * await main(['--help']);
 */
export async function main(args) {
  if (args[0] === 'auth') {
    return handleAuth(args.slice(1));
  }
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1), { version: PACKAGE_VERSION });
  }
  if (args[0] === 'init') {
    throw inputError(
      'patina init was removed',
      'patina is zero-config; use CLI flags for one-off runs or add .patina.yaml only when project defaults are needed.',
      'Copy .patina.default.yaml to .patina.yaml and edit it manually, or pass --config <path>.'
    );
  }
  if (args[0] === 'help') {
    printHelp();
    return;
  }

  const parsed = parseArgs(args);
  const logger = createLogger({ quiet: parsed.quiet });

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.version) {
    console.log(`patina ${PACKAGE_VERSION}`);
    return;
  }


  if (parsed.gate !== undefined && !parsed.score) {
    throw inputError(
      '--exit-on can only be used with --score',
      'Score gates need a parsed overall score.',
      'Run `patina --score --exit-on 30 <file>`.'
    );
  }

  if (parsed.listBackends) {
    printBackendStatus();
    return;
  }

  validateModeExclusivity(parsed);
  validatePreviewRequest(parsed);
  validateBrowserRequest(parsed);

  return runDefault(parsed, logger);
}

// Self-invocation guard (#113): when run directly via `node src/cli.js ...`,
// run main(). When imported (e.g. by bin/patina.js or tests), just expose
// the exports.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    createLogger().error('cli.error', { message: renderCliError(err) });
    process.exit(getExitCode(err));
  });
}
