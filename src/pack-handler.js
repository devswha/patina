// @ts-check
// Licensed pack delivery — the server half of `patina pack`.
//
// Pro-only pattern/persona/lexicon packs live in a PRIVATE repository and are
// served here to licensed users; they are never part of the public repo or the
// npm tarball, which is what actually prevents copying (a binary or obfuscation
// step would not — the skill surface has to stay readable prose).
//
// Trust model, mirroring src/rewrite-handler.js:
//   - the caller presents `Authorization: Bearer <license_key>`;
//   - the same fail-closed Lemon Squeezy validator used by the rewrite API
//     turns it into an HMAC subject (the raw key never leaves entitlement.js);
//   - downloads are metered per subject per UTC day;
//   - pack ids come from the server-side manifest only — the client never
//     supplies a path, so there is no traversal surface;
//   - upstream (GitHub contents API on the private repo) is cached in KV so a
//     burst of installs cannot exhaust the GitHub rate limit.
//
// Env (see .env.example):
//   PATINA_PACKS_GITHUB_TOKEN  read-only fine-grained PAT for the private repo (required)
//   PATINA_PACKS_REPO          owner/name of the private repo (default devswha/patina-pro-packs)
//   PATINA_PACKS_REF           git ref to serve (default main)
//   PATINA_PACKS_CACHE_TTL_MS  upstream cache TTL (default 300000)
//   PATINA_PACKS_REQ_PER_DAY   per-license daily download cap (default 200)

import { createHash } from 'node:crypto';

import { extractBearerLicense } from './entitlement.js';
import { QUOTA_REASONS } from './web-rewrite-contract.js';

export const DEFAULT_PACKS_REPO = 'devswha/patina-pro-packs';
export const DEFAULT_PACKS_REF = 'main';
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_REQ_PER_DAY = 200;
/** Pack kinds the CLI knows how to install; anything else is rejected here. */
export const PACK_KINDS = new Set(['pattern', 'persona', 'lexicon']);
export const PACKS_REASONS = Object.freeze({
  PACKS_UNAVAILABLE: 'PACKS_UNAVAILABLE',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  DAILY_DOWNLOADS: 'DAILY_DOWNLOADS',
});

const sha256 = (/** @type {string} */ s) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Validate one manifest entry from the private repo. The manifest is trusted
 * content (we publish it), but validating shape here keeps a malformed commit
 * from turning into a confusing client-side failure.
 * @param {any} p
 * @returns {boolean}
 */
export function isValidPackEntry(p) {
  return Boolean(
    p && typeof p === 'object'
    && typeof p.id === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(p.id)
    && typeof p.path === 'string' && !p.path.includes('..') && !p.path.startsWith('/')
    && typeof p.version === 'string'
    && typeof p.lang === 'string'
    && PACK_KINDS.has(p.kind)
    && typeof p.sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.sha256)
  );
}

/**
 * @param {{
 *   env?: Record<string,string|undefined>,
 *   kv: {get(k:string):Promise<any>, set(k:string,v:any,o?:{ttlMs?:number}):Promise<void>, incr(k:string,o?:{ttlMs?:number}):Promise<number>},
 *   licenseValidator: {validate(i:{licenseKey?:string}):Promise<any>},
 *   fetchImpl?: typeof globalThis.fetch,
 *   now?: () => number,
 *   logger?: {warn?: Function, error?: Function},
 * }} options
 */
