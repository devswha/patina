import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createCancellationController } from '../../src/cli.js';

test('createCancellationController aborts on first SIGINT and exits 130 on second', () => {
  const processObj = new EventEmitter();
  const writes = [];
  let exitCode = null;
  processObj.exit = (code) => {
    exitCode = code;
    throw new Error(`exit ${code}`);
  };

  const cancellation = createCancellationController({
    processObj,
    stderr: { write: (text) => writes.push(text) },
  });

  cancellation.install();
  processObj.emit('SIGINT');

  assert.equal(cancellation.signal.aborted, true);
  assert.equal(processObj.exitCode, 130);
  assert.match(writes.join(''), /cancelling…/);

  assert.throws(() => processObj.emit('SIGINT'), /exit 130/);
  assert.equal(exitCode, 130);
  cancellation.cleanup();
});
