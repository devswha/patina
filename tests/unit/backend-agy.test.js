import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import * as agyCli from '../../src/backends/agy-cli.js';
import { DEFAULT_BEST_MODELS, resolveLocalCliModel } from '../../src/model-defaults.js';
import { selectBackend } from '../../src/backends/index.js';
import { getBackendSafety } from '../../src/backends/contract.js';

// Fake `agy` that records argv, the stdin NDJSON, the workspace-local agent
// definition, then emits whatever NDJSON the test asked for via env. CommonJS
// on purpose: an extensionless script is parsed as CJS on every supported
// Node, so no ESM syntax detection is involved.
const FAKE_AGY = [
  `#!${process.execPath}`,
  "const { readFileSync, existsSync } = require('node:fs');",
  "const { join } = require('node:path');",
  'const args = process.argv.slice(2);',
  "if (args.includes('--version')) { process.stdout.write('1.1.26\\n'); process.exit(0); }",
  "let stdin = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (c) => { stdin += c; });",
  "process.stdin.on('end', () => {",
  "  const agentPath = join(process.cwd(), '.agents', 'agents', 'patina-text.md');",
  "  const agent = existsSync(agentPath) ? readFileSync(agentPath, 'utf8') : null;",
  "  const record = JSON.stringify({ args, stdin, agent, cwd: process.cwd() });",
  "  const mode = process.env.FAKE_AGY_MODE || 'success';",
  "  const init = JSON.stringify({ event: 'init', conversation_id: 'c1', init: { cwd: process.cwd(), tools: ['run_command', 'view_file'], permission_mode: 'request-review', agent: 'patina-text' } });",
  "  const result = (status, response, error) => JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status, response, ...(error ? { error } : {}), num_turns: 1, usage: { input_tokens: 1 } } });",
  "  const tool = JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'echo x' } } } });",
  "  if (mode === 'success') process.stdout.write(init + '\\n' + result('SUCCESS', 'REWRITTEN::' + record + '\\n') + '\\n');",
  "  else if (mode === 'empty') { process.stderr.write('jetski: no output produced — a tool required the \"command\" permission that headless mode cannot prompt for, so it was auto-denied.\\n'); process.stdout.write(init + '\\n' + result('SUCCESS', '') + '\\n'); }",
  "  else if (mode === 'error') process.stdout.write(init + '\\n' + result('ERROR', '', 'quota exhausted') + '\\n');",
  "  else if (mode === 'tool') process.stdout.write(init + '\\n' + tool + '\\n' + result('SUCCESS', 'looks fine\\n') + '\\n');",
  "  else if (mode === 'exit') { process.stderr.write('error: invalid model selection\\n'); process.exit(1); }",
  "  else if (mode === 'garbage') process.stdout.write('not json at all\\n');",
  "  else if (mode === 'double') process.stdout.write(init + '\\n' + result('ERROR', '', 'first turn failed') + '\\n' + result('SUCCESS', 'late answer\\n') + '\\n');",
  "  else if (mode === 'nullpayload') process.stdout.write(init + '\\n' + result('SUCCESS', 'fine\\n') + '\\n' + JSON.stringify({ event: 'result', result: null }) + '\\n');",
  '});',
  '',
].join('\n');

async function withFakeAgy(mode, fn) {
  const binDir = mkdtempSync(join(tmpdir(), 'patina-agy-fake-'));
  const oldPath = process.env.PATH;
  const oldMode = process.env.FAKE_AGY_MODE;
  try {
    const path = join(binDir, 'agy');
    writeFileSync(path, FAKE_AGY);
    chmodSync(path, 0o755);
    process.env.PATH = `${binDir}:${oldPath || ''}`;
    process.env.FAKE_AGY_MODE = mode;
    return await fn();
  } finally {
    process.env.PATH = oldPath;
    if (oldMode === undefined) delete process.env.FAKE_AGY_MODE;
    else process.env.FAKE_AGY_MODE = oldMode;
    rmSync(binDir, { recursive: true, force: true });
  }
}

// invoke() reads the real ~/.gemini/antigravity-cli/settings.json and refuses
// to launch when it widens headless permissions; os.homedir() cannot be
// redirected here, so the launch-path tests skip on such hosts instead of
// flaking. The refusal itself is covered by the settings test below.
function hostSettingsProblem() {
  try {
    agyCli.assertAgySettingsSafe(agyCli.readAgySettings());
    return false;
  } catch (err) {
    return err.message;
  }
}
// The fake `agy` is an extensionless POSIX shebang script joined to PATH with
// ':'. Windows never resolves an extensionless name through PATHEXT and (since
// the Node CVE-2024-27980 fix) refuses to spawn a .cmd shim without a shell,
// so the fake cannot intercept the launch there. Skipping is absent coverage
// of the live Windows launch path, not a pass; everything else (argv building,
// stream parsing, settings guard) still runs on win32.
const launchSkip = process.platform === 'win32'
  ? 'fake agy CLI shim requires POSIX shebang semantics; live Windows launch unverified'
  : hostSettingsProblem();

