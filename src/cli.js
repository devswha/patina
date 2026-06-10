import { loadConfig, getRepoRoot, resolveTone } from './config.js';
import {
  loadPatterns,
  loadProfile,
  loadCoreFile,
  loadInputText,
  loadVoiceSample,
  toneToBackboneProfile,
} from './loader.js';
import { buildPrompt } from './prompt-builder.js';
import { invokeBackendChain, selectBackendChain, listBackends, listBackendNames, resolveBackend } from './backends/index.js';
import { selectProvider, resolveProviderConfig } from './providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from './security.js';
import { formatOutput, formatRewriteBodyForBrowser, validateScoreWeights, buildDeterministicAuditBackstop } from './output.js';
import {
  buildBrowserDiffPromptInput,
  renderBrowserDiffHtml,
  writeBrowserDiffPage,
  openBrowserDiffPage,
} from './browser-diff.js';
import { runOuroboros } from './ouroboros.js';
import { interpretScore, reconcileScoreOverall, scoreDeterministicSignals } from './scoring.js';
import { runDoctor } from './commands/doctor.js';
import { PatinaCliError, inputError, runtimeError, renderCliError, getExitCode } from './errors.js';
import { providerHttpKeyEnvVars, resolveHttpApiKey } from './auth.js';
import { createLogger } from './logger.js';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  PROMPT_SIZE_WARNING_CHARS,
  getBackendSafety,
  resolveBackendMaxConcurrency,
  resolveBackendMaxRetries,
} from './backends/contract.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

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
  validateBrowserRequest(parsed);

  const config = loadConfig(undefined, parsed.config
    ? { overridePath: resolve(process.cwd(), parsed.config) }
    : {});

  if (parsed.lang) config.language = parsed.lang;
  if (parsed.profile) config.profile = parsed.profile;

  const provider = selectProvider(parsed.provider ?? config.provider);
  const apiKey = resolveApiKey(parsed, provider);
  const resolved = resolveProviderConfig({
    provider,
    apiKey,
    baseURL: parsed.baseURL ?? config.baseURL ?? config['base-url'],
    model: parsed.model ?? config.model,
  });
  applyInsecureBaseURLOptIn(parsed);
  applyPrivateBaseURLOptIn(parsed);
  validateBaseURL(resolved.baseURL);


  const repoRoot = getRepoRoot();
  const lang = config.language || 'ko';

  // Tone resolution (v3.10): CLI --tone > config tone > null.
  // null + config.profile → profile-only mode (regression-safe; v3.9 behavior).
  // zh/ja + explicit tone → unsupported_language_fallback (warn + profile-only path).
  const toneResolution = resolveTone({ cliTone: parsed.tone, configTone: config.tone, lang });
  if (toneResolution.warning) {
    logger.warn('tone.warning', { message: `[patina] ${toneResolution.warning}` });
  }

  // Backbone profile mapping: explicit user tone (not auto, not fallback) maps to a
  // backbone profile. CLI --profile still wins on conflict (per Phase 1 spec — backbone
  // is applied "after --profile override"). Only auto-map when user didn't specify --profile.
  let profileName = config.profile || 'default';
  if (
    !parsed.profile &&
    toneResolution.tone_source === 'user' &&
    toneResolution.tone &&
    toneResolution.tone !== 'auto'
  ) {
    const backbone = toneToBackboneProfile(toneResolution.tone);
    if (backbone) profileName = backbone;
  }
  const resolvedProfileName = resolveProfileForLanguage(profileName, lang, logger);
  if (resolvedProfileName !== profileName) {
    profileName = resolvedProfileName;
    config.profile = 'default';
  }

  const patterns = loadPatterns(repoRoot, lang, config['skip-patterns'] || []);
  const profile = loadProfile(repoRoot, profileName);
  const voice = loadCoreFile(repoRoot, 'voice.md');
  const scoring = loadCoreFile(repoRoot, 'scoring.md');
  const mode = parsed.diff ? 'diff'
    : parsed.audit ? 'audit'
    : parsed.score ? 'score'
    : parsed.ouroboros ? 'ouroboros'
    : 'rewrite';
  const voiceSamplePath = (mode === 'rewrite' || mode === 'ouroboros')
    ? (parsed.voiceSample ?? config['voice-sample'])
    : null;
  const voiceSample = voiceSamplePath
    ? loadVoiceSample(resolve(process.cwd(), voiceSamplePath))
    : null;
  if (voiceSample?.truncated) {
    logger.warn('voice_sample.truncated', {
      message: '[patina] voice sample has more than 3 paragraphs; using the first 3 as anchors',
    });
  }

  const inputTexts = await loadInputs(parsed, logger);
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  const backendSelection = parsed.ouroboros
    ? null
    : selectBackendChain({
      name: parsed.backend ?? config.backend ?? (resolved.baseURLSource !== 'default' ? 'openai-http' : undefined),
      model: resolved.model,
      modelSource: resolved.modelSource,
    });
  const backends = backendSelection?.backends || [];
  const backend = backends[0] || null;

  if (backendSelection) {
    if (backendSelection.autoSelected) {
      logger.info('backend.selected', {
        message: `[patina] Using ${backend.name} backend (${backendSelection.reason}). Run \`patina auth status\` for details.`,
      });
    }
    if (backends.length > 1) {
      logger.info('backend.chain', {
        message: `[patina] Backend fallback chain: ${backends.map((b) => b.name).join(' → ')}`,
      });
    }
    if (backend.name === 'openai-http' && !resolved.apiKey) {
      const msg = ['No API key found. Set PATINA_API_KEY, PATINA_API_KEY_FILE, OPENAI_API_KEY, or use --api-key-file.'];
      if (provider) {
        msg.push(`(--provider ${provider.name} expects ${provider.apiKeyEnv} or PATINA_API_KEY.)`);
      }
      const codex = listBackends().find((b) => b.name === 'codex-cli');
      if (codex && codex.available && codex.authenticated) {
        msg.push('Or pass `--backend codex-cli` to use the codex-cli backend (no key needed).');
      } else if (codex && codex.available && !codex.authenticated) {
        msg.push('Or run `codex login`, then pass `--backend codex-cli`.');
      } else if (codex && !codex.available) {
        msg.push('Or install `codex` from https://github.com/openai/codex and pass `--backend codex-cli`.');
      }
      throw runtimeError(
        'no API key found',
        msg[0],
        msg.slice(1).join(' ') || 'Set PATINA_API_KEY or pass --backend codex-cli after logging in.'
      );
    }
  }

  const promptMode = backendSelection
    ? resolvePromptMode({ backend: backend.name, model: resolved.model })
    : 'strict';
  const jobs = inputTexts.map(({ path, text }) => ({
    path,
    text,
    prompt: parsed.ouroboros ? null : buildPrompt({
      config,
      patterns,
      profile: profile.body ? profile : null,
      voice: voice.body ? voice : null,
      voiceSample,
      scoring: scoring.body ? scoring : null,
      text,
      mode,
      tone: toneResolution,
      promptMode,
    }),
  }));

  if (backendSelection) {
    logBatchSafetyPlan({
      jobs,
      backends,
      parsed,
      promptMode,
      timeoutMs,
      logger,
    });
  }

  const cancellation = createCancellationController({ logger });
  const batchState = createBatchCircuitBreaker({ parsed, total: jobs.length });

  cancellation.install();
  try {
    for (const { path, text, prompt } of jobs) {
      try {
        cancellation.throwIfCanceled();
        let result;

        if (parsed.ouroboros) {
          result = await runOuroboros({
            config,
            patterns,
            profile: profile.body ? profile : null,
            voice: voice.body ? voice : null,
            voiceSample,
            scoring: scoring.body ? scoring : null,
            text,
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            model: resolved.model,
            timeout: timeoutMs,
            signal: cancellation.signal,
            logger,
          });
        } else {
          result = await invokeBackendChain({
            backends,
            prompt,
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            model: resolved.model,
            modelSource: resolved.modelSource,
            signal: cancellation.signal,
            timeout: timeoutMs,
            maxConcurrency: parsed.maxConcurrency,
            maxRetries: parsed.maxRetries,
            logger,
          });
        }
        cancellation.throwIfCanceled();

        if (mode === 'score' && !parsed.ouroboros) {
          result = withDeterministicScore(result, {
            text,
            config,
            repoRoot,
            logger,
          });
        }
        let browserPagePath = null;

        const auditBackstop =
          mode === 'audit' && (parsed.format ?? 'markdown') !== 'json' && !parsed.batch
            ? buildDeterministicAuditBackstop(text, { lang, repoRoot, config })
            : '';
        let output;
        let scoreValidationOutput = null;
        if (parsed.ouroboros) {
          const ouroborosBody = formatOuroborosOutput(result);
          output = formatOutput(ouroborosBody, mode, parsed, { tone: toneResolution, logger, auditBackstop });
          scoreValidationOutput = ouroborosBody;
        } else {
          output = formatOutput(result, mode, parsed, { tone: toneResolution, logger, auditBackstop });
          if (mode === 'score') {
            scoreValidationOutput = formatOutput(result, mode, { ...parsed, format: 'markdown' }, { logger });
          }
        }

        if (parsed.browser && mode === 'rewrite') {
          ({ pagePath: browserPagePath } = await buildBrowserDiffArtifact({
            originalText: text,
            rawRewriteResult: result,
            sourcePath: path,
            parsed,
            config,
            repoRoot,
            patterns,
            profile: profile.body ? profile : null,
            voice: voice.body ? voice : null,
            voiceSample,
            scoring: scoring.body ? scoring : null,
            promptMode,
            backends,
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            model: resolved.model,
            modelSource: resolved.modelSource,
            signal: cancellation.signal,
            timeout: timeoutMs,
            maxConcurrency: parsed.maxConcurrency,
            maxRetries: parsed.maxRetries,
            logger,
          }));
        }

        // v3.11 Phase 1.3: surface weight drift between config and the score
        // table the model emitted. Warnings only — does not alter the output.
        if (mode === 'score') {
          const configWeights = config.ouroboros?.['category-weights']?.[lang] || {};
          const warnings = validateScoreWeights(scoreValidationOutput || output, configWeights);
          for (const w of warnings) {
            logger.warn('score.weight_check', { message: `[patina] ${w}` });
          }

          if (parsed.gate !== undefined) {
            applyScoreGate(result, output, parsed.gate, logger);
          }
        }

        if (parsed.batch) {
          await writeBatchOutput(parsed, path, output);
        } else {
          console.log(output);
          if (browserPagePath) {
            try {
              await openBrowserDiffPage(browserPagePath);
            } catch (err) {
              console.error(`[patina] Browser diff page saved at ${browserPagePath}`);
              console.error(`[patina] Browser open failed: ${err.message}`);
            }
          }
        }
        batchState.recordSuccess();
      } catch (err) {
        if (!shouldHandleBatchFailure(parsed, jobs.length)) throw err;
        batchState.recordFailure({ path, err });
        logger.warn('batch.file_failed', {
          message: `[patina] batch file failed: ${path} (${batchState.failures.length}/${batchState.maxFailures} failures): ${err.message}`,
        });
        if (batchState.shouldStop()) throw batchState.toError();
      }
    }

    if (batchState.hasFailures()) {
      throw batchState.toError({ completed: true });
    }
  } catch (err) {
    if (cancellation.signal.aborted) throw cancellationError();
    throw err;
  } finally {
    cancellation.cleanup();
    logger.closeProgress();
  }

}

