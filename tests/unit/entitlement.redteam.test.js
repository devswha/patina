// @ts-nocheck
// ---------------------------------------------------------------------------
// Adversarial red-team suite for the patina Pro entitlement core (G002 gate).
//
// This file deliberately targets the GAPS *beyond* the 27 happy/contract tests
// in entitlement.test.js. Every case tries to BREAK a fail-closed invariant:
//   (1) cache poisoning      -> malformed cached decisions must MISS (never
//                               grant, never throw), even when written under the
//                               correct HMAC key by an omniscient attacker.
//   (2) admission bypass      -> a degraded KV whose incr() returns
//                               NaN/negative/0/object/string/Infinity/float, or
//                               throws, must fail closed (503, LS never called).
//   (3) single-flight race    -> N concurrent misses call LS exactly once; a
//                               failed winner releases the lock so a retry can
//                               re-validate; a successful winner is served from
//                               cache (no LS re-call).
//   (4) key leakage           -> the raw license never lands in a return value,
//                               a KV key, a cached value, or a (redacted) log,
//                               even when LS echoes it in objects/strings/nested
//                               structures/error messages.
//   (5) evaluateLicenseResponse robustness against hostile response shapes.
//   (6) extractBearerLicense robustness against hostile header shapes.
//
// Injected dependencies only: fetchImpl (with a call counter), a fixed clock,
// and either createMemoryKv() or a hand-built degraded KV. NO real network.
//
// Each adversarial case is recorded (id/scenario/expectedBehavior/verdict) and
// the machine-readable report is written to artifacts/pro-qa/g002-redteam.json
// on process exit so the report survives a `node --test` self-check regardless
// of individual pass/fail.
// ---------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  createLemonSqueezyLicenseValidator,
  evaluateLicenseResponse,
  extractBearerLicense,
} from '../../src/entitlement.js';
import { createMemoryKv, quotaKeyHmac } from '../../src/rate-limit.js';
import { QUOTA_REASONS } from '../../src/web-rewrite-contract.js';

// ---------------------------------------------------------------------------
// Fixtures (mirrors entitlement.test.js so the two suites stay isomorphic)
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_700_000_000_000;
const SECRET = 'unit-test-license-secret';
const HEX64 = /^[a-f0-9]{64}$/;
const GOOD_META = Object.freeze({ store_id: 55555, variant_id: 98765, product_id: 4242 });

