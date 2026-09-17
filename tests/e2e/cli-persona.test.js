import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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
  // main() runs in-process here, so any process.exitCode it sets would leak
  // into the test runner's own exit code. Snapshot and restore it.
  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  let exitCode;
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
    // No test in this file uses --verify, so no scorer call is ever made and the
    // canned response must not carry a scorer JSON trailer: the mock serves one
    // body for every request, so the trailer lands in the rewrite output itself and
    // makes the rewrite add two numbers the source never had.
    mock = await startMockServer('[BODY]\n이 문장은 사람이 쓴 것처럼 자연스럽습니다.\n[/BODY]');
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

  it('runs --persona natural-ko and keeps safety outside Persona metadata', async () => {
    const { logs, exitCode } = await captureConsole(() => main([
      '--persona', 'natural-ko',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      inputPath,
    ]));

    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.mode, 'rewrite');
    assert.equal(payload.persona.id, 'natural-ko');
    assert.equal(Object.hasOwn(payload.persona, 'depth'), false);
    assert.equal(payload.persona.thresholds_source, 'placeholder');
    // The global deterministic meaning guard sees the dropped source number.
    assert.equal(exitCode, 4);
    // Persona remains a voice-quality advisory only.
    assert.equal(payload.persona.gate_result.pass, true);
    assert.deepEqual(payload.persona.gate_result.safetyFailures, []);
  });

  it('keeps a no-Persona rewrite on the source-voice path', async () => {
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
    // No Persona metadata or Persona-quality warning is emitted.
    assert.equal(exitCode, 0);
  });

  it('runs --lang en --persona natural-en', async () => {
    const enPath = resolve(keyDir, 'en2.txt');
    writeFileSync(enPath, 'This is a plain test sentence with no numbers.');
    const { logs, exitCode } = await captureConsole(() => main([
      '--lang', 'en',
      '--persona', 'natural-en',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      enPath,
    ]));

    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.mode, 'rewrite');
    assert.equal(payload.persona.id, 'natural-en');
    assert.equal(Object.hasOwn(payload.persona, 'depth'), false);
    assert.equal(payload.persona.gate_result.pass, true);
    assert.equal(exitCode, 0);
  });

  it('keeps Persona quality thresholds advisory and separate from verification', async () => {
    const enPath = resolve(keyDir, 'en-thresholds.txt');
    writeFileSync(enPath, 'This is a plain test sentence with no numbers.');
    const configPath = resolve(keyDir, 'thresholds.yaml');
    writeFileSync(configPath, [
      'verification:',
      '  mps-floor: 99',
      '  fidelity-floor: 99',
      'personas:',
      '  thresholds:',
      '    persona_match_min: 101',
      '    churn_max: 0',
      '',
    ].join('\n'));
    const { logs, exitCode } = await captureConsole(() => main([
      '--lang', 'en',
      '--persona', 'natural-en',
      '--config', configPath,
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      enPath,
    ]));
    const payload = JSON.parse(logs.join('\n'));
    assert.equal(exitCode, 0);
    assert.equal(payload.persona.gate_result.pass, true);
    assert.ok(payload.persona.gate_result.advisory.length > 0);
  });

  it('lists built-in en/zh/ja seed personas via persona list', async () => {
    const cases = {
      en: ['blog-essay', 'natural-en', 'technical-explainer'],
      zh: ['blog-essay', 'natural-zh'],
      ja: ['blog-essay', 'natural-ja'],
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

  it('persona show natural-ko prints target features and exits 0', async () => {
    const { logs, exitCode } = await captureConsole(() => main(['persona', 'show', 'natural-ko']));
    assert.equal(exitCode, 0);
    const out = logs.join('\n');
    assert.ok(out.includes('target_features') || out.includes('burstiness_cv'), 'persona show should print target features');
  });

  it('persona rm natural-ko refuses the built-in seed and never deletes it', async () => {
    const libPath = resolve(_REPO_ROOT, 'personas', 'ko', 'natural-ko.md');
    assert.ok(existsSync(libPath), 'natural-ko library seed should exist before rm');
    // Built-in personas cannot be removed: main() rejects with exit code 2.
    await assert.rejects(
      () => main(['persona', 'rm', 'natural-ko']),
      (err) => err && err.exitCode === 2,
    );
    assert.ok(existsSync(libPath), 'natural-ko library seed must still exist after a refused rm');
  });

  it('rejects the retired --profile axis', async () => {
    await assert.rejects(
      () => main(['--profile', 'blog', inputPath]),
      (err) => err && err.exitCode === 2 && /--profile was removed/.test(err.message),
    );
  });

  it('rejects a retired profile key in config', async () => {
    const configPath = resolve(keyDir, 'profile-blog.yaml');
    writeFileSync(configPath, 'language: en\nprofile: blog\n');
    await assert.rejects(
      () => main(['--config', configPath, inputPath]),
      (err) => err && err.exitCode === 2 && /config key ['"]profile['"] was removed/.test(err.message),
    );
  });
});