function parseArgs(args) {
  const parsed = {
    files: [],
    format: 'markdown',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--version':
      case '-v':
        parsed.version = true;
        break;
      case '--lang':
        parsed.lang = readOptionValue(args, i, arg);
        i++;
        break;
      case '--profile':
        parsed.profile = readOptionValue(args, i, arg);
        i++;
        break;
      case '--tone': {
        const t = readOptionValue(args, i, arg);
        i++;
        const valid = ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'];
        if (!valid.includes(t)) {
          throw inputError(
            `unknown tone ${t}`,
            `Valid tones are: ${valid.join(', ')}.`,
            'Use `--tone auto` to let patina infer tone from the text.'
          );
        }
        parsed.tone = t;
        break;
      }
      case '--voice-sample':
        parsed.voiceSample = readOptionValue(args, i, arg);
        i++;
        break;
      case '--browser':
        parsed.browser = true;
        break;
      case '--diff':
        parsed.diff = true;
        break;
      case '--no-color':
        parsed.noColor = true;
        break;
      case '--audit':
        parsed.audit = true;
        break;
      case '--score':
        parsed.score = true;
        break;
      case '--format': {
        const value = readOptionValue(args, i, arg);
        i++;
        if (!['json', 'text', 'markdown'].includes(value)) {
          throw inputError(
            '--format expects json, text, or markdown',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `--format json`, `--format text`, or `--format markdown`.'
          );
        }
        parsed.format = value;
        break;
      }
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--exit-on': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw inputError(
            '--exit-on expects a number from 0 to 100',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `patina --score --exit-on 30 <file>` for CI gates.'
          );
        }
        parsed.gate = n;
        break;
      }
      case '--ouroboros':
        parsed.ouroboros = true;
        break;
      case '--batch':
        parsed.batch = true;
        break;
      case '--in-place':
        parsed.inPlace = true;
        break;
      case '--suffix':
        parsed.suffix = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        break;
      case '--outdir':
        parsed.outdir = readOptionValue(args, i, arg);
        i++;
        break;
      case '--model':
        parsed.model = readOptionValue(args, i, arg);
        i++;
        break;
      case '--api-key-file':
        parsed.apiKeyFile = readOptionValue(args, i, arg);
        i++;
        break;
      case '--allow-private-base-url':
        parsed.allowPrivateBaseURL = true;
        break;
      case '--base-url':
        parsed.baseURL = readOptionValue(args, i, arg);
        i++;
        break;
      case '--backend':
        parsed.backend = readOptionValue(args, i, arg);
        i++;
        break;
      case '--timeout-ms': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.timeoutMs = parsePositiveIntegerOption(value, arg);
        break;
      }
      case '--max-concurrency': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxConcurrency = parsePositiveIntegerOption(value, arg);
        break;
      }
      case '--max-retries': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxRetries = parseNonNegativeIntegerOption(value, arg);
        break;
      }
      case '--max-failures': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxFailures = parsePositiveIntegerOption(value, arg);
        break;
      }
      case '--max-failure-rate': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxFailureRate = parseFailureRateOption(value, arg);
        break;
      }
      case '--stop-on-retryable-storm':
        parsed.stopOnRetryableStorm = true;
        break;
      case '--list-backends':
        parsed.listBackends = true;
        break;
      case '--provider':
        parsed.provider = readOptionValue(args, i, arg);
        i++;
        break;
      case '--allow-insecure-base-url':
        parsed.allowInsecureBaseURL = true;
        break;
      case '--config':
        parsed.config = readOptionValue(args, i, arg);
        i++;
        break;
      case '--no-interactive':
        parsed.noInteractive = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          parsed.files.push(arg);
        } else {
          throw inputError(
            `unknown option ${arg}`,
            'patina does not recognize this CLI flag.',
            'Run `patina --help` to see supported options.'
          );
        }
        break;
    }
  }

  return parsed;
}