function baseEnv(overrides = {}) {
  return { LS_STORE_ID: '55555', LS_PRO_VARIANT_ID: '98765', ...overrides };
}
function pastIso(offsetMs = 3_600_000) {
  return new Date(FIXED_NOW - offsetMs).toISOString();
}
function okBody(over = {}) {
  return {
    valid: over.valid !== undefined ? over.valid : true,
    error: null,
    license_key: { status: 'active', expires_at: null, ...(over.license_key || {}) },
    meta: { ...GOOD_META, ...(over.meta || {}) },
  };
}
function lsResponse(body, { status = 200, ok, throwJson = false } = {}) {
  return {
    ok: ok === undefined ? status >= 200 && status < 300 : ok,
    status,
    async json() {
      if (throwJson) throw new Error('Unexpected end of JSON input');
      return body;
    },
  };
}
function spyFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return responder(url, opts, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
function spyKv() {
  const inner = createMemoryKv();
  const keys = [];
  const values = [];
  return {
    __memory: true,
    _keys: keys,
    _values: values,
    async get(key) { keys.push(key); return inner.get(key); },
    async set(key, val, opts) { keys.push(key); values.push(val); return inner.set(key, val, opts); },
    async incr(key, opts) { keys.push(key); return inner.incr(key, opts); },
    async decr(key) { keys.push(key); return inner.decr(key); },
  };
}
function spyLogger() {
  const entries = [];
  return {
    _entries: entries,
    warn: (...args) => entries.push(args),
    log: (...args) => entries.push(args),
  };
}
function makeValidator({ kv, env, fetchImpl, logger, hmacSecret = SECRET, now = () => FIXED_NOW } = {}) {
  return createLemonSqueezyLicenseValidator({
    kv: kv === undefined ? createMemoryKv() : kv,
    hmacSecret,
    env: env || baseEnv(),
    fetchImpl,
    now,
    logger,
  });
}

// A KV whose get() always misses and whose incr() returns a poisoned value.
// The 1st incr in validate() is the RPM bucket, the 2nd is the single-flight
// lock, so `rpm`/`lock` let a case target a specific admission guard.
// { value } => incr returns that value; { throw:true } => incr throws.
function degradedKv({ rpm, lock } = {}) {
  let n = 0;
  return {
    async get() { return undefined; },
    async set() { /* noop */ },
    async incr() {
      n += 1;
      const spec = n === 1 ? rpm : lock;
      if (spec && spec.throw) throw new Error('kv incr exploded');
      return spec ? spec.value : 1; // default: a healthy first increment
    },
  };
}

// ---------------------------------------------------------------------------
// Case recorder + artifact emitter
// ---------------------------------------------------------------------------

const CASES = [];
function record(id, scenario, expectedBehavior, verdict, note) {
  CASES.push({ id, scenario, expectedBehavior, verdict, ...(note ? { note } : {}) });
}

/** Register one adversarial case as a node:test that also records its verdict. */
function check(id, scenario, expectedBehavior, fn) {
  test(`[${id}] ${scenario}`, async (t) => {
    try {
      await fn(t);
      record(id, scenario, expectedBehavior, 'pass');
    } catch (err) {
      record(id, scenario, expectedBehavior, 'fail', String((err && err.message) || err));
      throw err;
    }
  });
}

const ARTIFACT_PATH = 'artifacts/pro-qa/g002-redteam.json';
process.on('exit', () => {
  const pass = CASES.filter((c) => c.verdict === 'pass').length;
  const fail = CASES.length - pass;
  const report = {
    schemaVersion: 1,
    kind: 'algorithm-boundary-report',
    surface: 'algorithm',
    tests: CASES.length,
    pass,
    fail,
    cases: CASES,
  };
  try {
    mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
    writeFileSync(ARTIFACT_PATH, JSON.stringify(report, null, 2));
  } catch { /* best-effort: the node:test verdict is still authoritative */ }
});

// ===========================================================================
// Scenario 1 - cache poisoning: malformed cached decisions must MISS
// ===========================================================================
// Threat model: the KV key is an HMAC the attacker cannot forge, so we model
// the STRONGEST attacker (one who knows SECRET) writing directly at the derived
// cache key. Even then, a malformed/hostile cached value must be treated as a
// miss (readCacheEntry -> null): no wrong allow, no throw, always re-validate.

function cacheKeyFor(license) {
  return quotaKeyHmac(SECRET, 'ls-license-cache', license);
}

// Control A: a WELL-FORMED positive entry MUST be served from cache. This proves
// the HMAC key derivation used by the poison cases below is correct, so their
// "miss" outcomes are meaningful (not a false pass from a wrong key).
check('C1-ctrl-allow', 'cache: a well-formed allow entry is served as a hit', 'cache HIT, ok:true, LS never called', async () => {
  const kv = createMemoryKv();
  const license = 'LK-c1-ctrl-allow';
  await kv.set(cacheKeyFor(license), { decision: 'allow', tier: 'pro', status: 'active', expiresAt: FIXED_NOW + 60_000 }, { ttlMs: 600_000 });
  const fetchImpl = spyFetch(() => { throw new Error('must not fetch on a cache hit'); });
  const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey: license });
  assert.equal(res.ok, true);
  assert.equal(res.cache, 'hit');
  assert.equal(res.status, 'active');
  assert.equal(fetchImpl.calls.length, 0);
});

// Control B: a WELL-FORMED negative entry MUST be served from cache (403).
check('C1-ctrl-deny', 'cache: a well-formed deny entry is served as a hit', 'cache HIT, 403, LS never called', async () => {
  const kv = createMemoryKv();
  const license = 'LK-c1-ctrl-deny';
  await kv.set(cacheKeyFor(license), { decision: 'deny', tier: 'pro', status: 403, reason: QUOTA_REASONS.LICENSE_INVALID, expiresAt: FIXED_NOW + 60_000 }, { ttlMs: 600_000 });
  const fetchImpl = spyFetch(() => { throw new Error('must not fetch on a cache hit'); });
  const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey: license });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(fetchImpl.calls.length, 0);
});

