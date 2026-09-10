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
// definition, then emits whatever NDJSON the test asked for via env.
const FAKE_AGY = [
  '#!/usr/bin/env node',
  "import { readFileSync, existsSync } from 'node:fs';",
  "import { join } from 'node:path';",
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
// to launch when it auto-allows anything; os.homedir() cannot be redirected
// here, so the launch-path tests skip on such hosts instead of flaking.
function hostAllowRules() {
  try {
    return agyCli.readAgyAllowRules();
  } catch (err) {
    return [err.message];
  }
}
const hostAllows = hostAllowRules();
const launchSkip = hostAllows.length > 0
  ? `host Antigravity settings auto-allow rules (${hostAllows.join(', ')}); invoke() refuses by design`
  : false;

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
});

test('agy-cli rejects images and empty prompts before spawning', async () => {
  await assert.rejects(agyCli.invoke({ prompt: 'x', images: ['/tmp/a.png'] }), /image input is not supported/);
  await assert.rejects(agyCli.invoke({ prompt: '' }), /prompt must be a non-empty string/);
  assert.strictEqual(agyCli.supportsImages, false);
});

test('agy-cli refuses to launch when Antigravity settings auto-allow anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-agy-settings-'));
  const file = join(dir, 'settings.json');
  try {
    // Missing file or no permissions block: defaults, nothing auto-allowed.
    assert.deepEqual(agyCli.readAgyAllowRules(file), []);
    writeFileSync(file, JSON.stringify({ model: 'x', trustedWorkspaces: ['/home/me'] }));
    assert.deepEqual(agyCli.readAgyAllowRules(file), []);
    // ask/deny lists never widen anything.
    writeFileSync(file, JSON.stringify({ permissions: { ask: ['command(*)'], deny: ['command(sudo)'] } }));
    assert.doesNotThrow(() => agyCli.assertAgyAllowRulesSafe(agyCli.readAgyAllowRules(file)));
    // Any allow rule fails closed with the rules named.
    writeFileSync(file, JSON.stringify({ permissions: { allow: ['command(git)', 'read_url(google.com)'] } }));
    assert.throws(
      () => agyCli.assertAgyAllowRulesSafe(agyCli.readAgyAllowRules(file)),
      /auto-allows 2 permission rule\(s\): command\(git\), read_url\(google\.com\)/,
    );
    // Unknown shapes fail closed too.
    writeFileSync(file, '{not json');
    assert.throws(() => agyCli.readAgyAllowRules(file), /not valid JSON/);
    writeFileSync(file, JSON.stringify({ permissions: { allow: 'command(*)' } }));
    assert.throws(() => agyCli.readAgyAllowRules(file), /not a list/);
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
