import { createServer } from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { main } from '../../src/cli.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

let mockServer;
let mockPort;
let callCount = 0;
let lastRequestBody = null;
let lastAuthorization = null;

function startMockServer(responseText, statusCode = 200) {
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
      '--api-key', 'test-key',
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

  it('should pass correct temperature', async () => {
    callCount = 0;
    lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--api-key', 'test-key',
      '--base-url', `http://127.0.0.1:${mockPort}`,
      '--model', 'gpt-5',
      testFile,
    ]);

    assert.strictEqual(lastRequestBody.temperature, 0.7);
  });

  it('uses OPENAI_API_KEY for the default HTTP backend when no --api-key is passed', async () => {
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
      '--api-key', 'test-key',
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
      '--api-key', 'test-key',
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
    assert.ok(help.includes('--max-timeout <sec>'), 'help should document MAX wall-clock timeout');
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
      '--api-key', 'test-key',
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
      '--api-key', 'test-key',
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]));

    assert.strictEqual(JSON.parse(logs.join('\n')).overall, 23);
    assert.ok(!errors.some((line) => line.includes('weight check')), errors.join('\n'));
    await stopMockServer();
    await startMockServer('This is the humanized result.');
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
        '--api-key', 'test-key',
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
        '--api-key', 'test-key',
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
        '--api-key', 'test-key',
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]),
      /--gate can only be used with --score/
    );
  });

  it('should score each MAX candidate with its own model', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();

    const requests = [];
    mockServer = createServer((req, res) => {
      callCount++;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        lastRequestBody = JSON.parse(body);
        requests.push(lastRequestBody);
        const model = lastRequestBody.model;
        const prompt = lastRequestBody.messages[0].content;
        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (prompt.includes('AI-likeness scoring engine')) {
          const overall = prompt.includes('Result from model B') ? 20 : 40;
          res.end(JSON.stringify({
            choices: [{ message: { content: `{ "overall": ${overall}, "interpretation": "mostly human" }` } }],
          }));
        } else if (prompt.includes('Meaning Preservation evaluator')) {
          res.end(JSON.stringify({
            choices: [{ message: { content: '{ "anchors": [], "pass_count": 1, "total_count": 1, "polarity_pass_count": 0, "polarity_total_count": 0, "mps": 90 }' } }],
          }));
        } else if (model === 'model-a') {
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Result from model A' } }],
          }));
        } else if (model === 'model-b') {
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Result from model B' } }],
          }));
        } else {
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Unexpected model' } }],
          }));
        }
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--models', 'model-a,model-b',
      '--api-key', 'test-key',
      '--base-url', `http://127.0.0.1:${mockPort}`,
      testFile,
    ]);

    const scoringModelsForB = requests
      .filter((request) => request.messages[0].content.includes('Result from model B'))
      .map((request) => request.model);

    assert.deepStrictEqual(
      scoringModelsForB,
      ['model-b', 'model-b'],
      'model-b candidate should be scored for AI-likeness and MPS by model-b'
    );
    assert.ok(callCount >= 6, `Should make rewrite + scoring calls, got ${callCount}`);
    await stopMockServer();
    await startMockServer('This is the humanized result.');
  });

  it('should reject --variants with MAX mode instead of ignoring it', async () => {
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await assert.rejects(
      () => main([
        '--models', 'model-a,model-b',
        '--variants', '2',
        '--api-key', 'test-key',
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]),
      /--variants is not supported with --models\/MAX mode yet/
    );
  });

  it('should set exit code 4 when every MAX candidate fails', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();
    await startMockServer('Unauthorized', 401);

    const oldExitCode = process.exitCode;
    process.exitCode = undefined;
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    try {
      const { logs } = await captureConsole(() => main([
        '--lang', 'en',
        '--models', 'model-a',
        '--api-key', 'test-key',
        '--base-url', `http://127.0.0.1:${mockPort}`,
        testFile,
      ]));

      assert.strictEqual(process.exitCode, 4);
      assert.match(logs.join('\n'), /Best: none/);
    } finally {
      process.exitCode = oldExitCode;
    }
    await stopMockServer();
    await startMockServer('This is the humanized result.');
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
        '--api-key', 'test-key',
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