// Poisoned ALLOW entries: each must be ignored (miss). We make LS DENY, so if
// the poison were honored the result would wrongly be ok:true. A 403 + exactly
// one fetch proves: (a) no wrong allow, (b) the cache missed and we re-validated.
const POISON_ALLOWS = {
  'C1-a: allow missing status': { decision: 'allow', expiresAt: FIXED_NOW + 60_000 },
  'C1-b: allow non-string status': { decision: 'allow', status: 200, expiresAt: FIXED_NOW + 60_000 },
  'C1-c: allow missing expiresAt': { decision: 'allow', status: 'active' },
  'C1-d: allow expiresAt as string': { decision: 'allow', status: 'active', expiresAt: String(FIXED_NOW + 60_000) },
  'C1-e: allow expiresAt NaN': { decision: 'allow', status: 'active', expiresAt: NaN },
  'C1-f: allow expiresAt Infinity': { decision: 'allow', status: 'active', expiresAt: Infinity },
  'C1-g: allow expiresAt in the past': { decision: 'allow', status: 'active', expiresAt: FIXED_NOW - 1_000 },
  'C1-h: allow expiresAt exactly now (<= now boundary)': { decision: 'allow', status: 'active', expiresAt: FIXED_NOW },
  'C1-i: allow illegal decision value': { decision: 'grant', status: 'active', expiresAt: FIXED_NOW + 60_000 },
  'C1-j: entry is a bare string': 'allow',
  'C1-k: entry is a number': 123,
  'C1-l: entry is a boolean': true,
  'C1-m: entry is an array': [{ decision: 'allow', status: 'active', expiresAt: FIXED_NOW + 60_000 }],
};
for (const [label, poison] of Object.entries(POISON_ALLOWS)) {
  const id = label.split(':')[0];
  check(id, `cache poison ignored: ${label.split(': ')[1]}`, 'treated as miss -> re-validates -> LS denial honored (403), no throw', async () => {
    const kv = createMemoryKv();
    const license = `LK-${id}`;
    await kv.set(cacheKeyFor(license), poison, { ttlMs: 600_000 });
    const fetchImpl = spyFetch(() => lsResponse(okBody({ valid: false }))); // LS denies
    const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey: license });
    assert.equal(res.ok, false, 'poisoned allow must NOT grant');
    assert.equal(res.status, 403);
    assert.equal(fetchImpl.calls.length, 1, 'malformed cache must miss and re-validate against LS');
  });
}

// Poisoned DENY entries also miss -> re-validate. LS entitles, so a well-formed
// re-validation returns ok:true (proves the garbage deny was not honored either).
const POISON_DENIES = {
  'C1-n: deny non-number status': { decision: 'deny', status: '403', reason: QUOTA_REASONS.LICENSE_INVALID, expiresAt: FIXED_NOW + 60_000 },
  'C1-o: deny non-string reason': { decision: 'deny', status: 403, reason: 42, expiresAt: FIXED_NOW + 60_000 },
};
for (const [label, poison] of Object.entries(POISON_DENIES)) {
  const id = label.split(':')[0];
  check(id, `cache poison ignored: ${label.split(': ')[1]}`, 'treated as miss -> re-validates -> LS entitlement honored (ok, miss)', async () => {
    const kv = createMemoryKv();
    const license = `LK-${id}`;
    await kv.set(cacheKeyFor(license), poison, { ttlMs: 600_000 });
    const fetchImpl = spyFetch(() => lsResponse(okBody()));
    const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey: license });
    assert.equal(res.ok, true);
    assert.equal(res.cache, 'miss');
    assert.equal(fetchImpl.calls.length, 1);
  });
}

// ===========================================================================
// Scenario 2 - admission bypass: a degraded KV must fail closed (503)
// ===========================================================================

