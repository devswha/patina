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
  "import { writeFileSync } from 'node:fs';",
  "import { basename } from 'node:path';",
  'const args = process.argv.slice(2);',
  "if (args.includes('--version')) process.exit(0);",
  "let stdin = '';",
  "process.stdin.on('data', (chunk) => { stdin += chunk; });",
  "process.stdin.on('end', () => {",
  "  const payload = JSON.stringify({ command: basename(process.argv[1]), args, stdin });",
  "  const outIndex = args.indexOf('--output-last-message');",
  '  if (outIndex !== -1) writeFileSync(args[outIndex + 1], payload);',
  '  else process.stdout.write(payload);',
  '});',
  '',
].join('\n');

async function withFakeCli(fn) {
  const binDir = mkdtempSync(join(tmpdir(), 'patina-model-cli-'));
  const oldPath = process.env.PATH;
  try {
    for (const command of ['claude', 'codex', 'gemini', 'kimi']) {
      const path = join(binDir, command);
      writeFileSync(path, FAKE_CLI);
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
    resolveLocalCliModel({ backendName: 'kimi-cli', model: 'kimi', modelSource: 'flag' }),
    DEFAULT_BEST_MODELS.kimiCli
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
    assert.strictEqual(kimi.stdin, 'rewrite this');
  });
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
