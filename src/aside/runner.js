import { spawn } from 'node:child_process';
import { link, lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { createTextEdits, isWellFormedText, normalizeProtectedSpans, validateProtectedText } from '../edit-controls.js';
import { detectLanguage } from '../prose-core.js';
import { droppedNumbers } from '../verify.js';
import { MPS_FLOOR, FIDELITY_FLOOR, isWebPersonaAllowed } from '../web-rewrite-contract.js';
import { AsideError, hashAsideText, normalizeAsideSettings, readAsideSettings, readAsideUtf8, resolveAsideWorkspace } from './options.js';

const CLI_PATH = fileURLToPath(new URL('../../bin/patina.js', import.meta.url));
const MAX_TEXT_LENGTH = 20_000;
const MAX_TEXT_BYTES = MAX_TEXT_LENGTH * 4;
const MAX_STDOUT_BYTES = 256 * 1024;
export const ASIDE_REWRITE_TIMEOUT_MS = 180_000;

function checkAbort(signal, deadline) {
  if (signal?.aborted) throw new AsideError('aborted');
  if (Date.now() >= deadline) throw new AsideError('timeout');
}

function validText(text) {
  return isWellFormedText(text) && text.length <= MAX_TEXT_LENGTH && text.trim().length > 0 && !text.includes('\0');
}

function mergeOverrides(settings, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(overrides))) throw new AsideError('invalid_overrides');
  if (Object.keys(overrides).some(key => !Object.hasOwn(settings, key))) throw new AsideError('unknown_setting');
  // An omitted CLI flag is undefined; it must not reset a saved selection.
  const selected = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  return normalizeAsideSettings({ ...settings, ...selected });
}

export function cliVerification(value) {
  const bounded = number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100;
  const reasons = ['passed', 'passed-on-retry', 'floor-not-met', 'retry-error', 'dropped-numbers', 'output-changed'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.verified !== 'boolean' || typeof value.retried !== 'boolean'
    || !bounded(value.mps) || !bounded(value.fidelity)
    || !bounded(value.mpsFloor) || !bounded(value.fidelityFloor) || !reasons.includes(value.reason)
    || typeof value.outputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.outputHash)) return null;
  if (value.verified && value.reason !== (value.retried ? 'passed-on-retry' : 'passed')) return null;
  // Whitelist scalar evidence only; never reflect arbitrary child JSON or text.
  return { verified: value.verified, mps: value.mps, fidelity: value.fidelity,
    retried: value.retried, reason: value.reason, mpsFloor: value.mpsFloor, fidelityFloor: value.fidelityFloor,
    outputHash: value.outputHash };
}

function bindTerms(original, terms) {
  const spans = terms.flatMap(text => {
    const start = original.indexOf(text);
    // Workspace terms are a reusable glossary, not mandatory draft content.
    return start < 0 ? [] : [{ start, end: start + text.length, text }];
  });
  try {
    const normalized = normalizeProtectedSpans(original, spans);
    if (!validateProtectedText(original, original, normalized).ok) throw new AsideError('protected_text_ambiguous');
    return normalized;
  } catch {
    throw new AsideError('protected_text_ambiguous');
  }
}

async function outputDestination(workspace, inputPath, outputPath) {
  const extension = extname(inputPath);
  const fallback = `${inputPath.slice(0, inputPath.length - extension.length)}.patina${extension}`;
  const path = outputPath === undefined ? fallback : outputPath;
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) throw new AsideError('invalid_output_path');
  const resolved = resolve(workspace, path);
  if (resolved === inputPath) throw new AsideError('output_is_input');
  try {
    const target = join(await realpath(dirname(resolved)), basename(resolved));
    await requireMissingOutput(target);
    return target;
  } catch (error) {
    throw error instanceof AsideError ? error : new AsideError('invalid_output_path');
  }
}

