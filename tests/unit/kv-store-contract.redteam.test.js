import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryKv, createRateLimiter } from '../../src/rate-limit.js';
import { WEB_TIERS } from '../../src/web-rewrite-contract.js';
import { createRestKv } from '../../api/rewrite.js';

function makeRestKvMock({ failures = new Map(), incrResults = [] } = {}) {
  const store = new Map();
  const calls = [];
  let clock = 1_000_000;
  const origFetch = globalThis.fetch;

  const live = (key) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= clock) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const u = new URL(href);
    const segs = u.pathname.split('/').filter(Boolean);
    const op = segs[0];
    const rawKeySegment = segs[1] ?? '';
    const key = decodeURIComponent(rawKeySegment);
    const body = init.body == null ? undefined : String(init.body);
    calls.push({ url: href, method: init.method ?? 'GET', body, op, rawKeySegment, key });

    const failure = failures.get(op) ?? failures.get(href);
    if (failure) {
      return { ok: false, status: failure.status ?? 500, async json() { return failure.body ?? { error: 'boom' }; } };
    }

    let result;
    if (op === 'get') {
      result = live(key)?.value ?? null;
    } else if (op === 'set') {
      const ex = u.searchParams.get('EX');
      const expiresAt = ex == null ? Number.POSITIVE_INFINITY : clock + Number(ex) * 1000;
      store.set(key, { value: body ?? '', expiresAt });
      result = 'OK';
    } else if (op === 'incr') {
      if (incrResults.length) {
        result = incrResults.shift();
      } else {
        const current = Number(live(key)?.value ?? 0);
        result = current + 1;
        const prior = store.get(key);
        store.set(key, { value: String(result), expiresAt: prior?.expiresAt ?? Number.POSITIVE_INFINITY });
      }
    } else if (op === 'expire') {
      const seconds = Number(segs[2]);
      const entry = store.get(key);
      if (entry) entry.expiresAt = clock + seconds * 1000;
      result = entry ? 1 : 0;
    } else {
      result = null;
    }
    return { ok: true, async json() { return { result }; } };
  };

  return {
    kv: createRestKv({ KV_REST_API_URL: 'https://kv.example.com', KV_REST_API_TOKEN: 'tok' }),
    calls,
    advance(ms) { clock += ms; },
    restore() { globalThis.fetch = origFetch; },
  };
}

function withFakeDateNow(startMs = 1_000_000) {
  const original = Date.now;
  let now = startMs;
  Date.now = () => now;
  return {
    advance(ms) { now += ms; },
    restore() { Date.now = original; },
  };
}

test('REST set keeps URL-hostile secret values out of every request URL and only in POST body', async () => {
  const mock = makeRestKvMock();
  try {
    const secret = 's3cr3t?/&=%#'.repeat(32) + '\nline-two\nemoji-🚨-끝';
    await mock.kv.set('quota:key', secret, { ttlMs: 2_500 });
    await mock.kv.get('quota:key');
    await mock.kv.incr('counter:key', { ttlMs: 1_001 });

    const setCall = mock.calls.find((call) => call.op === 'set');
    assert.equal(setCall?.method, 'POST');
    assert.equal(setCall?.body, secret);
    for (const call of mock.calls) {
      assert.ok(!call.url.includes(secret), `raw secret leaked into URL: ${call.url}`);
      assert.ok(!call.url.includes(encodeURIComponent(secret)), `encoded secret leaked into URL: ${call.url}`);
      assert.ok(!call.url.includes('line-two'), `secret substring leaked into URL: ${call.url}`);
      assert.ok(!call.url.includes('%F0%9F%9A%A8'), `emoji secret leaked into URL: ${call.url}`);
    }
  } finally {
    mock.restore();
  }
});

test('REST keys with separators, spaces, colon, and unicode are percent-encoded in one path segment', async () => {
  const mock = makeRestKvMock();
  try {
    const key = 'tenant/word space:유니코드/../escape';
    const counterKey = `${key}:counter`;
    await mock.kv.set(key, 'value');
    await mock.kv.get(key);
    await mock.kv.incr(counterKey, { ttlMs: 1_000 });

    const expectedKeys = new Set([encodeURIComponent(key), encodeURIComponent(counterKey)]);
    for (const call of mock.calls) {
      assert.ok(expectedKeys.has(call.rawKeySegment), call.rawKeySegment);
      assert.equal(call.key, call.op === 'incr' || call.op === 'expire' ? counterKey : key);
      assert.ok(!call.url.includes('/../'));
      assert.ok(!call.url.includes('tenant/word'));
    }
  } finally {
    mock.restore();
  }
});

