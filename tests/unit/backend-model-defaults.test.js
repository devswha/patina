import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import * as claudeCli from '../../src/backends/claude-cli.js';
import * as codexCli from '../../src/backends/codex-cli.js';
import * as geminiCli from '../../src/backends/gemini-cli.js';
import * as kimiCli from '../../src/backends/kimi-cli.js';
import { DEFAULT_BEST_MODELS, resolveLocalCliModel } from '../../src/model-defaults.js';

const FAKE_CLI = [
  '#!/usr/bin/env node',
  "import { writeFileSync, readFileSync, readdirSync } from 'node:fs';",
  "import { basename } from 'node:path';",
  'const args = process.argv.slice(2);',
  "if (args.includes('--version')) process.exit(0);",
  "let stdin = '';",
  "process.stdin.on('data', (chunk) => { stdin += chunk; });",
  "process.stdin.on('end', () => {",
  "  const agentIndex = args.indexOf('--agent-file');",
  "  const skillIndex = args.indexOf('--skills-dir');",
  "  const isolation = agentIndex >= 0 ? {profile:readFileSync(args[agentIndex+1],'utf8'),skills:readdirSync(args[skillIndex+1]),engine:process.env.KIMI_CODE_EXPERIMENTAL_FLAG} : null;",
  "  const payload = JSON.stringify({ command: basename(process.argv[1]), args, stdin, isolation });",
  "  const outIndex = args.indexOf('--output-last-message');",
  '  if (outIndex !== -1) writeFileSync(args[outIndex + 1], payload);',
  '  else process.stdout.write(payload);',
  '});',
  '',
].join('\n');

async function withFakeCli(fn, script = FAKE_CLI) {
  const binDir = mkdtempSync(join(tmpdir(), 'patina-model-cli-'));
  const oldPath = process.env.PATH;
  try {
    for (const command of ['claude', 'codex', 'gemini', 'kimi']) {
      const path = join(binDir, command);
      writeFileSync(path, script);
      chmodSync(path, 0o755);
    }
    process.env.PATH = `${binDir}:${oldPath || ''}`;
    return await fn();
  } finally {
    process.env.PATH = oldPath;
    rmSync(binDir, { recursive: true, force: true });
  }
}

function assertArgValue(args, flag, expected) {
  const index = args.indexOf(flag);
  assert.notStrictEqual(index, -1, `${flag} should be present in ${args.join(' ')}`);
  assert.strictEqual(args[index + 1], expected);
}

test('local CLI model resolver uses best-known defaults and preserves explicit ids', () => {
  assert.strictEqual(resolveLocalCliModel({ backendName: 'codex-cli' }), DEFAULT_BEST_MODELS.codexCli);
  assert.strictEqual(resolveLocalCliModel({ backendName: 'claude-cli' }), DEFAULT_BEST_MODELS.claudeCli);
  assert.strictEqual(resolveLocalCliModel({ backendName: 'gemini-cli' }), DEFAULT_BEST_MODELS.geminiCli);
  assert.strictEqual(resolveLocalCliModel({ backendName: 'kimi-cli' }), DEFAULT_BEST_MODELS.kimiCli);

  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'codex-cli', model: 'gpt-5.5', modelSource: 'default' }),
    DEFAULT_BEST_MODELS.codexCli
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'codex-cli', model: 'codex', modelSource: 'flag' }),
    DEFAULT_BEST_MODELS.codexCli
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'claude-cli', model: 'claude-opus-custom', modelSource: 'flag' }),
    'claude-opus-custom'
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'codex-cli', model: 'gpt-5.6-preview', modelSource: 'flag' }),
    'gpt-5.6-preview'
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'kimi-cli', model: 'kimi', modelSource: 'flag' }),
    DEFAULT_BEST_MODELS.kimiCli
  );
});

