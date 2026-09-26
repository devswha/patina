import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyInsecureBaseURLOptIn,
  applyPrivateBaseURLOptIn,
  isLoopbackHost,
  isPrivateOrSpecialIP,
  shouldAllowInsecureBaseURL,
  shouldAllowPrivateBaseURL,
  validateBaseURL,
  validateDocumentTypeName,
} from '../../src/security.js';
import { loadDocumentType } from '../../src/loader.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

test('validateDocumentTypeName accepts known Document Type names', () => {
  for (const name of ['default', 'blog', 'academic', 'technical', 'tech-writer', 'name_with_underscore']) {
    assert.doesNotThrow(() => validateDocumentTypeName(name));
  }
});

test('validateDocumentTypeName rejects path traversal attempts', () => {
  for (const bad of ['../etc/passwd', '../../README', '..\\windows\\path', '/abs/path', 'sub/dir', 'name with space']) {
    assert.throws(() => validateDocumentTypeName(bad), /Invalid document type name/);
  }
});

test('validateDocumentTypeName rejects empty, null, and non-strings', () => {
  assert.throws(() => validateDocumentTypeName(''), /Invalid document type name/);
  assert.throws(() => validateDocumentTypeName(null), /Invalid document type name/);
  assert.throws(() => validateDocumentTypeName(undefined), /Invalid document type name/);
  assert.throws(() => validateDocumentTypeName(123), /Invalid document type name/);
});

test('loadDocumentType refuses traversal even though resolve() would normalize it', () => {
  assert.throws(() => loadDocumentType(REPO_ROOT, '../../package'), /Invalid document type name/);
  assert.throws(() => loadDocumentType(REPO_ROOT, '../README'), /Invalid document type name/);
});

test('loadDocumentType still loads real Document Types', () => {
  const documentType = loadDocumentType(REPO_ROOT, 'default');
  assert.ok(documentType);
  assert.ok(documentType.frontmatter || documentType.body);
});

test('validateBaseURL accepts https:// for any host', () => {
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
    assert.doesNotThrow(() => validateBaseURL('https://api.openai.com/v1'));
    assert.doesNotThrow(() => validateBaseURL('https://api.example.com/v1'));
  });
});

test('validateBaseURL accepts http:// for loopback hosts (test mock servers)', () => {
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
    assert.doesNotThrow(() => validateBaseURL('http://127.0.0.1:8080/v1'));
    assert.doesNotThrow(() => validateBaseURL('http://localhost:3000'));
    assert.doesNotThrow(() => validateBaseURL('http://[::1]:9000'));
  });
});

test('validateBaseURL rejects http:// for non-loopback hosts by default', () => {
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
    assert.throws(() => validateBaseURL('http://example.com'), /plaintext HTTP/);
    assert.throws(() => validateBaseURL('http://10.0.0.5:8080'), /plaintext HTTP/);
  });
});

test('validateBaseURL allows http:// to non-loopback when the env override is set', () => {
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: '1' }, () => {
    assert.doesNotThrow(() => validateBaseURL('http://example.com'));
  });
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

test('validateBaseURL rejects unsupported protocols and malformed URLs', () => {
  assert.throws(() => validateBaseURL('file:///etc/passwd'), /must use http or https/);
  assert.throws(() => validateBaseURL('ftp://example.com'), /must use http or https/);
  assert.throws(() => validateBaseURL('not a url'), /Invalid base URL/);
});

test('validateBaseURL rejects private literal IPs unless private URL opt-in is set', () => {
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
    assert.throws(
      () => validateBaseURL('https://10.0.0.1/v1'),
      /private\/reserved base URL/
    );
    assert.throws(
      () => validateBaseURL('https://169.254.169.254/latest/meta-data'),
      /private\/reserved base URL/
    );
  });

  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: '1' }, () => {
    assert.doesNotThrow(() => validateBaseURL('https://10.0.0.1/v1'));
  });
});

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

test('isLoopbackHost only exempts real IPv4 loopback literals, not 127.* DNS names (#448)', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.5.6.7'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  // A DNS name that merely starts with '127.' must NOT be treated as loopback.
  assert.equal(isLoopbackHost('127.attacker.example'), false);
  assert.equal(isLoopbackHost('127.0.0.1.evil.com'), false);
  assert.equal(isLoopbackHost('example.com'), false);
  assert.equal(isLoopbackHost('10.0.0.1'), false);
  assert.equal(isLoopbackHost(''), false);
});

test('shouldAllowInsecureBaseURL and applyInsecureBaseURLOptIn honor flag and env opt-in', () => {
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
    assert.equal(shouldAllowInsecureBaseURL(), false);
    applyInsecureBaseURLOptIn({});
    assert.equal(process.env.PATINA_ALLOW_INSECURE_BASE_URL, undefined);
    applyInsecureBaseURLOptIn({ allowInsecureBaseURL: true });
    assert.equal(process.env.PATINA_ALLOW_INSECURE_BASE_URL, '1');
  });

  for (const value of ['1', 'true', 'yes']) {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: value }, () => {
      assert.equal(shouldAllowInsecureBaseURL(), true, value);
    });
  }
  withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: 'no' }, () => {
    assert.equal(shouldAllowInsecureBaseURL(), false);
  });
});

test('shouldAllowPrivateBaseURL and applyPrivateBaseURLOptIn honor flag and env opt-in', () => {
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
    assert.equal(shouldAllowPrivateBaseURL(), false);
    applyPrivateBaseURLOptIn({});
    assert.equal(process.env.PATINA_ALLOW_PRIVATE_BASE_URL, undefined);
    applyPrivateBaseURLOptIn({ allowPrivateBaseURL: true });
    assert.equal(process.env.PATINA_ALLOW_PRIVATE_BASE_URL, '1');
  });

  for (const value of ['1', 'true', 'yes']) {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: value }, () => {
      assert.equal(shouldAllowPrivateBaseURL(), true, value);
    });
  }
  withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'no' }, () => {
    assert.equal(shouldAllowPrivateBaseURL(), false);
  });
});
