import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { PROVIDER_PRESETS } from '../../src/web-rewrite-contract.js';
import {
  escapeHtml,
  providerOptions,
  renderDiffSummary,
  renderMessage,
  renderMetrics,
  renderSignals,
} from '../../playground/chat-ui.js';

test('escapeHtml neutralizes scripts, event attributes, and quotes', () => {
  const escaped = escapeHtml('<script>alert("x")</script><img src=x onerror=\'alert(1)\'>&');

  assert.equal(
    escaped,
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;',
  );
  assert.doesNotMatch(escaped, /<script|<img/i);
  assert.match(escaped, /&quot;x&quot;/);
  assert.match(escaped, /&#39;alert\(1\)&#39;/);
});

test('renderSignals always renders a before/after AI-signal element (AC2), em dash when missing', () => {
  // Real signals: before/after deterministic signal scores shown.
  const withSignals = renderSignals({ before: { signalScore: 41 }, after: { signalScore: 12 } });
  assert.match(withSignals, /rewrite-signals/);
  assert.match(withSignals, /Before/);
  assert.match(withSignals, /After/);
  assert.match(withSignals, /41/);
  assert.match(withSignals, /12/);
  // Missing/empty signals still render the element (never silently dropped).
  const empty = renderSignals({});
  assert.match(empty, /rewrite-signals/);
  assert.match(empty, /\u2014/); // em dash for absent values
  // Tolerates undefined and alternate field names.
  assert.match(renderSignals(undefined), /rewrite-signals/);
  assert.match(renderSignals({ before: { overall: 30 }, after: { overall: 9 } }), /30/);
});

test('renderMessage escapes model and user text instead of injecting HTML', () => {
  const html = renderMessage({ role: 'assistant', text: '<script>alert(1)</script>' });

  assert.match(html, /rewrite-chat__message--assistant/);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderMetrics shows a floor warning when floors fail', () => {
  const lowMps = renderMetrics({ mps: 69, fidelity: 95, floorFailed: false });
  const explicitFailure = renderMetrics({ mps: 90, fidelity: 90, floorFailed: true });
  const passing = renderMetrics({ mps: 90, fidelity: 90, floorFailed: false });

  assert.match(lowMps, /role="alert"/);
  assert.match(lowMps, /floor warning/i);
  assert.match(explicitFailure, /role="alert"/);
  assert.doesNotMatch(passing, /role="alert"/);
});

test('providerOptions lists the allowlisted provider models', () => {
  const options = providerOptions();
  const openai = options.find((option) => option.provider === 'openai');

  assert.ok(openai);
  assert.equal(openai.baseURL, PROVIDER_PRESETS.openai.baseURL);
  assert.deepEqual(openai.models, [...PROVIDER_PRESETS.openai.models]);
  assert.ok(openai.models.includes('gpt-4.1-mini'));
});

test('renderDiffSummary returns HTML for a sample diff', () => {
  const html = renderDiffSummary({ before: 'AI-ish <before>', after: 'Human "after"', summary: 'Sample' });

  assert.equal(typeof html, 'string');
  assert.match(html, /rewrite-diff/);
  assert.match(html, /AI-ish &lt;before&gt;/);
  assert.match(html, /Human &quot;after&quot;/);
});