// The output modes are mutually exclusive (SKILL.md). Without this guard, a
// combination like `--audit --score` resolves to 'audit' and silently skips the
// score gate (exit 0 always), and `--score --ouroboros` throws deep in the gate.
function validateModeExclusivity(parsed) {
  const active = ['diff', 'audit', 'score', 'ouroboros'].filter((m) => parsed[m]);
  if (active.length > 1) {
    throw inputError(
      `--${active[0]} and --${active[1]} cannot be combined`,
      'The diff / audit / score / ouroboros output modes are mutually exclusive.',
      `Pick one of --diff, --audit, --score, or --ouroboros.`
    );
  }
}

function validateBrowserRequest(parsed) {
  if (!parsed.browser) return;
  if (parsed.batch) {
    throw inputError(
      '--browser does not support --batch',
      'The browser diff page is limited to one local file in this first release.',
      'Run `patina --browser path/to/file.md`, or omit --browser for batch rewrites.'
    );
  }
  if (parsed.diff || parsed.audit || parsed.score || parsed.ouroboros) {
    throw inputError(
      '--browser only works in rewrite mode',
      'Browser diff pages are an additive rewrite surface, not a diff/audit/score/ouroboros mode.',
      'Use `patina --browser path/to/file.md` by itself, without --diff, --audit, --score, or --ouroboros.'
    );
  }
  if (parsed.files.length !== 1) {
    throw inputError(
      '--browser requires exactly one local file',
      'No file, stdin, or multiple files were provided.',
      'Pass one local file path such as `patina --browser draft.md`.'
    );
  }
  if (/^https?:\/\//i.test(String(parsed.files[0] || ''))) {
    throw inputError(
      '--browser does not support URL input yet',
      'This first PR is limited to a single local file and does not fetch homepage URLs.',
      'Download the page to a local file first, or run plain patina without --browser.'
    );
  }
}