test('REST fetch failures throw and rate limiter converts them to fail-closed storage unavailable', async () => {
  for (const [op, status] of [['get', 404], ['set', 500], ['incr', 503]]) {
    const mock = makeRestKvMock({ failures: new Map([[op, { status }]]) });
    try {
      await assert.rejects(
        op === 'get' ? mock.kv.get('k') : op === 'set' ? mock.kv.set('k', 'v') : mock.kv.incr('k'),
        /kv request failed/,
      );
    } finally {
      mock.restore();
    }
  }

  const mock = makeRestKvMock({ failures: new Map([['incr', { status: 500 }]]) });
  try {
    const limiter = createRateLimiter({
      kv: mock.kv,
      hmacSecret: 'secret',
      env: { NODE_ENV: 'production' },
      limits: { [WEB_TIERS.FREE]: { reqPerDay: 10, burstPerHour: 5 } },
    });
    assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.9' }), {
      allowed: false,
      status: 503,
      reason: 'quota storage unavailable',
    });
  } finally {
    mock.restore();
  }
});

test('REST incr rejects malformed counters instead of returning unsafe values', async () => {
  for (const bad of [undefined, Number.NaN, {}, '2.5', 'not-a-number']) {
    const mock = makeRestKvMock({ incrResults: [bad] });
    try {
      await assert.rejects(mock.kv.incr('counter'), /kv incr returned invalid counter/);
    } finally {
      mock.restore();
    }
  }
});

test('REST TTL EX boundaries: any positive ttlMs rounds UP to whole seconds (min 1), expiry flips after boundary', async () => {
  const mock = makeRestKvMock();
  try {
    // Documented contract: a positive ttlMs is rounded UP to whole seconds
    // (Redis EX, min 1). Sub-second TTLs are out of contract and still yield
    // EX=1 rather than silently omitting the TTL (fail-safe: no immortal key).
    await mock.kv.set('sub-second', 'v', { ttlMs: 0.5 });
    assert.ok(mock.calls.at(-1).url.endsWith('/set/sub-second?EX=1'), mock.calls.at(-1).url);

    await mock.kv.set('fractional', 'temp', { ttlMs: 1_001 });
    const setUrl = mock.calls.at(-1).url;
    assert.ok(setUrl.endsWith('/set/fractional?EX=2'), setUrl);
    mock.advance(1_999);
    assert.equal(await mock.kv.get('fractional'), 'temp');
    mock.advance(1);
    assert.equal(await mock.kv.get('fractional'), null);
  } finally {
    mock.restore();
  }
});

test('memory TTL boundary matches millisecond contract for sub-second expiry', async () => {
  const time = withFakeDateNow();
  try {
    const kv = createMemoryKv();
    await kv.set('fractional', 'temp', { ttlMs: 1.5 });
    time.advance(1);
    assert.equal(await kv.get('fractional'), 'temp');
    time.advance(0.5);
    assert.equal((await kv.get('fractional')) ?? null, null);
  } finally {
    time.restore();
  }
});

test('memory and REST return identical results for the same normal store sequence after nullish normalization', async () => {
  const mock = makeRestKvMock();
  try {
    const memory = createMemoryKv();
    const rest = mock.kv;
    const memoryResults = [];
    const restResults = [];

    const recordBoth = async (fn) => {
      memoryResults.push((await fn(memory)) ?? null);
      restResults.push((await fn(rest)) ?? null);
    };

    await recordBoth((kv) => kv.get('missing'));
    await recordBoth(async (kv) => { await kv.set('same:key', 'value', { ttlMs: 60_000 }); return kv.get('same:key'); });
    await recordBoth((kv) => kv.incr('same:counter'));
    await recordBoth((kv) => kv.incr('same:counter', { ttlMs: 60_000 }));
    await recordBoth(async (kv) => { await kv.set('same:key', 'next'); return kv.get('same:key'); });

    assert.deepEqual(restResults, memoryResults);
  } finally {
    mock.restore();
  }
});

test('missing values are nullish for both stores: memory undefined and REST null', async () => {
  const mock = makeRestKvMock();
  try {
    const memoryMissing = await createMemoryKv().get('absent');
    const restMissing = await mock.kv.get('absent');
    assert.equal(memoryMissing, undefined);
    assert.equal(restMissing, null);
    assert.equal(memoryMissing ?? null, restMissing ?? null);
  } finally {
    mock.restore();
  }
});
