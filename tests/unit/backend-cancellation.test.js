import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import * as claudeCli from '../../src/backends/claude-cli.js';
import * as codexCli from '../../src/backends/codex-cli.js';
import * as geminiCli from '../../src/backends/gemini-cli.js';

const BACKENDS = [
  { command: 'claude', backend: claudeCli },
  { command: 'codex', backend: codexCli },
  { command: 'gemini', backend: geminiCli },
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