function cancellationError() {
  return new PatinaCliError({
    what: 'interrupted',
    why: 'Ctrl-C canceled the in-flight patina request.',
    action: 'Any running backend process or HTTP request was asked to stop.',
    exitCode: 130,
  });
}

/**
 * Create a SIGINT-aware cancellation controller for long-running CLI operations.
 *
 * @param {object} [options] Cancellation integration points.
 * @param {NodeJS.Process} [options.processObj=process] Process-like object used for signal listeners.
 * @param {NodeJS.WritableStream} [options.stderr=process.stderr] Stream for fallback cancel messages.
 * @param {object|null} [options.logger] Optional patina logger.
 * @returns {{signal: AbortSignal, install: Function, uninstall: Function, throwIfCanceled: Function}} Controller facade.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const cancellation = createCancellationController();
 * cancellation.install();
 */
export function createCancellationController({
  processObj = process,
  stderr = process.stderr,
  logger = null,
} = {}) {
  const controller = new AbortController();
  let sigintCount = 0;
  let installed = false;

  const writeStatus = (message) => {
    if (logger) {
      logger.warn('cli.cancel', { message: message.trimEnd() });
      return;
    }
    if (stderr && typeof stderr.write === 'function') stderr.write(message);
  };

  const onSigint = () => {
    sigintCount++;
    if (sigintCount === 1) {
      processObj.exitCode = 130;
      writeStatus('[patina] cancelling… press Ctrl-C again to exit immediately\n');
      controller.abort();
      return;
    }

    cleanup();
    processObj.exit(130);
  };

  function install() {
    if (!installed && typeof processObj.on === 'function') {
      processObj.on('SIGINT', onSigint);
      installed = true;
    }
  }

  function cleanup() {
    if (installed && typeof processObj.removeListener === 'function') {
      processObj.removeListener('SIGINT', onSigint);
      installed = false;
    }
  }

  return {
    signal: controller.signal,
    install,
    cleanup,
    throwIfCanceled() {
      if (controller.signal.aborted) throw cancellationError();
    },
  };
}

function readOptionValue(args, index, option, { allowFlagLike = false } = {}) {
  const value = args[index + 1];
  if (value === undefined || (!allowFlagLike && value.startsWith('-'))) {
    throw inputError(
      `${option} requires a value`,
      'The option was provided without the value it needs.',
      `Run \`patina --help\` to see the expected ${option} syntax.`
    );
  }
  return value;
}

function parsePositiveIntegerOption(value, option) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw inputError(
      `${option} expects a positive integer`,
      `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
      `Use ${option} 1 or another whole number greater than zero.`
    );
  }
  return n;
}

function parseNonNegativeIntegerOption(value, option) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw inputError(
      `${option} expects a non-negative integer`,
      `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
      `Use ${option} 0 to disable retries, or another whole number.`
    );
  }
  return n;
}

