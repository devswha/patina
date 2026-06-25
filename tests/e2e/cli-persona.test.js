import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { main } from '../../src/cli.js';
import { startMockServer } from './helpers/mock-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _REPO_ROOT = resolve(__dirname, '../..');

let mock;
let keyDir;
let mockApiKeyPath;
let inputPath;

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { logs, errors };
}

describe('CLI persona harness', () => {
  before(async () => {
    mock = await startMockServer('[BODY]\n이 문장은 사람이 쓴 것처럼 자연스럽습니다.\n[/BODY]\n{"mps":95,"fidelity":95}');
    keyDir = mkdtempSync(join(tmpdir(), 'patina-persona-'));
    mockApiKeyPath = resolve(keyDir, 'key.txt');
    inputPath = resolve(keyDir, 'ko.txt');
    writeFileSync(mockApiKeyPath, 'test-key\n');
    writeFileSync(inputPath, '이것은 테스트 문장입니다.');
  });

  after(async () => {
    await mock.stop();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it('runs --persona preserve with mocked backend and emits JSON persona field', async () => {
    const { logs } = await captureConsole(() => main([
      '--persona', 'preserve',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      inputPath,
    ]));

    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.mode, 'rewrite');
    assert.equal(payload.persona.id, 'preserve');
    assert.equal(payload.persona.depth, 'style-only');
    assert.equal(payload.persona.thresholds_source, 'placeholder');
  });

  it('keeps non-Korean no-persona rewrite path without persona gate', async () => {
    const enPath = resolve(keyDir, 'en.txt');
    writeFileSync(enPath, 'This is a test sentence.');
    const { logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      enPath,
    ]));

    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.mode, 'rewrite');
    assert.equal(payload.persona, null);
  });
});
