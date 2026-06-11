import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { main, resolvePromptMode } from '../../src/cli.js';
import { setBrowserDiffRuntimeForTests, resetBrowserDiffRuntimeForTests } from '../../src/browser-diff.js';
import { startMockServer } from './helpers/mock-server.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

let mock;
let mockApiKeyPath;

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

function makeFakeSpawn(onSpawn) {
  return (command, args) => {
    const child = new EventEmitter();
    child.unref = () => {};
    onSpawn?.({ command, args, child });
    return child;
  };
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
    const keyDir = mkdtempSync(join(tmpdir(), 'patina-api-key-'));
    mockApiKeyPath = resolve(keyDir, 'key.txt');
    writeFileSync(mockApiKeyPath, 'test-key\n');
  });

  after(async () => {
    await mock.stop();
  });

  it('should call LLM API with correct prompt structure', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;

    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await main([
      '--lang', 'en',
      '--profile', 'default',
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
    assert.strictEqual(resolvePromptMode({ backend: 'kimi-cli' }), 'minimal');
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

  it('injects --voice-sample paragraphs into rewrite prompts', async () => {
    mock.callCount = 0;
    mock.lastRequestBody = null;
    const dir = mkdtempSync(join(tmpdir(), 'patina-voice-sample-cli-'));
    try {
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
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]);

      const prompt = mock.lastRequestBody.messages[0].content;
      assert.ok(prompt.includes('Voice Anchor Examples'));
      assert.ok(prompt.includes('examples of how this person writes'));
      assert.ok(prompt.includes('I tend to start with the awkward tradeoff'));
      assert.ok(!prompt.includes('This fourth paragraph should be ignored.'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('supports --browser with JSON stdout while rendering prose HTML and a second diff call', async () => {
    const rewriteResponse = [
      '[BODY]',
      'This is the humanized result.',
      '[/BODY]',
      '',
      '[SELF_AUDIT]',
      '- residual signals: none',
      '[/SELF_AUDIT]',
      '',
      '---',
      'tone: null',
      'tone_source: profile_only',
      'tone_evidence: []',
      'tone_confidence: null',
      '---',
    ].join('\n');
    const diffResponse = [
      'Pattern: 1. Generic polish',
      'Removed: This is the draft.',
      'Added: This is the humanized result.',
      'Why: one short reason',
    ].join('\n');
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    mock.requestBodies = [];
    await mock.stop();
    mock = await startMockServer(rewriteResponse);
    const baseline = await captureConsole(() => main([
      '--lang', 'en',
      '--format', 'json',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]));

    const writes = [];
    const chmods = [];
    const spawns = [];
    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: (prefix) => {
        assert.match(prefix, /patina-browser-diff-/);
        return '/tmp/patina-browser-diff-123';
      },
      writeFile: (path, data, encoding) => {
        writes.push({ path, data, encoding });
      },
      chmod: (path, mode) => {
        chmods.push({ path, mode });
      },
      now: () => 123,
      platform: 'linux',
      spawn: makeFakeSpawn(({ command, args, child }) => {
        spawns.push({ command, args });
        process.nextTick(() => child.emit('close', 0));
      }),
    });

    mock.callCount = 0;
    mock.requestBodies = [];
    mock.lastRequestBody = null;
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: diffResponse },
      ]);

      const browserRun = await captureConsole(() => main([
        '--browser',
        '--lang', 'en',
        '--format', 'json',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]));

      assert.strictEqual(browserRun.logs.join('\n'), baseline.logs.join('\n'));
      assert.deepStrictEqual(browserRun.errors, [
        '[patina] Browser diff page saved at /tmp/patina-browser-diff-123/browser-diff-123.html',
      ]);
      assert.strictEqual(mock.callCount, 2);
      assert.strictEqual(mock.requestBodies.length, 2);
      assert.strictEqual(spawns[0].command, 'xdg-open');
      assert.deepStrictEqual(spawns[0].args, ['/tmp/patina-browser-diff-123/browser-diff-123.html']);
      assert.strictEqual(writes[0].path, '/tmp/patina-browser-diff-123/browser-diff-123.html');
      assert.strictEqual(writes[0].encoding, 'utf8');
      assert.ok(writes[0].data.includes('This is the humanized result.'));
      assert.ok(writes[0].data.includes('Pattern: 1. Generic polish'));
      // The single-paragraph fixture is below the deterministic-score floor,
      // so the page shows the skip-aware card instead of raw score rows.
      assert.ok(writes[0].data.includes('Not scored'));
      assert.ok(writes[0].data.includes('Deterministic scoring needs more than two paragraphs.'));
      assert.ok(!writes[0].data.includes('[SELF_AUDIT]'));
      assert.ok(!writes[0].data.includes('"mode": "rewrite"'));
      assert.deepStrictEqual(chmods, [
        { path: '/tmp/patina-browser-diff-123', mode: 0o700 },
        { path: '/tmp/patina-browser-diff-123/browser-diff-123.html', mode: 0o600 },
      ]);

      const diffPrompt = mock.requestBodies[1].messages[0].content;
      assert.match(diffPrompt, /Compare BEFORE to AFTER\./);
      assert.match(diffPrompt, /Do not rewrite either text\./);
      assert.match(diffPrompt, /report only changes present in AFTER relative to BEFORE/i);
      assert.match(diffPrompt, /## BEFORE/);
      assert.match(diffPrompt, /## AFTER/);
    } finally {
      resetBrowserDiffRuntimeForTests();
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('keeps stdout pure and reports the temp path on stderr when browser open fails', async () => {
    const rewriteResponse = '[BODY]\nThis is the humanized result.\n[/BODY]';
    const diffResponse = 'Pattern: 1. Generic polish\nRemoved: old\nAdded: new\nWhy: reason';
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    await mock.stop();
    mock = await startMockServer(rewriteResponse);
    const baseline = await captureConsole(() => main([
      '--lang', 'en',
      '--api-key-file', mockApiKeyPath,
      '--base-url', `http://127.0.0.1:${mock.port}`,
      testFile,
    ]));

    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: () => '/tmp/patina-browser-diff-456',
      writeFile: () => {},
      chmod: () => {},
      now: () => 456,
      platform: 'linux',
      spawn: makeFakeSpawn(({ child }) => {
        process.nextTick(() => child.emit('close', 1));
      }),
    });

    mock.callCount = 0;
    mock.requestBodies = [];
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: diffResponse },
      ]);

      const browserRun = await captureConsole(() => main([
        '--browser',
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]));

      assert.strictEqual(browserRun.logs.join('\n'), baseline.logs.join('\n'));
      assert.strictEqual(mock.callCount, 2);
      assert.ok(browserRun.errors.some((line) => line.includes('Browser diff page saved at /tmp/patina-browser-diff-456/browser-diff-456.html')));
      assert.ok(browserRun.errors.some((line) => line.includes('Browser open failed: browser opener exited with code 1')));
    } finally {
      resetBrowserDiffRuntimeForTests();
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('keeps rewrite success and writes an HTML warning when the secondary diff call fails', async () => {
    const rewriteResponse = '[BODY]\nThis is the humanized result.\n[/BODY]';
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const writes = [];

    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: () => '/tmp/patina-browser-diff-789',
      writeFile: (_path, data) => {
        writes.push(data);
      },
      chmod: () => {},
      now: () => 789,
      platform: 'linux',
      spawn: makeFakeSpawn(({ child }) => {
        process.nextTick(() => child.emit('close', 0));
      }),
    });

    mock.callCount = 0;
    mock.requestBodies = [];
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: 'backend failed', statusCode: 500 },
      ]);

      const browserRun = await captureConsole(() => main([
        '--browser',
        '--lang', 'en',
        '--max-retries',
        '0',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]));

      assert.match(browserRun.logs.join('\n'), /This is the humanized result\./);
      assert.strictEqual(mock.callCount, 2);
      assert.ok(browserRun.errors.some((line) => line.includes('browser diff explanation failed')));
      assert.ok(writes[0].includes('Pattern explanation unavailable:'));
      assert.ok(writes[0].includes('HTTP 500'));
    } finally {
      resetBrowserDiffRuntimeForTests();
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('serves the diff page at a token URL with --browser --serve and stops when idle', async () => {
    const rewriteResponse = '[BODY]\nThis is the humanized result.\n[/BODY]';
    const diffResponse = 'Pattern: 1. Generic polish\nRemoved: old\nAdded: new\nWhy: reason';
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');

    const spawns = [];
    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: () => '/tmp/patina-browser-diff-serve',
      writeFile: () => {},
      chmod: () => {},
      now: () => 999,
      platform: 'linux',
      spawn: makeFakeSpawn(({ command, args }) => {
        spawns.push({ command, args });
      }),
      randomToken: () => 'e2etoken',
      idleTimeoutMs: 750,
    });

    mock.callCount = 0;
    mock.requestBodies = [];
    const logs = [];
    const errors = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => errors.push(args.join(' '));
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: diffResponse },
      ]);

      const mainPromise = main([
        '--browser',
        '--serve',
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]);

      const deadline = Date.now() + 5000;
      let serveLine;
      while (!(serveLine = errors.find((line) => line.includes('Serving diff page at')))) {
        if (Date.now() > deadline) throw new Error('serve URL never appeared on stderr');
        await new Promise((r) => setTimeout(r, 10));
      }
      const url = serveLine.match(/http:\/\/127\.0\.0\.1:\d+\/e2etoken\//)?.[0];
      assert.ok(url, `expected token URL in: ${serveLine}`);

      const page = await fetch(url);
      assert.strictEqual(page.status, 200);
      const body = await page.text();
      assert.ok(body.includes('This is the humanized result.'));
      assert.ok(body.includes('Pattern: 1. Generic polish'));

      await mainPromise;

      assert.deepStrictEqual(spawns, [], 'serve mode must not spawn a window opener');
      assert.ok(errors.some((line) => line.includes('Browser diff page saved at /tmp/patina-browser-diff-serve/browser-diff-999.html')));
      assert.ok(errors.some((line) => line.includes('Stops after 10 idle minutes')));
      assert.ok(logs.join('\n').includes('This is the humanized result.'));
      assert.strictEqual(mock.callCount, 2);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      resetBrowserDiffRuntimeForTests();
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('rewrites a fetched page in place with --preview', async () => {
    const pageHtml = [
      '<html><head><title>page</title></head><body>',
      '<script>window.__DATA__ = {"p": "<p>serialized markup that must never be rewritten</p>"}</script>',
      '<nav><li><a href="/about">a navigation item with nested markup stays untouched</a></li></nav>',
      '<p>The first paragraph is long enough to be rewritten by the preview flow.</p>',
      '<p>The second paragraph also clears the minimum length threshold easily.</p>',
      '</body></html>',
    ].join('\n');
    const pageServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml);
    });
    await new Promise((resolveListen) => pageServer.listen(0, '127.0.0.1', resolveListen));
    const pageUrl = `http://127.0.0.1:${pageServer.address().port}/article`;

    const rewriteResponse = [
      '[BODY]',
      'First paragraph rewritten by the mock backend for the preview test.',
      '',
      'Second paragraph rewritten as well, still two paragraphs total.',
      '[/BODY]',
    ].join('\n');

    const writes = [];
    const spawns = [];
    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: (prefix) => {
        assert.match(prefix, /patina-preview-/);
        return '/tmp/patina-preview-77';
      },
      writeFile: (path, data) => {
        writes.push({ path, data });
      },
      chmod: () => {},
      now: () => 77,
      platform: 'linux',
      spawn: makeFakeSpawn(({ command, args, child }) => {
        spawns.push({ command, args });
        process.nextTick(() => child.emit('close', 0));
      }),
    });

    mock.callCount = 0;
    mock.requestBodies = [];
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: 'Pattern: 1. Generic polish\nRemoved: `old`\nAdded: `new`\nWhy: reason' },
      ]);

      const previewRun = await captureConsole(() => main([
        '--preview',
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        pageUrl,
      ]));

      assert.strictEqual(mock.callCount, 2);
      assert.ok(previewRun.logs.join('\n').includes('First paragraph rewritten by the mock backend'));
      assert.ok(previewRun.errors.some((line) => line.includes('Preview page saved at /tmp/patina-preview-77/browser-diff-77.html (2 of 2 blocks rewritten)')));
      assert.deepStrictEqual(spawns, [{ command: 'xdg-open', args: ['/tmp/patina-preview-77/browser-diff-77.html'] }]);

      const page = writes[0].data;
      assert.ok(page.includes('<span class="ptna-after">First paragraph rewritten by the mock backend for the preview test.</span>'));
      assert.ok(page.includes('<span class="ptna-before">The first paragraph is long enough to be rewritten by the preview flow.</span>'));
      assert.ok(page.includes(`<base href="${pageUrl}">`));
      assert.ok(page.includes('2 of 2 blocks rewritten'));
      assert.ok(page.includes('id="ptna-v-both"'));
      assert.ok(page.includes('<details class="ptna-notes">'));
      assert.ok(page.includes('Pattern: 1. Generic polish'));
      assert.ok(page.includes('a navigation item with nested markup stays untouched'));
      assert.ok(!page.includes('<script'));
      assert.ok(!page.includes('serialized markup'));
    } finally {
      resetBrowserDiffRuntimeForTests();
      await new Promise((resolveClose) => pageServer.close(resolveClose));
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('renders a local file as an in-place preview document with --preview', async () => {
    const testFile = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const rewriteResponse = '[BODY]\nThis is the humanized result.\n[/BODY]';
    const diffResponse = '**Pattern: 1. Generic polish**\nRemoved: `old`\nAdded: `new`\nWhy: reason';

    const writes = [];
    const spawns = [];
    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: (prefix) => {
        assert.match(prefix, /patina-preview-/);
        return '/tmp/patina-preview-88';
      },
      writeFile: (path, data) => {
        writes.push({ path, data });
      },
      chmod: () => {},
      now: () => 88,
      platform: 'linux',
      spawn: makeFakeSpawn(({ command, args, child }) => {
        spawns.push({ command, args });
        process.nextTick(() => child.emit('close', 0));
      }),
    });

    mock.callCount = 0;
    mock.requestBodies = [];
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: diffResponse },
      ]);

      const previewRun = await captureConsole(() => main([
        '--preview',
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        testFile,
      ]));

      assert.strictEqual(mock.callCount, 2);
      assert.ok(previewRun.logs.join('\n').includes('This is the humanized result.'));
      assert.ok(previewRun.errors.some((line) => line.includes('Preview page saved at /tmp/patina-preview-88/browser-diff-88.html (1 of 1 blocks rewritten)')));
      assert.deepStrictEqual(spawns, [{ command: 'xdg-open', args: ['/tmp/patina-preview-88/browser-diff-88.html'] }]);

      const page = writes[0].data;
      assert.ok(page.includes('Content-Security-Policy'));
      assert.ok(page.includes(`Source: ${testFile}`));
      assert.ok(page.includes('<span class="ptna-after">This is the humanized result.</span>'));
      assert.ok(page.includes('<span class="ptna-before">Coffee has emerged as a pivotal cultural phenomenon'));
      assert.ok(page.includes('id="ptna-v-both"'));
      assert.ok(page.includes('<details class="ptna-notes">'));
      assert.ok(page.includes('<strong>Pattern: 1. Generic polish</strong>'));
    } finally {
      resetBrowserDiffRuntimeForTests();
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('previews a local .html file through the snapshot pipeline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'patina-html-preview-'));
    const htmlPath = join(dir, 'page.html');
    writeFileSync(htmlPath, [
      '<html><head><title>local</title></head><body>',
      '<div class="hero">',
      '<p>The first paragraph is long enough to be rewritten by the preview flow.</p>',
      '</div>',
      '</body></html>',
    ].join('\n'));

    const rewriteResponse = '[BODY]\nFirst paragraph rewritten by the mock backend for the preview test.\n[/BODY]';
    const writes = [];
    setBrowserDiffRuntimeForTests({
      tmpdir: () => '/tmp',
      mkdtemp: () => '/tmp/patina-preview-99',
      writeFile: (path, data) => {
        writes.push({ path, data });
      },
      chmod: () => {},
      now: () => 99,
      platform: 'linux',
      spawn: makeFakeSpawn(({ child }) => {
        process.nextTick(() => child.emit('close', 0));
      }),
    });

    mock.callCount = 0;
    try {
      await mock.stop();
      mock = await startMockServer([
        { responseText: rewriteResponse },
        { responseText: 'Pattern: 1. Generic polish\nRemoved: old\nAdded: new\nWhy: reason' },
      ]);

      const previewRun = await captureConsole(() => main([
        '--preview',
        '--lang', 'en',
        '--api-key-file', mockApiKeyPath,
        '--base-url', `http://127.0.0.1:${mock.port}`,
        htmlPath,
      ]));

      assert.strictEqual(mock.callCount, 2);
      assert.ok(previewRun.errors.some((line) => line.includes('(1 of 1 blocks rewritten)')));
      const page = writes[0].data;
      // Snapshot pipeline, not the reading-document shell: host markup kept.
      assert.ok(page.includes('<div class="hero">'));
      assert.ok(!page.includes('ptna-doc'));
      assert.ok(page.includes('<span class="ptna-after">First paragraph rewritten by the mock backend for the preview test.</span>'));
      assert.ok(page.includes(`<base href="${pathToFileURL(htmlPath).href}">`));
    } finally {
      resetBrowserDiffRuntimeForTests();
      rmSync(dir, { recursive: true, force: true });
      await mock.stop();
      mock = await startMockServer('This is the humanized result.');
    }
  });

  it('rejects unsupported --browser inputs before any backend call', async () => {
    const first = resolve(REPO_ROOT, 'tests/e2e/test-input-en.txt');
    const second = first;
    const cases = [
      { args: ['--browser'], pattern: /requires exactly one local file/ },
      { args: ['--browser', first, second], pattern: /requires exactly one local file/ },
      { args: ['--browser', '--batch', first], pattern: /does not support --batch/ },
      { args: ['--browser', '--diff', first], pattern: /only works in rewrite mode/ },
      { args: ['--browser', 'https://example.test'], pattern: /does not support URL input/ },
      { args: ['--serve', first], pattern: /--serve requires --browser or --preview/ },
      { args: ['--preview'], pattern: /--preview requires exactly one input/ },
      { args: ['--preview', first, second], pattern: /--preview requires exactly one input/ },
      { args: ['--preview', 'draft.pdf'], pattern: /--preview supports http\(s\) URLs, \.html, \.md, and \.txt input/ },
      { args: ['--preview', '--batch', 'https://example.test'], pattern: /does not support --batch/ },
      { args: ['--preview', '--browser', 'https://example.test'], pattern: /cannot be combined/ },
    ];

    for (const testCase of cases) {
      mock.callCount = 0;
      mock.requestBodies = [];
      await assert.rejects(() => main(testCase.args), testCase.pattern);
      assert.strictEqual(mock.callCount, 0, testCase.args.join(' '));
      assert.strictEqual(mock.requestBodies.length, 0, testCase.args.join(' '));
    }
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
    assert.ok(help.includes('--exit-on <n>'), 'help should document score gate');
    assert.ok(help.includes('--format <fmt>'), 'help should document output format');
    assert.ok(help.includes('--quiet'), 'help should document quiet logs');
    assert.ok(!help.includes('--json-logs'), 'help should not document removed structured stderr logs');
    assert.ok(!help.includes('--list-providers'), 'help should not document removed provider listing');
    assert.ok(!/\n\s*--json\s+Alias for --format json/.test(help), 'help should not document removed json alias');
    assert.ok(help.includes('--no-color'), 'help should document diff color opt-out');
    assert.ok(help.includes('--browser'), 'help should document browser diff mode');
    assert.ok(
      help.includes('openai-http, codex-cli, claude-cli, gemini-cli, kimi-cli'),
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
    assert.ok(parsed.tone);
    await mock.stop();
    mock = await startMockServer('This is the humanized result.');
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
  });

  it('should keep --format text to the rewritten body without tone metadata', async () => {
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
