import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  validateProfileName,
  validateBaseURL,
  isLoopbackHost,
  isPrivateOrSpecialIP,
  shouldAllowInsecureBaseURL,
  applyInsecureBaseURLOptIn,
  shouldAllowPrivateBaseURL,
  applyPrivateBaseURLOptIn,
} from '../../src/security.js';
import { loadProfile } from '../../src/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function withEnv(envOverrides, fn) {
  const original = {};
  for (const k of Object.keys(envOverrides)) {
    original[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

describe('validateProfileName (issue #90)', () => {
  it('accepts known profile names', () => {
    for (const name of ['default', 'blog', 'academic', 'technical', 'tech-writer', 'name_with_underscore']) {
      assert.doesNotThrow(() => validateProfileName(name));
    }
  });

  it('rejects path traversal attempts', () => {
    for (const bad of ['../etc/passwd', '../../README', '..\\windows\\path', '/abs/path', 'sub/dir', 'name with space']) {
      assert.throws(() => validateProfileName(bad), /Invalid profile name/);
    }
  });

  it('rejects empty, null, and non-strings', () => {
    assert.throws(() => validateProfileName(''), /Invalid profile name/);
    assert.throws(() => validateProfileName(null), /Invalid profile name/);
    assert.throws(() => validateProfileName(undefined), /Invalid profile name/);
    assert.throws(() => validateProfileName(123), /Invalid profile name/);
  });

  it('loadProfile refuses traversal even though resolve() would normalize it', () => {
    assert.throws(() => loadProfile(REPO_ROOT, '../../package'), /Invalid profile name/);
    assert.throws(() => loadProfile(REPO_ROOT, '../README'), /Invalid profile name/);
  });

  it('loadProfile still loads real profiles', () => {
    const profile = loadProfile(REPO_ROOT, 'default');
    assert.ok(profile);
    assert.ok(profile.frontmatter || profile.body);
  });
});

describe('validateBaseURL (issue #89)', () => {
  it('accepts https:// for any host', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      assert.doesNotThrow(() => validateBaseURL('https://api.openai.com/v1'));
      assert.doesNotThrow(() => validateBaseURL('https://api.example.com/v1'));
    });
  });

  it('accepts http:// for loopback hosts (test mock servers)', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      assert.doesNotThrow(() => validateBaseURL('http://127.0.0.1:8080/v1'));
      assert.doesNotThrow(() => validateBaseURL('http://localhost:3000'));
      assert.doesNotThrow(() => validateBaseURL('http://[::1]:9000'));
    });
  });

  it('rejects http:// for non-loopback hosts by default', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      assert.throws(() => validateBaseURL('http://example.com'), /plaintext HTTP/);
      assert.throws(() => validateBaseURL('http://10.0.0.5:8080'), /plaintext HTTP/);
    });
  });

  it('allows http:// to non-loopback when allowInsecure is set', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      assert.doesNotThrow(() => validateBaseURL('http://example.com', { allowInsecure: true }));
    });
  });

  it('allows http:// to non-loopback when env override is set', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: '1' }, () => {
      assert.doesNotThrow(() => validateBaseURL('http://example.com'));
    });
  });

  it('rejects unsupported protocols', () => {
    assert.throws(() => validateBaseURL('file:///etc/passwd'), /must use http or https/);
    assert.throws(() => validateBaseURL('ftp://example.com'), /must use http or https/);
  });

  it('rejects malformed URLs', () => {
    assert.throws(() => validateBaseURL('not a url'), /Invalid base URL/);
  });
});

describe('isLoopbackHost', () => {
  it('matches IPv4 loopback', () => {
    assert.strictEqual(isLoopbackHost('127.0.0.1'), true);
    assert.strictEqual(isLoopbackHost('127.5.5.5'), true);
  });
  it('matches localhost and IPv6 loopback', () => {
    assert.strictEqual(isLoopbackHost('localhost'), true);
    assert.strictEqual(isLoopbackHost('::1'), true);
    assert.strictEqual(isLoopbackHost('[::1]'), true);
  });
  it('rejects public hosts', () => {
    assert.strictEqual(isLoopbackHost('example.com'), false);
    assert.strictEqual(isLoopbackHost('10.0.0.1'), false);
    assert.strictEqual(isLoopbackHost(''), false);
  });
});