function argValue(args, flag) {
  const index = args.indexOf(flag);
  assert.notStrictEqual(index, -1, `${flag} should be present in ${args.join(' ')}`);
  return args[index + 1];
}

test('agy-cli sends the prompt as one stdin user event with a tool-free workspace agent', { skip: launchSkip }, async () => {
  await withFakeAgy('success', async () => {
    const text = await agyCli.invoke({ prompt: 'rewrite this ✓ 한국어', timeout: 30_000 });
    assert.ok(text.startsWith('REWRITTEN::'));
    const record = JSON.parse(text.slice('REWRITTEN::'.length));

    // Prompt never rides argv.
    assert.ok(!record.args.some((a) => a.includes('rewrite this')));
    assert.ok(record.args.includes('-p='));
    assert.strictEqual(argValue(record.args, '--agent'), agyCli.AGY_AGENT_NAME);
    assert.strictEqual(argValue(record.args, '--input-format'), 'stream-json');
    assert.strictEqual(argValue(record.args, '--output-format'), 'stream-json');
    assert.ok(record.args.includes('--disable-slash-commands'));
    assert.strictEqual(argValue(record.args, '--print-timeout'), '30s');
    // The single stdin line is newline-terminated so agy's NDJSON reader
    // sees a complete message before EOF.
    assert.ok(record.stdin.endsWith('\n'));
    assert.strictEqual(argValue(record.args, '--model'), DEFAULT_BEST_MODELS.agyCli);

    const lines = record.stdin.trim().split('\n');
    assert.strictEqual(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { event: 'user', message: { content: 'rewrite this ✓ 한국어' } });

    // The agent definition was materialised in the (temp) cwd and forbids tools.
    assert.strictEqual(record.agent, agyCli.AGY_AGENT_DEFINITION);
    assert.match(record.agent, /commandExecutionPolicy: off/);
    assert.match(record.agent, /subagent: false/);
    assert.match(record.cwd, /patina-agy-/);
  });
});

test('agy-cli fails closed on empty, error, tool-using, garbage and non-zero outcomes', { skip: launchSkip }, async () => {
  await withFakeAgy('empty', async () => {
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /empty response[\s\S]*auto-denied/);
  });
  await withFakeAgy('error', async () => {
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /agy reported ERROR: quota exhausted/);
  });
  await withFakeAgy('tool', async () => {
    // A well-formed SUCCESS result is still rejected once a tool step appears.
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /invoked 1 tool call\(s\) \(run_command\)/);
  });
  await withFakeAgy('garbage', async () => {
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /no stream-json events/);
  });
  await withFakeAgy('exit', async () => {
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /agy exited with code 1[\s\S]*invalid model selection/);
  });
  // Exactly one terminal result per prompt: a late SUCCESS after an ERROR, or
  // a trailing null payload after a SUCCESS, are both rejected rather than
  // letting either result win.
  await withFakeAgy('double', async () => {
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /carried 2 result events/);
  });
  await withFakeAgy('nullpayload', async () => {
    await assert.rejects(agyCli.invoke({ prompt: 'x' }), /carried 2 result events/);
  });
});

test('agy-cli maps a non-finite timeout to an effectively unlimited --print-timeout', async () => {
  assert.strictEqual(agyCli.agyPrintTimeout(30_000), '30s');
  assert.strictEqual(agyCli.agyPrintTimeout(1), '1s');
  assert.strictEqual(agyCli.agyPrintTimeout(Infinity), '8760h');
  assert.strictEqual(agyCli.agyPrintTimeout(NaN), '8760h');
});

test('agy-cli rejects images and empty prompts before spawning', async () => {
  await assert.rejects(agyCli.invoke({ prompt: 'x', images: ['/tmp/a.png'] }), /image input is not supported/);
  await assert.rejects(agyCli.invoke({ prompt: '' }), /prompt must be a non-empty string/);
  assert.strictEqual(agyCli.supportsImages, false);
});

