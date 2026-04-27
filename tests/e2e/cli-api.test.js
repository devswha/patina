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

  it('should handle MAX mode with multiple models', async () => {
    callCount = 0;
    lastRequestBody = null;
    await stopMockServer();

    let callNum = 0;
    mockServer = createServer((req, res) => {
      callCount++;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        lastRequestBody = JSON.parse(body);
        callNum++;
        const model = lastRequestBody.model;
        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (model === 'model-a') {
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Result from model A' } }],
          }));
        } else if (model === 'model-b') {
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Result from model B' } }],
          }));
        } else {
          res.end(JSON.stringify({
            choices: [{ message: { content: 'Score result' } }],
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

    assert.ok(callCount >= 2, `Should make multiple API calls, got ${callCount}`);
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
