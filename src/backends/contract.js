export const DEFAULT_BACKEND_TIMEOUT_MS = 180_000;

export function isRetryableBackendError(err, { attemptIndex = 0, signal } = {}) {
  if (signal?.aborted) return false;
  const status = extractStatus(err);
  if (status === 429 || status === 503) return true;
  return err?.name === 'AbortError' && attemptIndex === 0;
}

export function describeBackendError(err) {
  const status = extractStatus(err);
  if (status) return `HTTP ${status}`;
  return err?.name || 'error';
}

function extractStatus(err) {
  const direct = Number(err?.status);
  if (Number.isFinite(direct)) return direct;
  const match = String(err?.message || '').match(/\bHTTP\s+(429|503)\b/);
  return match ? Number(match[1]) : null;
}
