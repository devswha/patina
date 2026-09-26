import { getRepoRoot } from './config.js';
import { runDoctor } from './commands/doctor.js';
import { runPersona } from './commands/persona.js';
import { runPack } from './commands/pack.js';
import { runInspect } from './commands/inspect.js';
import { handleAuth, printBackendStatus } from './commands/auth.js';
import { parseArgs, validateModeExclusivity, validateOfflineScoreRequest, validateOutputRouting, validateRegisterRequest, validatePersonaRequest, validateVerifyRequest, printHelp } from './cli/args.js';
import { runDefault } from './cli/run.js';
import { inputError } from './errors.js';
import { createLogger } from './logger.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  if (args[0] === 'inspect') return runInspect(args.slice(1));
  if (args[0] === 'auth') {
    return handleAuth(args.slice(1));
  }
  if (args[0] === 'doctor') {
    return runDoctor(args.slice(1), { version: PACKAGE_VERSION });
  }
  if (args[0] === 'persona') {
    return runPersona(args.slice(1));
  }
  if (args[0] === 'pack') {
    return runPack(args.slice(1));
  }
  if (args[0] === 'pattern') {
    throw inputError(
      'patina pattern was removed',
      'Community pattern packs are no longer supported.',
      'Add hand-written patterns to custom/patterns/ instead.'
    );
  }
  if (args[0] === 'aside') {
    throw inputError(
      'patina aside was removed',
      'The Aside integration is no longer supported.',
      'Run patina --verify <file> for a verified rewrite.'
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

  validateOfflineScoreRequest(parsed);
  if (parsed.listBackends) {
    printBackendStatus();
    return;
  }

  validateModeExclusivity(parsed);
  validateRegisterRequest(parsed);
  validatePersonaRequest(parsed);
  validateVerifyRequest(parsed);
  validateOutputRouting(parsed);

  return runDefault(parsed, logger);
}