// Control: a healthy KV under the SAME env reaches LS. This proves config is
// valid, so every 503 below is attributable to the admission guard, not config.
check('C2-ctrl', 'admission: a healthy KV reaches LS', 'ok:true, LS called once (config is valid)', async () => {
  const healthy = { async get() { return undefined; }, async set() {}, async incr() { return 1; } };
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const res = await makeValidator({ kv: healthy, fetchImpl }).validate({ licenseKey: 'LK-c2-ctrl' });
  assert.equal(res.ok, true);
  assert.equal(fetchImpl.calls.length, 1);
});

const DEGRADED_RPM = {
  'C2-a: RPM incr -> NaN': { value: NaN },
  'C2-b: RPM incr -> negative': { value: -1 },
  'C2-c: RPM incr -> zero': { value: 0 },
  'C2-d: RPM incr -> object': { value: {} },
  'C2-e: RPM incr -> string': { value: '5' },
  'C2-f: RPM incr -> Infinity': { value: Infinity },
  'C2-g: RPM incr -> float': { value: 1.5 },
  'C2-h: RPM incr -> throws': { throw: true },
};
for (const [label, rpm] of Object.entries(DEGRADED_RPM)) {
  const id = label.split(':')[0];
  check(id, `admission bypass blocked: ${label.split(': ')[1]}`, 'fail closed 503 LICENSE_UNAVAILABLE, LS never called', async () => {
    const fetchImpl = spyFetch(() => { throw new Error('must not reach LS under a degraded RPM bucket'); });
    const res = await makeValidator({ kv: degradedKv({ rpm }), fetchImpl }).validate({ licenseKey: `LK-${id}` });
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
    assert.equal(fetchImpl.calls.length, 0);
  });
}

const DEGRADED_LOCK = {
  'C2-i: lock incr -> NaN': { value: NaN },
  'C2-j: lock incr -> zero': { value: 0 },
  'C2-k: lock incr -> object': { value: {} },
  'C2-l: lock incr -> string': { value: '1' },
  'C2-m: lock incr -> throws': { throw: true },
};
for (const [label, lock] of Object.entries(DEGRADED_LOCK)) {
  const id = label.split(':')[0];
  check(id, `admission bypass blocked: ${label.split(': ')[1]} (RPM healthy)`, 'fail closed 503 LICENSE_UNAVAILABLE, LS never called', async () => {
    const fetchImpl = spyFetch(() => { throw new Error('must not reach LS under a degraded lock'); });
    // rpm healthy (1) so the case isolates the single-flight lock guard.
    const res = await makeValidator({ kv: degradedKv({ rpm: { value: 1 }, lock }), fetchImpl }).validate({ licenseKey: `LK-${id}` });
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
    assert.equal(fetchImpl.calls.length, 0);
  });
}

// ===========================================================================
// Scenario 3 - single-flight race
// ===========================================================================

function lockKeyFor(license) {
  return quotaKeyHmac(SECRET, 'ls-lock', license);
}

check('C3-a', 'single-flight: N concurrent misses call LS exactly once', 'LS called once; 1 winner (miss); N-1 losers fail closed 503', async () => {
  const N = 8;
  // The winner's fetch resolves on a macrotask so every loser returns 503 first.
  const fetchImpl = spyFetch(async () => { await new Promise((r) => setTimeout(r, 15)); return lsResponse(okBody()); });
  const validator = makeValidator({ fetchImpl });
  const license = 'LK-c3-concurrent';
  const results = await Promise.all(Array.from({ length: N }, () => validator.validate({ licenseKey: license })));
  assert.equal(fetchImpl.calls.length, 1, 'exactly one instance may call LS');
  const winners = results.filter((r) => r.ok);
  assert.equal(winners.length, 1, 'exactly one winner');
  assert.equal(winners[0].cache, 'miss');
  assert.equal(results.filter((r) => !r.ok && r.status === 503).length, N - 1, 'losers fail closed');
});

