import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/cli.js';
import { PatinaCliError } from '../../src/errors.js';

test('retired pattern list rejects at the CLI seam without fetching', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected fetch'));
  t.mock.method(console, 'log', () => {});
  await assert.rejects(main(['pattern', 'list']), (error) => {
    assert.ok(error instanceof PatinaCliError);
    assert.equal(error.exitCode, 2);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 0);
});

test('licensed Pro pack list still dispatches with its license and JSON contract', async (t) => {
  const output = [];
  t.mock.method(console, 'log', (text) => output.push(JSON.parse(text)));
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://packs.test/api/packs');
    assert.equal(options.headers.authorization, 'Bearer test-license');
    return new Response(JSON.stringify({ packs: [] }));
  });
  await main(['pack', 'list', '--license', 'test-license', '--url', 'https://packs.test/api/packs', '--json']);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(output, [{ packs: [] }]);
});
