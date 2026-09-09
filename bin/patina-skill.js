#!/usr/bin/env node
// Checkout-local skill boundary. Only builtins load before the initial receipt.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const CLI_PATH = fileURLToPath(new URL('./patina.js', import.meta.url));
const BUDGET_MS = 180_000;
const MAX_BYTES = 80_000;
const MODES = ['rewrite', 'audit', 'score', 'diff'];
const VALUE_FLAGS = ['--input', '--mode', '--lang', '--document-type', '--persona', '--register', '--backend', '--model', '--config', '--provider', '--api-key-file'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new SkillError(code); };
class SkillError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function options(argv) {
  const result = { mode: 'rewrite' };
  let modeSet = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--audit', '--score', '--diff', '--strict'].includes(flag)) {
      if (modeSet) fail('invalid_arguments');
      result.mode = flag === '--strict' ? 'rewrite' : flag.slice(2);
      modeSet = true;
    } else {
      if (!VALUE_FLAGS.includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('invalid_arguments');
      const key = flag.slice(2);
      if (key === 'mode' ? modeSet : Object.hasOwn(result, key)) fail('invalid_arguments');
      result[key] = argv[++i];
      if (key === 'mode') modeSet = true;
    }
  }
  if (!result.input || !MODES.includes(result.mode)) fail('invalid_arguments');
  // These are identifiers, not prose or arbitrary command-line fragments.
  for (const key of ['lang', 'document-type', 'persona', 'register', 'backend', 'model', 'provider']) {
    if (result[key] !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._/:@+-]{0,127}$/.test(result[key])) fail('invalid_arguments');
  }
  return result;
}

async function safeDirectories(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe_run_storage');
  }
}

async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await safeDirectories(path);
  const info = await lstat(path);
  if (process.getuid && info.uid !== process.getuid()) fail('unsafe_run_storage');
  await chmod(path, 0o700);
}

async function privateFile(path, bytes) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}

async function atomicReceipt(directory, receipt) {
  await safeDirectories(directory);
  const staging = join(directory, `receipt-${randomUUID()}.tmp`);
  try {
    await privateFile(staging, JSON.stringify(receipt, null, 2) + '\n');
    await rename(staging, join(directory, 'receipt.json'));
  } finally {
    await removeFile(staging);
  }
}

async function removeFile(path) {
  try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function inputBytes(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) fail('invalid_input');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size <= MAX_BYTES) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_BYTES) fail('invalid_input');
    }
    return buffer.subarray(0, size);
  } catch { fail('invalid_input'); } finally { await file?.close(); }
}

function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('invalid_input'); }
}

