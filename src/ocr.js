import { mkdtempSync, writeFileSync, copyFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_IMAGES = 8;
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TOTAL_BUDGET_BYTES = 10 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 20000;
const MIN_DATA_URI_BYTES = 2 * 1024; // below this: blur placeholders, icons
const MAX_DATA_URI_BYTES = 512 * 1024;
const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const PRIORITY_URL_RE = /(thumbnail|banner|card|og[-_image]*|detail|shot|news|hero|cover|poster)/i;

let testRuntimeOverrides = {};

export function setOcrRuntimeForTests(overrides = {}) {
  testRuntimeOverrides = { ...overrides };
}

export function resetOcrRuntimeForTests() {
  testRuntimeOverrides = {};
}

// True when a test has injected an OCR runner, so the CLI flow can skip the
// real backend-availability check (no installed vision CLI on CI).
export function hasOcrRunnerOverride() {
  return typeof testRuntimeOverrides.runOcr === 'function';
}

function getRuntimeValue(options, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(options, key)) return options[key];
  if (Object.prototype.hasOwnProperty.call(testRuntimeOverrides, key)) return testRuntimeOverrides[key];
  return fallback;
}

// Collect OCR candidates from a prepared snapshot: <img> sources (src,
// srcset, common lazy-load attributes; Next.js /_next/image wrappers are
// unwrapped to the original asset) plus document-wide base64 data URIs —
// card-news content frequently ships as CSS background-image data URIs, not
// <img> tags. SVG is skipped (vector text belongs to the DOM extractor).
export function collectImageCandidates(html, baseUrl, options = {}) {
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const source = String(html ?? '');
  const seen = new Set();
  const candidates = [];

  // Only a local (.html) preview may reference local file: images. A fetched
  // remote page must never make patina read local files — otherwise an
  // attacker page with <img src="file:///home/you/private.png"> could
  // exfiltrate local image content to the OCR backend (SSRF / local-file
  // disclosure). This mirrors the empty-cwd CLI containment.
  const allowFileImages = String(baseUrl || '').startsWith('file:');

  const imgRe = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(source)) !== null) {
    const tag = match[0];
    const url = pickImageUrl(tag, baseUrl, allowFileImages);
    if (!url) continue;
    if (url.startsWith('data:')) {
      addDataUri(candidates, seen, url, tag);
      continue;
    }
    const ext = extensionOf(url);
    if (!ACCEPTED_EXTENSIONS.has(ext)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({
      kind: url.startsWith('file:') ? 'file' : 'url',
      url,
      ext,
      anchor: extractSrcAttr(tag),
      alt: /\balt="([^"]*)"/i.exec(tag)?.[1] ?? '',
      priority: scorePriority(url, tag),
    });
  }

  // Document-wide data URIs (CSS backgrounds, payload remnants).
  const dataRe = /data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=]+)/g;
  while ((match = dataRe.exec(source)) !== null) {
    addDataUri(candidates, seen, match[0], '');
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const kept = candidates.slice(0, maxImages);
  return { candidates: kept, truncated: candidates.length > kept.length };
}

