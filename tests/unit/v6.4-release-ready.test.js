import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectReleaseReadyErrors, runReleaseReady } from '../../scripts/check-v6.4-release-ready.mjs';

const releaseContext = { isRelease: true, version: '6.4.0' };
const readyState = {
  release: 'v6.4',
  state: 'READY_FOR_RELEASE',
  prohibitions: { tag: false, publish: false },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

test('release-ready guard rejects the checked-in v6.4 hold in a release context', () => {
  const heldState = JSON.parse(readFileSync(new URL('../../docs/operations/v6.4-preflight-hold.json', import.meta.url), 'utf8'));
  assert.deepEqual(collectReleaseReadyErrors(heldState, releaseContext), [
    'v6.4 release state is HOLD_NO_PROMOTION',
    'v6.4 tag is prohibited',
    'v6.4 publish is prohibited',
  ]);
});

test('release-ready guard rejects either explicit v6.4 tag or publish prohibition', () => {
  for (const action of ['tag', 'publish']) {
    const state = clone(readyState);
    state.prohibitions[action] = true;
    assert.deepEqual(collectReleaseReadyErrors(state, releaseContext), [`v6.4 ${action} is prohibited`]);
  }
});

test('release-ready guard fails closed for missing and malformed v6.4 state', () => {
  assert.deepEqual(collectReleaseReadyErrors(undefined, releaseContext), ['v6.4 release state is missing or malformed']);
  assert.deepEqual(collectReleaseReadyErrors({ release: 'v6.4', state: 'READY_FOR_RELEASE' }, releaseContext), ['v6.4 release state has invalid prohibitions']);
  assert.deepEqual(runReleaseReady({ state: { release: 'v6.4', state: 1, prohibitions: { tag: false, publish: false } }, context: releaseContext }), {
    ok: false,
    errors: ['v6.4 release state has an invalid state'],
  });
});

test('release-ready guard leaves non-release validation and current-version releases usable', () => {
  assert.deepEqual(collectReleaseReadyErrors(undefined, { version: '6.4.0' }), []);
  assert.deepEqual(collectReleaseReadyErrors(undefined, { isRelease: true, version: '6.3.1' }), []);
  assert.deepEqual(collectReleaseReadyErrors(undefined, { ref: 'refs/tags/v6.3.1' }), []);
});