check('C3-b', 'single-flight: a failed winner (non-2xx) releases the lock for retry', 'lock reset to 0; retry re-validates against LS and succeeds', async () => {
  const kv = createMemoryKv();
  let attempt = 0;
  const fetchImpl = spyFetch(() => {
    attempt += 1;
    return attempt === 1 ? lsResponse({ error: 'upstream 500' }, { status: 500 }) : lsResponse(okBody());
  });
  const validator = makeValidator({ kv, fetchImpl });
  const license = 'LK-c3-fail-retry';

  const first = await validator.validate({ licenseKey: license });
  assert.equal(first.status, 503, 'a failed winner denies transiently (never cached)');
  assert.equal(await kv.get(lockKeyFor(license)), 0, 'the lock must be released (reset to 0) after a failure');

  const retry = await validator.validate({ licenseKey: license });
  assert.equal(retry.ok, true, 'a subsequent caller becomes the winner and re-validates');
  assert.equal(fetchImpl.calls.length, 2, 'a transient failure must not be cached');
});

check('C3-c', 'single-flight: a timed-out winner releases the lock for retry', 'timeout -> 503 -> lock released -> retry succeeds', async () => {
  const kv = createMemoryKv();
  let attempt = 0;
  const fetchImpl = spyFetch((_url, opts) => {
    attempt += 1;
    if (attempt === 1) return new Promise((_res, rej) => opts.signal.addEventListener('abort', () => rej(new Error('The operation was aborted'))));
    return lsResponse(okBody());
  });
  const validator = makeValidator({ kv, fetchImpl, env: baseEnv({ PATINA_LS_TIMEOUT_MS: '15' }) });
  const license = 'LK-c3-timeout-retry';

  const first = await validator.validate({ licenseKey: license });
  assert.equal(first.status, 503);
  assert.equal(await kv.get(lockKeyFor(license)), 0, 'lock released even after a timeout in the winner path');

  const retry = await validator.validate({ licenseKey: license });
  assert.equal(retry.ok, true);
  assert.equal(fetchImpl.calls.length, 2);
});

check('C3-d', 'single-flight: a successful winner serves late arrivals from cache', 'winner writes positive cache; late caller is a HIT (no LS re-call)', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({ fetchImpl });
  const license = 'LK-c3-late-hit';
  const winner = await validator.validate({ licenseKey: license });
  assert.equal(winner.ok, true);
  assert.equal(winner.cache, 'miss');
  const late = await validator.validate({ licenseKey: license });
  assert.equal(late.ok, true);
  assert.equal(late.cache, 'hit');
  assert.equal(fetchImpl.calls.length, 1, 'a late arrival must hit cache, not re-call LS');
});

check('C3-e', 'single-flight: a denying winner serves late arrivals from negative cache', 'winner writes negative cache; late caller is a 403 HIT (no LS re-call)', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody({ valid: false })));
  const validator = makeValidator({ fetchImpl });
  const license = 'LK-c3-late-deny';
  const winner = await validator.validate({ licenseKey: license });
  assert.equal(winner.ok, false);
  assert.equal(winner.status, 403);
  const late = await validator.validate({ licenseKey: license });
  assert.equal(late.status, 403);
  assert.equal(fetchImpl.calls.length, 1, 'a late arrival must hit the negative cache, not re-call LS');
});

// ===========================================================================
// Scenario 4 - key leakage: the raw license never leaks (beyond the 2 existing
// security tests: here we exercise recursion into meta, the deny-path KV key
// enumeration, and an isolated free-form error echo).
// ===========================================================================

const LEAK_LICENSE = 'LKX-9f8e7d6c-DEAD-BEEF-CAFE-000000000001';

check('C4-a', 'key leakage: allow path never exposes the license (return/keys/values/logs)', 'subject-only return, all KV keys HMAC hex, no raw license anywhere', async () => {
  const kv = spyKv();
  const logger = spyLogger();
  const fetchImpl = spyFetch(() => lsResponse(okBody({ license_key: { status: 'active', expires_at: null, key: LEAK_LICENSE } })));
  const res = await makeValidator({ kv, logger, fetchImpl }).validate({ licenseKey: LEAK_LICENSE });
  assert.equal(res.ok, true);
  assert.equal(res.cache, 'miss');
  assert.match(res.subject, HEX64);
  assert.equal(JSON.stringify(res).includes(LEAK_LICENSE), false, 'return value leaked the license');
  assert.ok(kv._keys.length >= 3, 'expected cache/rpm/lock KV keys');
  for (const key of kv._keys) {
    assert.match(key, HEX64, `KV key is not an HMAC digest: ${key}`);
    assert.equal(key.includes(LEAK_LICENSE), false, 'a KV key leaked the license');
  }
  assert.equal(JSON.stringify(kv._values).includes(LEAK_LICENSE), false, 'a cached value leaked the license');
  assert.equal(JSON.stringify(logger._entries).includes(LEAK_LICENSE), false, 'a log payload leaked the license');
});

