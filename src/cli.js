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
import { selectProvider, resolveProviderConfig, PROVIDERS } from './providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from './security.js';
import { formatOutput, validateScoreWeights, buildDeterministicAuditBackstop } from './output.js';
import { runMaxMode } from './max-mode.js';
import { runOuroboros } from './ouroboros.js';
import { interpretScore, reconcileScoreOverall, scoreDeterministicSignals, scoreMPS, scoreText } from './scoring.js';
import { renderShareCard } from '../scripts/share-card.mjs';
import { callLLM, DEFAULT_TEMPERATURE } from './api.js';
import { createResponseCache, DEFAULT_CACHE_TTL_SECONDS } from './cache.js';
import { buildManifest, appendResult, writeManifest, hashSha256 } from './manifest.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { PatinaCliError, inputError, runtimeError, renderCliError, getExitCode } from './errors.js';
import { inspectHttpApiKeySource, providerHttpKeyEnvVars, resolveHttpApiKey } from './auth.js';
import { createLogger } from './logger.js';
import { maybeShowFirstRunNudge } from './nudge.js';
import { maybeWarnJudgeOverlap } from './judge-warning.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, dirname, extname } from 'node:path';
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
    return runInit(args.slice(1));
  }
  if (args[0] === 'help') {
    printHelp();
    return;
  }

  const parsed = parseArgs(args);
  const logger = createLogger({ quiet: parsed.quiet, json: parsed.jsonLogs });

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.version) {
    console.log(`patina ${PACKAGE_VERSION}`);
    return;
  }

  if (parsed.models && parsed.variants && parsed.variants > 1) {
    throw inputError(
      '--variants is not supported with --models/MAX mode yet',
      'MAX mode already fans out across models, so variant fan-out is ambiguous.',
      'Omit --variants or run one model at a time.'
    );
  }

  if (parsed.gate !== undefined && !parsed.score) {
    throw inputError(
      `${parsed.gateOption || '--gate'} can only be used with --score`,
      'Score gates need a parsed overall score.',
      'Run `patina --score --exit-on 30 <file>`.'
    );
  }

  if (parsed.listBackends) {
    printBackendStatus();
    return;
  }

  if (parsed.listProviders) {
    printProviderStatus();
    return;
  }

  const configPath = parsed.config ? resolve(process.cwd(), parsed.config) : undefined;
  const config = loadConfig(configPath);

  if (parsed.lang) config.language = parsed.lang;
  if (parsed.profile) config.profile = parsed.profile;

  const provider = selectProvider(parsed.provider ?? config.provider);
  const apiKey = resolveApiKey(parsed, provider, logger);
  const resolved = resolveProviderConfig({
    provider,
    apiKey,
    baseURL: parsed.baseURL ?? config.baseURL ?? config['base-url'],
    model: parsed.model ?? config.model,
  });
  applyInsecureBaseURLOptIn(parsed);
  applyPrivateBaseURLOptIn(parsed);
  validateBaseURL(resolved.baseURL);

  const startedAt = new Date().toISOString();
  const manifestResults = [];
  const manifestOutputs = [];
  const manifestTemperature = DEFAULT_TEMPERATURE;
  const manifestSeed = null;
  const responseCache = resolveResponseCache(parsed);

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
  if (parsed.card && mode !== 'rewrite' && mode !== 'ouroboros') {
    throw inputError(
      '--card can only be used with rewrite or --ouroboros',
      'Share cards need before/after text, AI score, and meaning-preservation metadata.',
      'Run `patina --card card.svg draft.md` or `patina --ouroboros --card card.svg draft.md`.'
    );
  }
  if (parsed.card && parsed.batch) {
    throw inputError(
      '--card cannot be combined with --batch',
      'One output path cannot safely represent multiple input files.',
      'Run one input at a time, or omit --batch.'
    );
  }
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
  if (parsed.card && inputTexts.length !== 1) {
    throw inputError(
      '--card expects exactly one input',
      `Received ${inputTexts.length} inputs.`,
      'Run patina once per share card.'
    );
  }
  const cancellation = createCancellationController({ logger });

  cancellation.install();
  try {
    for (const { path, text } of inputTexts) {
      cancellation.throwIfCanceled();
      const manifestCalls = [];
      const recordManifestCall = parsed.saveRun ? createManifestCallRecorder(manifestCalls) : null;
      const trackedCallLLM = (parsed.saveRun || responseCache)
        ? (args) => callLLM({
          ...args,
          cache: responseCache,
          onResponse: (metadata) => {
            args.onResponse?.(metadata);
            recordManifestCall?.(metadata);
          },
        })
        : undefined;
      const prompt = buildPrompt({
        config,
        patterns,
        profile: profile.body ? profile : null,
        voice: voice.body ? voice : null,
        voiceSample,
        scoring: scoring.body ? scoring : null,
        text,
        mode,
        tone: toneResolution,
        promptMode: resolvePromptMode(
          resolveConfiguredPromptMode({
            cliPromptMode: parsed.promptMode,
            configPromptMode: config['prompt-mode'],
            isMaxMode: Boolean(parsed.models),
          }),
          { backend: parsed.backend ?? config.backend, model: resolved.model }
        ),
        variants: parsed.variants || 1,
      });

      let result;
      let shareCardCallLLM = trackedCallLLM;

      if (parsed.models) {
        result = await runMaxMode({
          prompt,
          sourceText: text,
          models: parsed.models,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          config,
          patterns,
          maxConcurrency: parsed.maxConcurrency,
          wallClockBudgetMs: parsed.maxTimeoutSeconds === undefined ? undefined : parsed.maxTimeoutSeconds * 1000,
          callLLM: trackedCallLLM,
          signal: cancellation.signal,
          logger,
        });
      } else if (parsed.ouroboros) {
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
          callLLM: trackedCallLLM,
          signal: cancellation.signal,
          logger,
        });
      } else {
        const { backends, autoSelected, reason } = selectBackendChain({
          name: parsed.backend ?? config.backend,
          model: resolved.model,
        });
        const backend = backends[0];
        shareCardCallLLM = (callArgs) => invokeBackendChain({
          backends,
          prompt: callArgs.prompt,
          apiKey: callArgs.apiKey ?? resolved.apiKey,
          baseURL: callArgs.baseURL ?? resolved.baseURL,
          model: callArgs.model ?? resolved.model,
          signal: callArgs.signal ?? cancellation.signal,
          temperature: callArgs.temperature,
          seed: manifestSeed,
          onResponse: recordManifestCall,
          cache: responseCache,
          logger,
        });

        if (autoSelected) {
          logger.info('backend.selected', {
            message: `[patina] Using ${backend.name} backend (${reason}). Run \`patina auth status\` for details.`,
          });
        }
        if (backends.length > 1) {
          logger.info('backend.chain', {
            message: `[patina] Backend fallback chain: ${backends.map((b) => b.name).join(' → ')}`,
          });
        }

        if (mode === 'score') {
          maybeWarnJudgeOverlap({
            suspectedGenerator: parsed.suspectedGenerator,
            backendName: backend.name,
            model: resolved.model,
            providerName: provider?.name,
            logger,
          });
        }

        if (backend.name === 'openai-http' && !resolved.apiKey) {
          const msg = ['No API key found. Set PATINA_API_KEY, PATINA_API_KEY_FILE, OPENAI_API_KEY, or pass --api-key.'];
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

        result = await invokeBackendChain({
          backends,
          prompt,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          model: resolved.model,
          modelSource: resolved.modelSource,
          signal: cancellation.signal,
          temperature: manifestTemperature,
          seed: manifestSeed,
          onResponse: recordManifestCall,
          cache: responseCache,
          logger,
        });
      }
      cancellation.throwIfCanceled();

      if (mode === 'score' && !parsed.models && !parsed.ouroboros) {
        result = withDeterministicScore(result, {
          text,
          config,
          repoRoot,
          logger,
        });
      }

      const auditBackstop =
        mode === 'audit' && (parsed.format ?? 'markdown') !== 'json' && !parsed.batch
          ? buildDeterministicAuditBackstop(text, { lang, repoRoot })
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

      if (result?.type === 'max-mode' && (result.allFailed || result.mpsFallback)) {
        process.exitCode = Math.max(Number(process.exitCode) || 0, 4);
      }

      if (parsed.card) {
        const cardPayload = await buildShareCardPayload({
          mode,
          sourceText: text,
          output,
          result,
          lang,
          config,
          patterns,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          model: resolved.model,
          callLLM: shareCardCallLLM,
          signal: cancellation.signal,
          logger,
        });
        const cardPath = writeShareCard(parsed.card, cardPayload);
        logger.info('share_card.written', { message: `[patina] wrote share card to ${cardPath}` });
      }

      if (parsed.saveRun) {
        const idx = manifestResults.length + 1;
        const outputName = `output-${idx}.txt`;
        appendResult(manifestResults, {
          inputPath: path,
          prompt,
          response: manifestResponseText(result, output),
          outputRef: { kind: 'file', name: outputName },
          tokensIn: sumManifestCalls(manifestCalls, 'tokensIn'),
          tokensOut: sumManifestCalls(manifestCalls, 'tokensOut'),
          temperature: manifestTemperature,
          seed: manifestSeed,
          cost: sumManifestCallCost(manifestCalls),
          scores: manifestScoreDetails(result),
          iterationLog: manifestIterationLog(result),
          calls: manifestCalls.length > 0 ? manifestCalls : undefined,
        });
        manifestOutputs.push({ name: outputName, content: output });
      }

      if (parsed.batch) {
        await writeBatchOutput(parsed, path, output);
      } else {
        console.log(output);
      }
    }

    if (responseCache) {
      logger.info('cache.stats', { message: formatCacheStats(responseCache.stats) });
    }
  } catch (err) {
    if (cancellation.signal.aborted) throw cancellationError();
    throw err;
  } finally {
    cancellation.cleanup();
    logger.closeProgress();
  }

  if (parsed.saveRun) {
    const manifest = buildManifest({
      patinaVersion: PACKAGE_VERSION,
      mode,
      lang,
      profile: profileName,
      provider: provider?.name,
      backend: parsed.backend ?? config.backend ?? 'openai-http',
      model: resolved.model,
      configPath: configPath ?? null,
      config,
      patterns,
      results: manifestResults,
      startedAt,
      temperature: manifestTemperature,
      seed: manifestSeed,
    });
    const manifestPath = writeManifest(
      resolve(process.cwd(), parsed.saveRun),
      manifest,
      manifestOutputs
    );
    logger.info('manifest.written', { message: `[patina] wrote manifest to ${manifestPath}` });
  }

  maybeShowFirstRunNudge({
    parsed,
    inputTexts,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stderr: process.stderr,
    stdout: process.stdout,
    processObj: process,
  });
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
      case '--suspected-generator':
        parsed.suspectedGenerator = readOptionValue(args, i, arg);
        i++;
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
      case '--json':
        parsed.format = 'json';
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--json-logs':
        parsed.jsonLogs = true;
        break;
      case '--card':
        parsed.card = readOptionValue(args, i, arg);
        i++;
        break;
      case '--gate': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw inputError(
            '--gate expects a number from 0 to 100',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `patina --score --gate 30 <file>` for CI gates.'
          );
        }
        parsed.gate = n;
        parsed.gateOption = '--gate';
        break;
      }
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
        parsed.gateOption = '--exit-on';
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
      case '--models':
        parsed.models = readOptionValue(args, i, arg)
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);
        i++;
        if (parsed.models.length === 0) {
          throw inputError(
            '--models expects at least one model id',
            'The comma-separated model list was empty.',
            'Use `--models gpt-4o,claude-3-5-sonnet`.'
          );
        }
        break;
      case '--max-concurrency': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw inputError(
            '--max-concurrency expects a non-negative integer',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `--max-concurrency 2`, omit it for the safe default, or pass 0 for unlimited concurrency.'
          );
        }
        parsed.maxConcurrency = n;
        break;
      }
      case '--max-timeout': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          throw inputError(
            '--max-timeout expects a positive number of seconds',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `--max-timeout 300`, or omit it for the default 300 seconds.'
          );
        }
        parsed.maxTimeoutSeconds = n;
        break;
      }
      case '--model':
        parsed.model = readOptionValue(args, i, arg);
        i++;
        break;
      case '--api-key':
        parsed.apiKey = readOptionValue(args, i, arg);
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
      case '--list-backends':
        parsed.listBackends = true;
        break;
      case '--provider':
        parsed.provider = readOptionValue(args, i, arg);
        i++;
        break;
      case '--list-providers':
        parsed.listProviders = true;
        break;
      case '--allow-insecure-base-url':
        parsed.allowInsecureBaseURL = true;
        break;
      case '--config':
        parsed.config = readOptionValue(args, i, arg);
        i++;
        break;
      case '--save-run':
        parsed.saveRun = readOptionValue(args, i, arg);
        i++;
        break;
      case '--cache':
        parsed.cacheDir = readOptionValue(args, i, arg);
        i++;
        break;
      case '--cache-ttl': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          throw inputError(
            '--cache-ttl expects a positive number of seconds',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `--cache-ttl 86400` for a one-day response cache.'
          );
        }
        parsed.cacheTtlSeconds = n;
        break;
      }
      case '--no-cache':
        parsed.noCache = true;
        break;
      case '--prompt-mode': {
        const m = readOptionValue(args, i, arg);
        i++;
        if (!m || !['strict', 'minimal', 'auto'].includes(m)) {
          throw inputError(
            '--prompt-mode expects strict, minimal, or auto',
            `Received ${m === undefined ? 'no value' : `"${m}"`}.`,
            'Use `--prompt-mode auto` unless you need a specific prompt style.'
          );
        }
        parsed.promptMode = m;
        break;
      }
      case '--variants': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          throw inputError(
            '--variants expects an integer from 1 to 5',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `--variants 2` for alternate rewrite drafts.'
          );
        }
        parsed.variants = n;
        break;
      }
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

