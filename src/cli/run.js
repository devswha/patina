import { loadConfig, getRepoRoot, resolveRegister } from '../config.js';
import {
  loadPatterns,
  applyDocumentTypePatternPolicy,
  loadDocumentType,
  loadCoreFile,
} from '../loader.js';
import { buildPrompt } from '../prompt-builder.js';
import { invokeBackendChain, selectBackendChain, listBackends } from '../backends/index.js';
import { selectProvider, resolveProviderConfig } from '../providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from '../security.js';
import { formatOutput, validateScoreWeights, buildDeterministicAuditBackstop, cleanRewriteOutput } from '../output.js';
import { createHash } from 'node:crypto';

import { verifyRewrite, deterministicMeaningGuard, assessRewriteMeaningSafety } from '../verify.js';
import { interpretScore, reconcileScoreOverall, scoreDeterministicSignals } from '../scoring.js';
import { buildDocumentSignals } from '../features/document-signals.js';
import { logBatchSafetyPlan, createBatchCircuitBreaker, shouldHandleBatchFailure, writeBatchOutput } from './batch.js';
import { applyScoreGate, extractScoreOverall } from './score-gate.js';
import { loadInputs } from './input.js';
import { PatinaCliError, inputError, runtimeError } from '../errors.js';
import { providerHttpKeyEnvVars, resolveHttpApiKey } from '../auth.js';
import { DEFAULT_BACKEND_TIMEOUT_MS, getBackendSafety } from '../backends/contract.js';
import { resolve } from 'node:path';
import { resolvePersonaForRun } from '../personas/resolve.js';
import { evaluatePersonaGate } from '../personas/gates.js';
import { personaMatchScore } from '../features/persona-match.js';
import { inspectAuditSource } from '../inspection.js';
import { warnIfTooSmooth } from './smoothness-advisory.js';
import { warnIfOvercorrected } from './overcorrection-advisory.js';
import { maybeStarNudge } from '../star-nudge.js';

/**
 * Run the default patina pipeline for an already-parsed CLI invocation:
 * resolve config, provider, and backends, build prompts, then process each
 * input job (rewrite/diff/audit/score).
 *
 * @param {object} parsed Parsed CLI arguments from parseArgs.
 * @param {import('../logger.js').Logger} logger Patina logger for this invocation.
 * @returns {Promise<void>} Resolves after all job output is written.
 * @throws {Error} For validation, provider, file, or runtime failures.
 */
export async function runDefault(parsed, logger) {
  const config = loadConfig(undefined, {
    overridePath: parsed.config ? resolve(process.cwd(), parsed.config) : undefined,
    snapshotPath: parsed.configSnapshot ? resolve(process.cwd(), parsed.configSnapshot) : undefined,
  });
  await runPipeline(parsed, logger, config);
  // Reached only when the run did not throw. Advisory only — stderr, terminal
  // sessions, at most twice ever. Does not touch exit codes or output.
  maybeStarNudge({ config, logger, quiet: parsed.quiet });
}

