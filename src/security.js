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

export function validateBaseURL(baseURL, { allowInsecure = false } = {}) {
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
  const allow = allowInsecure || shouldAllowInsecureBaseURL();
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !allow) {
    throw new Error(
      `Refusing to send prompts and API key over plaintext HTTP to ${url.hostname}.\n` +
      `Use an https:// URL, or pass --allow-insecure-base-url ` +
      `(or set PATINA_ALLOW_INSECURE_BASE_URL=1) to override for trusted private endpoints.`
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
