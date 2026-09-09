import { loadConfig, getRepoRoot, resolveRegister } from '../config.js';
import {
  loadPatterns,
  applyDocumentTypePatternPolicy,
  loadDocumentType,
  loadCoreFile,
} from '../loader.js';
import { buildPrompt } from '../prompt-builder.js';
import { buildTransformVariants } from './args.js';
import { invokeBackendChain, selectBackendChain, selectOcrBackends, listBackends } from '../backends/index.js';
import { selectProvider, resolveProviderConfig } from '../providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from '../security.js';
import { formatOutput, formatRewriteBodyForBrowser, validateScoreWeights, buildDeterministicAuditBackstop, cleanRewriteOutput } from '../output.js';
import {
  buildBrowserDiffPromptInput,
  renderExplanationHtml,
  writeBrowserDiffPage,
  openBrowserDiffPage,
  serveBrowserDiffPage,
} from '../browser-diff.js';
import { fetchPreviewPage, prepareSnapshotHtml, freezeSnapshotAssets, extractProseBlocks, alignRewrites, buildPreviewHtml, buildContextCardHtml } from '../preview.js';
import { collectImageCandidates, stageOcrImages, ocrStagedImages, describeImage, hasOcrRunnerOverride } from '../ocr.js';
import { rmSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { verifyRewrite, deterministicMeaningGuard, droppedNumbers } from '../verify.js';
import { interpretScore, reconcileScoreOverall, scoreDeterministicSignals } from '../scoring.js';
import { detectKoreanRegister } from '../features/stylometry.js';
import { logBatchSafetyPlan, createBatchCircuitBreaker, shouldHandleBatchFailure, writeBatchOutput, writeAtomicUtf8, resolveBatchOutputPath } from './batch.js';
import { applyScoreGate, extractScoreOverall } from './score-gate.js';
import { loadInputs } from './input.js';
import { PatinaCliError, inputError, runtimeError } from '../errors.js';
import { providerHttpKeyEnvVars, resolveHttpApiKey } from '../auth.js';
import { DEFAULT_BACKEND_TIMEOUT_MS, getBackendSafety, resolveBackendMaxRetries } from '../backends/contract.js';
import { resolve } from 'node:path';
import { resolvePersonaForRun } from '../personas/resolve.js';
import { evaluatePersonaGate } from '../personas/gates.js';
import { personaMatchScore } from '../features/persona-match.js';
import { pathToFileURL } from 'node:url';
import { humanizeXliffDocument, resolveUniqueCap } from './xliff.js';
import { inspectAuditSource } from '../inspection.js';

/**
 * Run the default patina pipeline for an already-parsed CLI invocation:
 * resolve config, provider, and backends, build prompts, then process each
 * input job (rewrite/diff/audit/score, plus the preview page).
 *
 * @param {object} parsed Parsed CLI arguments from parseArgs.
 * @param {object} logger Patina logger for this invocation.
 * @returns {Promise<void>} Resolves after all job output is written.
 * @throws {Error} For validation, provider, file, or runtime failures.
 */
export async function runDefault(parsed, logger) {
  const config = loadConfig(undefined, {
    overridePath: parsed.config ? resolve(process.cwd(), parsed.config) : undefined,
    snapshotPath: parsed.configSnapshot ? resolve(process.cwd(), parsed.configSnapshot) : undefined,
  });

  if (parsed.lang) config.language = parsed.lang;
  if (parsed.documentType) config.documentType = parsed.documentType;

  const repoRoot = getRepoRoot();
  const lang = config.language || 'ko';
  const mode = parsed.diff ? 'diff'
    : parsed.audit ? 'audit'
    : parsed.score ? 'score'
    : 'rewrite';

  if (mode !== 'rewrite' && (parsed.register || config.register)) {
    throw inputError(
      `--register cannot be combined with --${mode}`,
      'Register changes rewritten prose; this mode inspects the source as-is.',
      'Remove --register/config register, or run a rewrite.'
    );
  }
  const firstCliRegister = typeof parsed.register === 'string'
    ? parsed.register.split(',')[0]
    : parsed.register;
  const registerResolution = resolveRegister({
    cliRegister: firstCliRegister,
    configRegister: config.register,
  });

  let documentTypeName = config.documentType || 'default';
  const resolvedDocumentTypeName = resolveDocumentTypeForLanguage(documentTypeName, lang, logger);
  if (resolvedDocumentTypeName !== documentTypeName) {
    documentTypeName = resolvedDocumentTypeName;
    config.documentType = 'default';
  }
  const documentType = loadDocumentType(repoRoot, documentTypeName);
  const patterns = applyDocumentTypePatternPolicy(
    loadPatterns(repoRoot, lang, config['skip-patterns'] || []),
    documentType,
    lang,
  );
  if (parsed.offline) {
    return runOfflineScore(parsed, { config, patterns, repoRoot }, logger);
  }

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

  const voice = loadCoreFile(repoRoot, 'voice.md');
  const scoring = loadCoreFile(repoRoot, 'scoring.md');
  const persona = resolvePersonaForRun({ parsed, config, mode, lang, repoRoot });

  const inputTexts = parsed.preview ? [] : await loadInputs(parsed, logger);
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  const backendSelection = selectBackendChain({
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
    if (backend.name === 'openai-http' && !resolved.apiKey && !(parsed.xliff && parsed.dryRun)) {
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
      documentType,
      voice,
      scoring,
      persona,
      registerResolution,
      promptMode,
      backends,
      resolved,
      repoRoot,
      timeoutMs,
      logger,
    });
    return;
  }

  if (parsed.xliff) {
    await runXliffMode(parsed, { config, repoRoot, voice, scoring, backends, resolved, promptMode, timeoutMs, providerName: provider?.name }, logger);
    return;
  }

  const jobs = inputTexts.map(({ path, text, readError }) => ({
    path,
    text,
    readError,
    // A read failure (#503) means there is no prompt to build; the read error is
    // replayed inside the per-file batch loop below.
    prompt: readError ? null : buildPrompt({
      config,
      patterns,
      documentType,
      voice: voice.body ? voice : null,
      scoring: scoring.body ? scoring : null,
      text,
      mode,
      register: registerResolution,
      promptMode,
      documentSignals: mode === 'rewrite' ? buildDocumentSignals({ text, lang }).signals : null,
      jargon: parsed.jargon,
      rewriteHeadings: parsed.rewriteHeadings,
      persona,
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
        if (mode === 'rewrite') warnIfAlreadyHuman({ text, config, repoRoot, logger });
        let result;
        let verificationReport = null;
        let meaningSafetyReason = null;

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
        cancellation.throwIfCanceled();

        // Meaning preservation belongs to the global rewrite contract. Persona
        // selection may change voice, never whether safety checks are enforced.
        if (mode === 'rewrite') {
          const stripQuiet = { warn() {} };
          if (parsed.verify) {
            const cleanRewrite = cleanRewriteOutput(result, { logger: stripQuiet });
            const verifyCallLLM = ({ prompt: verifyPrompt, signal: verifySignal, timeout: verifyTimeout }) =>
              invokeBackendChain({
                backends,
                prompt: verifyPrompt,
                apiKey: resolved.apiKey,
                baseURL: resolved.baseURL,
                model: resolved.model,
                modelSource: resolved.modelSource,
                signal: verifySignal ?? cancellation.signal,
                timeout: verifyTimeout ?? timeoutMs,
                maxConcurrency: 1,
                maxRetries: 0,
                logger,
              });
            const verification = await verifyRewrite({
              original: text,
              rewrite: cleanRewrite,
              config,
              patterns,
              documentType,
              voice: voice.body ? voice : null,
              persona,
              register: registerResolution,
              scoring: scoring.body ? scoring : null,
              promptMode,
              documentSignals: buildDocumentSignals({ text, lang }).signals,
              jargon: parsed.jargon,
              rewriteHeadings: parsed.rewriteHeadings,
              apiKey: resolved.apiKey,
              baseURL: resolved.baseURL,
              model: resolved.model,
              callLLM: verifyCallLLM,
              signal: cancellation.signal,
              timeout: timeoutMs,
              logger,
            });
            result = verification.text;
            verificationReport = {
              verified: verification.verified, mps: verification.mps, fidelity: verification.fidelity,
              retried: verification.retried, reason: verification.reason,
              mpsFloor: config.verification?.['mps-floor'] ?? 70,
              fidelityFloor: config.verification?.['fidelity-floor'] ?? 70,
              outputHash: createHash('sha256').update(verification.text, 'utf8').digest('hex'),
            };
            logger.info('verify.result', {
              message: `[patina] verify: MPS ${verification.mps ?? 'n/a'}, fidelity ${verification.fidelity}${verification.verified ? ' (passed)' : ' (below floor)'}${verification.retried ? ' [retried]' : ''}`,
            });
            if (!verification.verified) {
              meaningSafetyReason = verification.reason;
            }
          }

          const finalText = cleanRewriteOutput(result, { logger: stripQuiet });
          if (verificationReport?.verified && finalText !== result) {
            verificationReport.verified = false;
            verificationReport.reason = 'output-changed';
            meaningSafetyReason = 'output-changed';
            logger.warn('verify.output_changed', {
              message: '[patina] verify: cleanup changed the graded text; verification does not cover the emitted output.',
            });
          }
          for (const warning of deterministicMeaningGuard(text, finalText)) {
            logger.warn('rewrite.meaning_guard', { message: `[patina] ${warning}` });
          }
          if (droppedNumbers(text, finalText).length > 0) {
            meaningSafetyReason = 'dropped-numbers';
            if (verificationReport) {
              verificationReport.verified = false;
              verificationReport.reason = 'dropped-numbers';
            }
          }
          if (meaningSafetyReason) {
            process.exitCode = Math.max(Number(process.exitCode) || 0, 4);
          }
        }

        if (mode === 'score') {
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
        let personaReport = null;
        if (persona && mode === 'rewrite') {
          const rewrittenForPersona = formatOutput(
            result,
            mode,
            { ...parsed, format: 'text' },
            { register: registerResolution, logger },
          );
          personaReport = buildPersonaReport({
            rewritten: rewrittenForPersona,
            original: text,
            persona,
            lang,
            repoRoot,
            thresholds: config.personas?.thresholds || {},
          });
          const gate = personaReport.gate_result;
          const bits = [];
          if (!gate.personaMatchPass) bits.push(`voice match ${gate.personaMatch} < ${gate.personaMatchMin}`);
          if (!gate.churnPass) bits.push(`surface churn ${gate.churn} > ${gate.churnMax}`);
          if (bits.length > 0) {
            logger.warn('persona.advisory', {
              message: `[patina] persona advisory: ${bits.join('; ')} (quality signals only; output not blocked).`,
            });
          }
        }

        let output;
        let scoreValidationOutput = null;
        const inspection = mode === 'audit' && parsed.format === 'json' ? inspectAuditSource(text, { language: lang, config, repoRoot }) : null;
        output = formatOutput(result, mode, parsed, { register: registerResolution, logger, auditBackstop, persona: personaReport, inspection, verification: verificationReport });
        if (mode === 'score') {
          scoreValidationOutput = formatOutput(result, mode, { ...parsed, format: 'markdown' }, { logger });
        }

        // v3.11 Phase 1.3: surface weight drift between config and the score
        // table the model emitted. Warnings only — does not alter the output.
        if (mode === 'score') {
          const configWeights = config.scoring?.['category-weights']?.[lang] || {};
          const warnings = validateScoreWeights(scoreValidationOutput || output, configWeights);
          for (const w of warnings) {
            logger.warn('score.weight_check', { message: `[patina] ${w}` });
          }

          if (parsed.gate !== undefined) {
            applyScoreGate(result, output, parsed.gate, logger);
          }
        }

        if (parsed.batch) {
          // The run-level exit code may belong to an earlier file. Only this
          // candidate's evidence decides whether it can replace a batch source.
          const meaningSafetyError = meaningSafetyReason ? new PatinaCliError({
            what: 'rewrite failed meaning-safety checks',
            why: meaningSafetyReason,
            action: 'Review the candidate on stdout or choose an output path outside the batch inputs.',
            exitCode: 4,
          }) : null;
          await writeBatchOutput(parsed, path, output, { meaningSafetyError });
          // Keep stdout/separate-file review output, but never count an unsafe
          // candidate as a success or let it bypass the batch failure budget.
          if (meaningSafetyError) throw meaningSafetyError;
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

async function runOfflineScore(parsed, { config, patterns, repoRoot }, logger) {
  const inputs = await loadInputs(parsed, logger);
  const batchState = createBatchCircuitBreaker({ parsed, total: inputs.length });

  for (const { path, text, readError } of inputs) {
    try {
      if (readError) throw readError;
      const deterministicScore = scoreDeterministicSignals({
        text,
        config,
        patterns,
        repoRoot,
        logger,
      });
      if (!deterministicScore) {
        throw inputError(
          'offline scoring is disabled by config',
          '`scoring.deterministic.enabled` is false, so no local score can be computed.',
          'Enable `scoring.deterministic.enabled`, or drop --offline to use the LLM-backed score.',
        );
      }
      if (!Number.isFinite(deterministicScore.overall)) {
        const detail = deterministicScore.error
          || deterministicScore.skipReason
          || 'the deterministic analyzer returned no numeric overall score';
        throw runtimeError(
          'offline score is unavailable',
          detail,
          'Enable deterministic scoring for this language and fix any reported analyzer error, or drop --offline to use the LLM-backed score.',
        );
      }

      const result = deterministicOnlyScoreResult(deterministicScore);
      const output = formatOutput(result, 'score', parsed, { logger });
      if (parsed.gate !== undefined) {
        applyScoreGate(result, output, parsed.gate, logger);
      }
      if (parsed.batch) {
        await writeBatchOutput(parsed, path, output);
      } else {
        console.log(output);
      }
      batchState.recordSuccess();
    } catch (err) {
      if (!shouldHandleBatchFailure(parsed, inputs.length)) throw err;
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
}

function deterministicOnlyScoreResult(score) {
  const overall = Number.isFinite(score?.overall) ? score.overall : null;
  const lines = [
    `Overall: ${overall ?? 'unavailable'}`,
    `Interpretation: ${score?.interpretation ?? 'unavailable'}`,
    'Scoring: deterministic only; LLM-judged categories unavailable.',
    `Paragraphs: ${score?.paragraphCount ?? 0}`,
    `Hot paragraphs: ${score?.hotParagraphs ?? 0}`,
    `Signal score: ${score?.signalScore ?? 0}`,
    `Evidence floor: ${score?.evidenceFloor ?? 0}`,
  ];
  if (score?.skipped && score?.skipReason) {
    lines.push(`Skipped signal: ${score.skipReason}`);
  }
  return {
    raw: lines.join('\n'),
    overall,
    interpretation: score?.interpretation ?? null,
    llmScore: null,
    deterministicScore: score,
    scorePreference: 'deterministic-only',
  };
}

/**
 * XLIFF localization humanize mode. Reads each XLIFF file, humanizes its safe
 * translated <target> segments through the normal rewrite+verify pipeline, and
 * writes a byte-preserving output atomically. --dry-run reports the plan with
 * zero LLM calls and no writes. Language/patterns are resolved per file from the
 * XLIFF target-language (cached), not the global config language.
 */
export async function runXliffMode(parsed, ctx, logger, overrides = {}) {
  const { config, repoRoot, voice, scoring, backends, resolved, promptMode, timeoutMs, providerName } = ctx;
  const cancellation = createCancellationController({ logger });
  const assetCache = new Map();
  const getAssets = (lang) => {
    if (assetCache.has(lang)) return assetCache.get(lang);
    const documentTypeName = resolveDocumentTypeForLanguage(config.documentType || 'default', lang, logger);
    const documentType = loadDocumentType(repoRoot, documentTypeName);
    const patterns = applyDocumentTypePatternPolicy(loadPatterns(repoRoot, lang, config['skip-patterns'] || []), documentType, lang);
    const assets = { patterns, documentType };
    assetCache.set(lang, assets);
    return assets;
  };
  const rewriteSegment = overrides.rewriteSegment || (async ({ core, lang }) => {
    const { patterns, documentType } = getAssets(lang);
    const prompt = buildPrompt({
      config: { ...config, language: lang }, patterns,
      documentType,
      voice: voice.body ? voice : null,
      scoring: scoring.body ? scoring : null,
      text: core, mode: 'rewrite',
      register: null,
      promptMode, documentSignals: null,
    });
    const raw = await invokeBackendChain({
      backends, prompt, apiKey: resolved.apiKey, baseURL: resolved.baseURL,
      model: resolved.model, modelSource: resolved.modelSource,
      signal: cancellation.signal, timeout: timeoutMs,
      maxConcurrency: parsed.maxConcurrency, maxRetries: parsed.maxRetries, logger,
    });
    return cleanRewriteOutput(raw, { logger: { warn() {} } });
  });
  const verifySegment = overrides.verifySegment || (async ({ core, candidate, lang }) => {
    const { patterns, documentType } = getAssets(lang);
    const callLLM = ({ prompt, signal, timeout }) => invokeBackendChain({
      backends, prompt, apiKey: resolved.apiKey, baseURL: resolved.baseURL,
      model: resolved.model, modelSource: resolved.modelSource,
      signal: signal ?? cancellation.signal, timeout: timeout ?? timeoutMs,
      maxConcurrency: 1, maxRetries: 0, logger,
    });
    const v = await verifyRewrite({
      original: core, rewrite: candidate, config: { ...config, language: lang }, patterns,
      documentType,
      voice: voice.body ? voice : null,
      scoring: scoring.body ? scoring : null, promptMode, register: null,
      apiKey: resolved.apiKey, baseURL: resolved.baseURL, model: resolved.model,
      callLLM, signal: cancellation.signal, timeout: timeoutMs, logger,
    });
    return { verified: v.verified, text: v.text, mps: v.mps, fidelity: v.fidelity };
  });
  // Worst-case backend attempts per LLM call = sum over the fallback chain of
  // (that backend's max retries + 1). Used only for the dry-run estimate.
  const backendAttemptsPerCall = backends.reduce((sum, b) => sum + resolveBackendMaxRetries(b.name, parsed.maxRetries) + 1, 0) || 1;

  cancellation.install();
  try {
    // Shared across the whole batch so a segment repeated across files is
    // humanized once and reused (cross-file dedup), keyed by target-language.
    const dedupCache = new Map();
    for (const file of parsed.files) {
      cancellation.throwIfCanceled();
      const xml = readFileSync(file, 'utf8');
      const outputPath = resolveBatchOutputPath(parsed, file, { defaultSuffix: '.humanized' });
      const breaker = createBatchCircuitBreaker({ parsed: { ...parsed, batch: true }, total: Math.max(2, resolveUniqueCap(parsed)) });
      const result = await humanizeXliffDocument({
        xml,
        cap: resolveUniqueCap(parsed),
        dryRun: !!parsed.dryRun,
        rewriteSegment,
        verifySegment,
        backendAttemptsPerCall,
        provider: providerName,
        model: resolved.model,
        outputPath,
        breaker,
        signal: cancellation.signal,
        cache: dedupCache,
      });
      if (result.dryRun) {
        const r = result.report;
        if ((parsed.format ?? 'markdown') === 'json') {
          console.log(JSON.stringify({ file, targetLang: result.targetLang, ...r }, null, 2));
        } else {
          console.log(
            `[dry-run] ${file} (target=${result.targetLang})\n`
            + `  units=${r.totalUnits} selected=${r.selectedCount} unique=${r.uniqueCount} (dedup saves ${r.duplicateSavings}${r.crossFileDuplicateSavings ? `, cross-file reuse ${r.crossFileDuplicateSavings}` : ''})\n`
            + `  cap=${r.cap} (${r.capStatus}) | worst-case LLM calls=${r.worstCaseLlmCalls} (~${r.callsPerUnique}/segment), backend attempts<=${r.worstCaseBackendAttempts}\n`
            + `  est input tokens ~${r.inputTokensEstimate.toLocaleString()} | cost: ${r.cost ?? r.costNote}\n`
            + `  output would be: ${outputPath}\n`
            + `  skipped: ${Object.entries(r.skippedByReason).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}\n`
            + `  (dry-run: 0 LLM calls, 0 writes)`
          );
        }
        continue;
      }
      if (parsed.outdir) mkdirSync(parsed.outdir, { recursive: true });
      if (!parsed.inPlace && resolve(outputPath) === resolve(file)) {
        throw runtimeError(
          'xliff: refusing to overwrite the original file',
          `The computed output path equals the input (${file}).`,
          'Use --in-place to overwrite intentionally, or --suffix/--outdir for a separate output.'
        );
      }
      writeAtomicUtf8(outputPath, result.outputXml);
      console.log(`Written: ${outputPath} — ${result.report.changedSegments} segment(s) humanized, ${result.report.uniqueCount - result.report.changedUniqueKeys} kept${result.report.reusedFromCache ? ` (${result.report.reusedFromCache} of ${result.report.uniqueCount} unique reused from cache)` : ''}`);
    }
  } finally {
    cancellation.cleanup();
    logger.closeProgress();
  }
}


function buildPersonaReport({ rewritten, original, persona, lang, repoRoot, thresholds }) {
  const match = personaMatchScore({ text: rewritten, persona, lang, repoRoot, original });
  const overEditChurn = match.overEditChurn ?? match.deltas?.overEditChurn ?? match.featureVector?.over_edit_churn ?? 0;
  const gate = evaluatePersonaGate({
    personaMatch: match.score,
    churn: overEditChurn,
    thresholds,
    persona,
  });
  return {
    id: persona.id,
    thresholds_source: thresholds?.source ?? gate.thresholdSource ?? null,
    match: match.score,
    over_edit_churn: overEditChurn,
    gate_result: gate,
  };
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
 * Resolve a document type against language-specific policy limits.
 *
 * @param {string} documentTypeName Requested document type.
 * @param {string} lang Active language code.
 * @param {object} [logger] Logger with warn(event, payload).
 * @returns {string} Effective document type.
 * @example
 * resolveDocumentTypeForLanguage('namuwiki', 'en') // 'default'
 */
export function resolveDocumentTypeForLanguage(documentTypeName, lang, logger = null) {
  const effective = documentTypeName || 'default';
  if (effective === 'namuwiki' && lang !== 'ko') {
    logger?.warn?.('document_type.unsupported_language', {
      message: `[patina] document type "namuwiki" is ko-only; falling back to default for --lang ${lang}`,
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

async function runPreviewJob({
  parsed,
  config,
  patterns,
  documentType,
  voice,
  scoring,
  persona,
  registerResolution,
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
      documentType,
      voice: voice.body ? voice : null,
      scoring: scoring.body ? scoring : null,
      persona,
      register: registerResolution,
      promptMode,
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

    // Variant comparison (--jargon x,y / --register a,b): one rewrite call
    // per variant, all baked into the preview page behind a scriptless toggle.
    // Calls run sequentially — local CLI backends carry concurrency caps of
    // 1-2, and a variant is a whole-document rewrite, not a cheap request.
    const transformVariants = buildTransformVariants(parsed);
    const compareMode = transformVariants.length > 1;
    if (compareMode && pageHtml === null) {
      throw runtimeError(
        'transform-variant comparison needs a page snapshot',
        'Plain-text file previews render as a single reading document, which cannot hold multiple toggleable variants.',
        'Run the compare against a URL or .html input, or pick a single --jargon/--register value.'
      );
    }
    const variantBodies = [];
    let rewrittenBody;
    if (compareMode) {
      const firstCliRegister = typeof parsed.register === 'string' ? parsed.register.split(',')[0] : parsed.register;
      for (const [index, variant] of transformVariants.entries()) {
        logger.info('preview.variant', {
          message: `[patina] Rewriting variant ${variant.label} (${index + 1}/${transformVariants.length})…`,
        });
        // A comma-listed --register resolves independently for each variant.
        let variantRegister = registerResolution;
        if (variant.register && variant.register !== firstCliRegister) {
          variantRegister = resolveRegister({
            cliRegister: variant.register,
            configRegister: config.register,
          });
        }
        const variantRaw = await invokeBackendChain({
          ...invokeInputs,
          prompt: buildPrompt({
            ...basePromptInputs,
            register: variantRegister,
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

    const previewCandidates = compareMode ? variantBodies : [rewrittenBody];
    for (const candidate of previewCandidates) {
      const dropped = droppedNumbers(rewriteText, candidate);
      if (dropped.length === 0) continue;
      logger.warn('rewrite.meaning_guard', {
        message: `[patina] Rewrite dropped source number(s): ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? ', …' : ''}`,
      });
      process.exitCode = Math.max(Number(process.exitCode) || 0, 4);
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
          jargon: variant.jargon,
          register: variant.register,
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
          sourceRegister: documentContext.register,
          // A compared register axis has no single global value.
          register: compareMode && transformVariants.some((v) => v.register !== transformVariants[0].register)
            ? null
            : registerResolution,
        }),
      });
      if (compareMode) {
        logger.info('preview.variants_ready', {
          message: `[patina] ${transformVariants.length} variants baked in (${transformVariants.map((v) => v.label).join(', ')}); stdout carries "${transformVariants[0].label}". Toggle variants from the preview bar.`,
        });
      }
    }
    // Do the throwing/binding work (temp-file write, serve port bind) BEFORE the
    // large stdout write: process.exit() does not drain a piped stdout, so a
    // throw after console.log(stdoutBody) truncates piped output (#527 H7).
    const pagePath = writeBrowserDiffPage(built.html, { prefix: 'patina-preview-' });
    const imageSummary = built.imageChangedCount > 0 ? `, ${built.imageChangedCount} image(s) flagged` : '';
    let serveHandle = null;
    if (parsed.serve) {
      serveHandle = await serveBrowserDiffPage(built.html, { signal: cancellation.signal });
    }

    console.log(stdoutBody);
    console.error(`[patina] Preview page saved at ${pagePath} (${built.changedCount} of ${built.totalCount} blocks rewritten${imageSummary})`);
    if (serveHandle) {
      console.error(`[patina] Serving preview at ${serveHandle.url}`);
      console.error('[patina] Stops after 10 idle minutes; press Ctrl+C to stop now.');
      await serveHandle.done;
    } else {
      try {
        await openBrowserDiffPage(pagePath);
      } catch (err) {
        console.error(`[patina] Browser open failed: ${err.message}`);
      }
    }
  } catch (err) {
    // Match runDefault: a Ctrl-C abort during a preview backend call surfaces as
    // a clean exit-130 cancellation, not a generic exit-1 runtime failure (#527 H3).
    if (cancellation.signal.aborted) throw cancellationError();
    throw err;
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

/**
 * Over-editing guard (Study 1 RQ5b): rewriting text that already reads human
 * measurably nudged it TOWARD AI-likeness (+3.3 judged points on human English
 * documents, docs/research/2026-rewrite-efficacy-study1.md). When the
 * deterministic layer finds nothing to fix, say so before spending a rewrite —
 * advisory only, never blocks, and silent wherever the deterministic score is
 * unavailable or the text is too short to judge (Study 0 Deviation 1).
 * Opt out with `over-editing-guard: false` in config.
 */
export function warnIfAlreadyHuman({ text, config = {}, repoRoot, logger, scorer = scoreDeterministicSignals }) {
  if (config['over-editing-guard'] === false) return null;
  let score = null;
  try {
    score = scorer({ text, config, repoRoot, logger: { warn() {} } });
  } catch {
    return null; // the guard must never break a rewrite
  }
  if (!score || score.skipped) return null;
  if (typeof score.paragraphCount !== 'number' || score.paragraphCount < 3) return null;
  const clean = score.hotParagraphs === 0
    && typeof score.signalScore === 'number' && score.signalScore <= 10
    && (score.overall === 0 || score.overall === null);
  if (!clean) return null;
  logger?.warn?.('rewrite.over_editing_guard', {
    message: '[patina] over-editing guard: this text already reads human on the deterministic layer '
      + `(0 hot paragraphs, signal ${Math.round(score.signalScore * 10) / 10}). Rewriting anyway can ADD AI-likeness `
      + '(measured on human documents in the rewrite-efficacy study). Consider --audit or --score first. '
      + 'Proceeding; disable this note with `over-editing-guard: false`.',
  });
  return score;
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
