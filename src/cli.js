import { loadConfig, getRepoRoot, resolveTone } from './config.js';
import { loadPatterns, loadProfile, loadCoreFile, loadInputText, toneToBackboneProfile } from './loader.js';
import { buildPrompt } from './prompt-builder.js';
import { selectBackend, listBackends, listBackendNames } from './backends/index.js';
import { selectProvider, resolveProviderConfig, PROVIDERS } from './providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from './security.js';
import { formatOutput, validateScoreWeights } from './output.js';
import { runMaxMode } from './max-mode.js';
import { runOuroboros } from './ouroboros.js';
import { buildManifest, appendResult, writeManifest } from './manifest.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { PatinaCliError, inputError, runtimeError, renderCliError, getExitCode } from './errors.js';
import { inspectHttpApiKeySource, providerHttpKeyEnvVars, resolveHttpApiKey } from './auth.js';
import { createLogger } from './logger.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(getRepoRoot(), 'package.json'), 'utf8')
).version;

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

  const patterns = loadPatterns(repoRoot, lang, config['skip-patterns'] || []);
  const profile = loadProfile(repoRoot, profileName);
  const voice = loadCoreFile(repoRoot, 'voice.md');
  const scoring = loadCoreFile(repoRoot, 'scoring.md');

  const mode = parsed.diff ? 'diff'
    : parsed.audit ? 'audit'
    : parsed.score ? 'score'
    : parsed.ouroboros ? 'ouroboros'
    : 'rewrite';

  const inputTexts = await loadInputs(parsed, logger);
  const cancellation = createCancellationController({ logger });

  cancellation.install();
  try {
    for (const { path, text } of inputTexts) {
      cancellation.throwIfCanceled();
      const prompt = buildPrompt({
        config,
        patterns,
        profile: profile.body ? profile : null,
        voice: voice.body ? voice : null,
        scoring: scoring.body ? scoring : null,
        text,
        mode,
        tone: toneResolution,
        promptMode: resolvePromptMode(
          parsed.promptMode || config['prompt-mode'] || 'strict',
          { backend: parsed.backend ?? config.backend, model: resolved.model }
        ),
        variants: parsed.variants || 1,
      });

      let result;

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
          signal: cancellation.signal,
          logger,
        });
      } else if (parsed.ouroboros) {
        result = await runOuroboros({
          config,
          patterns,
          profile: profile.body ? profile : null,
          voice: voice.body ? voice : null,
          scoring: scoring.body ? scoring : null,
          text,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          model: resolved.model,
          signal: cancellation.signal,
          logger,
        });
      } else {
        const { backend, autoSelected, reason } = selectBackend({
          name: parsed.backend ?? config.backend,
          model: resolved.model,
        });

        if (autoSelected) {
          logger.info('backend.selected', {
            message: `[patina] Using ${backend.name} backend (${reason}). Run \`patina auth status\` for details.`,
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

        result = await backend.invoke({
          prompt,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          model: resolved.model,
          signal: cancellation.signal,
        });
      }
      cancellation.throwIfCanceled();

      let output;
      let scoreValidationOutput = null;
      if (parsed.ouroboros) {
        const ouroborosBody = formatOuroborosOutput(result);
        output = formatOutput(ouroborosBody, mode, parsed, { tone: toneResolution, logger });
        scoreValidationOutput = ouroborosBody;
      } else {
        output = formatOutput(result, mode, parsed, { tone: toneResolution, logger });
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

      if (parsed.saveRun) {
        const idx = manifestResults.length + 1;
        const outputName = `output-${idx}.txt`;
        appendResult(manifestResults, {
          inputPath: path,
          prompt,
          outputRef: { kind: 'file', name: outputName },
        });
        manifestOutputs.push({ name: outputName, content: output });
      }

      if (parsed.batch) {
        await writeBatchOutput(parsed, path, output);
      } else {
        console.log(output);
      }
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
    });
    const manifestPath = writeManifest(
      resolve(process.cwd(), parsed.saveRun),
      manifest,
      manifestOutputs
    );
    logger.info('manifest.written', { message: `[patina] wrote manifest to ${manifestPath}` });
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
      case '--json':
        parsed.format = 'json';
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--json-logs':
        parsed.jsonLogs = true;
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

MODES
  --diff                  Show changes pattern by pattern
  --no-color              Disable ANSI colors in --diff output
  --audit                 Detect patterns only (no rewrite)
  --score                 Output AI-likeness score (0-100)
  --gate <n>              With --score, exit 3 when overall score > n
  --exit-on <n>           Alias for --gate, intended for CI scripts
  --ouroboros             Iterative self-improvement loop

OUTPUT & BATCH
  --format <fmt>          Output format: markdown (default), text, json
  --json                  Alias for --format json
  --quiet                 Suppress patina status/warning logs on stderr
  --json-logs             Emit stderr logs as NDJSON objects
  --batch                 Process multiple files
  --in-place              Overwrite original files (with --batch)
  --suffix <ext>          Save as {name}{ext}{extname}
  --outdir <dir>          Save results to directory
  --save-run <dir>        Write manifest.json + output-N.txt for reproducibility
  --no-interactive        Do not wait for TTY stdin; exit 2 when no input is given

LANGUAGE & PROFILE
  --lang <code>           Language: ko, en, zh, ja (default: ko)
  --profile <name>        Profile: default, blog, academic, technical, formal,
                          social, email, legal, medical, marketing,
                          narrative, instructional
  --tone <name>           Tone: casual, professional, academic, narrative,
                          marketing, instructional, auto. Resolution:
                          --tone > config tone > config profile.

MODEL & AUTH
  --model <id>            Single model ID (default: gpt-4o)
  --api-key <key>         API key (DEPRECATED: leaks via ps/shell history; prefer
                          PATINA_API_KEY env or --api-key-file)
  --api-key-file <path>   Read API key from file (recommended)
  --base-url <url>        API base URL (or PATINA_API_BASE env)
  --backend <name>        Backend: ${backendChoices} (default: openai-http)
  --list-backends         List available backends and their availability
  --provider <name>       Provider preset: openai, gemini, groq, together
  --list-providers        List provider presets and which keys are set
  --models <list>         MAX mode: comma-separated model list
  --max-concurrency <n>   Cap parallel MAX-mode requests (default: min(models, 3);
                          use 0 for unlimited, which can hit free-tier quotas)
  --max-timeout <sec>     Wall-clock budget for standalone MAX mode (default: 300)

ADVANCED
  --variants <n>          Generate N rewrite variants (1-5; rewrite mode only)
  --config <path>         Load config from <path> instead of .patina.default.yaml
  --prompt-mode <m>       strict | minimal | auto. auto picks per backend.
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
  OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY

EXIT CODES
  0 success · 1 runtime/backend · 2 input/usage · 3 score gate exceeded · 4 MAX MPS fallback/all candidates failed · 130 interrupted

If no API key is set, pass --backend codex-cli to use a logged-in codex CLI
(no key required). Auto-fallback was removed in v3.9 to keep agent-mode
backends opt-in (issue #88).
`);
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

  const match = text.match(/(?:^|[\s|{,"])overall(?:["\s]*[:|]|\s+score\s*[:|]?)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return Number(match[1]);
}

function toFiniteScore(value) {
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

function handleAuth(subArgs) {
  const sub = subArgs[0] || 'status';
  if (sub === 'status') {
    printBackendStatus();
    return;
  }
  if (sub === 'login') {
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
    'Try `patina auth status` or `patina auth login`.'
  );
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
