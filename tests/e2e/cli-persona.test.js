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
  // main() runs in-process here, so any process.exitCode it sets (e.g. the
  // persona safety gate on a churny rewrite) would leak into the test runner's
  // own exit code. Snapshot and restore it, and hand the observed code back.
  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  let exitCode = 0;
  try {
    await fn();
    exitCode = Number(process.exitCode) || 0;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
  return { logs, errors, exitCode };
}

describe('CLI persona harness', () => {
  before(async () => {
    mock = await startMockServer('[BODY]\n이 문장은 사람이 쓴 것처럼 자연스럽습니다.\n[/BODY]\n{"mps":95,"fidelity":95}');
    keyDir = mkdtempSync(join(tmpdir(), 'patina-persona-'));
    mockApiKeyPath = resolve(keyDir, 'key.txt');
    inputPath = resolve(keyDir, 'ko.txt');
    writeFileSync(mockApiKeyPath, 'test-key\n');
    writeFileSync(inputPath, '이것은 2026년에 시작한 테스트 문장입니다.');
  });

  after(async () => {
    await mock.stop();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it('runs --persona preserve with mocked backend and emits JSON persona field', async () => {
    const { logs, exitCode } = await captureConsole(() => main([
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
    // The mock output drops the source number "2026", so the deterministic
    // dropped-numbers safety signal fires: the gate ENFORCES (exit 4) while
    // still emitting output. High surface churn stays advisory (never blocks).
    assert.equal(exitCode, 4);
    assert.ok(payload.persona.gate_result.safetyFailures.includes('numbers'));
    assert.equal(payload.persona.gate_result.pass, false);
    assert.ok(payload.persona.gate_result.advisory.includes('churn'));
  });

  it('keeps non-Korean no-persona rewrite path without persona gate', async () => {
    const enPath = resolve(keyDir, 'en.txt');
    writeFileSync(enPath, 'This is a test sentence.');
    const { logs, exitCode } = await captureConsole(() => main([
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
    // No persona gate on the non-Korean path: nothing enforces an exit code.
    assert.equal(exitCode, 0);
  });

  it('runs --lang en --persona preserve (multilingual persona axis)', async () => {
    const enPath = resolve(keyDir, 'en2.txt');
    writeFileSync(enPath, 'This is a plain test sentence with no numbers.');
    const { logs, exitCode } = await captureConsole(() => main([
      '--lang', 'en',
      '--persona', 'preserve',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      enPath,
    ]));

    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.mode, 'rewrite');
    assert.equal(payload.persona.id, 'preserve');
    assert.equal(payload.persona.depth, 'style-only');
    // No source numbers to drop and self-reported MPS/fidelity pass → safety passes.
    assert.equal(payload.persona.gate_result.pass, true);
    assert.equal(exitCode, 0);
  });

  it('lists built-in en/zh/ja seed personas via persona list', async () => {
    const cases = {
      en: ['blog-essay', 'natural-en', 'preserve', 'technical-explainer'],
      zh: ['blog-essay', 'natural-zh', 'preserve'],
      ja: ['blog-essay', 'natural-ja', 'preserve'],
    };
    for (const [lang, ids] of Object.entries(cases)) {
      const { logs, exitCode } = await captureConsole(() => main(['persona', 'list', '--lang', lang]));
      assert.equal(exitCode, 0);
      const out = logs.join('\n');
      for (const id of ids) {
        assert.ok(out.includes(id), `persona list --lang ${lang} should list ${id}`);
      }
    }
  });
});
