import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPrivateBaseURLOptIn,
  isPrivateOrSpecialIP,
  shouldAllowPrivateBaseURL,
  validateBaseURL,
} from '../../src/security.js';

function withEnv(envOverrides, fn) {
  const original = {};
  for (const key of Object.keys(envOverrides)) {
    original[key] = process.env[key];
    if (envOverrides[key] === undefined) delete process.env[key];
    else process.env[key] = envOverrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test('isPrivateOrSpecialIP flags private, metadata, CGNAT, multicast, and IPv6 special ranges', () => {
  const privateHosts = [
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ];

  for (const host of privateHosts) {
    assert.equal(isPrivateOrSpecialIP(host), true, host);
  }
});

test('isPrivateOrSpecialIP allows public and documentation IP ranges', () => {
  for (const host of ['8.8.8.8', '203.0.113.1', '2001:db8::1']) {
    assert.equal(isPrivateOrSpecialIP(host), false, host);
  }
});

test('validateBaseURL rejects private literal IPs unless private URL opt-in is set', () => {
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
    assert.throws(
      () => validateBaseURL('https://10.0.0.1/v1'),
      /private\/reserved base URL/
    );
    assert.doesNotThrow(() => validateBaseURL('https://10.0.0.1/v1', { allowPrivate: true }));
  });

  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: '1' }, () => {
    assert.doesNotThrow(() => validateBaseURL('https://10.0.0.1/v1'));
  });
});

test('shouldAllowPrivateBaseURL and applyPrivateBaseURLOptIn honor flag and env opt-in', () => {
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
    assert.equal(shouldAllowPrivateBaseURL(), false);
    assert.equal(shouldAllowPrivateBaseURL({ allowPrivateBaseURL: true }), true);
    applyPrivateBaseURLOptIn({ allowPrivateBaseURL: true });
    assert.equal(process.env.PATINA_ALLOW_PRIVATE_BASE_URL, '1');
  });

  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'true' }, () => {
    assert.equal(shouldAllowPrivateBaseURL(), true);
  });
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'yes' }, () => {
    assert.equal(shouldAllowPrivateBaseURL(), true);
  });
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'no' }, () => {
    assert.equal(shouldAllowPrivateBaseURL(), false);
  });
});