test('agy-cli refuses to launch unless Antigravity settings keep the headless defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-agy-settings-'));
  const file = join(dir, 'settings.json');
  const check = (settings) => agyCli.assertAgySettingsSafe(settings);
  try {
    // Missing file, unrelated keys, ask/deny lists and the safe modes pass.
    assert.deepEqual(agyCli.readAgySettings(file), {});
    writeFileSync(file, JSON.stringify({ model: 'x', trustedWorkspaces: ['/home/me'] }));
    assert.doesNotThrow(() => check(agyCli.readAgySettings(file)));
    assert.doesNotThrow(() => check({ permissions: { ask: ['command(*)'], deny: ['command(sudo)'], allow: [] } }));
    assert.doesNotThrow(() => check({ toolPermission: 'request-review', allowNonWorkspaceAccess: false }));
    assert.doesNotThrow(() => check({ toolPermission: 'strict' }));

    // Each widening setting fails closed and is named.
    assert.throws(() => check({ permissions: { allow: ['command(git)', 'read_url(google.com)'] } }),
      /auto-allows 2 rule\(s\): command\(git\), read_url\(google\.com\)/);
    assert.throws(() => check({ toolPermission: 'always-proceed' }), /toolPermission is "always-proceed"/);
    assert.throws(() => check({ toolPermission: 'proceed-in-sandbox' }), /toolPermission is "proceed-in-sandbox"/);
    assert.throws(() => check({ allowNonWorkspaceAccess: true }), /allowNonWorkspaceAccess is true/);
    // Several problems are reported together.
    assert.throws(() => check({ toolPermission: 'always-proceed', allowNonWorkspaceAccess: true, permissions: { allow: ['mcp(*)'] } }),
      /mcp\(\*\)[\s\S]*always-proceed[\s\S]*allowNonWorkspaceAccess/);

    // Unknown shapes fail closed too.
    writeFileSync(file, '{not json');
    assert.throws(() => agyCli.readAgySettings(file), /not valid JSON/);
    writeFileSync(file, '[]');
    assert.throws(() => agyCli.readAgySettings(file), /not a JSON object/);
    assert.throws(() => check({ permissions: { allow: 'command(*)' } }), /permissions\.allow is not a list/);
    assert.throws(() => check({ permissions: 'yes' }), /permissions is not an object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(agyCli.agySettingsPath(), /\.gemini[\\/]antigravity-cli[\\/]settings\.json$/);
});

test('extractAgyResponse parses the documented stream shape', () => {
  const ok = [
    '{"event":"init","conversation_id":"c","init":{"cwd":"/x","tools":[],"permission_mode":"request-review"}}',
    '{"event":"step_update","step_update":{"conversation_id":"c","step_index":0,"state":"DONE","step_type":"user_input"}}',
    '{"event":"step_update","step_update":{"conversation_id":"c","step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"OK\\n"}}',
    '{"event":"result","result":{"conversation_id":"c","status":"SUCCESS","response":"OK\\n","num_turns":1}}',
  ].join('\n');
  assert.strictEqual(agyCli.extractAgyResponse(ok), 'OK');
  assert.throws(() => agyCli.extractAgyResponse(ok.split('\n').slice(0, 3).join('\n')), /without a result event/);
  assert.throws(() => agyCli.extractAgyResponse('{"event":"result","result":{"status":"ERROR","error":"stream input message is missing the \\"event\\" field"}}'), /missing the "event" field/);
});

test('agy-cli is explicit-selection only with its own model family and safety defaults', () => {
  assert.strictEqual(selectBackend({ name: 'agy-cli' }).backend.name, 'agy-cli');
  assert.strictEqual(selectBackend({ model: 'agy', modelSource: 'flag' }).backend.name, 'agy-cli');
  // gemini-* keeps routing to gemini-cli; Antigravity ids overlap three families.
  assert.strictEqual(selectBackend({ model: 'gemini-3.7-flash-medium', modelSource: 'flag' }).backend.name, 'gemini-cli');

  assert.strictEqual(resolveLocalCliModel({ backendName: 'agy-cli' }), 'gemini-3.7-flash-medium');
  assert.strictEqual(resolveLocalCliModel({ backendName: 'agy-cli', model: 'agy', modelSource: 'flag' }), 'gemini-3.7-flash-medium');
  assert.strictEqual(resolveLocalCliModel({ backendName: 'agy-cli', model: 'claude-sonnet-4-6', modelSource: 'flag' }), 'claude-sonnet-4-6');
  assert.strictEqual(resolveLocalCliModel({ backendName: 'agy-cli', model: 'gpt-oss-120b-medium', modelSource: 'flag' }), 'gpt-oss-120b-medium');
  // An OpenAI API id is not in the Antigravity catalog: fall back to the default.
  assert.strictEqual(resolveLocalCliModel({ backendName: 'agy-cli', model: 'gpt-5.5', modelSource: 'env:PATINA_MODEL' }), 'gemini-3.7-flash-medium');

  assert.deepEqual(getBackendSafety('agy-cli'), {
    maxConcurrency: 1,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
    supportsStructuredOutput: false,
  });
});
