#!/usr/bin/env node

import { main } from '../src/cli.js';
import { renderCliError, getExitCode } from '../src/errors.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(renderCliError(err));
  process.exit(getExitCode(err));
});
