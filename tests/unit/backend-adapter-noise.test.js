import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { stripGeminiNoise } from '../../src/backends/gemini-cli.js';

test('stripGeminiNoise strips known leading banners but keeps a "Warning:" response (#446)', () => {
  const noisy = 'Loaded cached credentials\nRipgrep is not available. Falling back to GrepTool.\n\nThe real rewritten text.';
  assert.equal(stripGeminiNoise(noisy), 'The real rewritten text.');
  // A model response that legitimately begins with "Warning:" must NOT be truncated.
  const warning = 'Warning: this approach has a tradeoff.\n\nUse it carefully.';
  assert.equal(stripGeminiNoise(warning), warning);
  // MCP banner is still stripped.
  assert.equal(stripGeminiNoise('MCP issues detected: foo\nBody here.'), 'Body here.');
});
