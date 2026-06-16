import {
  PROMPT_SIZE_WARNING_CHARS,
  formatLimit,
  getBackendSafety,
  resolveBackendMaxConcurrency,
  resolveBackendMaxRetries,
} from '../backends/contract.js';
import { runtimeError } from '../errors.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';

export function logBatchSafetyPlan({ jobs, backends, parsed, promptMode, timeoutMs, logger }) {
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

export function createBatchCircuitBreaker({ parsed, total }) {
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
        // Warm-up applies to explicit --max-failure-rate too (#434): a ratio
        // over a sample of 1 makes the first failed file 100% and turns any
        // rate < 1.0 into stop-on-first-failure, contradicting the documented
        // "stop when failure ratio exceeds r" semantics. Users who want
        // stop-on-first-failure have --max-failures 1.
        processed >= Math.min(total, 4) &&
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

export function shouldHandleBatchFailure(parsed, total) {
  return parsed.batch && total > 1;
}

function classifyRetryableStorm(err) {
  const message = String(err?.message || err || '');
  if (/\bHTTP\s+429\b/i.test(message) || err?.status === 429) return 'HTTP 429';
  if (/\bHTTP\s+503\b/i.test(message) || err?.status === 503) return 'HTTP 503';
  if (/Provider stream timed out/i.test(message)) return 'provider stream timeout';
  if (/timed out/i.test(message) || err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout';
  // Only EX_TEMPFAIL (75) counts as a retryable exit. Exit 1 is the generic
  // failure code for nearly every local-CLI error (auth, bad flags,
  // deterministic rejections) — three unrelated failures must not be labeled
  // a 'retryable storm' (#440); they stop the run via the failure budget.
  if (/\bexited with code\s+75\b/i.test(message)) return 'exit 75';
  if (/no final response body|empty response|final-message-only/i.test(message)) return 'empty response';
  return null;
}

export async function writeBatchOutput(parsed, inputPath, output) {
  if (inputPath === '-') {
    console.log(output);
    return;
  }

  // suffix/outdir are gated on truthiness below. validateOutputRouting (#504)
  // rejects empty-string suffix/outdir before we get here, so an empty value
  // can never reach the silent stdout fallback — the two layers agree.
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
