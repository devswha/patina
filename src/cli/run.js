import { loadConfig, getRepoRoot, resolveTone } from '../config.js';
import {
  loadPatterns,
  loadProfile,
  loadCoreFile,
  loadVoiceSample,
  toneToBackboneProfile,
} from '../loader.js';
import { buildPrompt } from '../prompt-builder.js';
import { buildTransformVariants } from './args.js';
import { invokeBackendChain, selectBackendChain, selectOcrBackends, listBackends } from '../backends/index.js';
import { selectProvider, resolveProviderConfig } from '../providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from '../security.js';
import { formatOutput, formatRewriteBodyForBrowser, validateScoreWeights, buildDeterministicAuditBackstop } from '../output.js';
import {
  buildBrowserDiffPromptInput,
  renderExplanationHtml,
  writeBrowserDiffPage,
  openBrowserDiffPage,
  serveBrowserDiffPage,
} from '../browser-diff.js';
import { fetchPreviewPage, prepareSnapshotHtml, freezeSnapshotAssets, extractProseBlocks, alignRewrites, buildPreviewHtml, buildContextCardHtml } from '../preview.js';
import { collectImageCandidates, stageOcrImages, ocrStagedImages, describeImage, hasOcrRunnerOverride } from '../ocr.js';
import { rmSync } from 'node:fs';
import { runOuroboros } from '../ouroboros.js';
import { interpretScore, reconcileScoreOverall, scoreDeterministicSignals } from '../scoring.js';
import { detectKoreanRegister } from '../features/stylometry.js';
import { logBatchSafetyPlan, createBatchCircuitBreaker, shouldHandleBatchFailure, writeBatchOutput } from './batch.js';
import { applyScoreGate, extractScoreOverall } from './score-gate.js';
import { loadInputs } from './input.js';
import { PatinaCliError, runtimeError } from '../errors.js';
import { providerHttpKeyEnvVars, resolveHttpApiKey } from '../auth.js';
import { DEFAULT_BACKEND_TIMEOUT_MS, getBackendSafety, backendSupportsStructuredOutput } from '../backends/contract.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Run the default patina pipeline for an already-parsed CLI invocation:
 * resolve config, provider, and backends, build prompts, then process each
 * input job (rewrite/diff/audit/score/ouroboros, plus the preview page).
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
  // --tone may carry a comma list for --preview variant comparison; the global
  // resolution (and the backbone-profile mapping below) follows the FIRST
  // tone, and the preview compare loop re-resolves per variant.
  const firstCliTone = typeof parsed.tone === 'string' ? parsed.tone.split(',')[0] : parsed.tone;
  const toneResolution = resolveTone({ cliTone: firstCliTone, configTone: config.tone, lang });
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

  const inputTexts = parsed.preview ? [] : await loadInputs(parsed, logger);
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

  if (parsed.preview) {
    await runPreviewJob({
      parsed,
      config,
      patterns,
      profile,
      voice,
      voiceSample,
      scoring,
      toneResolution,
      promptMode,
      backends,
      resolved,
      repoRoot,
      timeoutMs,
      logger,
    });
    return;
  }

  const jobs = inputTexts.map(({ path, text, readError }) => ({
    path,
    text,
    readError,
    // A read failure (#503) or ouroboros mode means there is no prompt to
    // build; the read error is replayed inside the per-file batch loop below.
    prompt: (readError || parsed.ouroboros) ? null : buildPrompt({
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
      documentSignals: mode === 'rewrite' ? buildDocumentSignals({ text, lang }).signals : null,
      restyle: parsed.restyle,
      jargon: parsed.jargon,
      rewriteHeadings: parsed.rewriteHeadings,
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
    for (const { path, text, prompt, readError } of jobs) {
      try {
        cancellation.throwIfCanceled();
        // Route a deferred batch read failure (#503) into the per-file catch so
        // it counts against the circuit breaker (batch) or rethrows (single).
        if (readError) throw readError;
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
            // Opt-in structured output for the openai-http scorer; default off.
            structuredOutput: config['structured-output'] === true && backendSupportsStructuredOutput('openai-http'),
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
        const auditBackstop =
          mode === 'audit' && (parsed.format ?? 'markdown') !== 'json' && !parsed.batch
            ? buildDeterministicAuditBackstop(text, { lang, repoRoot, config, logger })
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

        if (parsed.batch) {
          await writeBatchOutput(parsed, path, output);
        } else {
          console.log(output);
        }
        batchState.recordSuccess();
      } catch (err) {
        if (!shouldHandleBatchFailure(parsed, jobs.length)) throw err;
        // Ctrl-C is a run-level stop, not a per-file failure: after the abort,
        // every remaining iteration's throwIfCanceled() would otherwise be
        // recorded and logged as a spurious 'batch.file_failed' for files that
        // were never attempted (#440). The outer catch maps this to exit 130.
        if (cancellation.signal.aborted || err?.exitCode === 130) throw err;
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

async function runPreviewJob({
  parsed,
  config,
  patterns,
  profile,
  voice,
  voiceSample,
  scoring,
  toneResolution,
  promptMode,
  backends,
  resolved,
  repoRoot,
  timeoutMs,
  logger,
}) {
  const input = parsed.files[0];
  const isUrl = /^https?:\/\//i.test(String(input));
  const cancellation = createCancellationController({ logger });
  cancellation.install();
  try {
    let pageHtml = null;
    let blocks = null;
    let sourceUrl = null;
    let sourcePath = input;
    let originalText;
    let snapshotSource = null;

    if (isUrl) {
      logger.info('preview.fetch', { message: `[patina] Fetching ${input}` });
      let page;
      try {
        page = await fetchPreviewPage(input, { signal: cancellation.signal, timeoutMs });
      } catch (err) {
        throw runtimeError(
          'could not fetch the preview page',
          `${input}: ${err?.message || 'fetch failed'}`,
          'Check the URL is reachable from this machine, or save the page HTML to a file and run `patina --preview file.html`.'
        );
      }
      cancellation.throwIfCanceled();
      snapshotSource = page.html;
      sourceUrl = page.finalUrl;
    } else {
      const [loaded] = await loadInputs(parsed, logger);
      sourcePath = loaded.path;
      // Local files are validated to .html upstream and use the same
      // snapshot pipeline as a fetched page.
      snapshotSource = loaded.text;
      sourceUrl = pathToFileURL(resolve(process.cwd(), sourcePath)).href;
    }

    if (snapshotSource !== null) {
      pageHtml = prepareSnapshotHtml(snapshotSource);
      if (isUrl) {
        // Must happen before extraction: inlining changes offsets, and the
        // in-place swap later relies on the block offsets captured here.
        pageHtml = await freezeSnapshotAssets(pageHtml, {
          baseUrl: sourceUrl,
          signal: cancellation.signal,
          logger,
        });
        cancellation.throwIfCanceled();
      }
      const extracted = extractProseBlocks(pageHtml);
      blocks = extracted.blocks;
      // With --ocr, a page whose copy lives entirely in images has no DOM
      // prose but is exactly the case OCR exists for — defer the no-prose
      // error until after OCR has had a chance to find image text.
      if (blocks.length === 0 && !parsed.ocr) {
        throw runtimeError(
          'no prose found on the page',
          'The page has no plain-text prose blocks patina can rewrite in place (often a client-rendered SPA, or text split by inline markup).',
          'Try a server-rendered page, save the article text to a file, or add --ocr to scan image text.'
        );
      }
      if (extracted.truncated) {
        logger.warn('preview.truncated', {
          message: '[patina] Page has more prose blocks than the preview limit; extra blocks are left unchanged.',
        });
      }
      originalText = blocks.map((block) => block.text).join('\n\n');
      if (blocks.length > 0) {
        logger.info('preview.blocks', {
          message: `[patina] Rewriting ${blocks.length} prose block(s) from ${sourceUrl}`,
        });
      }
    }

    const basePromptInputs = {
      config,
      patterns,
      profile: profile.body ? profile : null,
      voice: voice.body ? voice : null,
      voiceSample,
      scoring: scoring.body ? scoring : null,
      tone: toneResolution,
      promptMode,
      restyle: parsed.restyle,
      jargon: parsed.jargon,
      rewriteHeadings: parsed.rewriteHeadings,
    };
    const invokeInputs = {
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
    };

    // --ocr: extract text from page images and let it ride the same rewrite
    // call as extra paragraph blocks. Image text cannot be swapped back into
    // pixels, so changed findings render as annotations + notes cards.
    let ocrImages = [];
    if (parsed.ocr) {
      if (pageHtml === null) {
        logger.warn('ocr.skipped', {
          message: '[patina] --ocr applies to URL/.html previews; plain-text input has no images.',
        });
      } else {
        ocrImages = await runOcrStage({
          pageHtml,
          sourceUrl,
          parsed,
          backends,
          resolved,
          timeoutMs,
          cancellation,
          logger,
        });
      }
    }

    // A page with no DOM prose AND no image text has nothing to rewrite.
    if (blocks !== null && blocks.length === 0 && ocrImages.length === 0) {
      throw runtimeError(
        'no prose found on the page',
        'The page has no plain-text prose blocks, and --ocr found no text in its images.',
        'Try a server-rendered page, or save the page HTML to a file and run `patina --preview file.html`.'
      );
    }

    const rewriteText = [originalText, ...ocrImages.map((image) => image.text)]
      .filter(Boolean)
      .join('\n\n');
    const documentContext = buildDocumentSignals({ text: rewriteText, lang: config.language || 'ko' });

    // Variant comparison (--restyle a,b / --jargon x,y): one rewrite call per
    // variant, all baked into the preview page behind a scriptless toggle.
    // Calls run sequentially — local CLI backends carry concurrency caps of
    // 1-2, and a variant is a whole-document rewrite, not a cheap request.
    const transformVariants = buildTransformVariants(parsed);
    const compareMode = transformVariants.length > 1;
    if (compareMode && pageHtml === null) {
      throw runtimeError(
        'transform-variant comparison needs a page snapshot',
        'Plain-text file previews render as a single reading document, which cannot hold multiple toggleable variants.',
        'Run the compare against a URL or .html input, or pick a single --restyle/--jargon value.'
      );
    }
    const variantBodies = [];
    let rewrittenBody;
    if (compareMode) {
      const previewLang = config.language || 'ko';
      const firstCliTone = typeof parsed.tone === 'string' ? parsed.tone.split(',')[0] : parsed.tone;
      for (const [index, variant] of transformVariants.entries()) {
        logger.info('preview.variant', {
          message: `[patina] Rewriting variant ${variant.label} (${index + 1}/${transformVariants.length})…`,
        });
        // Per-variant tone: a comma-listed --tone makes each variant carry its
        // own tone, so the resolution (and the backbone-profile mapping, when
        // the user did not pass an explicit --profile) is re-derived here —
        // mirroring exactly what a single run with that --tone would do.
        let variantTone = toneResolution;
        let variantProfile = basePromptInputs.profile;
        if (variant.tone && variant.tone !== firstCliTone) {
          variantTone = resolveTone({ cliTone: variant.tone, configTone: config.tone, lang: previewLang });
          if (variantTone.warning) {
            logger.warn('tone.warning', { message: `[patina] ${variantTone.warning}` });
          }
          if (!parsed.profile && variantTone.tone_source === 'user' && variantTone.tone && variantTone.tone !== 'auto') {
            const backbone = toneToBackboneProfile(variantTone.tone);
            if (backbone) {
              const loaded = loadProfile(repoRoot, resolveProfileForLanguage(backbone, previewLang, logger));
              if (loaded.body) variantProfile = loaded;
            }
          }
        }
        const variantRaw = await invokeBackendChain({
          ...invokeInputs,
          prompt: buildPrompt({
            ...basePromptInputs,
            profile: variantProfile,
            tone: variantTone,
            restyle: variant.restyle,
            jargon: variant.jargon,
            text: rewriteText,
            mode: 'rewrite',
            documentSignals: documentContext.signals,
          }),
        });
        cancellation.throwIfCanceled();
        variantBodies.push(formatRewriteBodyForBrowser(variantRaw, { logger }));
      }
      rewrittenBody = variantBodies[0];
    } else {
      const rawResult = await invokeBackendChain({
        ...invokeInputs,
        prompt: buildPrompt({
          ...basePromptInputs,
          text: rewriteText,
          mode: 'rewrite',
          documentSignals: documentContext.signals,
        }),
      });
      cancellation.throwIfCanceled();
      rewrittenBody = formatRewriteBodyForBrowser(rawResult, { logger });
    }

    // Best-effort pattern explanation, same contract as the browser diff
    // page: one extra call, and a failure never fails the preview. Compare
    // mode skips it: one explanation per variant would multiply the call
    // budget, and the variant toggle itself is the comparison surface.
    let explanationHtml = '';
    if (compareMode) {
      logger.info('preview.variant_explanation_skipped', {
        message: '[patina] explanation call skipped in compare mode (one rewrite call per variant already).',
      });
    } else try {
      const diffResult = await invokeBackendChain({
        ...invokeInputs,
        prompt: buildPrompt({
          ...basePromptInputs,
          text: buildBrowserDiffPromptInput(rewriteText, rewrittenBody),
          mode: 'diff',
        }),
      });
      const explanation = formatOutput(
        diffResult,
        'diff',
        { ...parsed, format: 'markdown', noColor: true },
        { logger, stdout: { isTTY: false } },
      );
      explanationHtml = renderExplanationHtml(explanation);
    } catch (err) {
      logger.warn('preview.diff_failed', {
        message: `[patina] preview explanation failed: ${err?.message || 'diff call failed'}`,
      });
    }
    cancellation.throwIfCanceled();

    // Score symmetric scopes: with --ocr the rewrite covers DOM text + image
    // text, so the "before" must too (rewriteText), or the chip would compare
    // unequal scopes and misreport the change. Compare mode scores every
    // variant so the chip shows where each one lands.
    const beforeScore = scoreDeterministicSignals({ text: rewriteText, config, repoRoot, logger });
    let scoreChip = null;
    if (!beforeScore?.skipped && beforeScore?.overall !== null && beforeScore?.overall !== undefined) {
      if (compareMode) {
        const parts = transformVariants.map((variant, index) => {
          const variantScore = scoreDeterministicSignals({ text: variantBodies[index], config, repoRoot, logger });
          return !variantScore?.skipped && variantScore?.overall !== null && variantScore?.overall !== undefined
            ? `${variant.label} ${variantScore.overall}`
            : null;
        }).filter(Boolean);
        scoreChip = parts.length > 0 ? `score ${beforeScore.overall} → ${parts.join(' · ')}` : null;
      } else {
        const afterScore = scoreDeterministicSignals({ text: rewrittenBody, config, repoRoot, logger });
        scoreChip = !afterScore?.skipped && afterScore?.overall !== null && afterScore?.overall !== undefined
          ? `score ${beforeScore.overall} → ${afterScore.overall}`
          : null;
      }
    }

    let built;
    let stdoutBody = rewrittenBody;
    if (pageHtml !== null) {
      // Align each rewrite body against the extracted blocks independently —
      // models merge/split paragraphs differently per variant.
      const alignOne = (body, label) => {
        try {
          const aligned = alignRewrites([...blocks, ...ocrImages], body);
          if (aligned.unalignedCount > 0) {
            logger.warn('preview.partial_alignment', {
              message: `[patina] ${aligned.unalignedCount} block(s)${label ? ` in variant ${label}` : ''} could not be aligned with the rewrite and keep their original text.`,
            });
          }
          return aligned.rewrites;
        } catch (err) {
          throw runtimeError(
            'preview rewrite could not be aligned',
            `${err.message}, so the rewrites cannot be swapped back into the page safely.`,
            'Re-run the command (model output varies), or save the page HTML to a file and run `patina --preview file.html`.'
          );
        }
      };
      const rewrites = alignOne(rewrittenBody, compareMode ? transformVariants[0].label : '');
      const previewVariants = compareMode
        ? transformVariants.map((variant, index) => ({
          label: variant.label,
          restyle: variant.restyle,
          jargon: variant.jargon,
          tone: variant.tone,
          rewrites: (index === 0 ? rewrites : alignOne(variantBodies[index], variant.label)).slice(0, blocks.length),
        }))
        : null;
      const imageFindings = ocrImages.map((image, index) => {
        const rewritten = rewrites[blocks.length + index];
        return { ...image, rewritten, changed: rewritten !== image.text };
      });
      if (ocrImages.length > 0) {
        // Keep stdout pipe-safe: only the page's own text, never OCR blocks.
        stdoutBody = rewrites.slice(0, blocks.length).join('\n\n');
      }
      built = buildPreviewHtml({
        html: pageHtml,
        blocks,
        rewrites: rewrites.slice(0, blocks.length),
        variants: previewVariants,
        sourceUrl,
        explanationHtml,
        scoreChip,
        imageFindings,
        contextCardHtml: buildContextCardHtml({
          register: documentContext.register,
          // With per-variant tones one global tone row would be wrong for
          // every variant but the first — show the register measurement only.
          tone: compareMode && transformVariants.some((v) => v.tone !== transformVariants[0].tone)
            ? null
            : toneResolution,
        }),
      });
      if (compareMode) {
        logger.info('preview.variants_ready', {
          message: `[patina] ${transformVariants.length} variants baked in (${transformVariants.map((v) => v.label).join(', ')}); stdout carries "${transformVariants[0].label}". Toggle variants from the preview bar.`,
        });
      }
    }
    console.log(stdoutBody);

    const pagePath = writeBrowserDiffPage(built.html, { prefix: 'patina-preview-' });
    const imageSummary = built.imageChangedCount > 0 ? `, ${built.imageChangedCount} image(s) flagged` : '';
    console.error(`[patina] Preview page saved at ${pagePath} (${built.changedCount} of ${built.totalCount} blocks rewritten${imageSummary})`);
    if (parsed.serve) {
      const { url: servedUrl, done } = await serveBrowserDiffPage(built.html, {
        signal: cancellation.signal,
      });
      console.error(`[patina] Serving preview at ${servedUrl}`);
      console.error('[patina] Stops after 10 idle minutes; press Ctrl+C to stop now.');
      await done;
    } else {
      try {
        await openBrowserDiffPage(pagePath);
      } catch (err) {
        console.error(`[patina] Browser open failed: ${err.message}`);
      }
    }
  } finally {
    cancellation.cleanup();
  }
}

async function runOcrStage({ pageHtml, sourceUrl, parsed, backends, resolved, timeoutMs, cancellation, logger }) {
  // A test-injected OCR runner replaces backend selection entirely (CI has no
  // installed vision CLI). In production we require a real image-capable CLI.
  const ocrBackends = hasOcrRunnerOverride() ? [] : selectOcrBackends(backends, { logger });
  if (!hasOcrRunnerOverride() && ocrBackends.length === 0) {
    throw runtimeError(
      'no image-capable backend for --ocr',
      'OCR needs an available, authenticated claude-cli, gemini-cli, or codex-cli (kimi-cli and openai-http cannot read images).',
      'Run `patina doctor` to check backend status, or drop --ocr.'
    );
  }

  const { candidates, truncated } = collectImageCandidates(pageHtml, sourceUrl);
  if (truncated) {
    logger.warn('ocr.truncated', {
      message: '[patina] Page has more images than the OCR limit; lower-priority images were skipped.',
    });
  }
  if (candidates.length === 0) {
    logger.info('ocr.empty', { message: '[patina] OCR: no eligible images on the page.' });
    return [];
  }

  logger.info('ocr.start', {
    message: `[patina] OCR: scanning ${candidates.length} image(s)${ocrBackends.length ? ` via ${ocrBackends.map((b) => b.name).join(' → ')}` : ''}…`,
  });
  const { dir, staged, skipped } = await stageOcrImages(candidates, { signal: cancellation.signal, baseUrl: sourceUrl });
  try {
    for (const skip of skipped) {
      logger.warn('ocr.skip', {
        message: `[patina] OCR skipped ${describeImage(skip.candidate)}: ${skip.reason}`,
      });
    }
    cancellation.throwIfCanceled();

    // No model override: an OCR fallback backend may differ from the text
    // backend, so each CLI uses its own default model.
    const invokeChain = ({ prompt, images }) => invokeBackendChain({
      backends: ocrBackends,
      prompt,
      images,
      apiKey: resolved.apiKey,
      baseURL: resolved.baseURL,
      signal: cancellation.signal,
      timeout: timeoutMs,
      maxConcurrency: parsed.maxConcurrency,
      maxRetries: parsed.maxRetries,
      logger,
    });
    const images = await ocrStagedImages(staged, { invokeChain, signal: cancellation.signal, logger });
    // A swallowed abort inside the OCR fan-out resolves to fewer results; make
    // Ctrl-C surface as the standard cancellation error, not a later
    // backend-flavored AbortError from the rewrite call.
    cancellation.throwIfCanceled();
    logger.info('ocr.done', {
      message: `[patina] OCR: text found in ${images.length} of ${staged.length} image(s)`,
    });
    return images;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Deterministic document signals for the rewrite prompt (document-brief
// stage). Korean only for now: the dominant register is measured, not
// guessed, so the model gets it as ground truth instead of re-deriving it.
function buildDocumentSignals({ text, lang }) {
  if (lang !== 'ko') return { signals: [], register: null };
  const register = detectKoreanRegister(text);
  if (!register) return { signals: [], register: null };
  const pct = (value) => `${Math.round(value * 100)}%`;
  const distribution = `합쇼체 ${pct(register.shares.formal)} · 해요체 ${pct(register.shares.polite)} · -다체 ${pct(register.shares.plain)} (문장 ${register.classified}개 기준)`;
  const signals = register.register === 'mixed'
    ? [`어미 분포: ${distribution} — 지배 어투 없음(혼합). 문서 성격에 맞는 어투 하나를 골라 전체를 통일할 것`]
    : [`지배 어투: ${register.label} — ${distribution}. 재작성 문장 전체를 이 어투로 통일할 것`];
  return { signals, register };
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