check('C4-b', 'key leakage: deny path redacts echoes in objects, nested meta, and error strings', 'redactSecrets scrubs every echo; keys HMAC hex; return/cache clean', async () => {
  const kv = spyKv();
  const logger = spyLogger();
  // status 'expired' -> denial is reached and the FULL body is logged (redacted).
  // The license is echoed in: the license_key object, a nested license-named
  // block inside meta, and a free-form error string (both label= and Bearer forms).
  const fetchImpl = spyFetch(() => lsResponse({
    valid: true,
    error: `rejected: license_key=${LEAK_LICENSE}; auth Bearer ${LEAK_LICENSE}`,
    license_key: { status: 'expired', key: LEAK_LICENSE, key_short: LEAK_LICENSE },
    meta: { ...GOOD_META, license_detail: { raw: LEAK_LICENSE }, activation: { license: LEAK_LICENSE } },
  }));
  const res = await makeValidator({ kv, logger, fetchImpl }).validate({ licenseKey: LEAK_LICENSE });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(JSON.stringify(res).includes(LEAK_LICENSE), false, 'return value leaked the license');

  assert.ok(logger._entries.length > 0, 'a denial must be logged for triage');
  const logs = JSON.stringify(logger._entries);
  assert.equal(logs.includes(LEAK_LICENSE), false, 'raw license leaked into logs');
  assert.ok(logs.includes('[REDACTED]'), 'echoed license must be redacted');

  for (const key of kv._keys) assert.match(key, HEX64, `KV key is not an HMAC digest: ${key}`);
  assert.equal(JSON.stringify(kv._values).includes(LEAK_LICENSE), false, 'a cached value leaked the license');
});

check('C4-c', 'key leakage: denial whose ONLY echo is a labelled free-form error string', 'string-shape redaction alone scrubs the license from logs', async () => {
  const logger = spyLogger();
  const fetchImpl = spyFetch(() => lsResponse({
    valid: false,
    error: `License validation failed for license_key=${LEAK_LICENSE} (not found)`,
    license_key: null,
    meta: GOOD_META,
  }));
  const res = await makeValidator({ logger, fetchImpl }).validate({ licenseKey: LEAK_LICENSE });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  const logs = JSON.stringify(logger._entries);
  assert.equal(logs.includes(LEAK_LICENSE), false, 'raw license leaked into logs via the error string');
  assert.ok(logs.includes('[REDACTED]'), 'the echoed license must be redacted');
});

// ===========================================================================
// Scenario 5 - evaluateLicenseResponse: hostile response shapes -> 403, no throw
// (the type-coercion cases below MUST still entitle: number vs string ids match
// via String() comparison)
// ===========================================================================

function assertDeny(res, label) {
  assert.equal(res.ok, false, label);
  assert.equal(res.status, 403, label);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID, label);
}

check('C5-a', 'evaluate: valid must be strictly true (no truthy coercion)', 'every non-true `valid` -> 403 not-valid, no throw', () => {
  for (const valid of [1, 'true', {}, [], 0, 'active', 'yes']) {
    assertDeny(evaluateLicenseResponse(okBody({ valid }), baseEnv(), FIXED_NOW), `valid=${JSON.stringify(valid)}`);
  }
});

