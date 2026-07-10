import test from 'node:test';
import assert from 'node:assert/strict';

import { appendUpdateCheck, compareSemver, NPM_LATEST_URL } from '../../src/commands/doctor.js';

const baseReport = () => ({ ok: true, checks: [] });

const registry = (body, { ok = true, status = 200 } = {}) => async (url) => {
  assert.equal(url, NPM_LATEST_URL);
  return { ok, status, json: async () => body };
};

test('newer registry version -> warning check with update instructions', async () => {
  const report = baseReport();
  await appendUpdateCheck(report, { version: '6.3.1', fetchImpl: registry({ version: '6.4.0' }) });
  assert.equal(report.update.updateAvailable, true);
  assert.equal(report.update.latest, '6.4.0');
  const check = report.checks.find((c) => c.name === 'update');
  assert.equal(check.status, 'warning');
  assert.match(check.summary, /6\.3\.1 -> 6\.4\.0/);
  assert.match(check.detail, /npm update -g patina-cli/);
});

test('same or older registry version -> ok, no update flag', async () => {
  for (const latest of ['6.3.1', '6.2.0']) {
    const report = baseReport();
    await appendUpdateCheck(report, { version: '6.3.1', fetchImpl: registry({ version: latest }) });
    assert.equal(report.update.updateAvailable, false);
    assert.equal(report.checks.find((c) => c.name === 'update').status, 'ok');
  }
});

test('registry failure degrades to informational ok, never throws', async () => {
  const cases = [
    registry({}, { ok: false, status: 404 }),
    async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    registry({ version: null }),
  ];
  for (const fetchImpl of cases) {
    const report = baseReport();
    await appendUpdateCheck(report, { version: '6.3.1', fetchImpl });
    const check = report.checks.find((c) => c.name === 'update');
    assert.equal(check.status, 'ok');
    assert.equal(report.update.updateAvailable, false);
    assert.equal(report.ok, true);
  }
});

test('timeout aborts the request and degrades gracefully', async () => {
  const report = baseReport();
  const hang = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await appendUpdateCheck(report, { version: '6.3.1', fetchImpl: hang, timeoutMs: 20 });
  const check = report.checks.find((c) => c.name === 'update');
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /timed out/);
});

test('compareSemver handles ordering and unparseable input', () => {
  assert.equal(compareSemver('6.4.0', '6.3.9'), 1);
  assert.equal(compareSemver('6.3.1', '6.3.1'), 0);
  assert.equal(compareSemver('6.3.1', '10.0.0'), -1);
  assert.equal(compareSemver('2.10.0', '2.9.9'), 1);
  assert.equal(compareSemver('not-a-version', '1.0.0'), null);
  assert.equal(compareSemver('1.0.0', undefined), null);
});