function parseFailureRateOption(value, option) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw inputError(
      `${option} expects a ratio or percent`,
      `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
      `Use ${option} 0.25 for 25%, or ${option} 25.`
    );
  }
  const ratio = n > 1 ? n / 100 : n;
  if (ratio > 1) {
    throw inputError(
      `${option} expects a value from 0 to 1 or 0 to 100`,
      `Received "${value}".`,
      `Use ${option} 0.25 for 25%, or ${option} 25.`
    );
  }
  return ratio;
}

// Internal prompt style is selected from backend safety metadata. Local agent
// CLIs use the compact rewrite prompt by default to avoid feeding large pattern
// packs into batch-oriented agent runtimes.
export function resolvePromptMode({ backend, model }) {
  const backendStr = (backend || '').toLowerCase();
  const modelStr = (model || '').toLowerCase();
  if (backendStr && backendStr !== 'openai-http') return getBackendSafety(backendStr).promptMode;
  if (modelStr.includes('gemini')) return 'minimal';
  if (backendStr) return getBackendSafety(backendStr).promptMode;
  if (modelStr.includes('kimi') || modelStr.includes('claude') || modelStr.includes('codex')) return 'minimal';
  return 'strict';
}

/**
 * Resolve a profile name against language-specific profile limits.
 *
 * @param {string} profileName Requested profile name.
 * @param {string} lang Active language code.
 * @param {object} [logger] Logger with warn(event, payload).
 * @returns {string} Effective profile name.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * resolveProfileForLanguage('namuwiki', 'en') // 'default'
 */
export function resolveProfileForLanguage(profileName, lang, logger = null) {
  const effective = profileName || 'default';
  if (effective === 'namuwiki' && lang !== 'ko') {
    logger?.warn?.('profile.unsupported_language', {
      message: `[patina] profile "namuwiki" is ko-only; falling back to default profile for --lang ${lang}`,
    });
    return 'default';
  }
  return effective;
}


// Resolve the API key from file or environment. Precedence: --api-key-file >
// PATINA_API_KEY_FILE > provider/default env vars.
function resolveApiKey(parsed, provider) {
  return resolveHttpApiKey({
    apiKeyFile: parsed.apiKeyFile,
    envVars: providerHttpKeyEnvVars(provider?.apiKeyEnv),
  });
}

function logBatchSafetyPlan({ jobs, backends, parsed, promptMode, timeoutMs, logger }) {
  if (!parsed.batch || jobs.length <= 1) return;

  const primary = backends[0];
  const promptSizes = jobs
    .map((job) => typeof job.prompt === 'string' ? job.prompt.length : 0)
    .filter((size) => size > 0);
  const maxPromptChars = promptSizes.length > 0 ? Math.max(...promptSizes) : 0;
  const avgPromptChars = promptSizes.length > 0
    ? Math.round(promptSizes.reduce((sum, size) => sum + size, 0) / promptSizes.length)
    : 0;
  const maxConcurrency = resolveBackendMaxConcurrency(primary?.name, parsed.maxConcurrency);
  const perFileRequests = backends.reduce(
    (sum, item) => sum + resolveBackendMaxRetries(item.name, parsed.maxRetries) + 1,
    0
  );

  logger.info('batch.safety_plan', {
    message: `[patina] batch safety: files=${jobs.length}, backend=${backends.map((b) => b.name).join('→')}, prompt_mode=${promptMode}, max_concurrency=${formatLimit(maxConcurrency)}, max_retries=${resolveBackendMaxRetries(primary?.name, parsed.maxRetries)}, timeout_ms=${timeoutMs}, worst_case_requests=${jobs.length * perFileRequests}, max_prompt_chars=${maxPromptChars}, avg_prompt_chars=${avgPromptChars}`,
  });

  if (primary && getBackendSafety(primary.name).agentRuntime) {
    logger.warn('batch.local_cli_caveat', {
      message: `[patina] ${primary.name} is a local agent CLI, not a stateless batch completion API. Large batches should prefer an OpenAI-compatible HTTP provider when possible.`,
    });
  }
  if (maxPromptChars >= PROMPT_SIZE_WARNING_CHARS) {
    logger.warn('batch.prompt_size', {
      message: `[patina] largest prompt is ~${maxPromptChars.toLocaleString()} chars; failed attempts still send the full prompt.`,
    });
  }
}

function createBatchCircuitBreaker({ parsed, total }) {
  const active = parsed.batch && total > 1;
  const maxFailures = active
    ? (parsed.maxFailures ?? Math.min(10, Math.max(3, Math.ceil(total * 0.1))))
    : Infinity;
  const maxFailureRate = active ? (parsed.maxFailureRate ?? 0.25) : Infinity;
  const stormEnabled = active && (parsed.stopOnRetryableStorm ?? true);
  const stormLimit = 3;
  const failures = [];
  const retryableBuckets = new Map();
  let successes = 0;
  let processed = 0;
  let stopReason = null;

  return {
    get failures() {
      return failures;
    },
    get maxFailures() {
      return maxFailures;
    },
    recordSuccess() {
      processed++;
      successes++;
    },
    recordFailure({ path, err }) {
      processed++;
      failures.push({ path, err });
      const bucket = classifyRetryableStorm(err);
      if (bucket) {
        retryableBuckets.set(bucket, (retryableBuckets.get(bucket) || 0) + 1);
      }
    },
    hasFailures() {
      return failures.length > 0;
    },
    shouldStop() {
      if (!active) return false;
      if (failures.length >= maxFailures) {
        stopReason = `max failures reached (${failures.length}/${maxFailures})`;
        return true;
      }
      if (
        Number.isFinite(maxFailureRate) &&
        processed >= (parsed.maxFailureRate === undefined ? Math.min(total, 4) : 1) &&
        failures.length / processed > maxFailureRate
      ) {
        stopReason = `failure rate ${(failures.length / processed * 100).toFixed(1)}% exceeded ${(maxFailureRate * 100).toFixed(1)}%`;
        return true;
      }
      if (stormEnabled) {
        for (const [bucket, count] of retryableBuckets) {
          if (count >= stormLimit) {
            stopReason = `retryable storm detected (${count} × ${bucket})`;
            return true;
          }
        }
      }
      return false;
    },
    toError({ completed = false } = {}) {
      const summary = failures
        .slice(0, 5)
        .map((failure) => `${failure.path}: ${failure.err.message}`)
        .join(' | ');
      const why = stopReason || (completed
        ? `Batch completed with ${failures.length} failed file(s).`
        : `Batch stopped after ${failures.length} failed file(s).`);
      return runtimeError(
        completed ? 'batch completed with failures' : 'batch circuit breaker stopped the run',
        `${why} Successes: ${successes}/${total}. Failures: ${failures.length}/${total}.`,
        summary || 'Fix the backend failure, lower concurrency/retries, or rerun with a smaller batch.'
      );
    },
  };
}

function shouldHandleBatchFailure(parsed, total) {
  return parsed.batch && total > 1;
}

function classifyRetryableStorm(err) {
  const message = String(err?.message || err || '');
  if (/\bHTTP\s+429\b/i.test(message) || err?.status === 429) return 'HTTP 429';
  if (/\bHTTP\s+503\b/i.test(message) || err?.status === 503) return 'HTTP 503';
  if (/Provider stream timed out/i.test(message)) return 'provider stream timeout';
  if (/timed out/i.test(message) || err?.name === 'AbortError') return 'timeout';
  const exit = message.match(/\bexited with code\s+(75|1)\b/i);
  if (exit) return `exit ${exit[1]}`;
  if (/no final response body|empty response|final-message-only/i.test(message)) return 'empty response';
  return null;
}

function formatLimit(value) {
  return Number.isFinite(value) ? String(value) : 'unbounded';
}

async function loadInputs(parsed, logger = createLogger()) {
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

async function writeBatchOutput(parsed, inputPath, output) {
  if (inputPath === '-') {
    console.log(output);
    return;
  }

  let outPath;
  if (parsed.inPlace) {
    outPath = inputPath;
  } else if (parsed.suffix) {
    const ext = extname(inputPath);
    const base = basename(inputPath, ext);
    const dir = inputPath.slice(0, -basename(inputPath).length);
    outPath = resolve(dir, `${base}${parsed.suffix}${ext}`);
  } else if (parsed.outdir) {
    mkdirSync(parsed.outdir, { recursive: true });
    outPath = resolve(parsed.outdir, basename(inputPath));
  } else {
    console.log(output);
    return;
  }

  writeFileSync(outPath, output, 'utf8');
  console.log(`Written: ${outPath}`);
}


function formatOuroborosOutput(result) {
  let output = '## Ouroboros Iteration Log\n\n';
  output += '| Iter | Before | After | Improvement | Reason |\n';
  output += '|------|--------|-------|-------------|--------|\n';

  for (const entry of result.log) {
    output += `| ${entry.iteration} | ${entry.before ?? '—'} | ${entry.after} | ${entry.improvement ?? '—'} | ${entry.reason} |\n`;
  }

  output += `\nFinal score: ${result.finalScore}/100 (±10)\n`;
  output += `Iterations: ${result.iterations}/${result.log.length > 0 ? result.log[result.log.length - 1].iteration : 0}\n`;
  output += `Reason: ${result.reason}\n\n`;
  output += '## Final Text\n\n';
  output += result.finalText.trim();
  output += '\n';

  return output;
}

function printHelp() {
  const backendChoices = listBackendNames().join(', ');
  console.log(`patina — AI text humanizer CLI

Usage: patina [command] [options] [file...]

COMMANDS
  patina doctor [--json]  Check Node, backends, tmux, and auth setup
  patina auth status      Show backend availability and authentication status
  patina auth login       Print per-backend authentication instructions
  patina auth login <backend> [--yes]
                         Launch a backend login flow after confirmation

MODES
  --diff                  Show changes pattern by pattern
  --no-color              Disable ANSI colors in --diff output
  --audit                 Detect patterns only (no rewrite)
  --score                 Output AI-likeness score (0-100)
  --exit-on <n>           With --score, exit 3 when overall score > n
  --ouroboros             Iterative self-improvement loop
  --browser               Rewrite one local file, then open a local before/after diff page (adds one diff explanation call)

OUTPUT & BATCH
  --format <fmt>          Stdout format: markdown (default), text, json
  --quiet                 Suppress patina status/warning logs on stderr
  --batch                 Process multiple files
  --in-place              Overwrite original files (with --batch)
  --suffix <ext>          Save as {name}{ext}{extname}
  --outdir <dir>          Save results to directory
  --max-failures <n>      Stop batch after n failed files
  --max-failure-rate <r>  Stop batch when failure ratio exceeds r (0.25 or 25)
  --stop-on-retryable-storm
                          Stop batch after repeated 429/timeouts/empty local-CLI exits
  --no-interactive        Do not wait for TTY stdin; exit 2 when no input is given

LANGUAGE & PROFILE
  --lang <code>           Language: ko, en, zh, ja (default: ko)
  --profile <name>        Profile: default, blog, academic, technical, formal,
                          social, email, legal, medical, marketing,
                          narrative, instructional, casual-conversation,
                          code-comment, commit-message, release-notes, namuwiki
  --tone <name>           Tone: casual, professional, academic, narrative,
                          marketing, instructional, auto. Resolution:
                          --tone > config tone > config profile.
  --voice-sample <path>   Use 1-3 user paragraphs as style-only voice anchors

MODEL & AUTH
  --model <id>            Single model ID. Defaults use the strongest
                          documented model per backend: openai/codex gpt-5.5,
                          claude-sonnet-4-6, gemini-2.5-pro,
                          kimi-code/kimi-for-coding.
  --api-key-file <path>   Read API key from file (recommended)
  --base-url <url>        API base URL (or PATINA_API_BASE env)
  --backend <name[,name]> Backend or explicit fallback chain:
                          ${backendChoices} (default: openai-http)
  --list-backends         List backends, selectors, default models, and auth status
  --timeout-ms <n>        Per-request/backend timeout in milliseconds
  --max-concurrency <n>   Cross-process backend cap (safe defaults per backend)
  --max-retries <n>       Retry budget per backend (local CLIs default to 0)
  --provider <name>       Provider preset: openai, gemini, groq, kimi, moonshot, together
ADVANCED
  --config <path>         Load config from <path> instead of .patina.default.yaml
  --allow-insecure-base-url  Permit plaintext http:// to non-localhost endpoints
  --allow-private-base-url   Permit private/IMDS base URLs
  -h, --help              Show this help message
  -v, --version           Show version

EXAMPLES
  echo "This is a draft." | patina --lang en --backend codex-cli
  patina --score --exit-on 30 --format json draft.md
  patina doctor --json

ENVIRONMENT
  PATINA_API_KEY, PATINA_API_KEY_FILE, PATINA_API_BASE, PATINA_MODEL
  OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY,
  KIMI_API_KEY, MOONSHOT_API_KEY

EXIT CODES
  0 success · 1 runtime/backend · 2 input/usage · 3 score gate exceeded · 130 interrupted

If no API key is set, pass --backend codex-cli to use a logged-in codex CLI
(no key required). Auto-fallback was removed in v3.9 to keep agent-mode
backends opt-in (issue #88).
`);
}

async function buildBrowserDiffArtifact({
  originalText,
  rawRewriteResult,
  sourcePath,
  parsed,
  config,
  repoRoot,
  patterns,
  profile,
  voice,
  voiceSample,
  scoring,
  promptMode,
  backends,
  apiKey,
  baseURL,
  model,
  modelSource,
  signal,
  timeout,
  maxConcurrency,
  maxRetries,
  logger,
}) {
  const rewrittenBody = formatRewriteBodyForBrowser(rawRewriteResult, { logger });
  const beforeScore = scoreDeterministicSignals({ text: originalText, config, repoRoot, logger });
  const afterScore = scoreDeterministicSignals({ text: rewrittenBody, config, repoRoot, logger });

  let diffExplanation = '';
  let diffError = null;
  try {
    const diffPrompt = buildPrompt({
      config,
      patterns,
      profile,
      voice,
      voiceSample,
      scoring,
      text: buildBrowserDiffPromptInput(originalText, rewrittenBody),
      mode: 'diff',
      promptMode,
    });
    const diffResult = await invokeBackendChain({
      backends,
      prompt: diffPrompt,
      apiKey,
      baseURL,
      model,
      modelSource,
      signal,
      timeout,
      maxConcurrency,
      maxRetries,
      logger,
    });
    diffExplanation = formatOutput(
      diffResult,
      'diff',
      { ...parsed, format: 'markdown', noColor: true },
      { logger, stdout: { isTTY: false } },
    );
  } catch (err) {
    diffError = err?.message || 'browser diff explanation failed';
    logger.warn('browser.diff_failed', {
      message: `[patina] browser diff explanation failed: ${diffError}`,
    });
  }

  const html = renderBrowserDiffHtml({
    original: originalText,
    rewrittenBody,
    diffExplanation,
    diffError,
    beforeScore,
    afterScore,
    sourcePath,
  });

  return {
    pagePath: writeBrowserDiffPage(html),
    rewrittenBody,
  };
}

function withDeterministicScore(rawResult, { text, config, repoRoot, logger }) {
  const deterministicScore = scoreDeterministicSignals({ text, config, repoRoot, logger });
  const llmOverall = extractScoreOverall(rawResult, rawResult);
  const reconciliation = reconcileScoreOverall({
    llmOverall,
    deterministicScore,
    config,
    logger,
  });
  const overall = reconciliation.overall ?? llmOverall;
  return {
    raw: String(rawResult || '').trim(),
    overall,
    llmScore: {
      overall: llmOverall,
      interpretation: llmOverall === null ? null : interpretScore(llmOverall),
    },
    deterministicScore,
    ...(reconciliation.scorePreference ? { scorePreference: reconciliation.scorePreference } : {}),
  };
}



function applyScoreGate(result, output, gate, logger = createLogger()) {
  const overall = extractScoreOverall(result, output);
  if (overall === null) {
    throw new Error('score gate could not find a numeric `overall` value in --score output.');
  }
  if (overall > gate) {
    logger.warn('score.gate_failed', { message: `[patina] score gate failed: overall ${overall} > ${gate}` });
    process.exitCode = Math.max(Number(process.exitCode) || 0, 3);
  }
}

function extractScoreOverall(result, output) {
  const resultOverall = toFiniteScore(result?.overall);
  if (resultOverall !== null) return resultOverall;

  const text = String(output ?? result ?? '');
  const parsed = parseJsonScore(text);
  const parsedOverall = toFiniteScore(parsed?.overall);
  if (parsedOverall !== null) return parsedOverall;

  const table = text.match(/(?:^|\n)\|\s*(?:\*\*)?Overall(?:\*\*)?\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(?:\*\*)?([0-9]+(?:\.[0-9]+)?)/i);
  if (table) return Number(table[1]);

  const match = text.match(/(?:^|[\s|{,"])overall(?:["\s]*[:|]|\s+score\s*[:|]?)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return Number(match[1]);
}

function toFiniteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonScore(text) {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1],
    trimmed.match(/\{[\s\S]*\}/)?.[0],
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function printBackendStatus() {
  const list = listBackends();
  const rows = list.map((b) => ({
    name: b.name,
    kind: b.kind,
    selectWith: b.selectWith,
    defaultModel: b.defaultModel || '-',
    available: b.available ? 'yes' : 'no',
    authenticated: b.authenticated ? 'yes' : 'no',
    note: `${backendSafetyNote(b)} ${backendStatusNote(b)}`.trim(),
  }));
  const widths = {
    name: Math.max('Backend'.length, ...rows.map((r) => r.name.length)),
    kind: Math.max('Kind'.length, ...rows.map((r) => r.kind.length)),
    selectWith: Math.max('Select with'.length, ...rows.map((r) => r.selectWith.length)),
    defaultModel: Math.max('Default model'.length, ...rows.map((r) => r.defaultModel.length)),
    available: Math.max('Available'.length, ...rows.map((r) => r.available.length)),
    authenticated: Math.max('Authenticated'.length, ...rows.map((r) => r.authenticated.length)),
  };
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('Backend', widths.name)}  ${pad('Kind', widths.kind)}  ${pad('Select with', widths.selectWith)}  ${pad('Default model', widths.defaultModel)}  ${pad('Available', widths.available)}  ${pad('Authenticated', widths.authenticated)}  Notes`
  );
  console.log(
    `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.kind)}  ${'-'.repeat(widths.selectWith)}  ${'-'.repeat(widths.defaultModel)}  ${'-'.repeat(widths.available)}  ${'-'.repeat(widths.authenticated)}  -----`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.kind, widths.kind)}  ${pad(r.selectWith, widths.selectWith)}  ${pad(r.defaultModel, widths.defaultModel)}  ${pad(r.available, widths.available)}  ${pad(r.authenticated, widths.authenticated)}  ${r.note}`
    );
  }
}

function backendStatusNote(backend) {
  if (!backend.available) return backend.installHint || backend.authHint;
  if (backend.name === 'openai-http') return backend.authHint;
  if (backend.authenticated && backend.name === 'gemini-cli' && backend.authHint.startsWith('Authenticated via ')) {
    return backend.authHint;
  }
  if (backend.authenticated) return 'ready';
  if (backend.loginCommand) return `${backend.authHint} Use \`patina auth login ${backend.name}\` for the guided flow.`;
  return backend.authHint;
}

