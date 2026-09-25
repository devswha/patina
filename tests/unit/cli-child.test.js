import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CliChildError, cliVerification, invokeCli } from '../../src/cli-child.js';

const PROOF = Object.freeze({ verified: true, mps: 100, fidelity: 100, retried: false, reason: 'passed', mpsFloor: 70, fidelityFloor: 70,
  outputHash: 'a'.repeat(64) });

function fakeCli(script) {
  return (command, argv, options) => {
    assert.equal(command, process.execPath);
    assert.match(argv[0], /bin[/\\]patina\.js$/);
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
    return spawn(command, ['--input-type=module', '-e', script], options);
  };
}

const invoke = (spawnImpl, { signal, timeoutMs = 10_000 } = {}) =>
  invokeCli(['--version'], { cwd: process.cwd(), env: process.env, signal, timeoutMs, spawnImpl });

test('cliVerification accepts numeric-claim-changed as a failed verification reason', () => {
  const proof = cliVerification({ ...PROOF, verified: false, reason: 'numeric-claim-changed' });
  assert.equal(proof?.reason, 'numeric-claim-changed');
  assert.equal(proof?.verified, false);
});

test('cliVerification whitelists scalar evidence and drops extra child fields', () => {
  assert.deepEqual(cliVerification({ ...PROOF, raw: 'provider-secret' }), { ...PROOF });
  assert.deepEqual(cliVerification({ ...PROOF, retried: true, reason: 'passed-on-retry' }),
    { ...PROOF, retried: true, reason: 'passed-on-retry' });
});

test('cliVerification rejects missing or malformed verification evidence', () => {
  const proofs = [null, undefined, {}, [],
    ...['mps', 'fidelity', 'mpsFloor', 'fidelityFloor'].flatMap(key => [null, '100', Infinity, -1, 101].map(value => ({ ...PROOF, [key]: value }))),
    { ...PROOF, verified: 'true' }, { ...PROOF, retried: 'false' },
    { ...PROOF, reason: 'provider-secret' }, { ...PROOF, retried: true },
    ...[undefined, null, 100, '', '0'.repeat(63), 'G'.repeat(64), 'A'.repeat(64)]
      .map(outputHash => ({ ...PROOF, outputHash })),
  ];
  for (const proof of proofs) assert.equal(cliVerification(proof), null, JSON.stringify(proof));
});

test('invokeCli returns exit code and UTF-8 stdout, and empty stdout for other nonzero exits', async () => {
  assert.deepEqual(await invoke(fakeCli("process.stdout.write('patina 1.2.3');")), { exitCode: 0, stdout: 'patina 1.2.3' });
  assert.deepEqual(await invoke(fakeCli("process.stdout.write('candidate'); process.exitCode = 4;")), { exitCode: 4, stdout: 'candidate' });
  assert.deepEqual(await invoke(fakeCli("process.stdout.write('provider-secret'); process.exitCode = 1;")), { exitCode: 1, stdout: '' });
});

test('invokeCli rejects invalid UTF-8 stdout while exit 4 still wins over its bytes', async () => {
  const script = exitCode => `process.stdout.write(Buffer.from([0xc3, 0x28])); process.exitCode = ${exitCode};`;
  await assert.rejects(invoke(fakeCli(script(0))), { name: 'CliChildError', code: 'invalid_cli_json' });
  assert.deepEqual(await invoke(fakeCli(script(4))), { exitCode: 4, stdout: '' });
});

test('invokeCli bounds stdout bytes', async () => {
  await assert.rejects(invoke(fakeCli("process.stdout.write('a'.repeat(300000));")),
    error => error instanceof CliChildError && error.code === 'cli_output_limit');
});

test('invokeCli maps spawn failures to cli_start_failed without exposing messages', async () => {
  for (const spawnImpl of [() => { throw new Error('provider-secret'); },
    (_command, _argv, options) => spawn('/definitely-absent-patina-executable', [], options)]) {
    await assert.rejects(invoke(spawnImpl), error => {
      assert.equal(error.code, 'cli_start_failed');
      assert.doesNotMatch(error.message, /provider-secret|definitely-absent/);
      return true;
    });
  }
});

test('invokeCli times out a hung child', async () => {
  await assert.rejects(invoke(fakeCli('setInterval(() => {}, 1000);'), { timeoutMs: 100 }), { code: 'timeout' });
});

test('invokeCli cancellation before spawn and during a real child is bounded and kills the child', async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    if (before) controller.abort(new Error('provider-secret'));
    let pid;
    let closed = Promise.resolve([]);
    const spawnImpl = fakeCli("process.stdout.write('READY'); process.stdin.resume(); setInterval(() => {}, 1000);");
    await assert.rejects(invoke((...args) => {
      assert.equal(before, false, 'must not spawn after an earlier abort');
      const child = spawnImpl(...args);
      pid = child.pid;
      // invokeCli unrefs the killed child, so the close deadline must keep the loop alive.
      const closeController = new AbortController();
      const closeTimer = setTimeout(() => closeController.abort(), 5000);
      closed = once(child, 'close', { signal: closeController.signal }).finally(() => clearTimeout(closeTimer));
      child.stdout.once('data', () => controller.abort(new Error('provider-secret')));
      return child;
    }, { signal: controller.signal }), error => {
      assert.equal(error.code, 'aborted');
      assert.doesNotMatch(error.message, /provider-secret/);
      return true;
    });
    if (pid) {
      await closed;
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  }
});
