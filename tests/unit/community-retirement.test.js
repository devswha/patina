import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/cli.js';
import { PatinaCliError } from '../../src/errors.js';

test('retired pattern commands reject at the CLI seam without fetching or output', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected fetch'));
  const log = t.mock.method(console, 'log', () => {});
  const invocations = [
    ['pattern'], ['pattern', 'help'], ['pattern', '--help'],
    ['pattern', 'list'], ['pattern', 'list', '--json'],
    ['pattern', 'install', 'en-corporate-bizspeak'],
    ['pattern', 'install', 'https://github.com/example/packs/tree/main/packs/en-corporate-bizspeak', '--json'],
    ['pattern', 'remove', 'en-corporate-bizspeak'],
    ['pattern', 'remove', 'en-corporate-bizspeak', '--json'],
    ['pattern', 'install', '--help'], ['pattern', 'list', '--help'], ['pattern', 'remove', '--help'],
  ];
  for (const args of invocations) {
    await assert.rejects(main(args), (error) => {
      assert.ok(error instanceof PatinaCliError, args.join(' '));
      assert.equal(error.exitCode, 2, args.join(' '));
      return true;
    });
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 0);
});

test('removed aside command rejects as a usage error without output', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  for (const args of [['aside'], ['aside', '--help'], ['aside', 'options', '--workspace', '.'], ['aside', 'skill'],
    ['aside', 'rewrite', '--input', 'draft.md', '--output', 'verified.md']]) {
    await assert.rejects(main(args), (error) => {
      assert.ok(error instanceof PatinaCliError, args.join(' '));
      assert.equal(error.exitCode, 2, args.join(' '));
      assert.equal(error.what, 'patina aside was removed');
      return true;
    });
  }
  assert.equal(log.mock.callCount(), 0);
});

test('removed pack command rejects as a usage error without fetching or output', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected fetch'));
  const log = t.mock.method(console, 'log', () => {});
  for (const args of [['pack'], ['pack', '--help'], ['pack', 'list'], ['pack', 'list', '--json'],
    ['pack', 'install', 'ko-structure'], ['pack', 'install', '--all']]) {
    await assert.rejects(main(args), (error) => {
      assert.ok(error instanceof PatinaCliError, args.join(' '));
      assert.equal(error.exitCode, 2, args.join(' '));
      assert.equal(error.what, 'patina pack was removed');
      return true;
    });
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 0);
});
