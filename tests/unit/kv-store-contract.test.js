import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryKv } from '../../src/rate-limit.js';
import { createRestKv } from '../../api/rewrite.js';

// G002: the in-memory KV (tests/local) and the Upstash/Vercel REST KV must
// satisfy ONE shared store contract — get / set / incr / TTL — so the
// entitlement, session-token, idempotency, and metering layers (G003-G006)
// can target a single interface. The REST adapter additionally must never put
// a raw secret value in the request URL (the value goes in the POST body) and
// must key only by opaque/URL-encoded ids.

/**
 * Build a deterministic in-memory mock of the Upstash REST surface that
 * createRestKv talks to, capturing every requested URL so we can assert no raw
 * value is ever placed in the URL path/query.
 */
function makeRestKvMock() {
  /** @type {Map<string,{value:string, expiresAt:number}>} */
  const store = new Map();
  const urls = [];
  let clock = 1_000_000;
  const live = (k) => {
    const e = store.get(k);
    if (!e) return undefined;
    if (e.expiresAt <= clock) { store.delete(k); return undefined; }
    return e;
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    urls.push(String(url));
    const u = new URL(String(url));
    const segs = u.pathname.split('/').filter(Boolean); // [op, key, ...]
    const op = segs[0];
    const key = decodeURIComponent(segs[1] ?? '');
    let result;
    if (op === 'get') {
      result = live(key)?.value ?? null;
    } else if (op === 'set') {
      const ex = u.searchParams.get('EX');
      const ttlMs = ex ? Number(ex) * 1000 : Infinity;
      // The value is in the body, NOT the URL — mirror real Upstash behavior.
      const body = init.body == null ? '' : String(init.body);
      store.set(key, { value: body, expiresAt: ex ? clock + ttlMs : Number.POSITIVE_INFINITY });
      result = 'OK';
    } else if (op === 'incr') {
      const cur = Number(live(key)?.value ?? 0);
      const next = cur + 1;
      const prev = store.get(key);
      store.set(key, { value: String(next), expiresAt: prev?.expiresAt ?? Number.POSITIVE_INFINITY });
      result = next;
    } else if (op === 'expire') {
      const seconds = Number(segs[2]);
      const e = store.get(key);
      if (e) e.expiresAt = clock + seconds * 1000;
      result = 1;
    } else {
      result = null;
    }
    return { ok: true, async json() { return { result }; } };
  };
  return {
    kv: createRestKv({ KV_REST_API_URL: 'https://kv.example.com', KV_REST_API_TOKEN: 'tok' }),
    urls,
    advance(ms) { clock += ms; },
    restore() { globalThis.fetch = origFetch; },
  };
}

/**
 * Shared contract assertions. `getNull` normalizes the "missing" sentinel
 * (memory returns undefined; REST returns null) so both pass one contract.
 */
async function runStoreContract(kv) {
  // set/get string roundtrip
  await kv.set('k:opaque:1', 'value-one');
  assert.equal(await kv.get('k:opaque:1'), 'value-one');

  // overwrite
  await kv.set('k:opaque:1', 'value-two');
  assert.equal(await kv.get('k:opaque:1'), 'value-two');

  // missing key is nullish (undefined OR null)
  assert.equal((await kv.get('k:absent')) ?? null, null);

  // incr sequence
  assert.equal(await kv.incr('c:opaque:1'), 1);
  assert.equal(await kv.incr('c:opaque:1'), 2);
  assert.equal(await kv.incr('c:opaque:1', { ttlMs: 60_000 }), 3);

  // set with ttl is accepted and the value is readable before expiry
  await kv.set('k:ttl', 'temp', { ttlMs: 60_000 });
  assert.equal(await kv.get('k:ttl'), 'temp');
}

test('memory KV satisfies the shared store contract (get/set/incr/ttl)', async () => {
  await runStoreContract(createMemoryKv());
});

test('memory KV honors TTL expiry', async () => {
  const kv = createMemoryKv();
  await kv.set('k:short', 'gone-soon', { ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await kv.get('k:short')) ?? null, null);
});

test('REST KV satisfies the same shared store contract', async () => {
  const mock = makeRestKvMock();
  try {
    await runStoreContract(mock.kv);
  } finally {
    mock.restore();
  }
});

test('REST KV honors TTL expiry via EX', async () => {
  const mock = makeRestKvMock();
  try {
    await mock.kv.set('k:short', 'gone-soon', { ttlMs: 5_000 });
    assert.equal(await mock.kv.get('k:short'), 'gone-soon');
    mock.advance(6_000);
    assert.equal(await mock.kv.get('k:short'), null);
  } finally {
    mock.restore();
  }
});

test('REST KV never places the raw value in the request URL (value goes in the body)', async () => {
  const mock = makeRestKvMock();
  try {
    const secretish = 'hashed-entitlement-payload-abc123';
    await mock.kv.set('ent:9f8a', secretish, { ttlMs: 600_000 });
    // Every captured URL must be value-free; the value only ever travels in the body.
    for (const url of mock.urls) {
      assert.ok(!url.includes(secretish), `value leaked into URL: ${url}`);
    }
    // The set URL carries the opaque key + EX, not the value.
    const setUrl = mock.urls.find((u) => u.includes('/set/'));
    assert.ok(setUrl.includes('ent%3A9f8a') || setUrl.includes('ent:9f8a'));
    assert.ok(setUrl.includes('EX=600'));
  } finally {
    mock.restore();
  }
});

test('REST KV URL-encodes keys (opaque ids only, no raw separators leaking)', async () => {
  const mock = makeRestKvMock();
  try {
    await mock.kv.get('a/b c:weird');
    const getUrl = mock.urls.find((u) => u.includes('/get/'));
    assert.ok(getUrl.includes('a%2Fb%20c%3Aweird'));
  } finally {
    mock.restore();
  }
});

test('createRestKv is null without KV env (production fail-closed handoff)', () => {
  assert.equal(createRestKv({}), null);
  assert.equal(createRestKv({ KV_REST_API_URL: 'https://x' }), null);
  assert.equal(createRestKv({ KV_REST_API_TOKEN: 'tok' }), null);
});

test('REST KV set requires a string value (no implicit JSON serialization divergence)', async () => {
  const mock = makeRestKvMock();
  try {
    // The shared store contract is string-only: callers serialize objects
    // themselves. REST rejects a non-string loudly instead of implicitly
    // JSON.stringify'ing it (which would diverge from memory KV, where an
    // object would round-trip as an object). This keeps memory and REST
    // observably identical for the contract's value type.
    for (const bad of [{ a: 1 }, [1, 2], 42, true, null, undefined]) {
      await assert.rejects(() => mock.kv.set('k:bad', /** @type {any} */ (bad)), /value must be a string/);
    }
    await mock.kv.set('k:ok', 'a-string');
    assert.equal(await mock.kv.get('k:ok'), 'a-string');
  } finally {
    mock.restore();
  }
});
