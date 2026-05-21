#!/usr/bin/env node

// Backward-compatible wrapper for the opt-in live quality scaffold.
// This file is intentionally not part of `npm test`; run it manually with:
// OPENCODE_AVAILABLE=1 node tests/e2e/quality-test.js

import { main } from '../quality/live-quality.mjs';

main(process.argv.slice(2).length ? process.argv.slice(2) : ['--language', 'en', '--limit', '1'])
  .catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