function backendSafetyNote(backend) {
  return `cap=${formatLimit(backend.maxConcurrency)}, retries=${backend.maxRetries}, prompt=${backend.promptMode};`;
}

async function handleAuth(subArgs) {
  const sub = subArgs[0] || 'status';
  if (sub === 'status') {
    printBackendStatus();
    return;
  }
  if (sub === 'login') {
    const parsed = parseAuthLoginArgs(subArgs.slice(1));
    if (parsed.backendName) {
      await runAuthLogin(parsed);
      return;
    }

    console.log('To authenticate a backend, follow the per-backend instructions:\n');
    for (const b of listBackends()) {
      const status = b.authenticated ? '✓ already authenticated' : '✗ not authenticated';
      console.log(`  ${b.name}: ${status}`);
      if (!b.authenticated) console.log(`    → ${b.authHint}`);
    }
    return;
  }
  throw inputError(
    `unknown auth subcommand ${sub}`,
    'Supported auth subcommands are status and login.',
    'Try `patina auth status`, `patina auth login`, or `patina auth login codex-cli`.'
  );
}

function parseAuthLoginArgs(args) {
  let assumeYes = false;
  let backendName = null;

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      assumeYes = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw inputError(
        `unknown auth login option ${arg}`,
        'Only --yes/-y is supported for non-interactive confirmation.',
        'Run `patina auth login <backend> --yes` or omit --yes to confirm interactively.'
      );
    }
    if (backendName) {
      throw inputError(
        'auth login expects at most one backend',
        `Received both ${backendName} and ${arg}.`,
        `Available backends are: ${listBackendNames().join(', ')}.`
      );
    }
    backendName = arg;
  }

  return { backendName, assumeYes };
}