test('drops foreign-family models from env/provider sources for local CLI backends (#524)', () => {
  // PATINA_MODEL=gpt-5.5 or a provider default paired with --backend claude-cli
  // must not forward an OpenAI/Gemini id into the Claude process.
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'claude-cli', model: 'gpt-5.5', modelSource: 'flag' }),
    DEFAULT_BEST_MODELS.claudeCli
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'gemini-cli', model: 'gpt-5.5', modelSource: 'flag' }),
    DEFAULT_BEST_MODELS.geminiCli
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'claude-cli', model: 'gpt-5.5', modelSource: 'env:PATINA_MODEL' }),
    DEFAULT_BEST_MODELS.claudeCli
  );
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'claude-cli', model: 'gemini-2.5-pro', modelSource: 'provider:gemini' }),
    DEFAULT_BEST_MODELS.claudeCli
  );
  // A matching-family flag model is still honored.
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'claude-cli', model: 'claude-opus-custom', modelSource: 'flag' }),
    'claude-opus-custom'
  );
  // openai-http is not a local CLI; it still receives the model verbatim.
  assert.strictEqual(
    resolveLocalCliModel({ backendName: 'openai-http', model: 'gpt-5.5', modelSource: 'flag' }),
    'gpt-5.5'
  );
});

test('local CLI backends pass default best-model flags to child processes', async () => {
  await withFakeCli(async () => {
    const codex = JSON.parse(await codexCli.invoke({ prompt: 'rewrite this', modelSource: 'default' }));
    assert.strictEqual(basename(codex.command), 'codex');
    assertArgValue(codex.args, '--model', DEFAULT_BEST_MODELS.codexCli);
    assert.strictEqual(codex.stdin, 'rewrite this');

    const claude = JSON.parse(await claudeCli.invoke({ prompt: 'rewrite this', modelSource: 'default' }));
    assert.strictEqual(basename(claude.command), 'claude');
    assertArgValue(claude.args, '--model', DEFAULT_BEST_MODELS.claudeCli);
    assert.strictEqual(claude.stdin, 'rewrite this');

    const gemini = JSON.parse(await geminiCli.invoke({ prompt: 'rewrite this', modelSource: 'default' }));
    assert.strictEqual(basename(gemini.command), 'gemini');
    assertArgValue(gemini.args, '-m', DEFAULT_BEST_MODELS.geminiCli);
    assert.strictEqual(gemini.stdin, 'rewrite this');

    const kimi = JSON.parse(await kimiCli.invoke({ prompt: 'rewrite this', modelSource: 'default' }));
    assert.strictEqual(basename(kimi.command), 'kimi');
    assertArgValue(kimi.args, '--model', DEFAULT_BEST_MODELS.kimiCli);
    // Kimi Code >= 0.28 takes the one-shot prompt as an argv value, not stdin.
    assertArgValue(kimi.args, '--prompt', 'rewrite this');
    assert.strictEqual(kimi.stdin, '');
    assert.match(kimi.isolation.profile, /tools: \[\]/);
    assert.match(kimi.isolation.profile, /subagents: \[\]/);
    assert.deepEqual(kimi.isolation.skills, []);
    assert.equal(kimi.isolation.engine, '1');
  });
});

// A fake CLI that also captures the gemini --policy file body before the
// adapter removes its temp directory.
const FAKE_CLI_WITH_POLICY = FAKE_CLI.replace(
  "  const payload = JSON.stringify({ command: basename(process.argv[1]), args, stdin, isolation });",
  "  const policyIndex = args.indexOf('--policy');\n" +
  "  const policy = policyIndex >= 0 ? readFileSync(args[policyIndex + 1], 'utf8') : null;\n" +
  "  const payload = JSON.stringify({ command: basename(process.argv[1]), args, stdin, isolation, policy });",
);

