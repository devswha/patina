// @ts-check
import { TextDecoder } from 'node:util';
import { evaluateFreeTierHealth, evaluateProMonitor, isCronAuthorized, SYNTHETIC_TEXT } from '../src/pro-monitor.js';
import { upstashOrigin } from '../src/upstash-rest.js';

const DEADLINE_MS = 55_000;
const BODY_READ_TIMEOUT_MS = 1_000;
const BODY_LIMIT = 64 * 1024;
const SAFE_ID = /^[a-z0-9._-]{1,128}$/i;
const DEPLOYMENT_ID = /^[a-f0-9]{40}$/;
const CHANNELS = ['production', 'staging'];
const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);

// Delete a lease only while the caller still owns it.
const RELEASE_LUA = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
// While the caller still owns the dedup lease (KEYS[1]), add the delivered
// alert id to the active list (KEYS[2]) and refresh the list's TTL.
const ACKNOWLEDGE_LUA = [
  "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end",
  "local a=redis.call('GET',KEYS[2])",
  'local ids=a and cjson.decode(a) or {}',
  "for _,id in ipairs(ids) do if id==ARGV[2] then redis.call('PEXPIRE',KEYS[2],ARGV[3]) return 1 end end",
  'table.insert(ids,ARGV[2])',
  "redis.call('SET',KEYS[2],cjson.encode(ids),'PX',ARGV[3])",
  'return 1',
].join(' ');
// Clear the active list (KEYS[1]) and the recovery lease (KEYS[2]) only if the
// caller still owns the lease and the list is exactly the one it announced.
const COMPLETE_RECOVERY_LUA = [
  "if redis.call('GET',KEYS[2])~=ARGV[1] or redis.call('GET',KEYS[1])~=ARGV[2] then return 0 end",
  "redis.call('DEL',KEYS[1],KEYS[2])",
  'return 1',
].join(' ');

function empty(body) {
  return body === undefined || body === null || body === '' || (body instanceof Uint8Array && body.length === 0);
}

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.setHeader?.('Cache-Control', 'no-store');
  res.end?.(JSON.stringify(body));
}

/** Exactly one Authorization header, matching the cron secret. */
function authorized(req, secret) {
  const value = typeof req?.headers?.get === 'function' ? req.headers.get('authorization') : req?.headers?.authorization;
  const raw = req?.rawHeaders;
  if (Array.isArray(raw)) {
    const count = raw.filter((_, i) => i % 2 === 0 && String(raw[i]).toLowerCase() === 'authorization').length;
    if (count !== 1) return false;
  }
  return isCronAuthorized(value, secret);
}

function required(value) {
  return typeof value === 'string' && value.length > 0;
}

function decode(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeHttps(value, host) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!host || host(url.hostname)) ? url : null;
  } catch {
    return null;
  }
}

/** A public HTTPS service URL: no port, query, fragment, credentials, or local/IP host. */
function publicServiceUrl(value) {
  const url = safeHttps(value);
  if (!url || url.port || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
  return local ? null : url;
}

function deadline(start) {
  return Math.max(0, start + DEADLINE_MS - Date.now());
}

async function race(promise, ms, controller) {
  if (ms < 1) throw new Error('deadline');
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error('deadline'));
      }, ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

// Every request shares the run deadline; the controller stays attached to the
// response so a stalled body read can still be aborted.
const responseControllers = new WeakMap();

async function fetchBounded(fetchImpl, start, url, options) {
  const controller = new AbortController();
  const response = await race(fetchImpl(url, { ...options, signal: controller.signal }), deadline(start), controller);
  if (response && typeof response === 'object') responseControllers.set(response, controller);
  return response;
}

