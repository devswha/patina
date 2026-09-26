// Size- and redirect-contained HTTP fetches for page-derived URLs (preview
// pages and their assets, OCR images).

const MAX_REDIRECTS = 5;

/**
 * Fetch with `redirect: 'manual'` and follow each hop only when `guardHop`
 * allows it: redirect Location headers are server-controlled, so a public URL
 * must not be able to bounce into private space mid-redirect.
 *
 * @returns {Promise<{ response: Response, url: string }>} the final response and its URL
 */
export async function fetchFollowingGuardedRedirects(fetchImpl, url, { signal, headers, guardHop, tooManyMessage, blockedMessage }) {
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(current, { signal, redirect: 'manual', ...(headers ? { headers } : {}) });
    const location = response.status >= 300 && response.status < 400
      ? response.headers.get('location')
      : null;
    if (!location) return { response, url: current };
    if (hop >= MAX_REDIRECTS) throw new Error(tooManyMessage);
    const next = new URL(location, current).href;
    if (!(await guardHop(next))) throw new Error(blockedMessage);
    current = next;
  }
}

// Fetch with a hard timeout and a streaming byte cap. Used for OCR images and
// for the snapshot asset freezer's page-derived CSS and font URLs.
export async function fetchCappedBytes(fetchImpl, url, { signal, maxBytes, fetchTimeoutMs, tooBig = 'response too large', guardHop } = {}) {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('image fetch timed out')), fetchTimeoutMs);
  try {
    const response = guardHop
      ? (await fetchFollowingGuardedRedirects(fetchImpl, url, {
        signal: controller.signal,
        guardHop,
        tooManyMessage: 'too many redirects',
        blockedMessage: 'redirect to a private/internal address blocked',
      })).response
      : await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await readResponseBytesCapped(response, {
      maxBytes,
      tooBig,
      onOverflow: () => controller.abort(new Error(tooBig)),
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }
}

// Read a response body chunk by chunk under a hard byte cap, so a chunked /
// Content-Length-less response cannot buffer unbounded data into memory before
// the size check (#447).
export async function readResponseBytesCapped(response, { maxBytes, tooBig = 'response too large', onOverflow } = {}) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(tooBig);
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(tooBig);
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      if (onOverflow) onOverflow();
      else { try { await reader.cancel(); } catch {} }
      throw new Error(tooBig);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
