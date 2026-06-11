import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

import {
  buildBrowserDiffPromptInput,
  htmlEscape,
  writeBrowserDiffPage,
  openBrowserDiffPage,
  serveBrowserDiffPage,
} from '../../src/browser-diff.js';
import { formatRewriteBodyForBrowser } from '../../src/output.js';

test('buildBrowserDiffPromptInput carries the explicit compare contract', () => {
  const prompt = buildBrowserDiffPromptInput('before text', 'after text');
  assert.match(prompt, /Compare BEFORE to AFTER\./);
  assert.match(prompt, /Do not rewrite either text\./);
  assert.match(prompt, /Report only changes present in AFTER relative to BEFORE\./);
  assert.match(prompt, /## BEFORE\nbefore text/);
  assert.match(prompt, /## AFTER\nafter text/);
});

test('htmlEscape escapes markup-significant characters', () => {
  assert.strictEqual(
    htmlEscape(`<tag attr="x">'&`),
    '&lt;tag attr=&quot;x&quot;&gt;&#39;&amp;',
  );
});

test('formatRewriteBodyForBrowser strips self-audit blocks and tone footer', () => {
  const raw = [
    '[BODY]',
    'Human result.',
    '[/BODY]',
    '',
    '[SELF_AUDIT]',
    '- note',
    '[/SELF_AUDIT]',
    '',
    '---',
    'tone: null',
    'tone_source: profile_only',
    'tone_evidence: []',
    'tone_confidence: null',
    '---',
  ].join('\n');
  assert.strictEqual(formatRewriteBodyForBrowser(raw), 'Human result.');
});

test('writeBrowserDiffPage uses a patina-scoped temp dir and restrictive permissions', () => {
  const writes = [];
  const chmods = [];
  const path = writeBrowserDiffPage('<html/>', {
    tmpdir: () => '/tmp',
    mkdtemp: (prefix) => {
      assert.match(prefix, /patina-browser-diff-/);
      return '/tmp/patina-browser-diff-abc';
    },
    writeFile: (filePath, content, encoding) => {
      writes.push({ filePath, content, encoding });
    },
    chmod: (filePath, mode) => {
      chmods.push({ filePath, mode });
    },
    now: () => 42,
  });

  assert.strictEqual(path, '/tmp/patina-browser-diff-abc/browser-diff-42.html');
  assert.deepStrictEqual(writes, [{ filePath: '/tmp/patina-browser-diff-abc/browser-diff-42.html', content: '<html/>', encoding: 'utf8' }]);
  assert.deepStrictEqual(chmods, [
    { filePath: '/tmp/patina-browser-diff-abc', mode: 0o700 },
    { filePath: '/tmp/patina-browser-diff-abc/browser-diff-42.html', mode: 0o600 },
  ]);
});

test('writeBrowserDiffPage fails loudly when chmod hardening fails on a POSIX-like platform', () => {
  assert.throws(
    () =>
      writeBrowserDiffPage('<html/>', {
        tmpdir: () => '/tmp',
        mkdtemp: () => '/tmp/patina-browser-diff-fail',
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

test('openBrowserDiffPage selects the platform opener and propagates close failures', async () => {
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

  await openBrowserDiffPage('/tmp/demo.html', { platform: 'linux', spawn: successSpawn });
  assert.deepStrictEqual(seen, { command: 'xdg-open', args: ['/tmp/demo.html'] });
  assert.strictEqual(unrefCalled, false);

  await assert.rejects(
    () => openBrowserDiffPage('/tmp/demo.html', {
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

test('serveBrowserDiffPage serves only the token URL on loopback with hardened headers', async () => {
  const html = '<html><body>diff page</body></html>';
  const { url, close, done } = await serveBrowserDiffPage(html, {
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

test('serveBrowserDiffPage stops on its own after the idle timeout', async () => {
  const { url, done } = await serveBrowserDiffPage('idle page', {
    randomToken: () => 'tok',
    idleTimeoutMs: 40,
  });
  await done;
  await assert.rejects(() => fetch(url));
});

test('serveBrowserDiffPage with an already-aborted signal resolves and closes immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  const { url, done } = await serveBrowserDiffPage('pre-aborted', {
    randomToken: () => 'tok',
    idleTimeoutMs: 60_000,
    signal: controller.signal,
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/tok\/$/);
  await done;
  await assert.rejects(() => fetch(url));
});

test('serveBrowserDiffPage closes when the abort signal fires', async () => {
  const controller = new AbortController();
  const { url, done } = await serveBrowserDiffPage('abort page', {
    randomToken: () => 'tok',
    idleTimeoutMs: 60_000,
    signal: controller.signal,
  });
  controller.abort();
  await done;
  await assert.rejects(() => fetch(url));
});
