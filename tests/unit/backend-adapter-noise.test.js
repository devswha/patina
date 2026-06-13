import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { stripGeminiNoise } from '../../src/backends/gemini-cli.js';
import { stripKimiNoise } from '../../src/backends/kimi-cli.js';

test('stripGeminiNoise strips known leading banners but keeps a "Warning:" response (#446)', () => {
  const noisy = 'Loaded cached credentials\nRipgrep is not available. Falling back to GrepTool.\n\nThe real rewritten text.';
  assert.equal(stripGeminiNoise(noisy), 'The real rewritten text.');
  // A model response that legitimately begins with "Warning:" must NOT be truncated.
  const warning = 'Warning: this approach has a tradeoff.\n\nUse it carefully.';
  assert.equal(stripGeminiNoise(warning), warning);
  // MCP banner is still stripped.
  assert.equal(stripGeminiNoise('MCP issues detected: foo\nBody here.'), 'Body here.');
});

test('stripKimiNoise strips only the trailing resume banner (#446)', () => {
  const trailing = 'Rewritten body line one.\nLine two.\n\nTo resume this session: kimi -r abc123';
  assert.equal(stripKimiNoise(trailing), 'Rewritten body line one.\nLine two.');
  // A banner-shaped line mid-body (with real content as the trailing line) is
  // preserved — the old filter removed it anywhere in the body and lost content.
  const midBanner = 'To resume this session: kimi -r quoted-in-body\nBut the actual answer continues here.';
  assert.equal(stripKimiNoise(midBanner), midBanner);
  // No banner → unchanged aside from leading trim.
  assert.equal(stripKimiNoise('just a response'), 'just a response');
});
