import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import * as claudeCli from '../../src/backends/claude-cli.js';
import * as codexCli from '../../src/backends/codex-cli.js';
import { isTimeoutError, withBackendConcurrencySlot } from '../../src/backends/contract.js';
import * as geminiCli from '../../src/backends/gemini-cli.js';
import * as kimiCli from '../../src/backends/kimi-cli.js';
import * as agyCli from '../../src/backends/agy-cli.js';

// agy-cli refuses to launch when the host's Antigravity settings auto-allow
// anything; its lifecycle rows are skipped (not failed) on such hosts.
function agyLaunchable() {
  try { agyCli.assertAgySettingsSafe(agyCli.readAgySettings()); return true; } catch { return false; }
}

const BACKENDS = [
  { command: 'claude', backend: claudeCli },
  { command: 'codex', backend: codexCli },
  { command: 'gemini', backend: geminiCli },
  { command: 'kimi', backend: kimiCli },
  ...(agyLaunchable() ? [{ command: 'agy', backend: agyCli }] : []),
];

// The fixture uses a POSIX executable and process.kill(pid, 0) as the
// liveness probe. Keep the limitation explicit rather than implying Windows
// coverage from a script that cannot run there.
const POSIX_PROCESS_TEST = new Set([
  'aix', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos',
]).has(process.platform);

const FAKE_CLI_SOURCE = [
  '#!/usr/bin/env node',
  "const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');",
  "const { spawn } = require('node:child_process');",
  "const { basename } = require('node:path');",
  'const command = basename(process.argv[1]);',
  'const recordPath = process.env.PATINA_FAKE_CLI_RECORD;',
  'const processRecordPath = process.env.PATINA_TEST_PROCESS_RECORD;',
  'const mode = process.env.PATINA_FAKE_CLI_MODE || "hang-first";',
  'if (process.argv.includes("--version")) {',
  '  process.stdout.write("2.1.261\\n");',
  '  process.exit(0);',
  '}',
  'function events() {',
  '  if (!recordPath) return [];',
  '  try {',
  '    return readFileSync(recordPath, "utf8").split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line));',
  '  } catch (error) {',
  '    if (error?.code === "ENOENT") return [];',
  '    throw error;',
  '  }',
  '}',
  'function emit(type, fields = {}) {',
  '  if (!recordPath) return;',
  '  appendFileSync(recordPath, `${JSON.stringify({ type, ...fields })}\\n`);',
  '}',
  'const invocation = events().filter((event) => event.type === "ready").length + 1;',
  'process.on("SIGTERM", () => emit("sigterm-ignored"));',
  'const workerScript = [',
  '  "const { appendFileSync } = require(\\"node:fs\\");",',
  '  "const path = process.env.PATINA_TEST_PROCESS_RECORD;",',
  '  "if (path) appendFileSync(path, JSON.stringify({ type: \\"worker-ready\\", pid: process.pid }) + \\"\\\\n\\");",',
  '  "process.on(\\"SIGTERM\\", () => {});",',
  '  "setInterval(() => {}, 1000);",',
  '].join("\\n");',
  'const worker = processRecordPath',
  '  ? spawn(process.execPath, ["-e", workerScript], { stdio: ["ignore", "ignore", "ignore"] })',
  '  : null;',
  'if (worker && processRecordPath) {',
  '  appendFileSync(processRecordPath, JSON.stringify({ parent: process.pid, child: worker.pid }) + "\\n");',
  '}',
  'const leaderGate = process.env.PATINA_TEST_LEADER_GATE;',
  'function afterLeaderGate(run) {',
  '  if (!leaderGate) { run(); return; }',
  '  const poll = setInterval(() => {',
  '    try {',
  '      readFileSync(leaderGate);',
  '      clearInterval(poll);',
  '      run();',
  '    } catch {}',
  '  }, 5);',
  '}',
  'emit("ready", { pid: process.pid, cwd: process.cwd(), invocation });',
  'const chunks = [];',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", (chunk) => chunks.push(chunk));',
  'process.stdin.on("end", () => {',
  '  if (mode === "hang-first" && invocation === 1) {',
  '    setInterval(() => {}, 1000);',
  '    return;',
  '  }',
  '  if (mode === "fail-first" && invocation === 1) {',
  '    emit("failed", { code: 75 });',
  '    process.stderr.write("synthetic CLI failure\\n");',
  '    process.exit(75);',
  '    return;',
  '  }',
  '  afterLeaderGate(() => {',
  '    const prompt = chunks.join("");',
  '    const register = /casual/i.test(prompt) ? "casual"',
  '      : /professional/i.test(prompt) ? "professional" : "unspecified";',
  '    const id = process.env.PATINA_FAKE_CLI_ID || command;',
  '    const output = `synthetic-${id}-register-${register}-invocation-${invocation}`;',
  '    if (command === "codex") {',
  '      const args = process.argv.slice(2);',
  '      const index = args.indexOf("--output-last-message");',
  '      if (index < 0 || !args[index + 1]) {',
  '        emit("failed", { code: 64 });',
  '        process.exit(64);',
  '        return;',
  '      }',
  '      writeFileSync(args[index + 1], output);',
  '    } else if (command === "kimi") {',
  '      process.stdout.write(`${JSON.stringify({ role: "assistant", content: output })}\\n`);',
  '    } else if (command === "agy") {',
  '      process.stdout.write(`${JSON.stringify({ event: "init", conversation_id: "c", init: { cwd: process.cwd(), tools: [], permission_mode: "request-review" } })}\\n`);',
  '      process.stdout.write(`${JSON.stringify({ event: "result", result: { conversation_id: "c", status: "SUCCESS", response: output, num_turns: 1 } })}\\n`);',
  '    } else {',
  '      process.stdout.write(output);',
  '    }',
  '    emit("exit", { code: 0, invocation });',
  '    process.exit(0);',
  '  });',
  '});',
  '',
].join('\n');

