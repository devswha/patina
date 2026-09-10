'use strict';

// Preloaded with `node --require` before any test module. macOS exposes the
// temp root through symlinks (/var and /tmp point at /private/...): os.tmpdir()
// keeps the literal spelling while process.cwd(), fs.realpathSync and npm
// canonicalize to the real path. Temp roots created under the literal spelling
// then compare unequal to the same locations reached through the symlink, and
// npm writes lockfiles relativized against the real spelling. Point TMPDIR at
// its realpath so every temp root a test creates is already canonical; child
// processes (including npm) inherit the normalized value through the
// environment. No-op on platforms whose temp root is not symlinked.
//
// Tradeoff by design: the suite runs under a canonical TMPDIR, so it cannot
// detect a product-level literal-vs-real temp-path mismatch on macOS. Such a
// defect would need its own product fix (like the src/config.js realpath
// dedupe this helper was added alongside), not a harness change.
const { realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');

try {
  const literal = tmpdir();
  const real = realpathSync(literal);
  if (real && real !== literal) process.env.TMPDIR = real;
} catch {
  // Keep the platform default; a broken temp root fails loudly in the tests
  // that need it.
}
