import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { main } from '../../src/cli.js';
import { resolvePromptMode } from '../../src/cli/run.js';
import { startMockServer } from './helpers/mock-server.js';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

let mock;
let mockApiKeyPath;
let keyDir;

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

async function withEnv(envOverrides, fn) {
  const original = {};
  for (const key of Object.keys(envOverrides)) {
    original[key] = process.env[key];
    if (envOverrides[key] === undefined) delete process.env[key];
    else process.env[key] = envOverrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

describe('CLI End-to-End with Mock API', () => {
  before(async () => {
    mock = await startMockServer('This is the humanized result.');
    keyDir = mkdtempSync(join(tmpdir(), 'patina-api-key-'));
    mockApiKeyPath = resolve(keyDir, 'key.txt');
    writeFileSync(mockApiKeyPath, 'test-key\n');
  });

  after(async () => {
    await mock.stop();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it('should call LLM API with correct prompt structure', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--document-type', 'default',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      testFile,
    ]);

    assert.strictEqual(mock.callCount, 1, 'Should make exactly one API call');
    assert.ok(mock.lastRequestBody, 'Request body should be captured');
    assert.strictEqual(mock.lastRequestBody.model, 'gpt-5');
    assert.ok(mock.lastRequestBody.messages[0].content.includes('Pattern Packs'));
    assert.ok(mock.lastRequestBody.messages[0].content.includes('Input Text'));
  });

  it('uses the compact rewrite prompt internally for gemini models', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--backend', 'openai-http',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gemini-3-flash-preview',
      testFile,
    ]);

    const prompt = mock.lastRequestBody.messages[0].content;
    assert.ok(prompt.includes('AI signal words (reference)'));
    assert.ok(!prompt.includes('Follow the 3-Phase pipeline'));
  });

  it('uses compact prompt mode for local agent CLI backends', () => {
    assert.strictEqual(resolvePromptMode({ backend: 'claude-cli' }), 'minimal');
    assert.strictEqual(resolvePromptMode({ backend: 'gemini-cli' }), 'minimal');
    assert.strictEqual(resolvePromptMode({ backend: 'openai-http', model: 'gpt-5' }), 'strict');
  });

  it('should pass correct temperature', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      '--model', 'gpt-5',
      testFile,
    ]);

    assert.strictEqual(mock.lastRequestBody.temperature, 0.7);
  });

  it('uses OPENAI_API_KEY for the default HTTP backend when no key file flag is passed', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    mock.lastAuthorization = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await withEnv({
      PATINA_API_KEY: undefined,
      PATINA_API_KEY_FILE: undefined,
      OPENAI_API_KEY: 'openai-env-key',
      GEMINI_API_KEY: undefined,
      GROQ_API_KEY: undefined,
      TOGETHER_API_KEY: undefined,
      KIMI_API_KEY: undefined,
      MOONSHOT_API_KEY: undefined,
    }, async () => {
      await main([
        '--lang', 'en',
        '--base-url', `http://127.0.0.1:${mock.port}`,
        '--model', 'gpt-5',
        testFile,
      ]);
    });

    assert.strictEqual(mock.callCount, 1, 'Should make exactly one API call');
    assert.strictEqual(mock.lastAuthorization, 'Bearer openai-env-key');
  });

  it('keeps selected provider env keys ahead of generic PATINA_API_KEY', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    mock.lastAuthorization = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await withEnv({
      PATINA_API_KEY: 'patina-env-key',
      PATINA_API_KEY_FILE: undefined,
      OPENAI_API_KEY: 'openai-env-key',
      GEMINI_API_KEY: 'gemini-env-key',
      GROQ_API_KEY: undefined,
      TOGETHER_API_KEY: undefined,
      KIMI_API_KEY: undefined,
      MOONSHOT_API_KEY: undefined,
    }, async () => {
      await main([
        '--lang', 'en',
        '--provider', 'gemini',
        '--backend', 'openai-http',
        '--base-url', `http://127.0.0.1:${mock.port}`,
        '--model', 'provider-test',
        testFile,
      ]);
    });

    assert.strictEqual(mock.callCount, 1, 'Should make exactly one API call');
    assert.strictEqual(mock.lastAuthorization, 'Bearer gemini-env-key');
  });

  it('should handle --audit mode', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('Audit result: patterns detected.');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--audit',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]);

    assert.ok(mock.lastRequestBody.messages[0].content.includes('audit'));
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });

  it('should handle --score mode', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('{ "overall": 23, "interpretation": "mostly human" }');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--score',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]);

    assert.ok(mock.lastRequestBody.messages[0].content.includes('score'));
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });

  it('should group help output and list current backend names', async () => {
    const { logs } = await captureConsole(() => main(['--help']));
    const help = logs.join('\n');

    assert.ok(help.includes('MODES'), 'help should group modes');
    assert.ok(help.includes('--document-type'), 'Help should document --document-type');
    assert.ok(help.includes('DOCUMENT & VOICE'), 'help should group document and voice options');
    assert.ok(help.includes('MODEL & AUTH'), 'help should group backend options');
    assert.ok(help.includes('ADVANCED'), 'help should group advanced options');
    assert.ok(help.includes('EXAMPLES'), 'help should include examples');
    assert.ok(help.includes('--exit-on <n>'), 'help should document score gate');
    assert.ok(help.includes('--offline'), 'help should document deterministic offline scoring');
    assert.ok(help.includes('--format <fmt>'), 'help should document output format');
    assert.ok(help.includes('--quiet'), 'help should document quiet logs');
    assert.ok(!help.includes('--json-logs'), 'help should not document removed structured stderr logs');
    assert.ok(!help.includes('--list-providers'), 'help should not document removed provider listing');
    assert.ok(!/\n\s*--json\s+Alias for --format json/.test(help), 'help should not document removed json alias');
    assert.ok(help.includes('--no-color'), 'help should document diff color opt-out');
    assert.ok(!help.includes('--preview'), 'help should not document the removed preview mode');
    assert.ok(!help.includes('--xliff'), 'help should not document the removed XLIFF mode');
    assert.ok(!help.includes('--browser'), 'help should not document the removed browser alias');
    assert.ok(
      help.includes('openai-http, codex-cli, claude-cli, gemini-cli, agy-cli'),
      'help should list every backend name'
    );
  });

  it('should wrap score output in documented JSON when --format json is used', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('{ "overall": 23, "categories": { "style": { "score": 10 } }, "interpretation": "mostly human" }');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--score',
      '--exit-on', '30',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]));

    const parsed = JSON.parse(logs.join('\n'));
    assert.strictEqual(parsed.mode, 'score');
    assert.strictEqual(parsed.format, 'json');
    assert.strictEqual(parsed.overall, 23);
    assert.deepStrictEqual(parsed.gateResult, {
      threshold: 30,
      overall: 23,
      passed: true,
      exitCode: 0,
    });
    assert.strictEqual(parsed.categories[0].name, 'style');
    assert.strictEqual(parsed.register, null);
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });

  it('scores offline without resolving or calling a backend', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--score',
      '--offline',
      '--exit-on', '100',
      '--format', 'json',
      testFile,
    ]));

    assert.strictEqual(mock.callCount, 0);
    assert.strictEqual(mock.lastRequestBody, null);
    const parsed = JSON.parse(logs.join('\n'));
    assert.strictEqual(parsed.mode, 'score');
    assert.strictEqual(parsed.overall, 100);
    assert.deepStrictEqual(parsed.categories, []);
    assert.strictEqual(parsed.scores.llm, null);
    assert.strictEqual(parsed.scores.preference, 'deterministic-only');
    assert.strictEqual(parsed.scores.deterministic.overall, 100);
    assert.match(parsed.output, /LLM-judged categories unavailable/);
    assert.deepStrictEqual(parsed.gateResult, {
      threshold: 100,
      overall: 100,
      passed: true,
      exitCode: 0,
    });
  });

  it('fails offline scoring when deterministic analysis has no numeric score', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    const configPath = resolve(keyDir, 'offline-language-disabled.yaml');
    writeFileSync(configPath, 'stylometry:\n  languages: [ko]\n');
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await assert.rejects(
      () => main([
        '--lang', 'en',
        '--score',
        '--offline',
        '--config', configPath,
        testFile,
      ]),
      /offline score is unavailable/,
    );
    assert.strictEqual(mock.callCount, 0);
    assert.strictEqual(mock.lastRequestBody, null);
  });

  it('rejects --list-backends before offline scoring dispatch', async () => {
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    await assert.rejects(
      () => main(['--score', '--offline', '--list-backends', testFile]),
      /--list-backends cannot be combined with --offline/,
    );
  });

  it('should validate score weights before wrapping --format json output', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer([
      '| Category | Weight | Detected | Raw Score | Weighted |',
      '|---|---:|---:|---:|---:|',
      '| content | 0.20 | 0 | 0 | 0 |',
      '| language | 0.20 | 0 | 0 | 0 |',
      '| style | 0.20 | 0 | 0 | 0 |',
      '| communication | 0.12 | 0 | 0 | 0 |',
      '| filler | 0.08 | 0 | 0 | 0 |',
      '| structure | 0.10 | 0 | 0 | 0 |',
      '| viral-hook | 0.10 | 0 | 0 | 0 |',
      '| Overall | - | - | - | 23 |',
    ].join('\n'));

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { errors, logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--score',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]));

    assert.strictEqual(JSON.parse(logs.join('\n')).overall, 23);
    assert.ok(!errors.some((line) => line.includes('weight check')), errors.join('\n'));
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });


  it('should suppress stderr status and warnings with --quiet', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { errors, logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--quiet',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]));

    assert.strictEqual(mock.callCount, 1, 'Should make exactly one API call');
    assert.deepStrictEqual(errors, []);
    assert.match(logs.join('\n'), /This is the humanized result\./);
    assert.doesNotMatch(logs.join('\n'), /register_source:/);
  });

  it('should keep --format text to the rewritten body without register metadata', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--format', 'text',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]));

    assert.strictEqual(mock.callCount, 1, 'Should make exactly one API call');
    assert.strictEqual(logs.join('\n'), 'This is the humanized result.');
  });


  it('should set exit code 3 when --score gate fails', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('{ "overall": 42, "interpretation": "mixed" }');

    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    try {
      const { errors } = await captureConsole(() => main([
        '--lang', 'en',
        '--score',
        '--exit-on', '30',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]));

      assert.strictEqual(process.exitCode, 3);
      assert.ok(errors.some((line) => line.includes('score gate failed')));
    } finally {
      process.exitCode = oldExitCode;
    }
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });


  it('should accept --exit-on as the CI score gate', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('{ "overall": 42, "interpretation": "mixed" }');

    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    try {
      await captureConsole(() => main([
        '--lang', 'en',
        '--score',
        '--exit-on', '30',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]));

      assert.strictEqual(process.exitCode, 3);
    } finally {
      process.exitCode = oldExitCode;
    }
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });

  it('should reject --exit-on outside score mode', async () => {
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await assert.rejects(
      () => main([
        '--exit-on', '30',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]),
      /--exit-on can only be used with --score/
    );
  });



  it('stops batch mode after the configured failure budget', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('Error occurred', 500);

    const dir = mkdtempSync(join(tmpdir(), 'patina-batch-breaker-'));
    const first = resolve(dir, 'first.txt');
    const second = resolve(dir, 'second.txt');
    const third = resolve(dir, 'third.txt');
    writeFileSync(first, 'This is the first draft.', 'utf8');
    writeFileSync(second, 'This is the second draft.', 'utf8');
    writeFileSync(third, 'This is the third draft.', 'utf8');

    await assert.rejects(
      () => captureConsole(() => main([
        '--lang', 'en',
        '--batch',
        '--max-retries', '0',
        '--max-failures', '2',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        first,
        second,
        third,
      ])),
      /batch circuit breaker stopped the run/
    );

    assert.strictEqual(mock.callCount, 2, 'Should stop before the third file');
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });
  it('should handle API errors gracefully', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    await mock.stop();
    mock = await startMockServer('Error occurred', 500);

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    try {
      await main([
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('500') || err.message.includes('failed after'));
    }

    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
  });
});
