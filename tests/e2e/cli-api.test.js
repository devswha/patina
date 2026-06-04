import { createServer } from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { main } from '../../src/cli.js';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

let mockServer;
let mockPort;
let callCount = 0;
let lastRequestBody = null;
let lastAuthorization = null;
let mockApiKeyPath;

function startMockServer(responseText, statusCode = 200, extraResponse = {}) {
  return new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      callCount++;
      lastAuthorization = req.headers.authorization || null;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        lastRequestBody = JSON.parse(body);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: responseText } }],
          ...extraResponse,
        }));
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });
}

function stopMockServer() {
  return new Promise((resolve) => {
    mockServer.close(resolve);
  });
}

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
    await startMockServer('This is the humanized result.');
    const keyDir = mkdtempSync(join(tmpdir(), 'patina-api-key-'));
    mockApiKeyPath = resolve(keyDir, 'key.txt');
    writeFileSync(mockApiKeyPath, 'test-key\n');
  });

  after(async () => {
    await stopMockServer();
  });

  it('should call LLM API with correct prompt structure', async () => {
    callCount = 0;
    lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--profile', 'default',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      '--model', 'gpt-5',
      testFile,
    ]);

    assert.strictEqual(callCount, 1, 'Should make exactly one API call');
    assert.ok(lastRequestBody, 'Request body should be captured');
    assert.strictEqual(lastRequestBody.model, 'gpt-5');
    assert.ok(lastRequestBody.messages[0].content.includes('Pattern Packs'));
    assert.ok(lastRequestBody.messages[0].content.includes('Input Text'));
  });

  it('uses the compact rewrite prompt internally for gemini models', async () => {
    callCount = 0;
    lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--backend', 'openai-http',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      '--model', 'gemini-3-flash-preview',
      testFile,
    ]);

    const prompt = lastRequestBody.messages[0].content;
    assert.ok(prompt.includes('AI signal words (reference)'));
    assert.ok(!prompt.includes('Follow the 3-Phase pipeline'));
  });

  it('should pass correct temperature', async () => {
    callCount = 0;
    lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      '--model', 'gpt-5',
      testFile,
    ]);

    assert.strictEqual(lastRequestBody.temperature, 0.7);
  });

  it('injects --voice-sample paragraphs into rewrite prompts', async () => {
    callCount = 0;
    lastRequestBody = null;
    const dir = mkdtempSync(join(tmpdir(), 'patina-voice-sample-cli-'));
    const samplePath = resolve(dir, 'sample.md');
    writeFileSync(samplePath, [
      'I tend to start with the awkward tradeoff, not the polished takeaway.',
      'Then I add one concrete detail so the point does not float away.',
      'A final short sentence is fine.',
      'This fourth paragraph should be ignored.',
    ].join('\n\n'), 'utf8');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--voice-sample', samplePath,
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]);

    const prompt = lastRequestBody.messages[0].content;
    assert.ok(prompt.includes('Voice Anchor Examples'));
    assert.ok(prompt.includes('examples of how this person writes'));
    assert.ok(prompt.includes('I tend to start with the awkward tradeoff'));
    assert.ok(!prompt.includes('This fourth paragraph should be ignored.'));
  });

  it('uses OPENAI_API_KEY for the default HTTP backend when no key file flag is passed', async () => {
    callCount = 0;
    lastRequestBody = null;
    lastAuthorization = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await withEnv({
      PATINA_API_KEY: undefined,
      PATINA_API_KEY_FILE: undefined,
      OPENAI_API_KEY: 'openai-env-key',
      GEMINI_API_KEY: undefined,
      GROQ_API_KEY: undefined,
      TOGETHER_API_KEY: undefined,
    }, async () => {
      await main([
        '--lang', 'en',
        '--base-url', `http://127.0.0.1:${mockPort}`,
        '--model', 'gpt-5',
        testFile,
      ]);
    });

    assert.strictEqual(callCount, 1, 'Should make exactly one API call');
    assert.strictEqual(lastAuthorization, 'Bearer openai-env-key');
  });

  it('keeps selected provider env keys ahead of generic PATINA_API_KEY', async () => {
    callCount = 0;
    lastRequestBody = null;
    lastAuthorization = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await withEnv({
      PATINA_API_KEY: 'patina-env-key',
      PATINA_API_KEY_FILE: undefined,
      OPENAI_API_KEY: 'openai-env-key',
      GEMINI_API_KEY: 'gemini-env-key',
      GROQ_API_KEY: undefined,
      TOGETHER_API_KEY: undefined,
    }, async () => {
      await main([
        '--lang', 'en',
        '--provider', 'gemini',
        '--backend', 'openai-http',
        '--base-url', `http://127.0.0.1:${mockPort}`,
        '--model', 'provider-test',
        testFile,
      ]);
    });

    assert.strictEqual(callCount, 1, 'Should make exactly one API call');
    assert.strictEqual(lastAuthorization, 'Bearer gemini-env-key');
  });

  it('should handle --audit mode', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('Audit result: patterns detected.');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--audit',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]);

    assert.ok(lastRequestBody.messages[0].content.includes('audit'));
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });

  it('should handle --score mode', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('{ "overall": 23, "interpretation": "mostly human" }');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--score',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]);

    assert.ok(lastRequestBody.messages[0].content.includes('score'));
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });


  it('should group help output and list current backend names', async () => {
    const { logs } = await captureConsole(() => main(['--help']));
    const help = logs.join('\n');

    assert.ok(help.includes('MODES'), 'help should group modes');
    assert.ok(help.includes('OUTPUT & BATCH'), 'help should group output options');
    assert.ok(help.includes('LANGUAGE & PROFILE'), 'help should group language options');
    assert.ok(help.includes('MODEL & AUTH'), 'help should group backend options');
    assert.ok(help.includes('ADVANCED'), 'help should group advanced options');
    assert.ok(help.includes('EXAMPLES'), 'help should include examples');
    assert.ok(help.includes('--gate <n>'), 'help should document score gate');
    assert.ok(help.includes('--format <fmt>'), 'help should document output format');
    assert.ok(help.includes('--quiet'), 'help should document quiet logs');
    assert.ok(help.includes('--json-logs'), 'help should document structured stderr logs');
    assert.ok(help.includes('--no-color'), 'help should document diff color opt-out');
    assert.ok(
      help.includes('openai-http, codex-cli, claude-cli, gemini-cli'),
      'help should list every backend name'
    );
  });

  it('should wrap score output in documented JSON when --format json is used', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('{ "overall": 23, "categories": { "style": { "score": 10 } }, "interpretation": "mostly human" }');

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--score',
      '--exit-on', '30',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
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
    assert.ok(parsed.tone);
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });

  it('should validate score weights before wrapping --format json output', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer([
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
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]));

    assert.strictEqual(JSON.parse(logs.join('\n')).overall, 23);
    assert.ok(!errors.some((line) => line.includes('weight check')), errors.join('\n'));
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });


  it('should suppress stderr status and warnings with --quiet', async () => {
    callCount = 0;
    lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const { errors, logs } = await captureConsole(() => main([
      '--lang', 'en',
      '--quiet',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]));

    assert.strictEqual(callCount, 1, 'Should make exactly one API call');
    assert.deepStrictEqual(errors, []);
    assert.match(logs.join('\n'), /This is the humanized result\./);
  });


  it('should set exit code 3 when --score gate fails', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('{ "overall": 42, "interpretation": "mixed" }');

    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    try {
      const { errors } = await captureConsole(() => main([
        '--lang', 'en',
        '--score',
        '--gate', '30',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]));

      assert.strictEqual(process.exitCode, 3);
      assert.ok(errors.some((line) => line.includes('score gate failed')));
    } finally {
      process.exitCode = oldExitCode;
    }
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });

  it('should emit stderr logs as NDJSON with stable fields', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('{ "overall": 42, "interpretation": "mixed" }');

    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    try {
      const { errors } = await captureConsole(() => main([
        '--lang', 'en',
        '--score',
        '--gate', '30',
        '--json-logs',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]));

      assert.strictEqual(process.exitCode, 3);
      const records = errors.map((line) => JSON.parse(line));
      const gate = records.find((record) => record.event === 'score.gate_failed');
      assert.ok(gate);
      assert.strictEqual(gate.level, 'warn');
      assert.strictEqual(gate.model, null);
      assert.strictEqual(gate.latency_ms, null);
    } finally {
      process.exitCode = oldExitCode;
    }
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });

  it('should accept --exit-on as the CI score gate alias', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('{ "overall": 42, "interpretation": "mixed" }');

    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    try {
      await captureConsole(() => main([
        '--lang', 'en',
        '--score',
        '--exit-on', '30',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]));

      assert.strictEqual(process.exitCode, 3);
    } finally {
      process.exitCode = oldExitCode;
    }
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });

  it('should reject --gate outside score mode', async () => {
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await assert.rejects(
      () => main([
        '--gate', '30',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]),
      /--gate can only be used with --score/
    );
  });


  it('should handle API errors gracefully', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('Error occurred', 500);

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    try {
      await main([
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]);
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('500') || err.message.includes('failed after'));
    }

    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });
});
