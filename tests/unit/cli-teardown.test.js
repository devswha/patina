import { createServer } from 'node:http';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { callLLM } from '../../src/api.js';
import {
  drainCliHandles,
  isIdleHttpClientSocket,
  runCliProcess,
} from '../../src/cli/teardown.js';

function idleClientSockets(processObj = process) {
  const handles = typeof processObj._getActiveHandles === 'function' ? processObj._getActiveHandles() : [];
  return handles.filter((handle) => isIdleHttpClientSocket(handle));
}

async function withKeepAliveServer(run) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await run({
      port,
      baseURL: `http://127.0.0.1:${port}/v1`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('isIdleHttpClientSocket ignores stdio, servers, and already-destroyed sockets', () => {
  assert.equal(isIdleHttpClientSocket(null), false);
  assert.equal(isIdleHttpClientSocket({ constructor: { name: 'Socket' }, destroyed: true, remotePort: 80 }), false);
  assert.equal(isIdleHttpClientSocket({ constructor: { name: 'Socket' }, server: {}, remotePort: 80 }), false);
  assert.equal(isIdleHttpClientSocket({ constructor: { name: 'Socket' }, fd: 1, remotePort: 80 }), false);
  assert.equal(isIdleHttpClientSocket({ constructor: { name: 'Server' }, remotePort: 80 }), false);
  assert.equal(isIdleHttpClientSocket({ constructor: { name: 'Socket' }, remotePort: 43168 }), true);
});

test('callLLM leave-behind: undici keep-alive sockets are closed by drainCliHandles', async () => {
  await withKeepAliveServer(async ({ baseURL, port }) => {
    await callLLM({ prompt: 'first', apiKey: 'k', baseURL, model: 'm', maxRetries: 0 });
    await callLLM({ prompt: 'second', apiKey: 'k', baseURL, model: 'm', maxRetries: 0 });

    const leftover = idleClientSockets().filter((socket) => socket.remotePort === port);
    assert.ok(
      leftover.length > 0,
      'callLLM fetch must leave a keep-alive client socket; otherwise this no longer reproduces #807',
    );

    const result = await drainCliHandles();
    assert.ok(
      result.closed.some((socket) => socket.remotePort === port),
      'drain must close the leftover fetch keep-alive socket',
    );
    assert.equal(
      idleClientSockets().filter((socket) => socket.remotePort === port).length,
      0,
      'the leftover-handle path must not return after drain',
    );
  });
});

test('drainCliHandles destroys http agents, pauses stdin, and records remaining types', async () => {
  const destroyed = [];
  const stdin = {
    paused: false,
    unrefed: false,
    pause() { this.paused = true; },
    unref() { this.unrefed = true; },
  };
  const processObj = {
    stdin,
    getActiveResourcesInfo: () => ['PipeWrap'],
    _getActiveHandles: () => [],
  };
  const result = await drainCliHandles({
    processObj,
    httpModule: { globalAgent: { destroy() { destroyed.push('http'); } } },
    httpsModule: { globalAgent: { destroy() { destroyed.push('https'); } } },
    wait: async () => {},
  });
  assert.deepEqual(destroyed, ['http', 'https']);
  assert.equal(stdin.paused, true);
  assert.equal(stdin.unrefed, true);
  assert.deepEqual(result.closed, []);
  assert.deepEqual(result.remaining, ['PipeWrap']);
});

test('runCliProcess drains leftover handles before a thrown batch error can force-exit', async () => {
  const order = [];
  const processObj = {
    exitCode: undefined,
    exit(code) { order.push(`exit:${code}`); },
  };
  await runCliProcess(['--batch'], {
    mainFn: async () => {
      order.push('work');
      throw Object.assign(new Error('batch completed with failures'), { exitCode: 4 });
    },
    drain: async () => { order.push('drain'); },
    onError: () => { order.push('error'); },
    processObj,
  });
  assert.deepEqual(order, ['work', 'error', 'drain']);
  assert.equal(processObj.exitCode, 4);
});
