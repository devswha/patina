import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSubresourceFetchAllowed } from './security.js';

const DEFAULT_MAX_IMAGES = 8;
const DEFAULT_MAX_IMAGE_BYTES = 6 * 1024 * 1024; // tall detail images can be a few MB
const DEFAULT_TOTAL_BUDGET_BYTES = 16 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 20000;
// Inline thumbnail embedded in a finding card so the user sees the exact
// image patina read, regardless of carousel/lazy/background-image rendering.
const MAX_THUMBNAIL_BYTES = 240 * 1024;
const MIME_BY_EXT = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' };
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
// unwrapped to the original asset), CSS url(…) backgrounds (style attributes
// and <style> blocks — card-news frequently ships as background images), and
// document-wide base64 data URIs. Extension-less CDN URLs are kept and
// magic-byte sniffed after download. SVG is skipped (vector text belongs to
// the DOM extractor).
// A file: image candidate is confined to the previewed file's own directory
// subtree (#447): a malicious local .html must not reference absolute paths
// like file:///home/user/passport.jpg and exfiltrate them to the OCR backend.
function fileUrlWithinDir(fileUrl, dir) {
  if (!dir) return false;
  try {
    const target = resolve(fileURLToPath(fileUrl));
    const base = resolve(dir);
    return target === base || target.startsWith(base + sep);
  } catch {
    return false;
  }
}

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
  const allowedProtocols = allowFileImages ? /^(https?|file):$/ : /^https?:$/;
  // Confine local file: images to the previewed file's own directory subtree (#447).
  let sourceDir = null;
  if (allowFileImages) {
    try { sourceDir = dirname(fileURLToPath(baseUrl)); } catch { sourceDir = null; }
  }

  const pushUrlCandidate = (url, { anchor, alt, priority }) => {
    const ext = extensionOf(url);
    // A known non-image extension (svg, ico, css, woff2…) is skipped; an
    // extension-less URL is kept and sniffed from its bytes at staging time.
    if (ext && !ACCEPTED_EXTENSIONS.has(ext)) return;
    if (!ext && url.startsWith('file:')) return;
    if (url.startsWith('file:') && !fileUrlWithinDir(url, sourceDir)) return;
    if (seen.has(url)) return;
    seen.add(url);
    candidates.push({
      kind: url.startsWith('file:') ? 'file' : 'url',
      url,
      ext,
      anchor,
      alt,
      priority,
    });
  };

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
    pushUrlCandidate(url, {
      anchor: rawAttr(tag, 'src'),
      alt: attrValue(tag, 'alt') ?? '',
      priority: scorePriority(url, tag),
    });
  }

  // CSS background images, scanned ONLY inside CSS contexts — style="…"
  // attributes and <style> blocks. A document-wide url() scan would also
  // collect SVG paint references (fill="url(#grad)"), var(--x) tokens, and
  // other non-image url() occurrences, which resolve to junk candidates that
  // crowd real images out of the per-page cap. data: URIs are picked up by
  // the document-wide scan below.
  const cssUrlRe = /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/gi;
  for (const css of collectCssText(source)) {
    cssUrlRe.lastIndex = 0;
    while ((match = cssUrlRe.exec(css)) !== null) {
      const rawUrl = decodeHtmlAttr((match[1] ?? match[2] ?? match[3] ?? '').trim());
      // Fragment refs (#gradient) and CSS functions (var(--x)) are not images.
      if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('#') || /^[a-z-]+\(/i.test(rawUrl)) continue;
      let resolved;
      try {
        resolved = new URL(rawUrl, baseUrl || undefined);
      } catch {
        continue;
      }
      if (!allowedProtocols.test(resolved.protocol)) continue;
      // No surrounding tag to score, so background images rank below
      // same-score <img> candidates.
      pushUrlCandidate(resolved.href, {
        anchor: null,
        alt: '',
        priority: scorePriority(resolved.href, '') - 1,
      });
    }
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

// The only places url() means a CSS image: <style> block contents and the
// value of a style="…" attribute. Returns those text spans so the url()
// scan never sees SVG paint refs or other non-CSS url() tokens.
function collectCssText(source) {
  const spans = [];
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let m;
  while ((m = styleBlockRe.exec(source)) !== null) spans.push(m[1]);
  const styleAttrRe = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = styleAttrRe.exec(source)) !== null) spans.push(m[1] ?? m[2] ?? '');
  return spans;
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
    anchor: tag ? rawAttr(tag, 'src') : null,
    alt: tag ? (attrValue(tag, 'alt') ?? '') : '',
    priority: 1 + (tag ? scorePriority('', tag) : 0),
  });
}