// v3.11: case-05 found that prompt-mode preference is per-backend.
// auto resolves to strict for codex-cli/claude (instruction-rich) and
// minimal for gemini (voice-rich, over-constrained by long prompts).
// Explicit strict/minimal pass through unchanged.
/**
 * Resolve the effective prompt style for backend/model auto mode.
 *
 * @param {string} mode Requested prompt mode: auto, strict, or minimal.
 * @param {object} context Backend selection context.
 * @param {string} [context.backend] Backend name.
 * @param {string} [context.model] Model id.
 * @returns {string} Resolved prompt mode.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const mode = resolvePromptMode('auto', { model: 'gemini-2.5-flash' });
 */
export function resolvePromptMode(mode, { backend, model }) {
  if (mode !== 'auto') return mode;
  const backendStr = (backend || '').toLowerCase();
  const modelStr = (model || '').toLowerCase();
  if (backendStr.includes('gemini') || modelStr.includes('gemini')) return 'minimal';
  if (modelStr.includes('claude')) return 'strict';
  // Default for codex-cli, openai-http with gpt-* models, and anything we
  // can't classify — strict is the conservative choice (full pattern packs).
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

/**
 * Choose the configured prompt mode before backend/model auto-resolution.
 *
 * @param {object} [options] Prompt-mode sources.
 * @param {string} [options.cliPromptMode] CLI --prompt-mode value.
 * @param {string} [options.configPromptMode] Config prompt-mode value.
 * @param {boolean} [options.isMaxMode=false] Whether MAX mode is active.
 * @returns {string} Requested prompt mode.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const requested = resolveConfiguredPromptMode({ isMaxMode: true });
 */
export function resolveConfiguredPromptMode({ cliPromptMode, configPromptMode, isMaxMode = false } = {}) {
  return cliPromptMode || configPromptMode || (isMaxMode ? 'minimal' : 'strict');
}

// Resolve the API key, preferring file-based sources to keep the secret out
// of argv and shell history (CWE-214). Precedence: --api-key-file >
// PATINA_API_KEY_FILE > --api-key (with deprecation warning) > provider/default
// env vars.
function resolveApiKey(parsed, provider, logger = createLogger()) {
  const hasApiKeyFile = Boolean(parsed.apiKeyFile || process.env.PATINA_API_KEY_FILE);
  const apiKey = resolveHttpApiKey({
    explicitApiKey: parsed.apiKey,
    apiKeyFile: parsed.apiKeyFile,
    envVars: providerHttpKeyEnvVars(provider?.apiKeyEnv),
  });
  if (hasApiKeyFile && parsed.apiKey) {
    logger.warn('auth.api_key_file_precedence', {
      message: '[patina] both --api-key-file and --api-key were provided; using --api-key-file',
    });
  }
  if (parsed.apiKey && !hasApiKeyFile) {
    logger.warn('auth.argv_secret_warning', {
      message: '[patina] warning: --api-key exposes the secret in shell history and `ps` output.\n' +
        '         Prefer PATINA_API_KEY env var, --api-key-file <path>, or PATINA_API_KEY_FILE.',
    });
  }
  return apiKey;
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

async function buildShareCardPayload({
  mode,
  sourceText,
  output,
  result,
  lang,
  config,
  patterns,
  apiKey,
  baseURL,
  model,
  callLLM,
  signal,
  logger,
}) {
  const after = resolveShareCardAfterText({ mode, output, result, logger });
  const metrics = existingShareCardMetrics({ mode, result, sourceText, after });

  if (result?.type === 'max-mode' && !result.best) {
    return { before: sourceText, after, aiScore: null, mps: null, lang };
  }

  if (metrics.aiScore !== null && metrics.mps !== null) {
    return { before: sourceText, after, aiScore: metrics.aiScore, mps: metrics.mps, lang };
  }

  const [aiScoreResult, mpsResult] = await Promise.all([
    metrics.aiScore === null
      ? scoreText({
        text: after,
        config,
        patterns,
        apiKey,
        baseURL,
        model,
        callLLM,
        signal,
        logger,
      })
      : Promise.resolve({ overall: metrics.aiScore }),
    metrics.mps === null
      ? scoreMPS({
        original: sourceText,
        rewritten: after,
        apiKey,
        baseURL,
        model,
        callLLM,
        signal,
        logger,
      })
      : Promise.resolve({ mps: metrics.mps }),
  ]);

  return {
    before: sourceText,
    after,
    aiScore: toFiniteNumber(aiScoreResult?.overall),
    mps: toFiniteNumber(mpsResult?.mps),
    lang,
  };
}

function resolveShareCardAfterText({ mode, output, result, logger }) {
  if (result?.type === 'max-mode') {
    return cleanShareCardText(result.best?.result || output);
  }
  if (mode === 'ouroboros') {
    return cleanShareCardText(result?.finalText || output);
  }
  return cleanShareCardText(formatOutput(result, mode, { format: 'text' }, { logger }));
}

function existingShareCardMetrics({ mode, result, sourceText, after }) {
  if (result?.type === 'max-mode') {
    return {
      aiScore: toFiniteNumber(result.best?.aiScore),
      mps: toFiniteNumber(result.best?.mps),
    };
  }
  if (mode === 'ouroboros') {
    const aiScore = toFiniteNumber(result?.finalScore);
    const mps = latestOuroborosMps(result?.log) ?? (sourceText.trim() === after.trim() ? 100 : null);
    return { aiScore, mps };
  }
  return { aiScore: null, mps: null };
}

function latestOuroborosMps(log) {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const mps = toFiniteNumber(log[i]?.mps);
    if (mps !== null) return mps;
  }
  return null;
}

function cleanShareCardText(output) {
  return String(output || '')
    .replace(/\n---\s*\ntone:[\s\S]*?\n---\s*$/u, '')
    .trim();
}

function writeShareCard(cardPath, payload) {
  const outPath = resolve(process.cwd(), cardPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderShareCard(payload), 'utf8');
  return outPath;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
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
  patina init             Create a project .patina.yaml
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
  --gate <n>              With --score, exit 3 when overall score > n
  --exit-on <n>           Alias for --gate, intended for CI scripts
  --suspected-generator <family>
                          Warn when score judge matches source model family
  --ouroboros             Iterative self-improvement loop

OUTPUT & BATCH
  --format <fmt>          Output format: markdown (default), text, json
  --json                  Alias for --format json
  --quiet                 Suppress patina status/warning logs on stderr
  --json-logs             Emit stderr logs as NDJSON objects
  --card <path>           Write a 1200x630 SVG before/after + score share card
  --batch                 Process multiple files
  --in-place              Overwrite original files (with --batch)
  --suffix <ext>          Save as {name}{ext}{extname}
  --outdir <dir>          Save results to directory
  --save-run <dir>        Write manifest.json + output-N.txt for reproducibility
  --cache <dir>           Opt into persistent HTTP response cache
  --cache-ttl <sec>       Cache TTL in seconds (default: ${DEFAULT_CACHE_TTL_SECONDS})
  --no-cache              Bypass PATINA_CACHE_DIR / --cache for a fresh run
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
  --model <id>            Single model ID (default: gpt-4o). Only affects
                          gemini-cli and the HTTP provider path; claude-cli
                          and codex-cli use their logged-in session model.
  --api-key <key>         API key (DEPRECATED: leaks via ps/shell history; prefer
                          PATINA_API_KEY env or --api-key-file)
  --api-key-file <path>   Read API key from file (recommended)
  --base-url <url>        API base URL (or PATINA_API_BASE env)
  --backend <name[,name]> Backend or explicit fallback chain:
                          ${backendChoices} (default: openai-http)
  --list-backends         List available backends and their availability
  --provider <name>       Provider preset: openai, gemini, groq, together
  --list-providers        List provider presets and which keys are set
  --models <list>         MAX mode: comma-separated model/backend list
                          (HTTP IDs, or claude/codex/gemini CLI aliases)
  --max-concurrency <n>   Cap parallel MAX-mode candidates (default: min(models, 3);
                          use 0 for unlimited, which can hit free-tier quotas)
  --max-timeout <sec>     Wall-clock budget for standalone MAX mode (default: 300)

ADVANCED
  --variants <n>          Generate N rewrite variants (1-5; rewrite mode only)
  --config <path>         Load config from <path> instead of .patina.default.yaml
  --prompt-mode <m>       strict | minimal | auto. auto picks per backend.
                          MAX defaults to minimal; auto resolves once before dispatch.
  --allow-insecure-base-url  Permit plaintext http:// to non-localhost endpoints
  --allow-private-base-url   Permit private/IMDS base URLs
  -h, --help              Show this help message
  -v, --version           Show version

EXAMPLES
  echo "This is a draft." | patina --lang en --backend codex-cli
  patina --score --exit-on 30 --format json draft.md
  patina init --defaults
  patina doctor --json

ENVIRONMENT
  PATINA_API_KEY, PATINA_API_KEY_FILE, PATINA_API_BASE, PATINA_MODEL
  PATINA_CACHE_DIR, PATINA_CACHE_TTL_SECONDS
  PATINA_NO_NUDGE=1 disables the one-time interactive star reminder
  OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY

EXIT CODES
  0 success · 1 runtime/backend · 2 input/usage · 3 score gate exceeded · 4 MAX MPS fallback/all candidates failed · 130 interrupted

If no API key is set, pass --backend codex-cli to use a logged-in codex CLI
(no key required). Auto-fallback was removed in v3.9 to keep agent-mode
backends opt-in (issue #88).
`);
}

function withDeterministicScore(rawResult, { text, config, repoRoot, logger }) {
  const deterministicScore = scoreDeterministicSignals({ text, config, repoRoot });
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

function manifestScoreDetails(result) {
  if (!result || typeof result !== 'object') return null;
  if (!result.llmScore && !result.deterministicScore && !result.scorePreference) return null;
  return {
    llm: result.llmScore ?? null,
    deterministic: result.deterministicScore ?? null,
    preference: result.scorePreference ?? null,
  };
}

function resolveResponseCache(parsed) {
  if (parsed.noCache) return null;
  const dir = parsed.cacheDir ?? process.env.PATINA_CACHE_DIR;
  if (!dir) return null;

  const ttlSeconds =
    parsed.cacheTtlSeconds ??
    parseOptionalPositiveNumber(process.env.PATINA_CACHE_TTL_SECONDS, 'PATINA_CACHE_TTL_SECONDS') ??
    DEFAULT_CACHE_TTL_SECONDS;

  return createResponseCache({
    dir: resolve(process.cwd(), dir),
    ttlSeconds,
  });
}

function parseOptionalPositiveNumber(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw inputError(
      `${name} expects a positive number of seconds`,
      `Received "${value}".`,
      `Set ${name}=86400 or omit it for the default.`
    );
  }
  return n;
}

function formatCacheStats(stats) {
  const expired = stats.expired ? `, expired ${stats.expired}` : '';
  const errors = stats.errors ? `, errors ${stats.errors}` : '';
  return `[patina] cache hits ${stats.hits}, misses ${stats.misses}, writes ${stats.writes}${expired}${errors}`;
}

function createManifestCallRecorder(calls) {
  return (metadata = {}) => {
    calls.push({
      provider: metadata.provider ?? null,
      model: metadata.model ?? null,
      requestedModel: metadata.requestedModel ?? null,
      temperature: metadata.temperature ?? null,
      seed: metadata.seed ?? null,
      responseHash: hashSha256(metadata.content),
      tokensIn: extractUsageToken(metadata.usage, ['prompt_tokens', 'input_tokens', 'tokens_in']),
      tokensOut: extractUsageToken(metadata.usage, ['completion_tokens', 'output_tokens', 'tokens_out']),
      cost: extractResponseCost(metadata.rawResponse, metadata.usage),
      cache: metadata.cache ?? null,
    });
  };
}

function extractUsageToken(usage, keys) {
  if (!usage || typeof usage !== 'object') return null;
  for (const key of keys) {
    const value = Number(usage[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function extractResponseCost(rawResponse, fallbackUsage) {
  const usage = rawResponse?.usage && typeof rawResponse.usage === 'object'
    ? rawResponse.usage
    : (fallbackUsage && typeof fallbackUsage === 'object' ? fallbackUsage : {});
  const candidates = [
    ['usage.cost_usd', usage.cost_usd, 'USD'],
    ['usage.total_cost_usd', usage.total_cost_usd, 'USD'],
    ['usage.cost', usage.cost, usage.currency],
    ['usage.total_cost', usage.total_cost, usage.currency],
    ['cost_usd', rawResponse?.cost_usd, 'USD'],
    ['cost', rawResponse?.cost, rawResponse?.currency],
  ];

  for (const [source, value, currency] of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return {
        amount,
        currency: currency || 'USD',
        source,
      };
    }
  }
  return null;
}

function manifestResponseText(result, output) {
  if (result?.type === 'max-mode') return result.best?.result ?? output;
  if (typeof result?.finalText === 'string') return result.finalText;
  if (typeof result?.raw === 'string') return result.raw;
  if (typeof result === 'string') return result;
  return output;
}

function manifestIterationLog(result) {
  return Array.isArray(result?.log) ? result.log : null;
}

function sumManifestCalls(calls, key) {
  const values = calls
    .map((call) => call[key])
    .filter((value) => value !== null && value !== undefined)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function sumManifestCallCost(calls) {
  const costs = calls
    .map((call) => call.cost)
    .filter((cost) => cost && Number.isFinite(Number(cost.amount)));
  if (costs.length === 0) return null;

  const currency = costs[0].currency || 'USD';
  if (!costs.every((cost) => (cost.currency || 'USD') === currency)) return null;
  return {
    amount: costs.reduce((sum, cost) => sum + Number(cost.amount), 0),
    currency,
    source: 'sum',
  };
}

function applyScoreGate(result, output, gate, logger = createLogger()) {
  const overall = extractScoreOverall(result, output);
  if (overall === null) {
    throw new Error('--gate could not find a numeric `overall` value in --score output.');
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
    available: b.available ? 'yes' : 'no',
    authenticated: b.authenticated ? 'yes' : 'no',
    note: b.authenticated ? '' : b.authHint,
  }));
  const widths = {
    name: Math.max('Backend'.length, ...rows.map((r) => r.name.length)),
    available: Math.max('Available'.length, ...rows.map((r) => r.available.length)),
    authenticated: Math.max('Authenticated'.length, ...rows.map((r) => r.authenticated.length)),
  };
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('Backend', widths.name)}  ${pad('Available', widths.available)}  ${pad('Authenticated', widths.authenticated)}  Notes`
  );
  console.log(
    `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.available)}  ${'-'.repeat(widths.authenticated)}  -----`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.available, widths.available)}  ${pad(r.authenticated, widths.authenticated)}  ${r.note}`
    );
  }
}

function printProviderStatus() {
  const rows = Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    free: p.freeTier ? 'yes' : 'no',
    keySource: providerKeySource(p),
    providerEnv: process.env[p.apiKeyEnv] ? 'set' : 'missing',
    note: `${p.apiKeyEnv} → ${p.baseURL}`,
  }));
  const widths = {
    name: Math.max('Provider'.length, ...rows.map((r) => r.name.length)),
    free: Math.max('Free tier'.length, ...rows.map((r) => r.free.length)),
    keySource: Math.max('Key source'.length, ...rows.map((r) => r.keySource.length)),
    providerEnv: Math.max('Provider env'.length, ...rows.map((r) => r.providerEnv.length)),
  };
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('Provider', widths.name)}  ${pad('Free tier', widths.free)}  ${pad('Key source', widths.keySource)}  ${pad('Provider env', widths.providerEnv)}  Notes`
  );
  console.log(
    `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.free)}  ${'-'.repeat(widths.keySource)}  ${'-'.repeat(widths.providerEnv)}  -----`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.free, widths.free)}  ${pad(r.keySource, widths.keySource)}  ${pad(r.providerEnv, widths.providerEnv)}  ${r.note}`
    );
  }
}

function providerKeySource(provider) {
  const source = inspectHttpApiKeySource({
    envVars: providerHttpKeyEnvVars(provider.apiKeyEnv),
  });
  return source.ok ? source.source : 'missing';
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
