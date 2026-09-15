#!/usr/bin/env node

import { main } from '../src/cli.js';
import { renderCliError } from '../src/errors.js';
import { runCliProcess } from '../src/cli/teardown.js';

await runCliProcess(process.argv.slice(2), {
  mainFn: main,
  onError: (err) => console.error(renderCliError(err)),
});