check('C5-b', 'evaluate: non-string status -> 403', 'number/null/absent/object status -> 403, no throw', () => {
  assertDeny(evaluateLicenseResponse(okBody({ license_key: { status: 200 } }), baseEnv(), FIXED_NOW), 'status number');
  assertDeny(evaluateLicenseResponse(okBody({ license_key: { status: null } }), baseEnv(), FIXED_NOW), 'status null');
  assertDeny(evaluateLicenseResponse(evaluateBodyNoStatus(), baseEnv(), FIXED_NOW), 'status absent');
  assertDeny(evaluateLicenseResponse(okBody({ license_key: { status: {} } }), baseEnv(), FIXED_NOW), 'status object');
});
function evaluateBodyNoStatus() {
  return { valid: true, error: null, license_key: { expires_at: null }, meta: { ...GOOD_META } };
}

check('C5-c', 'evaluate: status is case- and whitespace-sensitive', 'ACTIVE/Active/ active/active /empty/unknown -> 403 (only exact active|inactive entitle)', () => {
  for (const status of ['ACTIVE', 'Active', ' active', 'active ', '', 'pending', 'ACTIVE ', 'inactive ']) {
    assertDeny(evaluateLicenseResponse(okBody({ license_key: { status } }), baseEnv(), FIXED_NOW), `status=${JSON.stringify(status)}`);
  }
});

check('C5-d', 'evaluate: hostile expires_at shapes fail closed', 'past/garbage/empty/0/numeric-epoch/bool/exact-now -> 403 expired', () => {
  const shapes = [pastIso(), 'not-a-date', '', 0, FIXED_NOW + 3_600_000, true, new Date(FIXED_NOW).toISOString()];
  for (const expires_at of shapes) {
    assertDeny(evaluateLicenseResponse(okBody({ license_key: { status: 'active', expires_at } }), baseEnv(), FIXED_NOW), `expires_at=${JSON.stringify(expires_at)}`);
  }
});

check('C5-e', 'evaluate: numeric vs string store/variant ids MUST match via String()', 'number ids equal string env ids -> ok:true (no false deny)', () => {
  const numeric = evaluateLicenseResponse(okBody({ meta: { store_id: 55555, variant_id: 98765 } }), baseEnv(), FIXED_NOW);
  assert.equal(numeric.ok, true, 'numeric ids must coerce-match the string env');
  const stringed = evaluateLicenseResponse(okBody({ meta: { store_id: '55555', variant_id: '98765' } }), baseEnv(), FIXED_NOW);
  assert.equal(stringed.ok, true, 'string ids must match');
  // and product id coercion when configured
  const prod = evaluateLicenseResponse(okBody({ meta: { store_id: 55555, variant_id: 98765, product_id: 4242 } }), baseEnv({ LS_PRO_PRODUCT_ID: '4242' }), FIXED_NOW);
  assert.equal(prod.ok, true, 'numeric product id must coerce-match');
});

check('C5-f', 'evaluate: mismatched store/variant ids -> 403', 'store/variant mismatch -> 403, no throw', () => {
  assertDeny(evaluateLicenseResponse(okBody({ meta: { store_id: 55556 } }), baseEnv(), FIXED_NOW), 'store mismatch');
  assertDeny(evaluateLicenseResponse(okBody({ meta: { variant_id: 99999 } }), baseEnv(), FIXED_NOW), 'variant mismatch');
});

check('C5-g', 'evaluate: hostile license_key shapes -> 403', 'string/number/array license_key -> 403, no throw', () => {
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: 'raw-string', meta: GOOD_META }, baseEnv(), FIXED_NOW), 'license_key string');
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: 12345, meta: GOOD_META }, baseEnv(), FIXED_NOW), 'license_key number');
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: ['active'], meta: GOOD_META }, baseEnv(), FIXED_NOW), 'license_key array');
});

check('C5-h', 'evaluate: hostile meta shapes -> 403', 'null/string/array/number/absent meta -> 403, no throw', () => {
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: { status: 'active' }, meta: null }, baseEnv(), FIXED_NOW), 'meta null');
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: { status: 'active' }, meta: 'x' }, baseEnv(), FIXED_NOW), 'meta string');
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: { status: 'active' }, meta: [] }, baseEnv(), FIXED_NOW), 'meta array');
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: { status: 'active' }, meta: 7 }, baseEnv(), FIXED_NOW), 'meta number');
  assertDeny(evaluateLicenseResponse({ valid: true, license_key: { status: 'active' } }, baseEnv(), FIXED_NOW), 'meta absent');
});

