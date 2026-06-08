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
  const { beforeHtml, afterHtml } = renderChangedBlocks('same\n\nold', 'same\n\nnew');
  assert.ok(beforeHtml.includes('same'));
  assert.ok(afterHtml.includes('same'));
  assert.ok(!beforeHtml.includes('<mark class="changed-block">same</mark>'));
  assert.ok(beforeHtml.includes('<mark class="changed-block">old</mark>'));
  assert.ok(afterHtml.includes('<mark class="changed-block">new</mark>'));
});

test('renderChangedBlocks falls back to index matching for large inputs', () => {
  const before = Array.from({ length: 220 }, (_, index) => `line-${index}`).join('\n');
  const after = Array.from({ length: 220 }, (_, index) => (index === 219 ? 'line-changed' : `line-${index}`)).join('\n');
  const { beforeHtml, afterHtml } = renderChangedBlocks(before, after);
  assert.ok(!beforeHtml.includes('<mark class="changed-block">line-0</mark>'));
  assert.ok(afterHtml.includes('<mark class="changed-block">line-changed</mark>'));
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
  const successSpawn = (command, args) => {
    seen = { command, args };
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => child.emit('close', 0));
    return child;
  };

  await openBrowserDiffPage('/tmp/demo.html', { platform: 'linux', spawn: successSpawn });
  assert.deepStrictEqual(seen, { command: 'xdg-open', args: ['/tmp/demo.html'] });

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