// The pipeline behind runDefault; every mode (offline score and the per-file
// job loop) returns through here.
async function runPipeline(parsed, logger, config) {
  if (parsed.lang) config.language = parsed.lang;
  if (parsed.documentType) config.documentType = parsed.documentType;

  const repoRoot = getRepoRoot();
  const lang = config.language || 'ko';
  const mode = parsed.diff ? 'diff'
    : parsed.audit ? 'audit'
    : parsed.score ? 'score'
    : 'rewrite';

  if (mode !== 'rewrite' && config.register) {
    throw inputError(
      `--register cannot be combined with --${mode}`,
      'Register changes rewritten prose; this mode inspects the source as-is.',
      'Remove --register/config register, or run a rewrite.'
    );
  }
  const registerResolution = resolveRegister({
    cliRegister: parsed.register,
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
  // Precedence: --api-key-file > PATINA_API_KEY_FILE > provider/default env vars.
  const apiKey = resolveHttpApiKey({
    apiKeyFile: parsed.apiKeyFile,
    envVars: providerHttpKeyEnvVars(provider?.apiKeyEnv),
  });
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

  const inputTexts = await loadInputs(parsed);
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  const { backends } = selectBackendChain({
    name: parsed.backend ?? config.backend ?? (resolved.baseURLSource !== 'default' ? 'openai-http' : undefined),
    model: resolved.model,
    modelSource: resolved.modelSource,
  });
  const backend = backends[0];

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

  const promptMode = resolvePromptMode({ backend: backend.name, model: resolved.model });

  const assets = promptAssets({ voice, scoring });
  const callArgs = backendCallArgs({ parsed, backends, resolved, timeoutMs, logger });
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
      ...assets,
      text,
      mode,
      register: registerResolution,
      promptMode,
      documentSignals: mode === 'rewrite' ? buildDocumentSignals({ text, lang }).signals : null,
      rewriteHeadings: parsed.rewriteHeadings,
      persona,
    }),
  }));

  logBatchSafetyPlan({
    jobs,
    backends,
    parsed,
    promptMode,
    timeoutMs,
    logger,
  });

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

        result = await invokeBackendChain({ ...callArgs, prompt, signal: cancellation.signal });
        cancellation.throwIfCanceled();

        // Meaning preservation belongs to the global rewrite contract. Persona
        // selection may change voice, never whether safety checks are enforced.
        if (mode === 'rewrite') {
          const stripQuiet = { warn() {} };
          if (parsed.verify) {
            const cleanRewrite = cleanRewriteOutput(result, { logger: stripQuiet });
            const verification = await verifyRewrite({
              original: text,
              rewrite: cleanRewrite,
              config,
              patterns,
              documentType,
              ...assets,
              persona,
              register: registerResolution,
              promptMode,
              documentSignals: buildDocumentSignals({ text, lang }).signals,
              rewriteHeadings: parsed.rewriteHeadings,
              apiKey: resolved.apiKey,
              baseURL: resolved.baseURL,
              model: resolved.model,
              callLLM: verifyCallLLM(callArgs, cancellation.signal),
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
          const meaningSafety = assessRewriteMeaningSafety(text, finalText, lang);
          if (!meaningSafety.ok) {
            if (meaningSafety.reason === 'numeric-claim-changed') {
              logger.warn('rewrite.meaning_guard', {
                message: '[patina] numeric claims in the source changed in the rewrite',
              });
            }
            meaningSafetyReason = meaningSafety.reason;
            if (verificationReport) {
              verificationReport.verified = false;
              verificationReport.reason = meaningSafety.reason;
            }
          }
          if (meaningSafetyReason) {
            process.exitCode = Math.max(Number(process.exitCode) || 0, 4);
          }
          // Advisory only — rewrite output, never the source. Does not touch exit codes.
          warnIfTooSmooth({ text: finalText, config, logger, lang });
          // Advisory only — compares source to output to catch a rewrite that traded
          // one slop class for another. Does not touch exit codes or the emitted text.
          // registerRequested exempts flattening the user explicitly asked for (--register/config).
          warnIfOvercorrected({ original: text, text: finalText, config, logger, lang, registerRequested: Boolean(registerResolution) });
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
            ? buildDeterministicAuditBackstop(text, { lang, repoRoot })
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

        // Surface weight drift between config and the score table the model
        // emitted. Warnings only — does not alter the output.
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
  }

}

async function runOfflineScore(parsed, { config, patterns, repoRoot }, logger) {
  const inputs = await loadInputs(parsed);
  const batchState = createBatchCircuitBreaker({ parsed, total: inputs.length });

  for (const { path, text, readError } of inputs) {
    try {
      if (readError) throw readError;
      const deterministicScore = scoreDeterministicSignals({
        text,
        config,
        patterns,
        repoRoot,
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

// Only called with a non-null score whose `overall` is finite (runOfflineScore
// checks both first).
function deterministicOnlyScoreResult(score) {
  const lines = [
    `Overall: ${score.overall}`,
    `Interpretation: ${score.interpretation ?? 'unavailable'}`,
    'Scoring: deterministic only; LLM-judged categories unavailable.',
    `Paragraphs: ${score.paragraphCount ?? 0}`,
    `Hot paragraphs: ${score.hotParagraphs ?? 0}`,
    `Signal score: ${score.signalScore ?? 0}`,
    `Evidence floor: ${score.evidenceFloor ?? 0}`,
  ];
  if (score.skipped && score.skipReason) {
    lines.push(`Skipped signal: ${score.skipReason}`);
  }
  return {
    raw: lines.join('\n'),
    overall: score.overall,
    interpretation: score.interpretation ?? null,
    llmScore: null,
    deterministicScore: score,
    scorePreference: 'deterministic-only',
  };
}

function buildPersonaReport({ rewritten, original, persona, lang, repoRoot, thresholds }) {
  const match = personaMatchScore({ text: rewritten, persona, lang, repoRoot, original });
  const overEditChurn = match.overEditChurn ?? 0;
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
  const backendName = String(backend || '').toLowerCase();
  if (backendName === 'openai-http' && String(model || '').toLowerCase().includes('gemini')) return 'minimal';
  return getBackendSafety(backendName).promptMode;
}

// Transport arguments every text backend call in a run shares; each call adds
// its prompt and abort signal.
function backendCallArgs({ parsed, backends, resolved, timeoutMs, logger }) {
  return {
    backends,
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
    model: resolved.model,
    modelSource: resolved.modelSource,
    timeout: timeoutMs,
    maxConcurrency: parsed.maxConcurrency,
    maxRetries: parsed.maxRetries,
    logger,
  };
}

// The injected LLM client for verifyRewrite: the run's backend chain with one
// attempt and no concurrency, bound to the run's cancellation signal.
function verifyCallLLM(callArgs, runSignal) {
  return ({ prompt, signal, timeout }) => invokeBackendChain({
    ...callArgs,
    prompt,
    signal: signal ?? runSignal,
    timeout: timeout ?? callArgs.timeout,
    maxConcurrency: 1,
    maxRetries: 0,
  });
}

// Prompt inputs shared by every rewrite and verify prompt in a run.
function promptAssets({ voice, scoring }) {
  return {
    voice: voice.body ? voice : null,
    scoring: scoring.body ? scoring : null,
  };
}

/**
 * Resolve a document type against language-specific policy limits.
 *
 * @param {string} documentTypeName Requested document type.
 * @param {string} lang Active language code.
 * @param {import('../logger.js').Logger} [logger] Logger with warn(event, payload).
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


/**
 * Advisory note before rewriting text the deterministic layer already reads as
 * human, since rewriting such text can add AI-likeness. Never blocks; opt out
 * with `over-editing-guard: false`.
 */
export function warnIfAlreadyHuman({ text, config = {}, repoRoot, logger, scorer = scoreDeterministicSignals }) {
  if (config['over-editing-guard'] === false) return null;
  let score;
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