export function createPackHandler({
  env = {},
  kv,
  licenseValidator,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  logger = console,
}) {
  const repo = env.PATINA_PACKS_REPO || DEFAULT_PACKS_REPO;
  const ref = env.PATINA_PACKS_REF || DEFAULT_PACKS_REF;
  const token = env.PATINA_PACKS_GITHUB_TOKEN;
  const cacheTtlMs = readPositiveInt(env.PATINA_PACKS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
  const reqPerDay = readPositiveInt(env.PATINA_PACKS_REQ_PER_DAY, DEFAULT_REQ_PER_DAY);

  const warn = (/** @type {string} */ message, /** @type {Record<string, unknown>} */ meta = {}) => {
    try {
      if (typeof logger?.warn === 'function') logger.warn(message, meta);
    } catch { /* logging must never throw into the request path */ }
  };

  /**
   * Fetch one file from the private repo via the contents API, KV-cached.
   * @param {string} path
   * @returns {Promise<string>}
   */
  async function fetchRepoFile(path) {
    const cacheKey = `packs:file:${ref}:${path}`;
    const cached = await kv.get(cacheKey).catch(() => undefined);
    if (typeof cached === 'string') return cached;

    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github.raw+json',
        'user-agent': 'patina-packs',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) {
      // Never cache upstream failures: a transient GitHub 5xx must not pin a
      // pack into "missing" for a whole TTL window.
      throw Object.assign(new Error(`upstream ${response.status} for ${path}`), { upstreamStatus: response.status });
    }
    const text = await response.text();
    await kv.set(cacheKey, text, { ttlMs: cacheTtlMs }).catch(() => {});
    return text;
  }

  async function loadManifest() {
    const raw = await fetchRepoFile('manifest.json');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error('manifest is not valid JSON'), { upstreamStatus: 502 });
    }
    const packs = Array.isArray(parsed?.packs) ? parsed.packs.filter(isValidPackEntry) : [];
    const skipped = Array.isArray(parsed?.packs) ? parsed.packs.length - packs.length : 0;
    if (skipped > 0) warn('packs: manifest entries skipped as malformed', { skipped });
    return { packs };
  }

  const send = (/** @type {any} */ res, /** @type {number} */ status, /** @type {object} */ body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };

  return async function handler(/** @type {any} */ req, /** @type {any} */ res) {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      return send(res, 405, { error: 'method not allowed' });
    }

    // Fail closed before touching auth: a pack endpoint with no upstream
    // credentials must not report per-license verdicts it cannot honor.
    if (!token) return send(res, 503, { reason: PACKS_REASONS.PACKS_UNAVAILABLE });

    const extracted = extractBearerLicense(req.headers || {});
    if (!extracted.ok) return send(res, 401, { reason: QUOTA_REASONS.LICENSE_REQUIRED });
    const verdict = await licenseValidator.validate({ licenseKey: extracted.license });
    if (!verdict?.ok) {
      return send(res, verdict?.status || 403, { reason: verdict?.reason || QUOTA_REASONS.LICENSE_INVALID });
    }

    // Per-license daily download meter (UTC day bucket). The subject is
    // already an HMAC — never the raw license.
    const day = new Date(now()).toISOString().slice(0, 10);
    let used;
    try {
      used = await kv.incr(`packs:dl:${verdict.subject}:${day}`, { ttlMs: 48 * 60 * 60 * 1000 });
    } catch {
      return send(res, 503, { reason: PACKS_REASONS.PACKS_UNAVAILABLE });
    }
    if (used > reqPerDay) return send(res, 429, { reason: PACKS_REASONS.DAILY_DOWNLOADS });

    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const id = requestUrl.searchParams.get('id');

    try {
      const manifest = await loadManifest();
      if (!id) {
        return send(res, 200, {
          ref,
          packs: manifest.packs.map(({ id: packId, version, kind, lang, description, sha256: digest }) => (
            { id: packId, version, kind, lang, description: description || '', sha256: digest }
          )),
        });
      }

      const pack = manifest.packs.find((/** @type {any} */ p) => p.id === id);
      if (!pack) return send(res, 404, { reason: PACKS_REASONS.PACK_NOT_FOUND });

      const content = await fetchRepoFile(pack.path);
      const digest = sha256(content);
      if (digest !== pack.sha256) {
        // Integrity mismatch between manifest and blob (mid-publish read or a
        // bad commit). Serving it would put an unverifiable file on disk
        // client-side; refuse instead.
        warn('packs: manifest/content sha mismatch', { id, expected: pack.sha256, actual: digest });
        return send(res, 503, { reason: PACKS_REASONS.PACKS_UNAVAILABLE });
      }
      return send(res, 200, {
        id: pack.id,
        version: pack.version,
        kind: pack.kind,
        lang: pack.lang,
        sha256: pack.sha256,
        content,
      });
    } catch (err) {
      const upstream = /** @type {any} */ (err)?.upstreamStatus;
      warn('packs: upstream failure', { upstream: upstream ?? null });
      return send(res, 503, { reason: PACKS_REASONS.PACKS_UNAVAILABLE });
    }
  };
}