function addDataUri(candidates, seen, dataUri, tag) {
  const payload = dataUri.slice(dataUri.indexOf(',') + 1);
  const decodedBytes = Math.floor(payload.length * 3 / 4);
  if (decodedBytes < MIN_DATA_URI_BYTES || decodedBytes > MAX_DATA_URI_BYTES) return;
  const key = `data:${payload.length}:${payload.slice(0, 64)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const ext = /data:image\/(\w+)/.exec(dataUri)?.[1]?.replace('jpeg', 'jpg') ?? 'png';
  candidates.push({
    kind: 'data',
    dataUri,
    ext: ext === 'jpg' ? 'jpg' : ext,
    anchor: tag ? extractSrcAttr(tag) : null,
    alt: tag ? (/\balt="([^"]*)"/i.exec(tag)?.[1] ?? '') : '',
    priority: 1 + (tag ? scorePriority('', tag) : 0),
  });
}

function pickImageUrl(tag, baseUrl, allowFileImages) {
  const fromAttr = (name) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
    return m ? decodeHtmlAttr(m[1]) : null;
  };
  let raw = fromAttr('src') || fromAttr('data-src') || fromAttr('data-lazy') || fromAttr('data-original');
  if (!raw) {
    const srcset = fromAttr('srcset');
    if (srcset) raw = pickFromSrcset(srcset);
  }
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;
  try {
    let resolved = new URL(raw, baseUrl || undefined);
    // Next.js image proxy: recover the original asset URL.
    if (resolved.pathname.endsWith('/_next/image')) {
      const inner = resolved.searchParams.get('url');
      if (inner) resolved = new URL(inner, resolved);
    }
    const allowedProtocols = allowFileImages ? /^(https?|file):$/ : /^https?:$/;
    if (!allowedProtocols.test(resolved.protocol)) return null;
    return resolved.href;
  } catch {
    return null;
  }
}

// Prefer a mid-sized srcset candidate: big enough for legible OCR, far
// smaller than the w=3840 variants.
function pickFromSrcset(srcset) {
  const entries = srcset.split(',').map((entry) => {
    const [url, descriptor] = entry.trim().split(/\s+/);
    const width = parseInt(descriptor, 10) || 0;
    return { url, width };
  }).filter((entry) => entry.url);
  if (entries.length === 0) return null;
  const sorted = entries.sort((a, b) => a.width - b.width);
  const preferred = sorted.find((entry) => entry.width >= 480 && entry.width <= 1200);
  return (preferred ?? sorted[Math.floor(sorted.length / 2)]).url;
}

function extractSrcAttr(tag) {
  return /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? null;
}

function decodeHtmlAttr(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extensionOf(url) {
  try {
    const pathname = new URL(url).pathname;
    return (/\.([a-z0-9]+)$/i.exec(pathname)?.[1] || '').toLowerCase().replace('jpeg', 'jpg');
  } catch {
    return '';
  }
}

function scorePriority(url, tag) {
  let score = 0;
  if (PRIORITY_URL_RE.test(url)) score += 4;
  const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] ?? '';
  if (/[가-힣぀-ヿ㐀-鿿]/.test(alt)) score += 3;
  else if (alt.trim().length > 8) score += 1;
  return score;
}

// Download/decode candidates into a 0700 temp dir, enforcing per-image and
// total byte budgets. Oversized or failing images are skipped (and reported),
// never truncated.
export async function stageOcrImages(candidates, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const totalBudget = options.totalBudget ?? DEFAULT_TOTAL_BUDGET_BYTES;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = getRuntimeValue(options, 'fetchImpl', fetch);
  const signal = options.signal;
  const tooBig = `larger than ${Math.round(maxBytes / 1024)}KB`;

  const dir = mkdtempSync(join(tmpdir(), 'patina-ocr-'));
  try { chmodSync(dir, 0o700); } catch {}

  const staged = [];
  const skipped = [];
  let spent = 0;
  let budgetExhausted = false;
  for (const [index, candidate] of candidates.entries()) {
    if (signal?.aborted) break;
    if (budgetExhausted) {
      skipped.push({ candidate, reason: 'total image budget reached' });
      continue;
    }
    try {
      let bytes;
      if (candidate.kind === 'data') {
        bytes = Buffer.from(candidate.dataUri.slice(candidate.dataUri.indexOf(',') + 1), 'base64');
      } else if (candidate.kind === 'file') {
        const filePath = fileURLToPath(candidate.url);
        const size = statSync(filePath).size;
        if (size > maxBytes) throw new Error(tooBig);
        if (spent + size > totalBudget) {
          skipped.push({ candidate, reason: 'total image budget reached' });
          budgetExhausted = true;
          continue;
        }
        const target = join(dir, `img-${index}.${candidate.ext}`);
        copyFileSync(filePath, target);
        try { chmodSync(target, 0o600); } catch {}
        spent += size;
        staged.push({ ...candidate, path: target, bytes: size });
        continue;
      } else {
        // Cap by streaming at the per-image limit: never trust Content-Length
        // presence/value, and bound an unbounded chunked stream before it
        // exhausts memory. The total budget is enforced below.
        bytes = await fetchImageBytes(fetchImpl, candidate.url, { signal, maxBytes, fetchTimeoutMs, tooBig });
      }
      if (bytes.length > maxBytes) throw new Error(tooBig);
      if (spent + bytes.length > totalBudget) {
        skipped.push({ candidate, reason: 'total image budget reached' });
        budgetExhausted = true;
        continue;
      }
      const target = join(dir, `img-${index}.${candidate.ext}`);
      writeFileSync(target, bytes);
      try { chmodSync(target, 0o600); } catch {}
      spent += bytes.length;
      staged.push({ ...candidate, path: target, bytes: bytes.length });
    } catch (err) {
      if (signal?.aborted) break;
      skipped.push({ candidate, reason: err?.message || 'fetch failed' });
    }
  }
  return { dir, staged, skipped };
}

// Fetch with a hard timeout and a streaming byte cap. The body is read
// chunk by chunk so a chunked/Content-Length-less response cannot buffer
// unbounded data into memory before the size check.
async function fetchImageBytes(fetchImpl, url, { signal, maxBytes, fetchTimeoutMs, tooBig }) {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('image fetch timed out')), fetchTimeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
        controller.abort(new Error(tooBig));
        throw new Error(tooBig);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }
}

export const OCR_PROMPT = [
  'Extract every piece of legible text visible in the attached image, exactly as written, preserving reading order and line breaks.',
  'Output only the extracted text — no commentary, no translation, no formatting marks.',
  'If the image contains no legible text, output exactly: NO_TEXT',
].join('\n');

// OCR each staged image through the backend chain. `runOcr` is injectable
// for tests; the default routes through invokeBackendChain with the image
// attached, so timeout/abort/concurrency-slot plumbing applies per call.
export async function ocrStagedImages(staged, { invokeChain, signal, logger, minTextLength = 8 } = {}) {
  const runOcr = getRuntimeValue({}, 'runOcr', null);
  const results = await Promise.all(staged.map(async (image) => {
    try {
      const rawText = runOcr
        ? await runOcr(image)
        : await invokeChain({ prompt: OCR_PROMPT, images: [image.path] });
      const text = normalizeOcrText(rawText);
      if (!text || text.length < minTextLength) return null;
      return { ...image, text };
    } catch (err) {
      if (signal?.aborted) return null;
      logger?.warn?.('ocr.image_failed', {
        message: `[patina] OCR failed for ${describeImage(image)}: ${err?.message || 'unknown error'}`,
      });
      return null;
    }
  }));
  return results.filter(Boolean);
}

export function normalizeOcrText(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text || /^NO_TEXT\b/.test(text)) return null;
  // Collapse runs of blank lines so OCR text behaves as ONE paragraph block
  // in the rewrite call — paragraph alignment depends on it.
  return text.replace(/\s*\n\s*/g, ' / ').replace(/\s+/g, ' ').trim();
}

export function describeImage(image) {
  if (image.kind === 'data') return `embedded image (${Math.round((image.bytes ?? 0) / 1024)}KB data URI)`;
  try {
    return new URL(image.url).pathname.split('/').pop() || image.url;
  } catch {
    return image.url ?? 'image';
  }
}
