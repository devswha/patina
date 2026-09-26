import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { join, resolve as resolvePath } from 'node:path';
import {
  buildExplanationPromptInput,
  writePreviewPage,
  openPreviewPage,
  servePreviewPage,
} from '../../src/preview/page.js';
import { htmlEscape } from '../../src/preview/dom.js';

test('buildExplanationPromptInput carries BEFORE then AFTER sections', () => {
  const prompt = buildExplanationPromptInput('before text', 'after text');
  assert.match(prompt, /## BEFORE\nbefore text\n\n## AFTER\nafter text$/);
});

test('htmlEscape escapes markup-significant characters', () => {
  assert.strictEqual(
    htmlEscape(`<tag attr="x">'&`),
    '&lt;tag attr=&quot;x&quot;&gt;&#39;&amp;',
  );
});

test('writePreviewPage uses a patina-scoped temp dir and restrictive permissions', () => {
  const writes = [];
  const chmods = [];
  const path = writePreviewPage('<html/>', {
    tmpdir: () => '/tmp',
    mkdtemp: (prefix) => {
      assert.match(prefix, /patina-preview-/);
      return '/tmp/patina-preview-abc';
    },
    writeFile: (filePath, content, encoding) => {
      writes.push({ filePath, content, encoding });
    },
    chmod: (filePath, mode) => {
      chmods.push({ filePath, mode });
    },
    now: () => 42,
  });

  // The dir chmod receives the mkdtemp return value verbatim; only the file
  // path goes through join().
  const expectedDir = '/tmp/patina-preview-abc';
  const expectedFile = join(expectedDir, 'preview-42.html');
  assert.strictEqual(path, expectedFile);
  assert.deepStrictEqual(writes, [{ filePath: expectedFile, content: '<html/>', encoding: 'utf8' }]);
  assert.deepStrictEqual(chmods, [
    { filePath: expectedDir, mode: 0o700 },
    { filePath: expectedFile, mode: 0o600 },
  ]);
});

test('writePreviewPage fails loudly when chmod hardening fails on a POSIX-like platform', () => {
  assert.throws(
    () =>
      writePreviewPage('<html/>', {
        tmpdir: () => '/tmp',
        mkdtemp: () => '/tmp/patina-preview-fail',
        writeFile: () => {},
        chmod: () => {
          throw new Error('chmod failed');
        },
        now: () => 7,
        platform: 'linux',
      }),
    /chmod failed/,
  );
});

test('openPreviewPage selects the platform opener and propagates close failures', async () => {
  let seen = null;
  let unrefCalled = false;
  const successSpawn = (command, args) => {
    seen = { command, args };
    const child = new EventEmitter();
    child.unref = () => {
      unrefCalled = true;
    };
    process.nextTick(() => child.emit('close', 0));
    return child;
  };

  await openPreviewPage('/tmp/demo.html', { platform: 'linux', spawn: successSpawn });
  assert.deepStrictEqual(seen, { command: 'xdg-open', args: [resolvePath('/tmp/demo.html')] });
  assert.strictEqual(unrefCalled, false);

  await assert.rejects(
    () => openPreviewPage('/tmp/demo.html', {
      platform: 'darwin',
      spawn: () => {
        const child = new EventEmitter();
        child.unref = () => {};
        process.nextTick(() => child.emit('close', 1));
        return child;
      },
    }),
    /browser opener exited with code 1/,
  );
});

test('servePreviewPage serves only the token URL on loopback with hardened headers', async () => {
  const html = '<html><body>diff page</body></html>';
  const { url, close, done } = await servePreviewPage(html, {
    randomToken: () => 'tok123',
    idleTimeoutMs: 60_000,
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/tok123\/$/);

  const ok = await fetch(url);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.strictEqual(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(ok.headers.get('referrer-policy'), 'no-referrer');
  assert.strictEqual(ok.headers.get('cache-control'), 'no-store');
  assert.strictEqual(await ok.text(), html);

  const head = await fetch(url, { method: 'HEAD' });
  assert.strictEqual(head.status, 200);

  const wrongToken = await fetch(url.replace('tok123', 'other'));
  assert.strictEqual(wrongToken.status, 404);

  const wrongMethod = await fetch(url, { method: 'POST' });
  assert.strictEqual(wrongMethod.status, 404);

  close();
  await done;
});

test('servePreviewPage stops on its own after the idle timeout', async () => {
  const { url, done } = await servePreviewPage('idle page', {
    randomToken: () => 'tok',
    idleTimeoutMs: 40,
  });
  await done;
  await assert.rejects(() => fetch(url));
});

test('servePreviewPage with an already-aborted signal resolves and closes immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  const { url, done } = await servePreviewPage('pre-aborted', {
    randomToken: () => 'tok',
    idleTimeoutMs: 60_000,
    signal: controller.signal,
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/tok\/$/);
  await done;
  await assert.rejects(() => fetch(url));
});

test('servePreviewPage closes when the abort signal fires', async () => {
  const controller = new AbortController();
  const { url, done } = await servePreviewPage('abort page', {
    randomToken: () => 'tok',
    idleTimeoutMs: 60_000,
    signal: controller.signal,
  });
  controller.abort();
  await done;
  await assert.rejects(() => fetch(url));
});

test('servePreviewPage surfaces post-listen socket errors to the logger and shuts down (G9)', async () => {
  let serverCloseCalls = 0;
  class FakeServer extends EventEmitter {
    listen(_port, _host, cb) {
      // Mimic the async "listening" callback the real http.Server emits.
      process.nextTick(cb);
      return this;
    }

    address() {
      return { port: 4321 };
    }

    close(cb) {
      serverCloseCalls += 1;
      if (cb) cb();
      return this;
    }
  }

  const fake = new FakeServer();
  const warnings = [];
  const logger = { warn: (event, fields) => warnings.push({ event, fields }) };

  const { url, done } = await servePreviewPage('<html/>', {
    createServer: () => fake,
    randomToken: () => 'tok',
    idleTimeoutMs: 60_000,
    logger,
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:4321\/tok\/$/);

  // After listening, the startup reject handler is gone and the post-listen
  // handler turns a runtime socket error into a logged warning + shutdown,
  // instead of swallowing it against the already-resolved outer promise.
  fake.emit('error', new Error('boom'));
  await done;

  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].event, 'serve.socket_error');
  assert.match(warnings[0].fields.message, /local preview server error: boom/);
  assert.ok(serverCloseCalls >= 1, 'a socket error should shut the server down');
});
