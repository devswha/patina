import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createPackHandler, isValidPackEntry, PACKS_REASONS } from '../../src/pack-handler.js';
import { createMemoryKv } from '../../src/rate-limit.js';
import { QUOTA_REASONS } from '../../src/web-rewrite-contract.js';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const FIXED_NOW = 1_700_000_000_000;

const PACK_BODY = '---\nversion: 1.0.0\n---\n\n# pro pack body\n';
const MANIFEST = {
  packs: [
    { id: 'ko-structure', path: 'patterns/ko-structure.md', version: '1.0.0', lang: 'ko', kind: 'pattern', description: 'structural tells', sha256: sha256(PACK_BODY) },
  ],
};

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
  return res;
}

function mockReq({ method = 'GET', url = '/api/packs', license = 'good-key' } = {}) {
  return { method, url, headers: license ? { authorization: `Bearer ${license}` } : {} };
}

/** GitHub contents API stub keyed by path. */
function githubFetch(files, calls = []) {
  return async (url) => {
    calls.push(String(url));
    const m = String(url).match(/contents\/([^?]+)\?/);
    const path = m ? decodeURIComponent(m[1]) : '';
    if (!(path in files)) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => files[path] };
  };
}

const allowValidator = { validate: async () => ({ ok: true, subject: 'subj-hmac', tier: 'pro', status: 'active' }) };

function makeHandler({ files = { 'manifest.json': JSON.stringify(MANIFEST), 'patterns/ko-structure.md': PACK_BODY }, validator = allowValidator, env = {}, calls = [], kv = createMemoryKv() } = {}) {
  return {
    handler: createPackHandler({
      env: { PATINA_PACKS_GITHUB_TOKEN: 'tok', ...env },
      kv,
      licenseValidator: validator,
      fetchImpl: githubFetch(files, calls),
      now: () => FIXED_NOW,
      logger: { warn: () => {} },
    }),
    calls,
    kv,
  };
}

test('manifest listing requires a license and returns validated entries', async () => {
  const { handler } = makeHandler();
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.packs.length, 1);
  assert.equal(res.body.packs[0].id, 'ko-structure');
  assert.equal(res.body.packs[0].sha256, sha256(PACK_BODY));
  // listing never includes repo paths or content
  assert.equal(res.body.packs[0].path, undefined);
  assert.equal(res.body.packs[0].content, undefined);
});

test('missing bearer -> 401 LICENSE_REQUIRED, invalid license -> validator status/reason', async () => {
  const { handler } = makeHandler();
  const res401 = mockRes();
  await handler(mockReq({ license: null }), res401);
  assert.equal(res401.statusCode, 401);
  assert.equal(res401.body.reason, QUOTA_REASONS.LICENSE_REQUIRED);

  const deny = { validate: async () => ({ ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID }) };
  const { handler: denyHandler } = makeHandler({ validator: deny });
  const res403 = mockRes();
  await denyHandler(mockReq(), res403);
  assert.equal(res403.statusCode, 403);
  assert.equal(res403.body.reason, QUOTA_REASONS.LICENSE_INVALID);
});

test('pack download verifies manifest sha and returns content', async () => {
  const { handler } = makeHandler();
  const res = mockRes();
  await handler(mockReq({ url: '/api/packs?id=ko-structure' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.content, PACK_BODY);
  assert.equal(res.body.kind, 'pattern');
});

test('sha mismatch between manifest and blob is refused, unknown id -> 404', async () => {
  const files = { 'manifest.json': JSON.stringify(MANIFEST), 'patterns/ko-structure.md': PACK_BODY + 'tampered' };
  const { handler } = makeHandler({ files });
  const res = mockRes();
  await handler(mockReq({ url: '/api/packs?id=ko-structure' }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, PACKS_REASONS.PACKS_UNAVAILABLE);

  const res404 = mockRes();
  await handler(mockReq({ url: '/api/packs?id=nope' }), res404);
  assert.equal(res404.statusCode, 404);
  assert.equal(res404.body.reason, PACKS_REASONS.PACK_NOT_FOUND);
});

test('no upstream token -> 503 before any auth work', async () => {
  const validateCalls = [];
  const spyValidator = { validate: async () => { validateCalls.push(1); return { ok: true, subject: 's' }; } };
  const handler = createPackHandler({
    env: {},
    kv: createMemoryKv(),
    licenseValidator: spyValidator,
    fetchImpl: async () => { throw new Error('must not fetch'); },
    logger: { warn: () => {} },
  });
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, PACKS_REASONS.PACKS_UNAVAILABLE);
  assert.equal(validateCalls.length, 0);
});

test('daily download cap meters per subject and returns 429 over the cap', async () => {
  const { handler } = makeHandler({ env: { PATINA_PACKS_REQ_PER_DAY: '2' } });
  const ok1 = mockRes(); await handler(mockReq(), ok1);
  const ok2 = mockRes(); await handler(mockReq(), ok2);
  const over = mockRes(); await handler(mockReq(), over);
  assert.equal(ok1.statusCode, 200);
  assert.equal(ok2.statusCode, 200);
  assert.equal(over.statusCode, 429);
  assert.equal(over.body.reason, PACKS_REASONS.DAILY_DOWNLOADS);
});

test('upstream responses are KV-cached; failures are not cached', async () => {
  const calls = [];
  const { handler } = makeHandler({ calls });
  const r1 = mockRes(); await handler(mockReq(), r1);
  const r2 = mockRes(); await handler(mockReq(), r2);
  assert.equal(r2.statusCode, 200);
  // manifest fetched once, served from KV the second time
  assert.equal(calls.filter((u) => u.includes('manifest.json')).length, 1);

  const failCalls = [];
  const { handler: failing } = makeHandler({ files: {}, calls: failCalls });
  const f1 = mockRes(); await failing(mockReq(), f1);
  const f2 = mockRes(); await failing(mockReq(), f2);
  assert.equal(f1.statusCode, 503);
  assert.equal(f2.statusCode, 503);
  // 404 upstream must be retried (not pinned into cache)
  assert.equal(failCalls.filter((u) => u.includes('manifest.json')).length, 2);
});

test('malformed manifest entries are dropped, not served', async () => {
  const files = {
    'manifest.json': JSON.stringify({
      packs: [
        MANIFEST.packs[0],
        { id: '../evil', path: '/etc/passwd', version: 'x', lang: 'ko', kind: 'pattern', sha256: 'zz' },
        { id: 'no-kind', path: 'a.md', version: '1', lang: 'en', kind: 'binary', sha256: sha256('x') },
      ],
    }),
    'patterns/ko-structure.md': PACK_BODY,
  };
  const { handler } = makeHandler({ files });
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.packs.map((p) => p.id), ['ko-structure']);
});

test('non-GET is rejected with 405', async () => {
  const { handler } = makeHandler();
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('isValidPackEntry enforces id/path/kind/sha shape', () => {
  const good = MANIFEST.packs[0];
  assert.equal(isValidPackEntry(good), true);
  assert.equal(isValidPackEntry({ ...good, id: 'Bad_ID!' }), false);
  assert.equal(isValidPackEntry({ ...good, path: '../../secrets' }), false);
  assert.equal(isValidPackEntry({ ...good, path: '/abs/path' }), false);
  assert.equal(isValidPackEntry({ ...good, kind: 'exe' }), false);
  assert.equal(isValidPackEntry({ ...good, sha256: 'nothex' }), false);
});
