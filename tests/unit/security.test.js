import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPrivateBaseURLOptIn,
  isLoopbackHost,
  isPrivateOrSpecialIP,
  isSubresourceFetchAllowed,
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
    // IPv4-mapped IPv6 in the HEX form the URL parser normalizes to — these
    // route to the embedded v4 target, so they must be flagged too.
    '::ffff:a9fe:a9fe', // 169.254.169.254 (cloud metadata)
    '::ffff:7f00:1', // 127.0.0.1 (loopback)
    '::ffff:0a00:0005', // 10.0.0.5
    '64:ff9b::a9fe:a9fe', // NAT64 of metadata
  ];

  for (const host of privateHosts) {
    assert.equal(isPrivateOrSpecialIP(host), true, host);
  }
});

test('isPrivateOrSpecialIP allows public and documentation IP ranges', () => {
  for (const host of ['8.8.8.8', '203.0.113.1', '2001:db8::1', '::ffff:0808:0808']) {
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


test('isLoopbackHost only exempts real IPv4 loopback literals, not 127.* DNS names (#448)', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.5.6.7'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  // A DNS name that merely starts with '127.' must NOT be treated as loopback.
  assert.equal(isLoopbackHost('127.attacker.example'), false);
  assert.equal(isLoopbackHost('127.0.0.1.evil.com'), false);
});

test('validateBaseURL refuses plaintext HTTP to a 127.* DNS name but allows real loopback (#448)', () => {
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined, PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
    assert.throws(
      () => validateBaseURL('http://127.attacker.example/v1'),
      /refusing plaintext HTTP/,
    );
    assert.doesNotThrow(() => validateBaseURL('http://127.0.0.1/v1'));
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

test('isSubresourceFetchAllowed blocks page-derived fetches into private space', async () => {
  const publicIp = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateIp = async () => [{ address: '10.0.0.7', family: 4 }];
  const metadataIp = async () => [{ address: '169.254.169.254', family: 4 }];

  // Public host → allowed.
  assert.equal(await isSubresourceFetchAllowed('https://cdn.test/x.png', { baseUrl: 'https://page.test/', lookupImpl: publicIp }), true);
  // A hostname that resolves into private space, from a different host → blocked.
  assert.equal(await isSubresourceFetchAllowed('http://internal.svc/x', { baseUrl: 'https://page.test/', lookupImpl: privateIp }), false);
  // Same private resource, but the previewed page is itself served from that
  // host (a localhost dev preview loading its own assets) → allowed.
  assert.equal(await isSubresourceFetchAllowed('http://internal.svc/x', { baseUrl: 'http://internal.svc/', lookupImpl: privateIp }), true);
  // A name that resolves to cloud metadata, cross-host → blocked.
  assert.equal(await isSubresourceFetchAllowed('http://meta.evil/latest', { baseUrl: 'https://page.test/', lookupImpl: metadataIp }), false);
  // Literal metadata IP, no DNS needed → blocked.
  assert.equal(await isSubresourceFetchAllowed('http://169.254.169.254/latest', { baseUrl: 'https://page.test/' }), false);
  // IPv4-mapped IPv6 written in dotted form (the URL parser normalizes it to
  // the hex form before the guard sees it) → still blocked.
  assert.equal(await isSubresourceFetchAllowed('http://[::ffff:169.254.169.254]/latest', { baseUrl: 'https://page.test/' }), false);
  assert.equal(await isSubresourceFetchAllowed('http://[::ffff:7f00:1]/', { baseUrl: 'https://page.test/' }), false);
  // Non-http(s) and unresolvable hosts → blocked.
  assert.equal(await isSubresourceFetchAllowed('ftp://cdn.test/x', { baseUrl: 'https://page.test/' }), false);
  assert.equal(await isSubresourceFetchAllowed('https://nope.test/x', { baseUrl: 'https://page.test/', lookupImpl: async () => { throw new Error('ENOTFOUND'); } }), false);
});