async function runAuthLogin({ backendName, assumeYes }) {
  const backend = resolveBackend(backendName);
  if (typeof backend.login !== 'function') {
    throw inputError(
      `${backend.name} does not support interactive login`,
      backend.authHint ? backend.authHint() : 'This backend authenticates outside local CLI OAuth.',
      'Set PATINA_API_KEY, PATINA_API_KEY_FILE, or the provider-specific API key env var for HTTP backends.'
    );
  }

  if (!backend.isAvailable()) {
    throw runtimeError(
      `${backend.name} CLI is not installed or not on PATH`,
      backend.installHint || backend.authHint(),
      'Install the CLI named above, then rerun this command.'
    );
  }

  const commandLabel = backend.loginCommand || backend.name;
  const confirmed = await confirmAuthLogin(commandLabel, { assumeYes });
  if (!confirmed) {
    console.log('Cancelled.');
    return;
  }

  const wasAuthenticated = backend.isAuthenticated();
  await backend.login();
  const authenticated = backend.isAuthenticated();

  if (authenticated) {
    console.log(`${backend.name}: authenticated.`);
  } else if (wasAuthenticated) {
    console.log(`${backend.name}: login command completed; previous authentication is still present.`);
  } else {
    console.log(`${backend.name}: login command completed, but patina could not confirm authentication yet.`);
    console.log(`→ ${backend.authHint()}`);
  }
}

async function confirmAuthLogin(commandLabel, { assumeYes = false } = {}) {
  if (assumeYes) {
    console.log(`Run ${commandLabel}? yes (--yes)`);
    return true;
  }

  if (!process.stdin.isTTY) {
    throw inputError(
      `cannot confirm ${commandLabel} in a non-interactive session`,
      'patina will not launch an interactive OAuth flow without explicit confirmation.',
      `Rerun with \`patina auth login <backend> --yes\` if you intentionally want to start ${commandLabel}.`
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Run ${commandLabel}? [Y/n] `);
    return answer.trim() === '' || /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
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
