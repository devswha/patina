import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const BIN = resolve(REPO_ROOT, 'bin/patina.js');

// The scenario relies on a POSIX executable and shared TMPDIR slot root. It is
// intentionally skipped elsewhere; this test does not claim Windows coverage.
const POSIX_SESSION_TEST = new Set([
  'aix', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos',
]).has(process.platform);

const FAKE_CLAUDE_SOURCE = [
  '#!/usr/bin/env node',
  "const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');",
  'const recordPath = process.env.PATINA_FAKE_CLI_RECORD;',
  'const mode = process.env.PATINA_FAKE_CLI_MODE || "fail-first";',
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
  'emit("ready", { pid: process.pid, cwd: process.cwd(), invocation });',
  'const chunks = [];',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", (chunk) => chunks.push(chunk));',
  'process.stdin.on("end", () => {',
  '  if (mode === "fail-first" && invocation === 1) {',
  '    emit("failed", { code: 75, invocation });',
  '    process.stderr.write("synthetic CLI failure\\n");',
  '    process.exit(75);',
  '    return;',
  '  }',
  '  const prompt = chunks.join("");',
  '  const registerMatch = prompt.match(/## Register\\s+[\\s\\S]*?- value:\\s*(casual|professional)\\b/i);',
  '  const register = registerMatch ? registerMatch[1].toLowerCase() : "unspecified";',
  '  const id = process.env.PATINA_FAKE_CLI_ID || "session";',
  '  const output = `synthetic-${id}-register-${register}-invocation-${invocation}`;',
  '  process.stdout.write(output);',
  '  emit("exit", { code: 0, invocation });',
  '  process.exit(0);',
  '});',
  '',
].join('\n');

function readEvents(path) {
  try {
    return readFileSync(path, 'utf8')
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

function runPatina(args, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
}

function isolatedEnv({ home, sharedTmp, binDir, recordPath, id }) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    TMPDIR: sharedTmp,
    TMP: sharedTmp,
    TEMP: sharedTmp,
    PATH: `${binDir}:${dirname(process.execPath)}`,
    PATINA_FAKE_CLI_RECORD: recordPath,
    PATINA_FAKE_CLI_MODE: 'fail-first',
    PATINA_FAKE_CLI_ID: id,
    NO_COLOR: '1',
  };
  // The scenario is local and synthetic; do not let ambient credentials or
  // provider settings turn an inspect/rewrite assertion into a real call.
  for (const key of [
    'PATINA_API_KEY', 'PATINA_API_KEY_FILE', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'PATINA_API_BASE',
  ]) delete env[key];
  return env;
}

