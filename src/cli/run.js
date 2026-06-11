import { loadConfig, getRepoRoot, resolveTone } from '../config.js';
import {
  loadPatterns,
  loadProfile,
  loadCoreFile,
  loadVoiceSample,
  toneToBackboneProfile,
} from '../loader.js';
import { buildPrompt } from '../prompt-builder.js';
import { invokeBackendChain, selectBackendChain, listBackends } from '../backends/index.js';
import { selectProvider, resolveProviderConfig } from '../providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from '../security.js';
import { formatOutput, formatRewriteBodyForBrowser, validateScoreWeights, buildDeterministicAuditBackstop } from '../output.js';
import {
  buildBrowserDiffPromptInput,
  renderBrowserDiffHtml,
  writeBrowserDiffPage,
  openBrowserDiffPage,
} from '../browser-diff.js';
import { runOuroboros } from '../ouroboros.js';
import { interpretScore, reconcileScoreOverall, scoreDeterministicSignals } from '../scoring.js';
import { logBatchSafetyPlan, createBatchCircuitBreaker, shouldHandleBatchFailure, writeBatchOutput } from './batch.js';
import { applyScoreGate, extractScoreOverall } from './score-gate.js';
import { loadInputs } from './input.js';
import { PatinaCliError, runtimeError } from '../errors.js';
import { providerHttpKeyEnvVars, resolveHttpApiKey } from '../auth.js';
import { DEFAULT_BACKEND_TIMEOUT_MS, getBackendSafety } from '../backends/contract.js';
import { resolve } from 'node:path';

/**
 * Run the default patina pipeline for an already-parsed CLI invocation:
 * resolve config, provider, and backends, build prompts, then process each
 * input job (rewrite/diff/audit/score/ouroboros, plus the browser-diff page).
 *
 * @param {object} parsed Parsed CLI arguments from parseArgs.
 * @param {object} logger Patina logger for this invocation.
 * @returns {Promise<void>} Resolves after all job output is written.
 * @throws {Error} For validation, provider, file, or runtime failures.
 */
export async function runDefault(parsed, logger) {
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
            // Always surface the path: a headless opener can exit 0 without
            // showing anything, leaving the user with no way to find the page.
            console.error(`[patina] Browser diff page saved at ${browserPagePath}`);
            try {
              await openBrowserDiffPage(browserPagePath);
            } catch (err) {
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
 * @returns {{signal: AbortSignal, install: Function, cleanup: Function, throwIfCanceled: Function}} Controller facade.
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
