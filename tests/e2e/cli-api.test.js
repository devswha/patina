import { createServer } from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { main } from '../../src/cli.js';
import { getRepoRoot } from '../../src/config.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

let mockServer;
let mockPort;
let callCount = 0;
let lastRequestBody = null;

function startMockServer(responseText, statusCode = 200) {
  return new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      callCount++;
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

    assert.ok(help.includes('Core options:'), 'help should group core options');
    assert.ok(help.includes('Modes:'), 'help should group modes');
    assert.ok(help.includes('Model / auth / backend:'), 'help should group backend options');
    assert.ok(help.includes('--gate <n>'), 'help should document score gate');
    assert.ok(
      help.includes('openai-http, codex-cli, claude-cli, gemini-cli'),
      'help should list every backend name'
    );
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