function readEvents(recordPath) {
  try {
    return readFileSync(recordPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

// Poll only for an observable fixture event. This is a bounded wait, not a
// delay used to guess that a process or directory has changed state.
async function waitForEvent(recordPath, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const event = readEvents(recordPath).find(predicate);
    if (event) return event;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`timed out waiting for fake CLI event in ${recordPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, remaining)));
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function pidState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'missing';
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const state = stat.slice(close + 1).trim().split(/\s+/)[0];
      return state || 'unknown';
    } catch (error) {
      if (error?.code === 'ENOENT') return 'missing';
    }
  }
  return pidIsAlive(pid) ? 'running' : 'missing';
}

function pidRunning(pid) {
  const state = pidState(pid);
  // Linux zombies still answer process.kill(pid, 0), but are no longer
  // executing. Treat Z as not running so the assertion checks process state,
  // not just a potentially misleading PID probe.
  return state !== 'missing' && state !== 'Z';
}

// A SIGKILLed child may remain a zombie until Node emits the adapter's close
// event, so probe until the kernel reports ESRCH instead of sleeping and
// assuming the kill worked.
async function waitForPidDeath(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!pidRunning(pid)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`child pid ${pid} remained alive`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, remaining)));
  }
}

function userSlotSegment() {
  try {
    const { uid, username } = userInfo();
    return Number.isInteger(uid) && uid >= 0
      ? `uid-${uid}`
      : String(username || 'user').replace(/[^a-z0-9._-]+/gi, '_');
  } catch {
    return 'user';
  }
}

function slotRoot(backendName) {
  return join(
    tmpdir(),
    `patina-backend-slots-${userSlotSegment()}`,
    String(backendName).replace(/[^a-z0-9._-]+/gi, '_'),
  );
}

function ownerForSlot(path) {
  try {
    return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

function ownSlotPaths(backendName) {
  const root = slotRoot(backendName);
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^slot-\d+$/.test(entry.name))
      .map((entry) => join(root, entry.name))
      .filter((path) => ownerForSlot(path)?.pid === process.pid);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function assertNoOwnedSlots(backendName) {
  assert.deepEqual(ownSlotPaths(backendName), [], `${backendName} left a slot owned by this test`);
}

function removeOwnedSlots(backendName) {
  for (const path of ownSlotPaths(backendName)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function restoreEnv(key, previous) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

function writeFakeCli(binDir, command) {
  const path = join(binDir, command);
  writeFileSync(path, FAKE_CLI_SOURCE, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function spawnUnrelatedSentinel(recordPath) {
  const script = [
    "const { appendFileSync } = require('node:fs');",
    'const path = process.env.PATINA_TEST_SENTINEL_RECORD;',
    'appendFileSync(path, JSON.stringify({ type: "sentinel-ready", pid: process.pid }) + "\\n");',
    'process.on("SIGTERM", () => {});',
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n');
  const sentinel = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PATINA_TEST_SENTINEL_RECORD: recordPath },
  });
  sentinel.unref();
  return sentinel.pid;
}

function processGroupId(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 1).trim().split(/\s+/);
    // Fields after comm/state start at state (field 3), then ppid (field 4);
    // pgrp is the following field (field 5).
    const group = Number(fields[2]);
    return Number.isInteger(group) ? group : null;
  } catch {
    return null;
  }
}

function ownProcessPair(recordPath) {
  const pair = readEvents(recordPath).find((event) => (
    Number.isInteger(event?.parent) && event.parent > 0
    && Number.isInteger(event?.child) && event.child > 0
  ));
  assert.ok(pair, `fake CLI did not record an owned parent/child pair in ${recordPath}`);
  return { parent: pair.parent, child: pair.child };
}

function killOwnPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !pidRunning(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function exerciseForkedWorkerLifecycle({ command, backend, phase }) {
  const binDir = mkdtempSync(join(tmpdir(), `patina-forked-${phase}-`));
  const recordDir = mkdtempSync(join(tmpdir(), `patina-forked-${phase}-record-`));
  const eventPath = join(recordDir, 'events.jsonl');
  const processPath = join(recordDir, 'processes.jsonl');
  const leaderGate = join(recordDir, 'release-leader');
  writeFakeCli(binDir, command);

  const envKeys = [
    'PATH',
    'PATINA_FAKE_CLI_RECORD',
    'PATINA_FAKE_CLI_MODE',
    'PATINA_FAKE_CLI_ID',
    'PATINA_TEST_PROCESS_RECORD',
    'PATINA_TEST_SENTINEL_RECORD',
    'PATINA_TEST_LEADER_GATE',
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oldPath = process.env.PATH;
  let controller = null;
  let invocation = null;
  let sentinelPid = null;
  let pair = null;
  try {
    process.env.PATH = `${binDir}:${dirname(process.execPath)}:${oldPath || ''}`;
    process.env.PATINA_FAKE_CLI_RECORD = eventPath;
    process.env.PATINA_FAKE_CLI_MODE = phase === 'normal' ? 'normal' : 'hang-first';
    process.env.PATINA_FAKE_CLI_ID = command;
    process.env.PATINA_TEST_PROCESS_RECORD = processPath;
    process.env.PATINA_TEST_SENTINEL_RECORD = processPath;
    process.env.PATINA_TEST_LEADER_GATE = leaderGate;

    // Detached sentinel has its own process group. It is an unrelated fixture,
    // proving adapter cleanup signals only the owned CLI group, never a broad
    // group that could terminate neighboring work.
    sentinelPid = spawnUnrelatedSentinel(processPath);
    await waitForEvent(processPath, (event) => event.type === 'sentinel-ready');
    assert.equal(pidRunning(sentinelPid), true, `${command} lifecycle sentinel failed to start`);

    if (phase === 'cancel') controller = new AbortController();
    const rawInvocation = backend.invoke({
      prompt: `synthetic forked worker ${phase} fixture`,
      signal: controller?.signal,
      timeout: phase === 'timeout' ? 1000 : 2000,
    });
    // Attach the rejection handler at creation time. Readiness/process-group
    // assertions below may fail before the phase outcome is consumed; keeping
    // a tagged, already-handled result preserves that primary assertion error
    // without emitting PromiseRejectionHandledWarning from cleanup.
    invocation = rawInvocation.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error }),
    );
    const ready = await waitForEvent(eventPath, (event) => event.type === 'ready' && event.invocation === 1);
    await waitForEvent(processPath, (event) => (
      Number.isInteger(event?.parent) && event.parent > 0
      && Number.isInteger(event?.child) && event.child > 0
    ));
    pair = ownProcessPair(processPath);
    assert.equal(ready.pid, pair.parent, `${command} parent readiness did not match process record`);
    await waitForEvent(processPath, (event) => event.type === 'worker-ready' && event.pid === pair.child);
    assert.equal(pidRunning(pair.parent), true, `${command} leader was not running at readiness`);
    assert.equal(pidRunning(pair.child), true, `${command} independent-stdio worker was not running at readiness`);
    if (process.platform === 'linux') {
      assert.equal(processGroupId(pair.parent), pair.parent, `${command} leader did not own a process group`);
      assert.equal(processGroupId(pair.child), pair.parent, `${command} worker did not inherit leader process group`);
      assert.notEqual(processGroupId(sentinelPid), pair.parent, `${command} sentinel shared the owned process group`);
    }

    if (phase === 'cancel') controller.abort();
    if (phase === 'normal') {
      // Release only after parent/worker readiness and process-group identity
      // were observed. This avoids a timing race without using a sleep as
      // lifecycle evidence.
      writeFileSync(leaderGate, 'release\n');
      const outcome = await invocation;
      assert.equal(outcome.status, 'fulfilled', outcome.error?.message || `${command} normal invocation rejected`);
      assert.equal(outcome.value, `synthetic-${command}-register-unspecified-invocation-1`);
    } else {
      const outcome = await invocation;
      assert.equal(outcome.status, 'rejected', `${command} unexpectedly fulfilled during ${phase}`);
      const error = outcome.error;
      assert.equal(
        phase === 'cancel'
          ? error?.name === 'AbortError' && error.message === `${command}-cli backend: aborted`
          : isTimeoutError(error) && new RegExp(`${command}-cli backend: timed out after`).test(error?.message || ''),
        true,
        `${command} should reject ${phase} while cleaning its process group`,
      );
    }

    // The adapter must await the leader close before settling. Both the
    // leader and independent-stdio worker are checked for a non-running
    // kernel state (Linux Z is not treated as live), not inferred from delay.
    await waitForPidDeath(pair.parent);
    await waitForPidDeath(pair.child);
    assert.equal(pidRunning(pair.parent), false, `${command} leader survived ${phase}`);
    assert.equal(pidRunning(pair.child), false, `${command} worker survived ${phase}`);
    assert.equal(pidRunning(sentinelPid), true, `${command} cleanup killed an unrelated process group`);
  } finally {
    if (controller && !controller.signal.aborted) controller.abort();
    // Recover a pair that was recorded before a readiness assertion failed so
    // cleanup still targets only this invocation's own processes.
    if (!pair) {
      const recorded = readEvents(processPath).find((event) => (
        Number.isInteger(event?.parent) && event.parent > 0
        && Number.isInteger(event?.child) && event.child > 0
      ));
      if (recorded) pair = { parent: recorded.parent, child: recorded.child };
    }
    const ownPids = [pair?.parent, pair?.child, sentinelPid];
    for (const pid of ownPids) killOwnPid(pid);
    for (const pid of ownPids) {
      if (Number.isInteger(pid) && pid > 0) await waitForPidDeath(pid).catch(() => {});
    }
    if (invocation) await invocation.catch(() => {});
    for (const key of envKeys) restoreEnv(key, previousEnv[key]);
    rmSync(binDir, { recursive: true, force: true });
    rmSync(recordDir, { recursive: true, force: true });
  }
}

async function exerciseCliLifecycle({ command, backend, phase }) {
  const binDir = mkdtempSync(join(tmpdir(), `patina-fake-${phase}-`));
  const recordDir = mkdtempSync(join(tmpdir(), `patina-fake-${phase}-record-`));
  const recordPath = join(recordDir, 'events.jsonl');
  writeFakeCli(binDir, command);

  const envKeys = ['PATH', 'PATINA_FAKE_CLI_RECORD', 'PATINA_FAKE_CLI_MODE', 'PATINA_FAKE_CLI_ID'];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const oldPath = process.env.PATH;
  process.env.PATINA_FAKE_CLI_RECORD = recordPath;
  process.env.PATH = `${binDir}:${dirname(process.execPath)}:${oldPath || ''}`;
  process.env.PATINA_FAKE_CLI_MODE = 'hang-first';
  process.env.PATINA_FAKE_CLI_ID = command;

  let firstController = null;
  let firstPromise = null;
  let secondPromise = null;
  const observedPids = [];
  try {
    firstController = phase === 'cancel' ? new AbortController() : null;
    firstPromise = withBackendConcurrencySlot({
      backendName: backend.name,
      maxConcurrency: 1,
      timeout: 2000,
      pollMs: 10,
      staleMs: 60 * 60_000,
      signal: firstController?.signal,
      fn: (remainingTimeout) => backend.invoke({
        prompt: `synthetic ${phase} fixture`,
        signal: firstController?.signal,
        // Timeout is intentionally owned by the adapter for this case; the
        // outer slot lease remains long enough to observe its cleanup.
        timeout: phase === 'timeout' ? 1000 : remainingTimeout,
      }),
    });

    const firstReady = await waitForEvent(recordPath, (event) => event.type === 'ready' && event.invocation === 1);
    observedPids.push(firstReady.pid);
    assert.equal(pidIsAlive(firstReady.pid), true, `${command} child did not stay ready`);
    // Prove the fixture ignores SIGTERM before exercising the adapter's
    // stronger kill path.
    process.kill(firstReady.pid, 'SIGTERM');
    await waitForEvent(recordPath, (event) => event.type === 'sigterm-ignored');
    assert.equal(pidIsAlive(firstReady.pid), true, `${command} fixture unexpectedly exited on SIGTERM`);

    if (phase === 'cancel') firstController.abort();
    await assert.rejects(
      firstPromise,
      (error) => phase === 'cancel'
        ? error?.name === 'AbortError' && error.message === `${command}-cli backend: aborted`
        : isTimeoutError(error) && new RegExp(`${command}-cli backend: timed out after`).test(error?.message || ''),
      `${command} should reject its ${phase} without accepting fallback text`,
    );
    await waitForPidDeath(firstReady.pid);
    assert.equal(existsSync(firstReady.cwd), false, `${command} invocation directory leaked after ${phase}`);
    assertNoOwnedSlots(backend.name);

    secondPromise = withBackendConcurrencySlot({
      backendName: backend.name,
      maxConcurrency: 1,
      timeout: 2000,
      pollMs: 10,
      staleMs: 60 * 60_000,
      fn: (remainingTimeout) => backend.invoke({
        prompt: `synthetic ${phase} recovery fixture`,
        timeout: remainingTimeout,
      }),
    });
    const secondResult = await secondPromise;
    assert.equal(secondResult, `synthetic-${command}-register-unspecified-invocation-2`);
    const secondReady = await waitForEvent(recordPath, (event) => event.type === 'ready' && event.invocation === 2);
    observedPids.push(secondReady.pid);
    await waitForEvent(recordPath, (event) => event.type === 'exit' && event.invocation === 2);
    assert.equal(pidIsAlive(secondReady.pid), false, `${command} success child did not exit`);
    assert.equal(existsSync(secondReady.cwd), false, `${command} invocation directory leaked after recovery`);
    assertNoOwnedSlots(backend.name);
  } finally {
    if (firstController && !firstController.signal.aborted) firstController.abort();
    for (const pid of observedPids) {
      if (pidIsAlive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
    if (firstPromise) await firstPromise.catch(() => {});
    if (secondPromise) await secondPromise.catch(() => {});
    removeOwnedSlots(backend.name);
    for (const key of envKeys) restoreEnv(key, previousEnv[key]);
    rmSync(binDir, { recursive: true, force: true });
    rmSync(recordDir, { recursive: true, force: true });
  }
}

test('CLI backends cancel with owned child, temp dir, slot, and next-call evidence', {
  skip: !POSIX_PROCESS_TEST,
}, async () => {
  for (const backend of BACKENDS) {
    await exerciseCliLifecycle({ ...backend, phase: 'cancel' });
  }
});

test('CLI backends timeout with SIGTERM-resistant child cleanup and next-call success', {
  skip: !POSIX_PROCESS_TEST,
}, async () => {
  for (const backend of BACKENDS) {
    await exerciseCliLifecycle({ ...backend, phase: 'timeout' });
  }
});

test('CLI backends clean forked independent-stdio workers on abort, timeout, and normal leader exit', {
  skip: !POSIX_PROCESS_TEST,
}, async () => {
  for (const phase of ['cancel', 'timeout', 'normal']) {
    for (const backend of BACKENDS) {
      await exerciseForkedWorkerLifecycle({ ...backend, phase });
    }
  }
});

test('codex-cli does not deadlock when the child floods stdout (#438)', {
  skip: !POSIX_PROCESS_TEST,
}, async () => {
  const binDir = mkdtempSync(join(tmpdir(), 'patina-fake-cli-'));
  const oldPath = process.env.PATH;

  try {
    // Fake `codex exec`: stream 8MB of session/progress noise to stdout —
    // waiting for 'drain' like a real blocked writer — and only then write
    // the --output-last-message file and exit. With a piped-but-undrained
    // stdout the OS pipe buffer (~64KB) fills, 'drain' never fires, the
    // child never exits, and invoke() hangs until its timeout.
    const path = join(binDir, 'codex');
    writeFileSync(path, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'process.stdin.resume();',
      'const args = process.argv.slice(2);',
      "const outFile = args[args.indexOf('--output-last-message') + 1];",
      'let written = 0;',
      "const chunk = 'x'.repeat(65536);",
      'function pump() {',
      '  while (written < 8 * 1024 * 1024) {',
      '    written += chunk.length;',
      '    if (!process.stdout.write(chunk)) {',
      "      process.stdout.once('drain', pump);",
      '      return;',
      '    }',
      '  }',
      "  fs.writeFileSync(outFile, 'final answer');",
      '  process.exit(0);',
      '}',
      'pump();',
      '',
    ].join('\n'));
    chmodSync(path, 0o755);
    process.env.PATH = `${binDir}:${oldPath || ''}`;

    const result = await codexCli.invoke({ prompt: 'rewrite this', timeout: 5000 });
    assert.equal(result, 'final answer');
  } finally {
    process.env.PATH = oldPath;
    rmSync(binDir, { recursive: true, force: true });
  }
});
