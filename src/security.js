// Boundary validation for untrusted CLI/env input.
//
// Profile names come from --profile and from .patina.yaml. Base URLs come from
// --base-url, PATINA_API_BASE, and provider presets. Both are sent into either
// fs.readFileSync or fetch() with the API key attached, so they need to be
// validated before use.

const PROFILE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export function validateProfileName(name) {
  if (typeof name !== 'string' || !PROFILE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name: ${JSON.stringify(name)}. ` +
      `Profile names must match /^[A-Za-z0-9_][A-Za-z0-9_-]*$/ ` +
      `(no slashes, no "..", no path separators).`
    );
  }
}

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

export function validateBaseURL(baseURL, { allowInsecure = false, allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(`Invalid base URL: ${JSON.stringify(baseURL)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `Base URL must use http or https (got ${url.protocol}): ${baseURL}`
    );
  }
  // Either an explicit caller opt-in or the env var override is enough to
  // permit plaintext HTTP. cli.js sets the env when --allow-insecure-base-url
  // is passed so downstream callLLM calls don't have to plumb the flag.
  const allowInsec = allowInsecure || shouldAllowInsecureBaseURL();
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !allowInsec) {
    throw new Error(
      `Refusing to send prompts and API key over plaintext HTTP to ${url.hostname}.\n` +
      `Use an https:// URL, or pass --allow-insecure-base-url ` +
      `(or set PATINA_ALLOW_INSECURE_BASE_URL=1) to override for trusted private endpoints.`
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
    throw new Error(
      `Refusing to send the API key to private/reserved IP ${url.hostname}.\n` +
      `This blocks SSRF to cloud metadata endpoints (169.254.169.254) and RFC 1918 hosts.\n` +
      `Pass --allow-private-base-url (or set PATINA_ALLOW_PRIVATE_BASE_URL=1) ` +
      `if you intentionally target an internal endpoint.`
    );
  }
}

export function shouldAllowInsecureBaseURL(parsed) {
  if (parsed && parsed.allowInsecureBaseURL) return true;
  const env = process.env.PATINA_ALLOW_INSECURE_BASE_URL;
  return env === '1' || env === 'true' || env === 'yes';
}

export function applyInsecureBaseURLOptIn(parsed) {
  if (parsed && parsed.allowInsecureBaseURL) {
    process.env.PATINA_ALLOW_INSECURE_BASE_URL = '1';
  }
}

export function shouldAllowPrivateBaseURL(parsed) {
  if (parsed && parsed.allowPrivateBaseURL) return true;
  const env = process.env.PATINA_ALLOW_PRIVATE_BASE_URL;
  return env === '1' || env === 'true' || env === 'yes';
}

export function applyPrivateBaseURLOptIn(parsed) {
  if (parsed && parsed.allowPrivateBaseURL) {
    process.env.PATINA_ALLOW_PRIVATE_BASE_URL = '1';
  }
}