test('local CLI backends strip agent tools from every text invocation', async () => {
  await withFakeCli(async () => {
    const codex = JSON.parse(await codexCli.invoke({ prompt: 'rewrite this' }));
    for (const feature of codexCli.CODEX_DISABLED_FEATURES) {
      const index = codex.args.indexOf('--disable');
      assert.notStrictEqual(index, -1);
      assert.ok(codex.args.some((arg, i) => arg === '--disable' && codex.args[i + 1] === feature), `codex should disable ${feature}`);
    }
    assert.deepEqual(codexCli.CODEX_DISABLED_FEATURES, ['shell_tool', 'unified_exec', 'multi_agent']);
    // Sandbox containment stays in place alongside the feature switches.
    assertArgValue(codex.args, '--sandbox', 'read-only');

    const claude = JSON.parse(await claudeCli.invoke({ prompt: 'rewrite this' }));
    assertArgValue(claude.args, '--tools', '');
    assert.ok(claude.args.includes('--strict-mcp-config'));
    assert.ok(!claude.args.includes('--mcp-config'));

    const gemini = JSON.parse(await geminiCli.invoke({ prompt: 'rewrite this' }));
    assert.strictEqual(gemini.policy, geminiCli.GEMINI_NO_TOOLS_POLICY);
    assert.match(gemini.policy, /toolName = "\*"/);
    assert.match(gemini.policy, /decision = "deny"/);
    assertArgValue(gemini.args, '--allowed-mcp-server-names', '__patina_no_mcp__');
  }, FAKE_CLI_WITH_POLICY);
});

test('claude keeps only the Read tool when images are attached; gemini stays tool-free', async () => {
  const imageDir = mkdtempSync(join(tmpdir(), 'patina-tool-image-'));
  const image = join(imageDir, 'shot.png');
  writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    await withFakeCli(async () => {
      const claude = JSON.parse(await claudeCli.invoke({ prompt: 'read the image', images: [image] }));
      assertArgValue(claude.args, '--tools', 'Read');
      assert.ok(claude.args.includes('--strict-mcp-config'));

      const gemini = JSON.parse(await geminiCli.invoke({ prompt: 'read the image', images: [image] }));
      assert.strictEqual(gemini.policy, geminiCli.GEMINI_NO_TOOLS_POLICY);
      assert.match(gemini.stdin, /^@ocr-image-0\.png\n/);
    }, FAKE_CLI_WITH_POLICY);
  } finally {
    rmSync(imageDir, { recursive: true, force: true });
  }
});

test('local CLI backends pass explicit non-alias model ids', async () => {
  await withFakeCli(async () => {
    const codex = JSON.parse(await codexCli.invoke({
      prompt: 'rewrite this',
      model: 'codex-mini-latest',
      modelSource: 'flag',
    }));
    assertArgValue(codex.args, '--model', 'codex-mini-latest');

    const gemini = JSON.parse(await geminiCli.invoke({
      prompt: 'rewrite this',
      model: 'gemini-3-flash-preview',
      modelSource: 'flag',
    }));
    assertArgValue(gemini.args, '-m', 'gemini-3-flash-preview');

    const kimi = JSON.parse(await kimiCli.invoke({
      prompt: 'rewrite this',
      model: 'kimi-k2.5',
      modelSource: 'flag',
    }));
    assertArgValue(kimi.args, '--model', 'kimi-k2.5');
  });
});

test('Kimi detailed output preserves validated private session identities', async () => {
  const uuid = '04698749-1e50-4b73-a5a8-6d3f3c61f4c9';
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const session = args[args.indexOf('--prompt') + 1];
console.log(JSON.stringify({ role: 'assistant', content: 'Rewritten text.' }));
console.log(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: session }));
`;
  await withFakeCli(async () => {
    for (const session of [uuid, `session_${uuid}`]) {
      const result = await kimiCli.invokeDetailed({ prompt: session });
      assert.equal(result.text, 'Rewritten text.');
      assert.equal(result.sessionId, session);
      assert.equal(Object.hasOwn(result, 'rawOutput'), false);
    }
    const invalid = await kimiCli.invokeDetailed({ prompt: '../../untrusted-session' });
    assert.equal(invalid.sessionId, null);
    assert.equal(await kimiCli.invoke({ prompt: uuid }), 'Rewritten text.');
  }, script);
});

test('Kimi clients lacking explicit tool restrictions never fall back to unrestricted mode', async () => {
  const script = `#!/usr/bin/env node
if (process.argv.includes('--agent-file')) {
  process.stderr.write('unknown option: --agent-file');
  process.exit(2);
}
console.log('Unrestricted legacy mode');
`;
  await withFakeCli(async () => {
    await assert.rejects(kimiCli.invoke({ prompt: 'Source text' }), /0\.29\+.*tool restrictions.*Upgrade/);
  }, script);
});
