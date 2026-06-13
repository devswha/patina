import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import * as claudeCli from '../../src/backends/claude-cli.js';
import * as codexCli from '../../src/backends/codex-cli.js';
import * as geminiCli from '../../src/backends/gemini-cli.js';
import * as kimiCli from '../../src/backends/kimi-cli.js';

const BACKENDS = [
  { command: 'claude', backend: claudeCli },
  { command: 'codex', backend: codexCli },
  { command: 'gemini', backend: geminiCli },
  { command: 'kimi', backend: kimiCli },
];

test('CLI backends reject AbortSignal cancellation and kill their child process', async () => {
  const binDir = mkdtempSync(join(tmpdir(), 'patina-fake-cli-'));
  const oldPath = process.env.PATH;

  try {
    for (const { command } of BACKENDS) {
      const path = join(binDir, command);
      writeFileSync(path, [
        '#!/usr/bin/env node',
        'process.stdin.resume();',
        'setInterval(() => {}, 1000);',
        '',
      ].join('\n'));
      chmodSync(path, 0o755);
    }
    process.env.PATH = `${binDir}:${oldPath || ''}`;

    for (const { command, backend } of BACKENDS) {
      const controller = new AbortController();
      const promise = backend.invoke({
        prompt: 'rewrite this',
        signal: controller.signal,
        timeout: 5000,
      });
      setTimeout(() => controller.abort(), 20);

      await assert.rejects(
        promise,
        (err) => err?.name === 'AbortError' && err.message === `${command}-cli backend: aborted`,
        `${command} should reject with AbortError on external abort`
      );
    }
  } finally {
    process.env.PATH = oldPath;
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('codex-cli does not deadlock when the child floods stdout (#438)', async () => {
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