/** Read a response body incrementally, capped at BODY_LIMIT bytes and the run deadline. */
async function bodyText(response, start) {
  const length = Number(response.headers?.get?.('content-length') ?? response.headers?.['content-length']);
  const controller = responseControllers.get(response);
  if (Number.isFinite(length) && length > BODY_LIMIT) {
    controller?.abort();
    throw new Error('body_large');
  }
  const reader = response.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await race(reader.read(), Math.min(deadline(start), BODY_READ_TIMEOUT_MS), controller);
        if (part.done) break;
        const bytes = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
        size += bytes.byteLength;
        if (size > BODY_LIMIT) {
          controller?.abort();
          throw new Error('body_large');
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock?.();
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  const text = await race(
    typeof response.text === 'function' ? response.text() : Promise.reject(new Error('body')),
    Math.min(deadline(start), BODY_READ_TIMEOUT_MS),
    controller,
  );
  if (typeof text !== 'string' || Buffer.byteLength(text) > BODY_LIMIT) throw new Error('body_large');
  return text;
}

async function bodyJson(response, start) {
  return JSON.parse(await bodyText(response, start));
}

/** Aggregate reader and control store over the dedicated observability Upstash REST KV. */
function createKv(env, fetchImpl, start) {
  const origin = upstashOrigin(env.PATINA_OBSERVABILITY_REST_API_URL);
  const token = env.PATINA_OBSERVABILITY_REST_API_TOKEN;
  if (!origin || !required(token)) return null;
  const command = async (args) => {
    const response = await fetchBounded(fetchImpl, start, origin, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error('kv');
    const value = await bodyJson(response, start);
    return value && typeof value === 'object' && 'result' in value ? value.result : value;
  };
  const evalCommand = (script, keys, args) => command(['EVAL', script, String(keys.length), ...keys, ...args]);
  return {
    async snapshot(keys) {
      const values = await command(['MGET', ...keys]);
      if (!Array.isArray(values) || values.length !== keys.length) throw new Error('snapshot');
      return values;
    },
    get: async (key) => decode(await command(['GET', key])),
    set: async (key, value, ttl) => (await command(['SET', key, JSON.stringify(value), 'PX', String(ttl)])) === 'OK',
    acquire: async (key, value, ttl) => (await command(['SET', key, value, 'PX', String(ttl), 'NX'])) === 'OK',
    release: async (key, value) => (await evalCommand(RELEASE_LUA, [key], [value])) === 1,
    acknowledge: async (leaseKey, owner, activeKey, id, ttl) => (
      await evalCommand(ACKNOWLEDGE_LUA, [leaseKey, activeKey], [owner, id, String(ttl)])
    ) === 1,
    completeRecovery: async (activeKey, leaseKey, owner, ids) => (
      await evalCommand(COMPLETE_RECOVERY_LUA, [activeKey, leaseKey], [owner, JSON.stringify(ids)])
    ) === 1,
  };
}

/** The log-query service answers with exactly these integer counts per window. */
function parseAggregate(payload, window) {
  const value = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const keys = window === '15m' ? ['numberSafety', 'entitlementNonOk', 'entitlementTotal'] : ['monitorDrop'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error('log_shape');
  return value;
}

/** Read-only client for the separate log-query service (`services/log-query/`). */
function createLogQuery(env, fetchImpl, start) {
  const endpoint = publicServiceUrl(env.PATINA_VERCEL_LOG_QUERY_URL);
  const token = env.PATINA_VERCEL_LOG_QUERY_TOKEN;
  if (!endpoint || !required(token)) return null;
  return async ({ channel, tier, window, aggregateOnly, readOnly }) => {
    if (!CHANNELS.includes(channel) || tier !== 'pro' || !['15m', '30m'].includes(window) || !aggregateOnly || !readOnly) {
      throw new Error('scope');
    }
    const url = new URL(endpoint);
    url.searchParams.set('channel', channel);
    url.searchParams.set('tier', tier);
    url.searchParams.set('window', window);
    url.searchParams.set('aggregate_only', 'true');
    const response = await fetchBounded(fetchImpl, start, url, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('logs');
    return parseAggregate(await bodyJson(response, start), window);
  };
}

/** A complete NDJSON rewrite stream: one start, any text deltas, then one non-empty done. */
function parseSynthetic(text) {
  let started = false;
  let done = null;
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return false;
    }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || done) return false;
    if (frame.type === 'start' && !started && Object.keys(frame).length === 1) started = true;
    else if (frame.type === 'delta' && started && typeof frame.text === 'string'
      && Object.keys(frame).every((key) => key === 'type' || key === 'text')) continue;
    else if (frame.type === 'done' && started && typeof frame.rewrite === 'string' && frame.rewrite.length > 0) done = frame;
    else return false;
  }
  return Boolean(started && done);
}

/**
 * A real rewrite against the public deployment. The Pro probe carries the
 * synthetic license; the free canary carries none, so it exercises the tier
 * real users are on. The observer header keeps either probe out of the
 * aggregate it watches, but does not exempt the free canary from the free IP
 * quota, so evaluateFreeTierHealth budgets how often it runs.
 *
 * @param {'pro'|'free'} tier
 */
function createRewriteProbe(env, fetchImpl, start, tier) {
  const origin = publicServiceUrl(env.PATINA_PUBLIC_BASE_URL);
  const license = tier === 'pro' ? env.PATINA_SYNTHETIC_PRO_LICENSE : undefined;
  if (!origin || origin.pathname !== '/' || (tier === 'pro' && !required(license))
    || !required(env.PATINA_SYNTHETIC_OBSERVER_SECRET)) return null;
  const headers = {
    ...(license ? { Authorization: `Bearer ${license}` } : {}),
    'Content-Type': 'application/json',
    Accept: 'application/x-ndjson',
    'x-patina-synthetic-observer': env.PATINA_SYNTHETIC_OBSERVER_SECRET,
  };
  return async () => {
    try {
      const response = await fetchBounded(fetchImpl, start, new URL('/api/rewrite', origin), {
        method: 'POST',
        redirect: 'error',
        headers,
        body: JSON.stringify({ mode: 'first', lang: 'en', tier, text: SYNTHETIC_TEXT }),
      });
      const ndjson = /^application\/x-ndjson(?:;|\s|$)/i.test(response.headers?.get?.('content-type') ?? '');
      return response.ok && ndjson && parseSynthetic(await bodyText(response, start))
        ? { ok: true, terminal: 'done' }
        : { ok: false, terminal: 'failed' };
    } catch {
      return { ok: false, terminal: 'failed' };
    }
  };
}

function createDiscord(env, fetchImpl, start) {
  const url = safeHttps(env.PATINA_ALERT_DISCORD_WEBHOOK, (host) => DISCORD_HOSTS.has(host));
  if (!url || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname)) return null;
  // `wait=true` makes Discord return the created message, whose id is the delivery acknowledgement.
  url.searchParams.set('wait', 'true');
  return async (payload) => {
    const content = JSON.stringify(payload);
    if (typeof content !== 'string' || !content.length || content.length > 2000) throw new Error('invalid Discord message');
    const response = await fetchBounded(fetchImpl, start, url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) return { status: response.status };
    try {
      const data = await bodyJson(response, start);
      return { status: response.status, receiptId: SAFE_ID.test(data?.id || '') ? data.id : undefined };
    } catch {
      return { status: response.status };
    }
  };
}