function backendAvailable(name, signal, timeoutMs) {
  return new Promise((resolveResult, reject) => {
    let settled = false;
    const child = spawn(name.replace(/-cli$/, ''), ['--version'], {
      shell: false, windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32',
    });
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code) {
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
        child.kill('SIGKILL');
        reject(new SkillError(code));
      } else resolveResult();
    };
    const onAbort = () => finish('aborted');
    // Node's spawn({timeout}) timer can survive ENOENT; own and clear it on
    // every terminal event so unavailable backends do not keep the helper alive.
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    child.once('error', () => finish('backend_unavailable'));
    child.once('close', code => finish(code === 0 ? null : 'backend_unavailable'));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** Programmatic spawn seam replaces only the existing shipped-CLI transport. */
export async function runSkill(argv, { spawnImpl = spawn, signal } = {}) {
  const deadline = Date.now() + BUDGET_MS;
  const remaining = () => {
    if (signal?.aborted) fail('aborted');
    if (Date.now() >= deadline) fail('timeout');
    return deadline - Date.now();
  };
  const receipt = { schemaVersion: 1, runId: null, mode: null, status: 'running', code: null,
    cliPath: CLI_PATH, cliVersion: null, nodeVersion: process.versions.node, flags: [], selection: null,
    invocationStarted: false, cliExitCode: null, exitCode: null, sourceHash: null, outputHash: null,
    verification: null, floors: null };
  const summary = { schemaVersion: 1, ok: false, status: 'error', code: null, exitCode: 1,
    receiptPath: null, outputPath: null, reportPath: null, sourceHash: null, outputHash: null };
  let directory;
  let artifact;
  let stage = 'receipt_write_failed';
  try {
    await safeDirectories(homedir());
    const managed = join(homedir(), '.patina');
    await privateDirectory(managed);
    const runs = join(managed, 'runs');
    await privateDirectory(runs);
    directory = await mkdtemp(join(runs, 'run-'));
    await chmod(directory, 0o700);
    receipt.runId = directory.slice(runs.length + 1);
    await atomicReceipt(directory, receipt);
    summary.receiptPath = join(directory, 'receipt.json');
    stage = 'invalid_arguments';
    const selected = options(argv);
    receipt.mode = selected.mode;
    stage = 'unsupported_node';
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 18 || (major === 18 && minor < 1)) fail('unsupported_node');
    remaining();
    stage = 'cli_missing';
    if (!(await lstat(CLI_PATH)).isFile()) fail('cli_missing');
    stage = 'dependency_unavailable';
    const [{ invokeCli, cliVerification }, { loadConfig }, { selectBackendChain },
      { selectProvider, resolveProviderConfig }, { resolveHttpApiKey, providerHttpKeyEnvVars },
      { droppedNumbers }, { isWellFormedText }, { resolveLocalCliModel }] = await Promise.all([
      import('../src/aside/runner.js'), import('../src/config.js'), import('../src/backends/index.js'),
      import('../src/providers.js'), import('../src/auth.js'), import('../src/verify.js'), import('../src/edit-controls.js'), import('../src/model-defaults.js'),
    ]);
    const invoke = args => invokeCli(args, { cwd: process.cwd(), env: process.env, signal, timeoutMs: remaining(),
      spawnImpl: (...parameters) => {
        const child = spawnImpl(...parameters);
        if (!args.includes('--version') && child.pid) receipt.invocationStarted = true;
        return child;
      },
    });
    stage = 'cli_setup_failed';
    const version = await invoke(['--version']);
    if (version.exitCode !== 0 || !/^patina \d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version.stdout.trim())) fail('cli_setup_failed');
    receipt.cliVersion = version.stdout.trim();
    stage = 'invalid_config';
    const config = loadConfig(undefined, selected.config ? { overridePath: resolve(selected.config) } : {});
    const provider = selectProvider(selected.provider ?? config.provider);
    stage = 'backend_auth_missing';
    const apiKey = resolveHttpApiKey({ apiKeyFile: selected['api-key-file'], envVars: providerHttpKeyEnvVars(provider?.apiKeyEnv) });
    stage = 'invalid_config';
    const resolved = resolveProviderConfig({ provider, apiKey, baseURL: config.baseURL ?? config['base-url'], model: selected.model ?? config.model });
    const backendName = selected.backend ?? config.backend ?? (resolved.baseURLSource !== 'default' ? 'openai-http' : undefined);
    const chain = selectBackendChain({ name: backendName, model: resolved.model, modelSource: resolved.modelSource });
    if (chain.backends.length !== 1) fail('backend_chain_not_supported');
    const backend = chain.backends[0];
    const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:@+-]{0,127}$/.test(value) ? value : null;
    if (!identifier(resolved.model)) fail('invalid_config');
    receipt.selection = {
      requestedBackend: selected.backend ?? identifier(config.backend), backend: backend.name,
      backendSource: selected.backend ? 'flag' : config.backend ? 'config' : backendName ? 'endpoint' : chain.reason,
      requestedModel: selected.model ?? identifier(config.model),
      model: resolveLocalCliModel({ backendName: backend.name, model: resolved.model, modelSource: resolved.modelSource }),
      modelSource: selected.model ? 'flag' : config.model ? 'config' : resolved.modelSource,
    };
    if (backend.name === 'kimi-cli') fail('backend_argv_exposes_input');
    if (backend.name === 'openai-http') {
      if (!resolved.apiKey) fail('backend_auth_missing');
    } else {
      await backendAvailable(backend.name, signal, remaining());
      if (!backend.isAuthenticated()) fail('backend_auth_missing');
    }
    stage = 'invalid_input';
    const sourcePath = resolve(selected.input);
    const bytes = await inputBytes(sourcePath);
    const original = decode(bytes);
    const valid = text => isWellFormedText(text) && text.trim().length > 0 && !text.includes('\0');
    if (!valid(original) || original.length > 20_000) fail('invalid_input');
    receipt.sourceHash = hash(bytes);
    summary.sourceHash = receipt.sourceHash;
    const floors = { mps: config.verification?.['mps-floor'] ?? 70, fidelity: config.verification?.['fidelity-floor'] ?? 70 };
    if (Object.values(floors).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) fail('invalid_config');
    if (selected.mode === 'rewrite') receipt.floors = { mps: Math.max(70, floors.mps), fidelity: Math.max(70, floors.fidelity) };
    // Snapshot the merged config, not provider resolution: default models must
    // stay implicit so each local CLI retains its existing model policy. The
    // child loads only this snapshot, including absent keys and exact arrays.
    const snapshot = { ...config, 'document-type': selected['document-type'] ?? config.documentType, backend: backend.name };
    delete snapshot.documentType;
    for (const [flag, key] of [['lang', 'language'], ['persona', 'persona'], ['register', 'register'], ['model', 'model'], ['provider', 'provider']]) {
      if (selected[flag] !== undefined) snapshot[key] = selected[flag];
    }
    const input = join(directory, 'input.txt');
    const configPath = join(directory, 'config.json');
    stage = 'snapshot_write_failed';
    await privateFile(input, bytes);
    await privateFile(configPath, JSON.stringify(snapshot));
    const args = [selected.mode === 'rewrite' ? '--verify' : `--${selected.mode}`, '--format', 'json', '--quiet', '--no-interactive',
      '--config-snapshot', configPath, '--timeout-ms', String(remaining()), '--max-retries', '0'];
    if (selected['api-key-file']) args.push('--api-key-file', resolve(selected['api-key-file']));
    args.push('--', input);
    receipt.flags = args.map((arg, index) => arg === input ? '<private-input>' : arg === configPath ? '<private-config>'
      : args[index - 1] === '--api-key-file' ? '<api-key-file>' : arg);
    stage = 'receipt_write_failed';
    await atomicReceipt(directory, receipt);
    stage = 'cli_failed';
    const child = await invoke(args);
    receipt.cliExitCode = child.exitCode;
    if (child.exitCode === 130) fail('aborted');
    if (child.exitCode !== 0 && child.exitCode !== 4) fail('cli_failed');
    let payload;
    try { payload = JSON.parse(child.stdout); } catch {
      fail(child.exitCode === 4 ? 'verification_rejected' : 'invalid_cli_json');
    }
    const proof = selected.mode === 'rewrite' ? cliVerification(payload?.verification) : null;
    receipt.verification = proof;
    if (child.exitCode === 4) fail('verification_rejected');
    if (!payload || payload.mode !== selected.mode || payload.format !== 'json' || !valid(payload.output)) fail('invalid_cli_output');
    if (selected.mode === 'rewrite') {
      if (!proof) fail('invalid_cli_verification');
      if (hash(payload.output) !== proof.outputHash) fail('verification_output_mismatch');
      if (!proof.verified || proof.mps < Math.max(receipt.floors.mps, proof.mpsFloor)
        || proof.fidelity < Math.max(receipt.floors.fidelity, proof.fidelityFloor)) fail('verification_rejected');
      if (droppedNumbers(original, payload.output).length) fail('numbers_changed');
    }
    stage = 'input_changed';
    let latest;
    try { latest = await inputBytes(sourcePath); } catch { fail('input_changed'); }
    if (hash(latest) !== receipt.sourceHash) fail('input_changed');
    remaining();
    const accepted = selected.mode === 'rewrite' ? payload.output : child.stdout;
    artifact = join(directory, selected.mode === 'rewrite' ? 'output.txt' : 'report.json');
    stage = 'output_write_failed';
    await safeDirectories(directory);
    await privateFile(artifact, accepted);
    receipt.outputHash = hash(accepted);
    stage = 'cleanup_failed';
    await removeFile(input);
    await removeFile(configPath);
    remaining();
    receipt.status = selected.mode === 'rewrite' ? 'verified' : 'unverified-report';
    receipt.exitCode = 0;
    stage = 'receipt_write_failed';
    await atomicReceipt(directory, receipt);
    return { ...summary, ok: true, status: receipt.status, code: null, exitCode: 0,
      outputPath: selected.mode === 'rewrite' ? artifact : null, reportPath: selected.mode === 'rewrite' ? null : artifact,
      outputHash: receipt.outputHash };
  } catch (error) {
    let code = error instanceof SkillError ? error.code
      : ['aborted', 'timeout', 'cli_start_failed', 'cli_output_failed', 'cli_output_limit', 'invalid_cli_json'].includes(error.code) ? error.code : stage;
    if (directory) {
      try {
        await safeDirectories(directory);
        for (const name of ['input.txt', 'config.json', 'output.txt', 'report.json']) await removeFile(join(directory, name));
      } catch { code = 'cleanup_failed'; }
    }
    const rejection = ['verification_rejected', 'verification_output_mismatch', 'invalid_cli_json', 'invalid_cli_output',
      'invalid_cli_verification', 'cli_output_limit', 'numbers_changed', 'input_changed'].includes(code);
    const exitCode = rejection ? 4 : code === 'aborted' ? 130 : ['invalid_arguments', 'invalid_config', 'invalid_input'].includes(code) ? 2 : 1;
    Object.assign(receipt, { status: rejection ? 'rejected' : 'error', code, exitCode, outputHash: null });
    if (directory) {
      try { await atomicReceipt(directory, receipt); summary.receiptPath = join(directory, 'receipt.json'); }
      catch { return { ...summary, code: 'receipt_write_failed', exitCode: 1 }; }
    }
    return { ...summary, status: receipt.status, code, exitCode };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
    console.log('Usage: node bin/patina-skill.js --input FILE [--mode rewrite|audit|score|diff] [--lang LANG] [--document-type TYPE] [--persona NAME] [--register casual|professional] [--backend NAME] [--model ID] [--config FILE] [--provider NAME] [--api-key-file FILE]\nAliases: --audit, --score, --diff; --strict enforces the same verified rewrite.\nReturns content-free JSON. Rewrite output requires verification; reports are unverified.');
  } else {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
    const result = await runSkill(process.argv.slice(2), { signal: controller.signal });
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    console.log(JSON.stringify(result));
    process.exitCode = result.exitCode;
  }
}
