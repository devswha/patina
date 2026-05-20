import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * On-disk response cache schema version.
 *
 * @type {number}
 * @example
 * const version = CACHE_SCHEMA_VERSION;
 */
export const CACHE_SCHEMA_VERSION = 1;
/**
 * Default response cache time-to-live: one day.
 *
 * @type {number}
 * @example
 * const ttl = DEFAULT_CACHE_TTL_SECONDS;
 */
export const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Create a filesystem-backed cache for LLM responses.
 *
 * @param {object} [options] Cache options.
 * @param {string} [options.dir] Directory for cache JSON files; returns null when omitted.
 * @param {number} [options.ttlSeconds=DEFAULT_CACHE_TTL_SECONDS] Entry TTL in seconds.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @returns {null|{dir: string, ttlSeconds: number, stats: object, get: Function, set: Function}} Cache object or null.
 * @throws {Error} Propagates filesystem or JSON errors when cache entries are read or written through the returned object.
 * @example
 * const cache = createResponseCache({ dir: '.patina-cache' });
 */
export function createResponseCache({
  dir,
  ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  now = () => Date.now(),
} = {}) {
  if (!dir) return null;
  const stats = {
    hits: 0,
    misses: 0,
    writes: 0,
    expired: 0,
    errors: 0,
  };

  return {
    dir,
    ttlSeconds,
    stats,
    get(args) {
      const key = responseCacheKey(args);
      const path = responseCachePath(dir, key);
      try {
        const entry = JSON.parse(readFileSync(path, 'utf8'));
        const expiresAt = Date.parse(entry.expiresAt || '');
        if (Number.isFinite(expiresAt) && expiresAt <= now()) {
          stats.misses++;
          stats.expired++;
          return null;
        }
        if (typeof entry.response !== 'string') {
          stats.misses++;
          return null;
        }
        stats.hits++;
        return {
          ...entry,
          key,
          path,
          content: entry.response,
        };
      } catch (err) {
        if (err?.code !== 'ENOENT') stats.errors++;
        stats.misses++;
        return null;
      }
    },
    set(args, response, metadata = {}) {
      const key = responseCacheKey(args);
      const path = responseCachePath(dir, key);
      const createdAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlSeconds * 1000).toISOString();
      const entry = {
        cacheVersion: CACHE_SCHEMA_VERSION,
        key,
        createdAt,
        expiresAt,
        baseURLHost: baseURLHost(args.baseURL),
        model: args.model ?? null,
        temperature: args.temperature ?? null,
        response,
        usage: metadata.usage ?? null,
        responseModel: metadata.model ?? null,
      };

      try {
        mkdirSync(dir, { recursive: true });
        const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n');
        renameSync(tmp, path);
        stats.writes++;
      } catch {
        stats.errors++;
      }
      return { key, path };
    },
  };
}

/**
 * Derive a stable cache key from prompt and provider settings.
 *
 * @param {object} [options] Cache-key inputs.
 * @param {string} [options.prompt] Prompt text.
 * @param {string} [options.model] Model id.
 * @param {number} [options.temperature] Sampling temperature.
 * @param {string} [options.baseURL] Provider base URL.
 * @returns {string} sha256-prefixed cache key.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const key = responseCacheKey({ prompt: 'Hi', model: 'gpt-4o' });
 */
export function responseCacheKey({ prompt, model, temperature, baseURL } = {}) {
  const input = [
    String(prompt ?? ''),
    String(model ?? ''),
    String(temperature ?? ''),
    baseURLHost(baseURL),
  ].join('\0');
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

/**
 * Resolve the JSON file path for a response cache key.
 *
 * @param {string} dir Cache directory.
 * @param {string} key sha256-prefixed or raw cache key.
 * @returns {string} Absolute or relative cache JSON path under dir.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const path = responseCachePath('.cache', 'sha256:abc');
 */
export function responseCachePath(dir, key) {
  return resolve(dir, `${String(key).replace(/^sha256:/, '')}.json`);
}

/**
 * Normalize a provider base URL to its host component for cache keys.
 *
 * @param {string} [baseURL] Provider base URL.
 * @returns {string} Parsed host, or the original string when parsing fails.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const host = baseURLHost('https://api.openai.com/v1');
 */
export function baseURLHost(baseURL) {
  try {
    return new URL(baseURL || 'https://api.openai.com/v1').host;
  } catch {
    return String(baseURL || '');
  }
}
