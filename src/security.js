// Boundary validation for untrusted CLI/env input.
//
// Profile names come from --profile and from .patina.yaml. Base URLs come from
// --base-url, PATINA_API_BASE, and provider presets. Both are sent into either
// fs.readFileSync or fetch() with the API key attached, so they need to be
// validated before use.
import { inputError } from './errors.js';

const PROFILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/**
 * Validate a profile name before resolving profiles/{name}.md.
 *
 * @param {string} name Profile name supplied by CLI or config.
 * @returns {void}
 * @throws {PatinaCliError} When the name is empty, non-string, or contains unsafe characters.
 * @example
 * validateProfileName('default');
 */
export function validateProfileName(name) {
  if (typeof name !== 'string' || !PROFILE_NAME_RE.test(name)) {
    throw inputError(
      `Invalid profile name: ${JSON.stringify(name)}`,
      'Profile names may only contain letters, numbers, underscore, and hyphen, and cannot contain slashes or "..".',
      'Run `patina --help` to see profile examples.'
    );
  }
}

/**
 * Check whether a hostname is localhost or loopback.
 *
 * @param {string} hostname Hostname from a URL.
 * @returns {boolean} True for localhost, 127/8, or ::1.
 * @example
 * const local = isLoopbackHost('127.0.0.1');
 */
export function isLoopbackHost(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost') return true;
  if (hostname === '127.0.0.1' || hostname.startsWith('127.')) return true;
  if (hostname === '::1' || hostname === '[::1]') return true;
  return false;
}

// Detects literal IPs in special-use ranges (RFC 1918, link-local/IMDS,
// CGNAT, multicast, IPv6 ULA/link-local). Sync only — no DNS resolution,
// so DNS rebinding is NOT covered by this check. The goal is to catch the
// common case: --base-url pointed at 169.254.169.254 (cloud metadata) or
// internal RFC 1918 hosts that should not receive Bearer tokens.
/**
 * Detect literal private, reserved, link-local, metadata, or multicast IP hosts.
 *
 * @param {string} hostname Hostname or bracketed IPv6 literal.
 * @returns {boolean} True when the literal IP is private or special-use.
 * @example
 * const blocked = isPrivateOrSpecialIP('169.254.169.254');
 */
export function isPrivateOrSpecialIP(hostname) {
  if (!hostname) return false;
  const h = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    const o = h.split('.').map((n) => Number(n));
    if (o.some((n) => n < 0 || n > 255)) return false;
    if (o[0] === 0) return true;                               // 0.0.0.0/8
    if (o[0] === 10) return true;                              // 10/8
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    if (o[0] === 127) return true;                             // loopback
    if (o[0] === 169 && o[1] === 254) return true;             // link-local / IMDS
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true;             // 192.168/16
    if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true;
    if (o[0] >= 224) return true;                              // multicast / reserved
    return false;
  }
  if (h.includes(':')) {
    const lower = h.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;         // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;         // fe80::/10
    if (lower.startsWith('ff')) return true;                   // multicast
    const v4mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (v4mapped) return isPrivateOrSpecialIP(v4mapped[1]);
    return false;
  }
  return false;
}

/**
 * Validate a provider base URL before sending prompts and bearer tokens.
 *
 * @param {string} baseURL URL to validate.
 * @param {object} [options] Validation opt-ins.
 * @param {boolean} [options.allowInsecure=false] Allow non-loopback HTTP.
 * @param {boolean} [options.allowPrivate=false] Allow private/reserved literal IPs.
 * @returns {void}
 * @throws {PatinaCliError} When the URL is invalid, unsupported, insecure, or private without opt-in.
 * @example
 * validateBaseURL('https://api.openai.com/v1');
 */
export function validateBaseURL(baseURL, { allowInsecure = false, allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw inputError(
      `Invalid base URL: ${JSON.stringify(baseURL)}`,
      'The value is not a parseable URL.',
      'Use an https:// URL, or http://127.0.0.1 for local test servers.'
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw inputError(
      'base URL must use http or https',
      `Received ${url.protocol}: ${baseURL}`,
      'Use an https:// URL, or http://127.0.0.1 for local test servers.'
    );
  }
  // Either an explicit caller opt-in or the env var override is enough to
  // permit plaintext HTTP. cli.js sets the env when --allow-insecure-base-url
  // is passed so downstream callLLM calls don't have to plumb the flag.
  const allowInsec = allowInsecure || shouldAllowInsecureBaseURL();
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !allowInsec) {
    throw inputError(
      `refusing plaintext HTTP to ${url.hostname}`,
      'patina will not send prompts and API keys over non-loopback HTTP by default.',
      'Use an https:// URL, or pass --allow-insecure-base-url for a trusted endpoint.'
    );
  }
  // SSRF guard: refuse non-loopback private/IMDS literal IPs unless explicitly
  // opted in. Loopback is allowed (covered above) so local proxies still work.
  const allowPriv = allowPrivate || shouldAllowPrivateBaseURL();
  if (
    !isLoopbackHost(url.hostname) &&
    isPrivateOrSpecialIP(url.hostname) &&
    !allowPriv
  ) {
    throw inputError(
      `refusing private/reserved base URL ${url.hostname}`,
      'This blocks sending API keys to cloud metadata or RFC 1918/private endpoints by accident.',
      'Pass --allow-private-base-url only if you intentionally target an internal endpoint.'
    );
  }
}

/**
 * Read CLI/env opt-in for non-loopback HTTP base URLs.
 *
 * @param {object} [parsed] Parsed CLI options.
 * @returns {boolean} True when insecure base URLs are explicitly allowed.
 * @example
 * const allowed = shouldAllowInsecureBaseURL({ allowInsecureBaseURL: true });
 */
export function shouldAllowInsecureBaseURL(parsed) {
  if (parsed && parsed.allowInsecureBaseURL) return true;
  const env = process.env.PATINA_ALLOW_INSECURE_BASE_URL;
  return env === '1' || env === 'true' || env === 'yes';
}

/**
 * Persist CLI insecure-base-url opt-in into process.env for downstream calls.
 *
 * @param {object} [parsed] Parsed CLI options.
 * @returns {void}
 * @example
 * applyInsecureBaseURLOptIn({ allowInsecureBaseURL: true });
 */
export function applyInsecureBaseURLOptIn(parsed) {
  if (parsed && parsed.allowInsecureBaseURL) {
    process.env.PATINA_ALLOW_INSECURE_BASE_URL = '1';
  }
}

/**
 * Read CLI/env opt-in for private or reserved literal IP base URLs.
 *
 * @param {object} [parsed] Parsed CLI options.
 * @returns {boolean} True when private base URLs are explicitly allowed.
 * @example
 * const allowed = shouldAllowPrivateBaseURL({ allowPrivateBaseURL: true });
 */
export function shouldAllowPrivateBaseURL(parsed) {
  if (parsed && parsed.allowPrivateBaseURL) return true;
  const env = process.env.PATINA_ALLOW_PRIVATE_BASE_URL;
  return env === '1' || env === 'true' || env === 'yes';
}

/**
 * Persist CLI private-base-url opt-in into process.env for downstream calls.
 *
 * @param {object} [parsed] Parsed CLI options.
 * @returns {void}
 * @example
 * applyPrivateBaseURLOptIn({ allowPrivateBaseURL: true });
 */
export function applyPrivateBaseURLOptIn(parsed) {
  if (parsed && parsed.allowPrivateBaseURL) {
    process.env.PATINA_ALLOW_PRIVATE_BASE_URL = '1';
  }
}