describe('isPrivateOrSpecialIP (issue #167)', () => {
  it('matches private, reserved, link-local, metadata, and multicast IPs', () => {
    const specialHosts = [
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

    for (const host of specialHosts) {
      assert.strictEqual(isPrivateOrSpecialIP(host), true, host);
    }
  });

  it('does not classify public or documentation IPs as private targets', () => {
    for (const host of ['8.8.8.8', '203.0.113.1', '2001:db8::1']) {
      assert.strictEqual(isPrivateOrSpecialIP(host), false, host);
    }
  });
});

describe('shouldAllowInsecureBaseURL / applyInsecureBaseURLOptIn', () => {
  it('returns false by default', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      assert.strictEqual(shouldAllowInsecureBaseURL(), false);
      assert.strictEqual(shouldAllowInsecureBaseURL({}), false);
    });
  });

  it('honors --allow-insecure-base-url flag', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      assert.strictEqual(shouldAllowInsecureBaseURL({ allowInsecureBaseURL: true }), true);
    });
  });

  it('honors PATINA_ALLOW_INSECURE_BASE_URL env in 1/true/yes', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: '1' }, () => assert.strictEqual(shouldAllowInsecureBaseURL(), true));
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: 'true' }, () => assert.strictEqual(shouldAllowInsecureBaseURL(), true));
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: 'yes' }, () => assert.strictEqual(shouldAllowInsecureBaseURL(), true));
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: 'no' }, () => assert.strictEqual(shouldAllowInsecureBaseURL(), false));
  });

  it('applyInsecureBaseURLOptIn sets the env when flag is passed', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      applyInsecureBaseURLOptIn({ allowInsecureBaseURL: true });
      assert.strictEqual(process.env.PATINA_ALLOW_INSECURE_BASE_URL, '1');
      delete process.env.PATINA_ALLOW_INSECURE_BASE_URL;
    });
  });

  it('applyInsecureBaseURLOptIn does nothing when flag is not passed', () => {
    withEnv({ PATINA_ALLOW_INSECURE_BASE_URL: undefined }, () => {
      applyInsecureBaseURLOptIn({});
      assert.strictEqual(process.env.PATINA_ALLOW_INSECURE_BASE_URL, undefined);
    });
  });
});

describe('private base URL SSRF guard (issue #167)', () => {
  it('rejects private literal IPs unless explicitly opted in', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
      assert.throws(
        () => validateBaseURL('https://10.0.0.1/v1'),
        /private\/reserved IP/
      );
      assert.throws(
        () => validateBaseURL('https://169.254.169.254/latest/meta-data'),
        /private\/reserved IP/
      );
    });
  });

  it('allows private literal IPs with an explicit option or env override', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
      assert.doesNotThrow(() =>
        validateBaseURL('https://10.0.0.1/v1', { allowPrivate: true })
      );
    });

    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: '1' }, () => {
      assert.doesNotThrow(() => validateBaseURL('https://10.0.0.1/v1'));
    });
  });
});

describe('shouldAllowPrivateBaseURL / applyPrivateBaseURLOptIn', () => {
  it('returns false by default', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
      assert.strictEqual(shouldAllowPrivateBaseURL(), false);
      assert.strictEqual(shouldAllowPrivateBaseURL({}), false);
    });
  });

  it('honors --allow-private-base-url flag', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
      assert.strictEqual(
        shouldAllowPrivateBaseURL({ allowPrivateBaseURL: true }),
        true
      );
    });
  });

  it('honors PATINA_ALLOW_PRIVATE_BASE_URL env in 1/true/yes', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: '1' }, () =>
      assert.strictEqual(shouldAllowPrivateBaseURL(), true)
    );
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'true' }, () =>
      assert.strictEqual(shouldAllowPrivateBaseURL(), true)
    );
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'yes' }, () =>
      assert.strictEqual(shouldAllowPrivateBaseURL(), true)
    );
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: 'no' }, () =>
      assert.strictEqual(shouldAllowPrivateBaseURL(), false)
    );
  });

  it('applyPrivateBaseURLOptIn sets the env when flag is passed', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
      applyPrivateBaseURLOptIn({ allowPrivateBaseURL: true });
      assert.strictEqual(process.env.PATINA_ALLOW_PRIVATE_BASE_URL, '1');
      delete process.env.PATINA_ALLOW_PRIVATE_BASE_URL;
    });
  });

  it('applyPrivateBaseURLOptIn does nothing when flag is not passed', () => {
    withEnv({ PATINA_ALLOW_PRIVATE_BASE_URL: undefined }, () => {
      applyPrivateBaseURLOptIn({});
      assert.strictEqual(process.env.PATINA_ALLOW_PRIVATE_BASE_URL, undefined);
    });
  });
});