check('C5-i', 'evaluate: non-object top-level data -> 403, no throw', 'null/undefined/string/number/array/bool -> 403 malformed', () => {
  for (const data of [null, undefined, 'nope', 42, [], true]) {
    const res = evaluateLicenseResponse(data, baseEnv(), FIXED_NOW);
    assert.equal(res.ok, false, `data=${JSON.stringify(data)}`);
    assert.equal(res.status, 403, `data=${JSON.stringify(data)}`);
  }
});

// ===========================================================================
// Scenario 6 - extractBearerLicense: hostile header shapes fail closed (401);
// valid-but-unusual shapes (case-insensitive scheme, extra whitespace,
// single-element array) still parse. Targets the gaps left by the existing
// suite: non-string values, hostile arrays, present-but-nullish values,
// multi-space/mixed-case schemes, and duplicate case-variant keys.
// ===========================================================================

const DENIED_401 = { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED };

check('C6-a', 'extract: scheme without a token fails closed', "'Bearer' / 'Bearer   ' -> 401", () => {
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer' }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer   ' }), DENIED_401);
});

check('C6-b', 'extract: lowercase scheme still parses', "'bearer x' -> ok 'x'", () => {
  assert.deepEqual(extractBearerLicense({ authorization: 'bearer LK-lower' }), { ok: true, license: 'LK-lower' });
});

check('C6-c', 'extract: multiple spaces between scheme and token', "'Bearer  x' (double space) -> ok 'x'", () => {
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer  LK-double' }), { ok: true, license: 'LK-double' });
});

check('C6-d', 'extract: mixed-case scheme still parses', "'BeArEr x' -> ok 'x'", () => {
  assert.deepEqual(extractBearerLicense({ authorization: 'BeArEr LK-mixed' }), { ok: true, license: 'LK-mixed' });
});

check('C6-e', 'extract: leading/trailing whitespace is trimmed', "'  Bearer x  ' -> ok 'x'", () => {
  assert.deepEqual(extractBearerLicense({ authorization: '  Bearer LK-pad  ' }), { ok: true, license: 'LK-pad' });
});

check('C6-f', 'extract: single-element array is one value', "['Bearer solo'] -> ok 'solo'", () => {
  assert.deepEqual(extractBearerLicense({ authorization: ['Bearer LK-solo'] }), { ok: true, license: 'LK-solo' });
});

check('C6-g', 'extract: hostile array shapes fail closed', 'empty / non-string element / multiple -> 401', () => {
  assert.deepEqual(extractBearerLicense({ authorization: [] }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: [12345] }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: [{}] }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: ['Bearer a', 'Bearer b'] }), DENIED_401);
});

check('C6-h', 'extract: non-string header value fails closed', 'number / boolean / object value -> 401', () => {
  assert.deepEqual(extractBearerLicense({ authorization: 12345 }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: true }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: { token: 'x' } }), DENIED_401);
});

check('C6-i', 'extract: a present-but-nullish authorization value fails closed', '{authorization:null|undefined} -> 401', () => {
  assert.deepEqual(extractBearerLicense({ authorization: null }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: undefined }), DENIED_401);
});

check('C6-j', 'extract: duplicate authorization keys (any case) are ambiguous', 'two/three case-variant keys -> 401', () => {
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer a', Authorization: 'Bearer b' }), DENIED_401);
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer a', Authorization: 'Bearer b', AUTHORIZATION: 'Bearer c' }), DENIED_401);
});

check('C6-k', 'extract: non-object headers fail closed', 'null / undefined / string / number headers -> 401', () => {
  assert.deepEqual(extractBearerLicense(null), DENIED_401);
  assert.deepEqual(extractBearerLicense(undefined), DENIED_401);
  assert.deepEqual(extractBearerLicense('authorization: Bearer x'), DENIED_401);
  assert.deepEqual(extractBearerLicense(42), DENIED_401);
});