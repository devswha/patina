import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

import {
  buildBrowserDiffPromptInput,
  htmlEscape,
  renderChangedBlocks,
  buildScoreSummary,
  renderBrowserDiffHtml,
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

test('renderChangedBlocks preserves shared blocks and highlights changed ones', () => {
  const { beforeHtml, afterHtml, beforeChangeCount, afterChangeCount } = renderChangedBlocks('same\n\nold', 'same\n\nnew');
  assert.ok(beforeHtml.includes('<span class="ctx">same'));
  assert.ok(afterHtml.includes('<span class="ctx">same'));
  assert.ok(beforeHtml.includes('<mark class="changed-block" id="before-change-1" data-n="1">old</mark>'));
  assert.ok(afterHtml.includes('<mark class="changed-block" id="after-change-1" data-n="1">new</mark>'));
  assert.strictEqual(beforeChangeCount, 1);
  assert.strictEqual(afterChangeCount, 1);
});

test('renderChangedBlocks groups consecutive changed blocks into one numbered hunk', () => {
  const { afterHtml, afterChangeCount } = renderChangedBlocks(
    'same\n\nold-a\n\nold-b\n\nmiddle\n\nold-c',
    'same\n\nnew-a\n\nnew-b\n\nmiddle\n\nnew-c',
  );
  assert.ok(afterHtml.includes('<mark class="changed-block" id="after-change-1" data-n="1">new-a\n\nnew-b</mark>'));
  assert.ok(afterHtml.includes('<mark class="changed-block" id="after-change-2" data-n="2">new-c</mark>'));
  assert.strictEqual(afterChangeCount, 2);
});

test('renderChangedBlocks falls back to index matching for large inputs', () => {
  const before = Array.from({ length: 220 }, (_, index) => `line-${index}`).join('\n');
  const after = Array.from({ length: 220 }, (_, index) => (index === 219 ? 'line-changed' : `line-${index}`)).join('\n');
  const { beforeHtml, afterHtml } = renderChangedBlocks(before, after);
  assert.ok(!beforeHtml.includes('data-n="1">line-0'));
  assert.ok(afterHtml.includes('<mark class="changed-block" id="after-change-1" data-n="1">line-changed</mark>'));
});

test('buildScoreSummary keeps skipped and error rows', () => {
  const summary = buildScoreSummary(
    { overall: 12, interpretation: 'mostly human', paragraphCount: 2, hotParagraphs: 0, signalScore: 8 },
    { overall: null, skipped: true, skipReason: 'language-disabled', error: 'disabled' },
  );
  assert.deepStrictEqual(summary.before[0], { label: 'Overall', value: '12' });
  assert.ok(summary.after.some((row) => row.label === 'Skipped' && row.value === 'true'));
  assert.ok(summary.after.some((row) => row.label === 'Skip reason' && row.value === 'language-disabled'));
  assert.ok(summary.after.some((row) => row.label === 'Error' && row.value === 'disabled'));
});

test('renderBrowserDiffHtml escapes untrusted content and keeps the page self-contained', () => {
  const html = renderBrowserDiffHtml({
    original: '<script>alert(1)</script>',
    rewrittenBody: '<img src=x onerror="alert(2)">',
    diffExplanation: 'Pattern: <b>Unsafe</b>',
    diffError: 'boom <script>',
    beforeScore: { overall: 30, interpretation: 'mixed', paragraphCount: 1, hotParagraphs: 1, signalScore: 20 },
    afterScore: { overall: 10, interpretation: 'mostly human', paragraphCount: 1, hotParagraphs: 0, signalScore: 5 },
    sourcePath: '/tmp/draft.md',
  });

  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;'));
  assert.ok(html.includes('Pattern: &lt;b&gt;Unsafe&lt;/b&gt;'));
  assert.ok(html.includes('Pattern explanation unavailable: boom &lt;script&gt;'));
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
});

test('renderBrowserDiffHtml exposes change navigation and the changes-only toggle', () => {
  const html = renderBrowserDiffHtml({
    original: 'same\n\nold-a\n\nmiddle\n\nold-b',
    rewrittenBody: 'same\n\nnew-a\n\nmiddle\n\nnew-b',
    diffExplanation: '**Pattern: 1. Test**\nRemoved: `old`\nAdded: `new`\n\n---\n\n**Pattern: 2. Other**\nWhy: because',
    diffError: null,
    beforeScore: { overall: 40, interpretation: 'mixed', paragraphCount: 4, hotParagraphs: 1, signalScore: 25 },
    afterScore: { overall: null, skipped: true, skipReason: 'paragraphs<=2' },
    sourcePath: '/tmp/draft.md',
  });

  assert.ok(html.includes('2 changes'));
  assert.ok(html.includes('<input type="checkbox" id="changes-only"'));
  assert.ok(html.includes('href="#after-change-1"'));
  assert.ok(html.includes('href="#after-change-2"'));
  assert.ok(html.includes('<strong>Pattern: 1. Test</strong>'));
  assert.ok(html.includes('<code>old</code>'));
  assert.strictEqual((html.match(/<article class="explain-card">/g) || []).length, 2);
  assert.ok(html.includes('Not scored'));
  assert.ok(html.includes('Deterministic scoring needs more than two paragraphs.'));
  assert.ok(html.includes('40<span class="score-scale">/100</span>'));
});

test('renderBrowserDiffHtml omits the toggle and jump nav when nothing changed', () => {
  const html = renderBrowserDiffHtml({
    original: 'same\n\ntext',
    rewrittenBody: 'same\n\ntext',
    diffExplanation: '',
    diffError: null,
    beforeScore: null,
    afterScore: null,
    sourcePath: '/tmp/draft.md',
  });

  assert.ok(html.includes('No changes'));
  assert.ok(!html.includes('id="changes-only"'));
  assert.ok(!html.includes('href="#after-change-1"'));
  assert.ok(html.includes('No pattern explanation available.'));
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
