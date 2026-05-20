import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;

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

export function responseCacheKey({ prompt, model, temperature, baseURL } = {}) {
  const input = [
    String(prompt ?? ''),
    String(model ?? ''),
    String(temperature ?? ''),
    baseURLHost(baseURL),
  ].join('\0');
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

export function responseCachePath(dir, key) {
  return resolve(dir, `${String(key).replace(/^sha256:/, '')}.json`);
}

export function baseURLHost(baseURL) {
  try {
    return new URL(baseURL || 'https://api.openai.com/v1').host;
  } catch {
    return String(baseURL || '');
  }
}
