import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processIdentity, isSameProcess } from './study-job.mjs';
import { abortStudy, assertStudyActive, safeStudyError, studyCompletion } from './model-evaluation-transport.mjs';

const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 }); renameSync(temporary, path);
}

export function acquireStudyWriter(output, name) {
  if (!/^[a-z0-9.-]+$/i.test(name)) throw new Error('Invalid study writer');
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const path = resolve(output, '.writer.lock');
  const nonce = randomUUID();
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ identity: processIdentity(process.pid) || { pid: process.pid }, nonce, name })); }
  finally { closeSync(fd); }
  // No automatic stale-lock deletion. A maintainer must establish that its
  // recorded process is gone before clearing a lock left by SIGKILL/crash.
  return () => {
    const owner = JSON.parse(readFileSync(path, 'utf8'));
    if (owner.nonce !== nonce) throw new Error('Study writer ownership changed');
    unlinkSync(path);
  };
}

// Called under the dataset writer lock, before any paid call or receipt group
// is selected. Existing unbound directories require a separate audited migration.
export function bindStudyProtocol(output, protocolHash) {
  if (!/^[a-f0-9]{64}$/.test(protocolHash)) throw new Error('Invalid study protocol hash');
  const path = resolve(output, 'study-protocol.json');
  if (existsSync(path)) {
    const binding = JSON.parse(readFileSync(path, 'utf8'));
    if (binding.schemaVersion !== 1 || binding.protocolHash !== protocolHash) throw new Error('Study directory belongs to a different protocol');
    return;
  }
  if (readdirSync(output).some((name) => name !== '.writer.lock')) throw new Error('Existing study directory has no protocol binding; use a new directory or audited migration');
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, protocolHash })}\n`, { flag: 'wx', mode: 0o600 });
}

export function readUniqueRows(path, key) {
  const rows = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  const seen = new Set();
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) throw new Error('Duplicate study row');
    seen.add(id);
  }
  return rows;
}

export function sanitizedUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const fields = {
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.thinking_tokens,
    cached_read_tokens: usage.cached_read_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens,
    cache_write_tokens: usage.cache_write_tokens ?? usage.cache_creation_input_tokens,
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Number.isSafeInteger(value) && value >= 0 ? value : null]));
}

export function safeCallRecord(record, candidate) {
  const response = record.response || record.errorMetadata;
  const identities = Array.isArray(response?.effectiveModels) ? response.effectiveModels : [];
  const distinct = [...new Set(identities)];
  const attempts = (record.transportAttempts || []).map((attempt) => ({
    usage: sanitizedUsage(attempt.usage), outcome: ['success', 'ok'].includes(attempt.outcome) ? 'success' : attempt.outcome === 'error' ? 'error' : 'unknown',
    retryReason: ['initial', 'transport', 'network', 'timeout', 'temperature_schema', 'score_schema_parse'].includes(attempt.retryReason) ? attempt.retryReason : 'unknown',
  }));
  return { durationMs: Number.isFinite(response?.durationMs) ? response.durationMs : record.durationMs || 0,
    effectiveModels: identities.filter((model) => model === candidate.model),
    modelIdentityVerified: response?.identityEvidence !== 'cli-request-trace' && distinct.length === 1 && distinct[0] === candidate.model,
    identityEvidence: ['cli-request-trace', 'assistant-message'].includes(response?.identityEvidence) ? response.identityEvidence : 'response-metadata',
    usageEvidence: ['cli-session-trace', 'cli-model-usage'].includes(response?.usageEvidence) ? response.usageEvidence : 'response-metadata',
    mixedOrUnexpectedModel: distinct.length > 1 || distinct.some((model) => model !== candidate.model),
    usage: sanitizedUsage(response?.usage), attempts: record.notStarted ? 0 : response?.attempts || record.transportAttempts?.length || null,
    ...(response?.usageEvidence === 'cli-model-usage' ? {
      primaryUsage: sanitizedUsage(response.primaryUsage), auxiliaryUsage: sanitizedUsage(response.auxiliaryUsage),
      observedResultUsage: sanitizedUsage(response.observedResultUsage),
      accountedModelCount: Number.isSafeInteger(response.accountedModelCount) && response.accountedModelCount >= 0 ? response.accountedModelCount : null,
      auxiliaryModelCount: Number.isSafeInteger(response.auxiliaryModelCount) && response.auxiliaryModelCount >= 0 ? response.auxiliaryModelCount : null,
      usageComplete: response.usageComplete === true, attemptUnit: 'cli-invocation',
    } : {}),
    notStarted: record.notStarted === true,
    transportAttempts: attempts, attemptUsageComplete: attempts.length > 0 && attempts.every((attempt) => Number.isSafeInteger(attempt.usage?.prompt_tokens) && Number.isSafeInteger(attempt.usage?.completion_tokens)),
    status: record.state === 'completed' ? 'ok' : 'error',
    error: record.error || null, schema_valid: record.schemaValid ?? null,
    temperature: record.temperature ?? null,
    temperature_control: candidate.transport === 'claude-cli' ? 'unsupported-by-cli' : 'requested',
    recovered_from_journal: record.replayed === true };
}

export function acceptedStudyIdentity(call) {
  return call?.modelIdentityVerified === true;
}

export function createCallJournal({ directory, logicalId, candidate, complete = studyCompletion, envFile, validate, record = () => {}, persist = atomicJson }) {
  const save = (path, receipt) => {
    if (!path) return;
    try { persist(path, receipt); }
    catch {
      abortStudy();
      // An attempt observer is handled by the terminal receipt below. Other
      // failed writes must still expose the unresolved call to the row/report.
      if (receipt.state !== 'started' || receipt.transportAttempts.length === 0) {
        record(safeCallRecord({ ...receipt, state: 'error', error: 'study-journal-persistence-failed',
          notStarted: receipt.notStarted || (receipt.state === 'started' && receipt.transportAttempts.length === 0) }, candidate), null);
      }
      throw new Error('Study journal persistence failed');
    }
  };
  let index = 0;
  let replayedBudgetMs = 0;
  const group = directory ? resolve(directory, 'calls', hash(logicalId)) : null;
  if (group) mkdirSync(group, { recursive: true, mode: 0o700 });
  return async (args) => {
    assertStudyActive(); index++;
    const identity = { logicalId, index, candidate, promptHash: hash(args.prompt), temperature: args.temperature ?? 0.2,
      responseFormat: args.responseFormat ?? null, extraBody: args.extraBody ?? null };
    const requestHash = hash(identity);
    const path = group ? resolve(group, `${index}.private.json`) : null;
    let receipt = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    if (receipt && receipt.requestHash !== requestHash) throw new Error('Call journal semantics changed');
    if (receipt?.state === 'started') {
      // Neither observation expiry nor a stale state file authorizes another
      // paid request. Keep an indeterminate call visible for reconciliation.
      const alive = isSameProcess(receipt.owner);
      record(safeCallRecord({ ...receipt, state: 'error', error: alive ? 'study-call-inflight' : 'study-call-unobserved' }, candidate), null);
      throw new Error(alive ? 'Study call still in flight' : 'Study call outcome unobserved after interruption');
    }
    if (receipt) {
      receipt = { ...receipt, replayed: true };
      replayedBudgetMs += Math.max(0, receipt.response?.durationMs || receipt.durationMs || 0);
    }
    else {
      const started = Date.now();
      const remaining = (args.deadline ? args.deadline - Date.now() : args.timeout ?? 180_000) - replayedBudgetMs;
      if (remaining <= 0) {
        receipt = { schemaVersion: 1, state: 'error', requestHash, promptHash: identity.promptHash, temperature: identity.temperature,
          error: 'request-timeout', durationMs: 0, transportAttempts: [], startedAt: null, endedAt: new Date().toISOString(), notStarted: true };
        save(path, receipt);
        record(safeCallRecord(receipt, candidate), null);
        throw new Error('Study deadline reached before transport');
      }
      receipt = { schemaVersion: 1, state: 'started', requestHash, promptHash: identity.promptHash, temperature: identity.temperature,
        owner: processIdentity(process.pid) || { pid: process.pid }, startedAt: new Date().toISOString(), transportAttempts: [] };
      save(path, receipt);
      let persistenceFailure = null;
      try {
        const response = await complete(candidate, args.prompt, { envFile, timeoutMs: remaining,
          temperature: identity.temperature, responseFormat: args.responseFormat, extraBody: args.extraBody,
          onAttempt: (attempt) => {
            receipt.transportAttempts.push(attempt);
            try { save(path, receipt); }
            catch {
              persistenceFailure = new Error('Study journal persistence failed');
              // The production API intentionally isolates observer exceptions.
              // Abort its signal so no transport retry can precede persistence.
              abortStudy(); throw persistenceFailure;
            }
            args.onAttempt?.(attempt);
          } });
        if (persistenceFailure) throw persistenceFailure;
        receipt = { ...receipt, state: 'completed', response, endedAt: new Date().toISOString() };
      } catch (error) {
        receipt = { ...receipt, state: 'error', error: safeStudyError(persistenceFailure || error), errorMetadata: error.studyResult || null,
          durationMs: Date.now() - started, endedAt: new Date().toISOString() };
      }
      // Persist immediately after this call, before any parsing or later call.
      save(path, receipt);
    }
    if (receipt.replayed) for (const attempt of receipt.transportAttempts || []) args.onAttempt?.(attempt);
    let parsed = null;
    if (receipt.state === 'completed') {
      try { parsed = validate ? validate(receipt.response.text, args) : null; receipt.schemaValid = true; }
      catch { receipt.schemaValid = false; }
      save(path, receipt);
    }
    record(safeCallRecord(receipt, candidate), parsed);
    if (receipt.state !== 'completed') throw new Error(receipt.error);
    return receipt.response.text;
  };
}