async function requireMissingOutput(path) {
  try {
    await lstat(path);
    throw new AsideError('output_exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Spawn the shipped CLI only. Drafts travel in a private snapshot file. */
export function invokeCli(args, { cwd, env, signal, timeoutMs, spawnImpl }) {
  return new Promise((resolveResult, reject) => {
    let child;
    let timer;
    let settled = false;
    const chunks = [];
    let bytes = 0;
    const finish = (error, exitCode = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        // A separate POSIX process group includes the backend's children.
        // Windows can only guarantee termination of the direct CLI process.
        try { if (process.platform !== 'win32' && child?.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
        try { child?.kill('SIGKILL'); } catch {}
        child?.stdout?.destroy();
        child?.unref();
        reject(error);
      } else {
        try {
          resolveResult({ exitCode, stdout: exitCode === 0 || exitCode === 4 ? new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) : '' });
        } catch {
          if (exitCode === 4) resolveResult({ exitCode, stdout: '' });
          else reject(new AsideError('invalid_cli_json'));
        }
      }
    };
    const onAbort = () => finish(new AsideError('aborted'));
    try {
      if (signal?.aborted) return onAbort();
      child = spawnImpl(process.execPath, [CLI_PATH, ...args], {
        cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.on('error', () => finish(new AsideError('cli_start_failed')));
      child.on('close', code => finish(null, code));
      child.stdout.on('error', () => finish(new AsideError('cli_output_failed')));
      child.stdout.on('data', chunk => {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_STDOUT_BYTES) return finish(new AsideError('cli_output_limit'));
        chunks.push(buffer);
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(new AsideError('timeout')), timeoutMs);
      if (signal?.aborted) onAbort();
    } catch { finish(new AsideError('cli_start_failed')); }
  });
}

/**
 * CLI-first rewrite adapter. All expected failures return a content-free result.
 * `env`, `spawnImpl`, and `tempRoot` are programmatic test seams, not CLI/UI
 * options. Saved settings come from workspace/.patina/aside.json; `overrides`
 * accepts the same validated, nonsecret fields for this invocation only.
 *
 * Forced CLI --verify must supply valid JSON evidence bound to the output's
 * exact UTF-8 SHA-256 hash and exit zero. Both
 * scores must meet the configured floors AND Aside's 70/70 minimum. The
 * temporary config never lowers an ambient floor. Exit 4 always rejects,
 * even when stdout contains the CLI's closest candidate.
 * Verified results identify an atomically created output file; they never
 * return drafts or raw backend diagnostics. No existing output is replaced.
 */
export async function runAsideRewrite({
  workspace, inputPath, outputPath, signal, overrides = {},
  timeoutMs = ASIDE_REWRITE_TIMEOUT_MS, spawnImpl = spawn, env = process.env, tempRoot = tmpdir(),
} = {}) {
  const result = {
    schemaVersion: 1, ok: false, status: 'error', code: null, exitCode: 1,
    configured: false, settings: null, settingsHash: null,
    inputPath: null, outputPath: null, sourceHash: null, rewriteHash: null,
    effectiveOptions: null, changes: null,
    verification: { enforced: true, verified: false, evidence: 'cli-verify-json', exitCode: null, cliVerified: null,
      mps: null, fidelity: null, retried: null, reason: null, configuredFloors: null, outputHash: null,
      mpsFloor: MPS_FLOOR, fidelityFloor: FIDELITY_FLOOR, protectedTermsVerified: false },
  };
  let temporary;
  let staging;
  try {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new AsideError('invalid_timeout');
    const deadline = Date.now() + timeoutMs;
    checkAbort(signal, deadline);
    const root = await resolveAsideWorkspace(workspace);
    Object.assign(result, await readAsideSettings(root));
    const settings = mergeOverrides(result.settings, overrides);
    if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0')) throw new AsideError('invalid_input_path');
    const input = resolve(root, inputPath);
    const original = await readAsideUtf8(input, MAX_TEXT_BYTES, 'invalid_input');
    if (!validText(original)) throw new AsideError('invalid_input');
    result.inputPath = input;
    result.sourceHash = hashAsideText(original);
    const output = await outputDestination(root, input, outputPath);
    const language = detectLanguage('', original, settings.language);
    if (settings.persona !== null && !isWebPersonaAllowed(language, settings.persona)) throw new AsideError('persona_language_mismatch');
    if (settings.documentType === 'namuwiki' && language !== 'ko') throw new AsideError('document_type_language_mismatch');
    const spans = bindTerms(original, settings.protectedTerms);
    result.verification.protectedTermsApplied = spans.length;
    result.verification.protectedTermsAbsent = settings.protectedTerms.length - spans.length;
    result.effectiveOptions = { ...settings, language, verify: true, format: 'json' };
    checkAbort(signal, deadline);
    temporary = await mkdtemp(join(tempRoot, 'patina-aside-run-'));
    const snapshot = join(temporary, 'input.txt');
    const config = join(temporary, 'options.json');
    // JSON is a YAML subset. Explicit nulls override ambient home/project
    // personas and registers without moving HOME or breaking CLI credentials.
    await writeFile(config, JSON.stringify({
      language, 'document-type': settings.documentType, persona: settings.persona,
      register: settings.register,
      ...(settings.backend === null ? {} : { backend: settings.backend }),
      ...(settings.model === null ? {} : { model: settings.model }),
    }), { flag: 'wx', mode: 0o600 });
    await writeFile(snapshot, original, { flag: 'wx', mode: 0o600 });
    const args = ['--verify', '--format', 'json', '--quiet', '--no-interactive', '--config', config,
      '--timeout-ms', String(timeoutMs), '--max-retries', '0', '--', snapshot];
    checkAbort(signal, deadline);
    const child = await invokeCli(args, { cwd: root, env, signal, timeoutMs: deadline - Date.now(), spawnImpl });
    result.verification.exitCode = child.exitCode;
    if (child.exitCode === 130) throw new AsideError('aborted');
    if (child.exitCode !== 0 && child.exitCode !== 4) throw new AsideError('cli_failed');
    let payload;
    try { payload = JSON.parse(child.stdout); } catch {
      if (child.exitCode === 4) return { ...result, status: 'rejected', code: 'verification_rejected', exitCode: 4 };
      throw new AsideError('invalid_cli_json');
    }
    const proof = cliVerification(payload?.verification);
    if (proof) Object.assign(result.verification, {
      cliVerified: proof.verified, mps: proof.mps, fidelity: proof.fidelity, retried: proof.retried, reason: proof.reason,
      outputHash: proof.outputHash,
      configuredFloors: { mps: proof.mpsFloor, fidelity: proof.fidelityFloor },
      mpsFloor: Math.max(MPS_FLOOR, proof.mpsFloor), fidelityFloor: Math.max(FIDELITY_FLOOR, proof.fidelityFloor),
    });
    if (child.exitCode === 4) return { ...result, status: 'rejected', code: 'verification_rejected', exitCode: 4 };
    if (!payload || payload.mode !== 'rewrite' || payload.format !== 'json' || !validText(payload.output)) throw new AsideError('invalid_cli_output');
    if (!proof) throw new AsideError('invalid_cli_verification');
    const rewriteHash = hashAsideText(payload.output);
    if (proof.outputHash !== rewriteHash) {
      return { ...result, status: 'rejected', code: 'verification_output_mismatch', exitCode: 4 };
    }
    if (!proof.verified || proof.mps < result.verification.mpsFloor || proof.fidelity < result.verification.fidelityFloor) {
      return { ...result, status: 'rejected', code: 'verification_rejected', exitCode: 4 };
    }
    const rewritten = payload.output;
    if (droppedNumbers(original, rewritten).length) return { ...result, status: 'rejected', code: 'numbers_changed', exitCode: 4 };
    const protectedCheck = validateProtectedText(original, rewritten, spans);
    if (!protectedCheck.ok) return { ...result, status: 'rejected', code: protectedCheck.reason, exitCode: 4 };
    const edits = createTextEdits(original, rewritten);
    const changes = { changed: original !== rewritten, editCount: edits.length,
      originalLength: original.length, rewriteLength: rewritten.length,
      removedLength: edits.reduce((sum, edit) => sum + edit.end - edit.start, 0),
      addedLength: edits.reduce((sum, edit) => sum + edit.replacement.length, 0) };
    checkAbort(signal, deadline);
    // A hard link publishes a complete file atomically and fails on ANY
    // existing destination, including a symlink created during the CLI run.
    staging = await mkdtemp(join(dirname(output), '.patina-aside-output-'));
    const stagedOutput = join(staging, 'output');
    const file = await open(stagedOutput, 'wx', 0o600);
    try { await file.writeFile(rewritten, 'utf8'); await file.sync(); } finally { await file.close(); }
    let latest;
    try { latest = await readAsideUtf8(input, MAX_TEXT_BYTES, 'input_changed'); } catch { throw new AsideError('input_changed'); }
    if (hashAsideText(latest) !== result.sourceHash) throw new AsideError('input_changed');
    checkAbort(signal, deadline);
    try { await link(stagedOutput, output); } catch (error) {
      throw new AsideError(error.code === 'EEXIST' ? 'output_exists' : 'output_write_failed');
    }
    return {
      ...result, ok: true, status: 'verified', code: null, exitCode: 0, outputPath: output, rewriteHash, changes,
      verification: { ...result.verification, verified: true, protectedTermsVerified: true },
    };
  } catch (error) {
    const code = error instanceof AsideError ? error.code : 'rewrite_failed';
    const rejection = ['input_changed', 'invalid_cli_json', 'invalid_cli_output', 'invalid_cli_verification', 'cli_output_limit'].includes(code);
    return { ...result, status: rejection ? 'rejected' : 'error', code,
      exitCode: rejection ? 4 : code.startsWith('invalid_') ? 2 : 1 };
  } finally {
    // Cleanup errors must not replace the content-free result with an OS error.
    if (temporary) try { await rm(temporary, { recursive: true, force: true }); } catch {}
    if (staging) try { await rm(staging, { recursive: true, force: true }); } catch {}
  }
}