// Attribute readers accepting double-quoted, single-quoted, and unquoted
// values. rawAttr returns the value exactly as written (used as a DOM anchor
// for re-finding the tag); attrValue entity-decodes it.
function rawAttr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function attrValue(tag, name) {
  const raw = rawAttr(tag, name);
  return raw === null ? null : decodeHtmlAttr(raw);
}

function pickImageUrl(tag, baseUrl, allowFileImages) {
  let raw = attrValue(tag, 'src') || attrValue(tag, 'data-src') || attrValue(tag, 'data-lazy') || attrValue(tag, 'data-original');
  if (!raw) {
    const srcset = attrValue(tag, 'srcset');
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
  const alt = (tag && attrValue(tag, 'alt')) ?? '';
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
  const baseUrl = options.baseUrl;
  const lookupImpl = options.lookupImpl;
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
      let ext = candidate.ext;
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
        // Image URLs come from page content, so a hostile page must not be
        // able to use --ocr to probe cloud metadata or internal services.
        if (!(await isSubresourceFetchAllowed(candidate.url, { baseUrl, lookupImpl }))) {
          skipped.push({ candidate, reason: 'private/internal address blocked' });
          continue;
        }
        // Cap by streaming at the per-image limit: never trust Content-Length
        // presence/value, and bound an unbounded chunked stream before it
        // exhausts memory. The total budget is enforced below. Redirect hops
        // are re-guarded so a public image URL cannot 30x into private space.
        bytes = await fetchCappedBytes(fetchImpl, candidate.url, {
          signal,
          maxBytes,
          fetchTimeoutMs,
          tooBig,
          guardHop: (next) => isSubresourceFetchAllowed(next, { baseUrl, lookupImpl }),
        });
        if (!ext) {
          // Extension-less CDN URL: identify the format from the bytes.
          ext = sniffImageType(bytes);
          if (!ext) throw new Error('not a recognizable image (jpg/png/webp/gif)');
        }
      }
      if (bytes.length > maxBytes) throw new Error(tooBig);
      if (spent + bytes.length > totalBudget) {
        skipped.push({ candidate, reason: 'total image budget reached' });
        budgetExhausted = true;
        continue;
      }
      const target = join(dir, `img-${index}.${ext}`);
      writeFileSync(target, bytes);
      try { chmodSync(target, 0o600); } catch {}
      spent += bytes.length;
      staged.push({ ...candidate, ext, path: target, bytes: bytes.length });
    } catch (err) {
      if (signal?.aborted) break;
      skipped.push({ candidate, reason: err?.message || 'fetch failed' });
    }
  }
  return { dir, staged, skipped };
}

// Magic-byte sniffing for extension-less candidates: the format comes from
// the downloaded bytes, never from the server's claims. Unknown bytes (HTML
// error pages, fonts, video) are rejected.
function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Fetch with a hard timeout and a streaming byte cap. The body is read
// chunk by chunk so a chunked/Content-Length-less response cannot buffer
// unbounded data into memory before the size check. Shared with the
// snapshot asset freezer (preview.js), which fetches page-derived CSS and
// font URLs under the same containment rules.
export async function fetchCappedBytes(fetchImpl, url, { signal, maxBytes, fetchTimeoutMs, tooBig = 'response too large', guardHop } = {}) {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('image fetch timed out')), fetchTimeoutMs);
  try {
    let response;
    if (guardHop) {
      // Manually follow redirects so each hop is SSRF-guarded; a public image
      // URL must not be able to bounce into private space mid-redirect.
      let current = url;
      for (let hop = 0; ; hop++) {
        response = await fetchImpl(current, { signal: controller.signal, redirect: 'manual' });
        const location = response.status >= 300 && response.status < 400
          ? response.headers.get('location')
          : null;
        if (!location) break;
        if (hop >= 5) throw new Error('too many redirects');
        const next = new URL(location, current).href;
        if (!(await guardHop(next))) throw new Error('redirect to a private/internal address blocked');
        current = next;
      }
    } else {
      response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    }
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
// the size check. Shared by fetchCappedBytes and the preview page fetch (#447).
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
      return { ...image, text, previewDataUri: buildThumbnail(image) };
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

// Build a capped inline data URI for a finding card so the user sees the
// exact OCR'd image. Returns null when no bytes are readable (e.g. test
// runner) or the image exceeds the embed cap.
function buildThumbnail(image) {
  try {
    if (image.kind === 'data') {
      const payload = image.dataUri.slice(image.dataUri.indexOf(',') + 1);
      return Math.floor(payload.length * 3 / 4) <= MAX_THUMBNAIL_BYTES ? image.dataUri : null;
    }
    if (!image.path || !existsSync(image.path)) return null;
    const bytes = readFileSync(image.path);
    if (bytes.length > MAX_THUMBNAIL_BYTES) return null;
    const mime = MIME_BY_EXT[image.ext] || 'png';
    return `data:image/${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
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