function summary(value) {
  return {
    channel: value.channel,
    tier: 'pro',
    windows: value.buckets?.length || 0,
    histogram: value.histogram,
    syntheticStreak: value.syntheticStreak,
    signals: value.triggers?.map((x) => x.trigger) || [],
    alerts: value.alerts?.map(({ trigger, sent, deduped }) => ({ trigger, sent: sent === true, deduped: deduped === true })) || [],
  };
}

// A free-monitor result is reported, never fatal: the cron's status code
// speaks for the Pro run only.
function freeSummary(value) {
  if (!value || value.error) return { available: false };
  return {
    available: true,
    tier: value.tier,
    total: value.denominators?.total ?? 0,
    failed: value.denominators?.failed ?? 0,
    canary: value.canaryTerminal,
    signals: value.triggers?.map((x) => x.trigger) ?? [],
  };
}

export function createProMonitorApiHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  evaluateProMonitorImpl = evaluateProMonitor,
  evaluateFreeTierHealthImpl = evaluateFreeTierHealth,
  logger = /** @type {{warn?: (...args: unknown[]) => unknown}} */ (console),
} = {}) {
  // Closed booleans and stage labels diagnose a blind monitor without exposing
  // upstream bodies, endpoint URLs, deployment secrets or customer traffic.
  const unavailable = (res, stage, adapters = {}) => {
    try {
      Promise.resolve(logger.warn?.({ code: 'pro_monitor_unavailable', stage, adapters })).catch(() => {});
    } catch {
      // Logging cannot change the response.
    }
    return send(res, 503, { error: 'monitor_unavailable' });
  };

  return async (req, res) => {
    if (req?.method !== 'GET' || !empty(req?.body)) return send(res, 405, { error: 'method_not_allowed' });
    if (!authorized(req, env.CRON_SECRET)) return send(res, 401, { error: 'unauthorized' });
    const start = Date.now();
    const kv = createKv(env, fetchImpl, start);
    const logs = createLogQuery(env, fetchImpl, start);
    const synthetic = createRewriteProbe(env, fetchImpl, start, 'pro');
    const freeCanary = createRewriteProbe(env, fetchImpl, start, 'free');
    const discord = createDiscord(env, fetchImpl, start);
    const configuration = {
      channel: CHANNELS.includes(env.PATINA_DEPLOYMENT_CHANNEL),
      deployment: DEPLOYMENT_ID.test(env.VERCEL_GIT_COMMIT_SHA || ''),
      aggregate: Boolean(kv),
      logs: Boolean(logs),
      synthetic: Boolean(synthetic),
      discord: Boolean(discord),
    };
    if (Object.values(configuration).some((ready) => !ready)) return unavailable(res, 'configuration', configuration);
    const channel = /** @type {'production'|'staging'} */ (env.PATINA_DEPLOYMENT_CHANNEL);

    try {
      const sleep = async (ms) => {
        if (ms > deadline(start)) throw new Error('deadline');
        await race(new Promise((resolve) => setTimeout(resolve, ms)), deadline(start));
      };
      const value = await race(evaluateProMonitorImpl({
        channel,
        tier: 'pro',
        aggregateReader: kv,
        controlStore: kv,
        logQuery: logs,
        syntheticRequest: synthetic,
        discordSender: discord,
        sleep,
        deadlineMs: Math.min(30_000, deadline(start)),
      }), deadline(start));
      // Evaluated after the paid path and never allowed to fail the cron: a
      // canary problem must not mask the Pro run.
      let free = null;
      try {
        free = await race(evaluateFreeTierHealthImpl({
          channel,
          tier: 'free',
          aggregateReader: kv,
          controlStore: kv,
          canaryRequest: freeCanary ?? undefined,
          discordSender: discord,
          sleep,
          deadlineMs: Math.min(10_000, deadline(start)),
        }), deadline(start));
      } catch {
        free = { error: 'free_monitor_unavailable' };
      }
      const blindUnacked = value.alerts?.some((item) => item.trigger === 'monitor_blind' && !item.deduped && !item.sent);
      if (!value.adapters?.aggregate || !value.adapters?.safetyEntitlementLogs || !value.adapters?.monitorDropLogs || blindUnacked) {
        return unavailable(res, 'inputs', {
          aggregate: value.adapters?.aggregate === true,
          safetyEntitlementLogs: value.adapters?.safetyEntitlementLogs === true,
          monitorDropLogs: value.adapters?.monitorDropLogs === true,
          blindnessAcknowledged: !blindUnacked,
        });
      }
      return send(res, 200, { ...summary(value), free: freeSummary(free) });
    } catch {
      return unavailable(res, 'evaluation');
    }
  };
}

export default createProMonitorApiHandler();