test('two CLI sessions isolate HOME/config/output and recover after a failure', {
  skip: !POSIX_SESSION_TEST,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'patina-session-isolation-'));
  const sharedTmp = join(root, 'shared-tmp');
  const binDir = join(root, 'bin');
  mkdirSync(sharedTmp);
  mkdirSync(binDir);
  const claudePath = join(binDir, 'claude');
  writeFileSync(claudePath, FAKE_CLAUDE_SOURCE, { mode: 0o755 });
  chmodSync(claudePath, 0o755);

  const sessions = ['a', 'b'].map((id) => {
    const home = join(root, `home-${id}`);
    const inputDir = join(root, `input-${id}`);
    const outputDir = join(root, `output-${id}`);
    const recordDir = join(root, `record-${id}`);
    mkdirSync(home);
    mkdirSync(inputDir);
    mkdirSync(outputDir);
    mkdirSync(recordDir);
    writeFileSync(join(home, '.patina.yaml'), [
      'language: en',
      'backend: claude-cli',
      `register: ${id === 'a' ? 'casual' : 'professional'}`,
      '',
    ].join('\n'));
    const inputPath = join(inputDir, `source-${id}.txt`);
    writeFileSync(inputPath, `synthetic session ${id} source\n`);
    return {
      id,
      home,
      inputPath,
      outputDir,
      outputPath: join(outputDir, basename(inputPath)),
      recordPath: join(recordDir, 'events.jsonl'),
    };
  });

  const envBySession = new Map(sessions.map((session) => [
    session.id,
    isolatedEnv({ ...session, sharedTmp, binDir }),
  ]));

  try {
    // --list-backends is the inspect path: it runs only the fake --version
    // probe, never login or an external model. Each HOME must report the same
    // synthetic CLI availability without sharing credentials.
    for (const session of sessions) {
      const inspect = await runPatina(['--list-backends'], envBySession.get(session.id));
      assert.equal(inspect.code, 0, inspect.stderr);
      const claudeRow = inspect.stdout.split(/\r?\n/).find((line) => line.includes('claude-cli'));
      assert.ok(claudeRow, `missing claude-cli row for session ${session.id}`);
      assert.match(claudeRow, /yes\s+no\s+/);
      assert.deepEqual(readEvents(session.recordPath), [], 'inspect must not invoke the rewrite fixture');
    }

    // Both sessions use one shared TMPDIR, and therefore the real backend slot
    // root. Distinct HOME/config/output paths prove isolation without claiming
    // a separate slot root that would bypass a global concurrency limit.
    assert.equal(envBySession.get('a').TMPDIR, envBySession.get('b').TMPDIR);

    const rewriteArgs = (session) => [
      '--batch',
      '--outdir', session.outputDir,
      '--timeout-ms', '5000',
      session.inputPath,
    ];

    for (const session of sessions) {
      const failed = await runPatina(rewriteArgs(session), envBySession.get(session.id));
      assert.notEqual(failed.code, 0, `first ${session.id} call silently accepted a failed CLI`);
      assert.match(failed.stderr, /synthetic CLI failure|exited with code 75/);
      assert.equal(existsSync(session.outputPath), false, `failed ${session.id} call wrote output`);
    }

    // The second call for each session runs concurrently against the same
    // claude-cli slot root. close events, not a delay, establish completion.
    const recovered = await Promise.all(sessions.map((session) =>
      runPatina(rewriteArgs(session), envBySession.get(session.id))));
    for (const result of recovered) assert.equal(result.code, 0, result.stderr);

    const [sessionA, sessionB] = sessions;
    const outputA = readFileSync(sessionA.outputPath, 'utf8');
    const outputB = readFileSync(sessionB.outputPath, 'utf8');
    assert.equal(outputA, 'synthetic-a-register-casual-invocation-2');
    assert.equal(outputB, 'synthetic-b-register-professional-invocation-2');
    assert.doesNotMatch(outputA, /synthetic-b|professional/);
    assert.doesNotMatch(outputB, /synthetic-a|casual/);
    assert.deepEqual(readdirSync(sessionA.outputDir), [basename(sessionA.inputPath)]);
    assert.deepEqual(readdirSync(sessionB.outputDir), [basename(sessionB.inputPath)]);

    for (const session of sessions) {
      const events = readEvents(session.recordPath);
      assert.equal(events.filter((event) => event.type === 'ready').length, 2);
      assert.deepEqual(events.filter((event) => event.type === 'failed').map((event) => event.code), [75]);
      assert.deepEqual(events.filter((event) => event.type === 'exit').map((event) => event.code), [0]);
      const recovery = events.find((event) => event.type === 'ready' && event.invocation === 2);
      assert.ok(recovery, `missing recovery readiness for session ${session.id}`);
      assert.equal(existsSync(recovery.cwd), false, `session ${session.id} leaked its CLI invocation directory`);
    }
    const recoveryA = readEvents(sessionA.recordPath).find((event) => event.type === 'ready' && event.invocation === 2);
    const recoveryB = readEvents(sessionB.recordPath).find((event) => event.type === 'ready' && event.invocation === 2);
    assert.notEqual(recoveryA.cwd, recoveryB.cwd, 'sessions shared a CLI invocation directory');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
