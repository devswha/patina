#!/usr/bin/env node
// @ts-check
// Local, rewrite-aware preview/test server for the patina playground.
//
// Why this exists: `vercel dev` needs project linking AND an OpenAI key for the
// free tier (PATINA_FREE_API_KEY) — neither is required to test the *frontend*.
// This server mirrors the vercel.json static rewrites and mounts the REAL
// /api/rewrite handler + REAL runWebRewriteStream contract path, stubbing ONLY
// the three LLM network calls (rewrite + MPS + fidelity). The deterministic
// signal layer (scoreDeterministicSignals) still runs for real, so the
// before -> after AI-signal arrow is genuine. MPS/fidelity are fixed preview
// values — the composer hint already calls them out as preview.
//
// Usage: node scripts/dev-server.mjs [--port 4178] [--host 0.0.0.0]
// This is a dev/test harness only. Do NOT deploy it.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRewriteHandler } from '../src/rewrite-handler.js';
import { encodeStreamFrame } from '../src/web-rewrite-contract.js';
import { runWebRewriteStream } from '../src/web-rewrite-stream.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Optional real-LLM mode for experimentation: when PATINA_DEV_LLM_* are set, the
// dev server runs the REAL patina rewrite via that OpenAI-compatible endpoint
// (e.g. OpenCode Zen -> DeepSeek). Scoring stays stubbed unless _SCORE=real, since
// the extra judge calls are slow on free models and add no signal to a rewrite test.
const DEV_LLM = {
  baseURL: process.env.PATINA_DEV_LLM_BASE_URL,
  apiKey: process.env.PATINA_DEV_LLM_KEY,
  model: process.env.PATINA_DEV_LLM_MODEL,
  realScore: process.env.PATINA_DEV_LLM_SCORE === 'real',
};
const DEV_LLM_ON = Boolean(DEV_LLM.baseURL && DEV_LLM.apiKey && DEV_LLM.model);

// ---------- args ----------
function parseArgs(argv) {
  const out = { port: 4178, host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--host' || a === '-h') out.host = String(argv[++i]);
  }
  if (!Number.isInteger(out.port) || out.port <= 0) out.port = 4178;
  return out;
}

// ---------- static: vercel.json rewrites + repo-tree fallback ----------
const REWRITES = new Map([
  ['/', '/playground/index.html'],
  ['/chatgpt.js', '/playground/chatgpt.js'],
  ['/chatgpt.css', '/playground/chatgpt.css'],
  ['/rewrite-client.js', '/playground/rewrite-client.js'],
  ['/analytics.js', '/playground/analytics.js'],
]);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
]);

function contentTypeFor(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

async function serveStatic(req, res, urlPath) {
  // Reject malformed percent-encoding (or an encoded NUL) on the RAW request
  // path FIRST — before the rewrite/SPA fallback below can mask a garbage
  // extension-less path (e.g. /%ff, /%E0%A4%A, /%00) with a 200 index page.
  // Malformed encoding is a client error (400), never an internal 500.
  try {
    if (decodeURIComponent(urlPath).includes('\u0000')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('400 Bad Request: malformed path encoding');
      return;
    }
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('400 Bad Request: malformed path encoding');
    return;
  }

  // Apply vercel.json rewrites; default unknown extension-less paths to "/".
  let rel = REWRITES.get(urlPath) || urlPath;
  if (rel === urlPath && !path.extname(urlPath)) rel = REWRITES.get('/'); // SPA-ish fallback

  const decoded = decodeURIComponent(rel);
  const abs = path.resolve(REPO_ROOT, '.' + decoded);
  // Path-traversal guard: never serve outside the repo root.
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(abs);
    if (info.isDirectory()) { res.writeHead(403).end('forbidden'); return; }
    const buf = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(abs),
      'Cache-Control': 'no-store',
      'Content-Length': buf.length,
    });
    // HEAD must return headers only — never a body (RFC 9110 §9.3.2).
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found: ' + urlPath);
  }
}

// ---------- mock LLM (only the network calls are faked) ----------
const HUMANIZE = {
  en: [
    [/\bWe are (?:thrilled|excited|delighted|pleased|proud) to announce that\b/gi, 'We are announcing'],
    [/\bI am (?:thrilled|excited|delighted|pleased|proud) to (?:announce|share) that\b/gi, 'I want to share that'],
    [/\bin today(?:'|’)s (?:fast-paced|rapidly evolving|ever-evolving|digital|modern) (?:world|landscape|age|era)\b,?\s*/gi, 'Today, '],
    [/\bin the (?:ever-evolving|rapidly changing|dynamic) (?:world|landscape) of\b/gi, 'in'],
    [/\bit(?:'|’)s (?:important|worth|crucial|essential) to (?:note|mention|remember|understand) that\b,?\s*/gi, ''],
    [/\bit is (?:important|worth|crucial|essential) to (?:note|mention|remember|understand) that\b,?\s*/gi, ''],
    [/\bplays? a (?:crucial|key|pivotal|significant|vital|critical) role in\b/gi, 'is key to'],
    [/\bplays? a (?:crucial|key|pivotal|significant|vital|critical) role\b/gi, 'matters'],
    [/\ba testament to\b/gi, 'proof of'],
    [/\b(?:delve|dive|delves|dives) (?:deep(?:er|ly)? )?into\b/gi, 'look at'],
    [/\b(?:delving|diving) (?:deep(?:er|ly)? )?into\b/gi, 'looking at'],
    [/\bnavigat(?:e|es|ing) the (?:complexities|landscape|challenges) of\b/gi, 'handle'],
    [/\bunlock(?:ing)? the (?:full )?potential of\b/gi, 'get the most from'],
    [/\bcutting-edge,?\s*/gi, ''],
    [/\bbest-in-class,?\s*/gi, ''],
    [/\bstate-of-the-art,?\s*/gi, ''],
    [/\bworld-class\s*/gi, 'solid '],
    [/\bgroundbreaking\b/gi, 'new'],
    [/\bgame[- ]?changer\b/gi, 'big deal'],
    [/\btransformative\b/gi, 'big'],
    [/\brevolutioniz(?:e|es|ed|ing)\b/gi, 'change'],
    [/\bleverag(?:e|es|ed|ing)\b/gi, 'use'],
    [/\butiliz(?:e|es|ed|ing)\b/gi, 'use'],
    [/\bharness(?:ing|es|ed)?\b/gi, 'use'],
    [/\bsynerg(?:y|ies)\b/gi, 'teamwork'],
    [/\bseamless(?:ly)?\s*/gi, ''],
    [/\bstreamlin(?:e|es|ed|ing)\b/gi, 'simplify'],
    [/\brobust\b/gi, 'solid'],
    [/\bcomprehensive\b/gi, 'complete'],
    [/\bnuanced\b/gi, 'subtle'],
    [/\b(?:complexities|intricacies)\b/gi, 'details'],
    [/\bcrucial\b/gi, 'key'],
    [/\bpivotal\b/gi, 'key'],
    [/\bmultifaceted\b/gi, 'broad'],
    [/\bmeaningful\b/gi, 'real'],
    [/\btangible\b/gi, 'real'],
    [/\bfoster(?:ing|s|ed)?\b/gi, 'build'],
    [/\bempower(?:ing|s|ed)?\b/gi, 'help'],
    [/\belevat(?:e|es|ed|ing)\b/gi, 'raise'],
    [/\bunderscore(?:s|d)?\b/gi, 'show'],
    [/\bhighlights? the importance of\b/gi, 'shows the value of'],
    [/\bfurther enhance\b/gi, 'improve'],
    [/\b(?:furthermore|moreover|additionally)\b,?\s*/gi, 'Also, '],
    [/\bensur(?:e|es|ed|ing)\b/gi, 'make sure'],
    [/\bembark(?:ing)? on a journey\b/gi, 'start'],
    [/\bat scale\b/gi, ''],
    [/\bIn (?:conclusion|summary),?\s*/gi, 'So '],
    [/\bOverall,\s*/gi, ''],
    [/\s—\s/g, ', '],
  ],
  ko: [
    [/본 (솔루션|제품|서비스|보고서|글)은/g, '이 $1은'],
    [/혁신적인\s*/g, ''],
    [/혁명적인\s*/g, ''],
    [/획기적인\s*/g, '새로운 '],
    [/혁명을 이끌고\s*/g, '크게 바꾸고 '],
    [/패러다임/g, '방식'],
    [/근본적으로\s*/g, '크게 '],
    [/궁극적으로,?\s*/g, '결국 '],
    [/전례 없는/g, '큰'],
    [/시너지를 활용하여/g, '협업으로'],
    [/시너지/g, '협업'],
    [/극대화하는/g, '크게 높이는'],
    [/극대화하고/g, '크게 높이고'],
    [/극대화/g, '크게 높임'],
    [/원활하게\s*/g, ''],
    [/제고하는/g, '높이는'],
    [/제고/g, '향상'],
    [/사료됩니다/g, '생각합니다'],
    [/사료된다/g, '생각한다'],
    [/진심으로 기쁘게 생각합니다/g, '기쁩니다'],
    [/기쁘게 생각합니다/g, '기쁩니다'],
    [/결론적으로,?\s*/g, '정리하면 '],
    [/다각적인/g, '다양한'],
    [/다각화된/g, '다양한'],
    [/선보이게 되어/g, '내놓게 되어'],
    [/에 기여할 것으로/g, '에 도움이 될 것으로'],
  ],
  zh: [
    [/总而言之[，,]?/g, '总之，'],
    [/综上所述[，,]?/g, '总的来说，'],
    [/在(?:当今)?数字时代[，,]?/g, '现在，'],
    [/值得注意的是[，,]?/g, '注意，'],
    [/充分利用/g, '用'],
    [/前沿协同效应/g, '协作'],
    [/协同效应/g, '协作'],
    [/无缝\s*/g, ''],
    [/赋能/g, '帮助'],
    [/前所未有的/g, '很大的'],
    [/综合性的?/g, '完整的'],
    [/极大地提升/g, '提升'],
    [/全面提升/g, '提升'],
    [/多元化的方法/g, '多种方法'],
    [/打造/g, '做'],
    [/助力/g, '帮助'],
    [/从长远来看[，,]?/g, '长远看，'],
    [/良性循环/g, '正向循环'],
    [/奠定(?:了)?(?:坚实的)?基础/g, '打基础'],
    [/释放/g, '带来'],
  ],
  ja: [
    [/結論として[、,]?\s*/g, 'まとめると、'],
    [/(?:近年では|昨今)[、,]?\s*/g, '最近は、'],
    [/(?:デジタル時代|現代社会)において[、,]?\s*/g, '今は、'],
    [/革新的な\s*/g, ''],
    [/画期的な\s*/g, '新しい'],
    [/シナジーを活用し[、,]?/g, '連携して'],
    [/シナジー/g, '連携'],
    [/シームレスに?\s*/g, ''],
    [/かつてない/g, '大きな'],
    [/一層向上させる/g, '高める'],
    [/多角的なアプローチ/g, 'いろいろな取り組み'],
    [/重要なのは/g, '大事なのは'],
    [/が求められます/g, 'が必要です'],
    [/切り開く/g, '広げる'],
  ],
};

function humanize(text, lang) {
  let out = String(text ?? '');
  for (const [re, rep] of (HUMANIZE[lang] || HUMANIZE.en)) out = out.replace(re, rep);
  // Tidy whitespace left behind by removals, then re-capitalize a latin opener
  // (dropping a leading phrase like "It's important to note that " can expose a
  // lowercase first word).
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:。、！？])/g, '$1').trim();
  out = out.replace(/^([a-z])/, (m) => m.toUpperCase());
  return out || String(text ?? '');
}

function* chunkText(text) {
  // Stream in small grapheme-ish chunks so the UI shows the typing animation
  // across both space-delimited (latin) and CJK scripts.
  const size = 4;
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Dev /api/rewrite runner.
 * - PATINA_DEV_LLM_* set -> REAL patina rewrite via that endpoint (e.g. DeepSeek
 *   through OpenCode Zen); scoring stubbed unless PATINA_DEV_LLM_SCORE=real.
 * - BYOK + a real key     -> the REAL patina pipeline on the contract's provider.
 * - free / no key          -> deterministic offline humanizer; ONLY the LLM network
 *   calls are stubbed (asset/prompt loading, frame protocol, floors, diff, and
 *   the deterministic signal layer are the real production code path).
 * @param {{request: any, emit: (frame: any) => void}} args
 */
async function mockRunWebRewriteStream({ request, emit }) {
  // Experimental real LLM (any OpenAI-compatible endpoint), applied to all tiers.
  if (DEV_LLM_ON) {
    const realReq = { ...request, baseURL: DEV_LLM.baseURL, apiKey: DEV_LLM.apiKey, model: DEV_LLM.model };
    const scoreFns = DEV_LLM.realScore ? undefined : {
      scoreMPS: async () => ({ mps: 90, verdict: 'preview' }),
      scoreFidelity: async () => ({ fidelity: 88, verdict: 'preview' }),
    };
    return runWebRewriteStream({ request: realReq, repoRoot: REPO_ROOT, ...(scoreFns ? { scoreFns } : {}), emit });
  }

  // Real end-to-end when the caller supplied their own provider key (BYOK).
  if (request.tier === 'byok' && request.apiKey && request.apiKey !== apiEnv.PATINA_FREE_API_KEY) {
    return runWebRewriteStream({ request, repoRoot: REPO_ROOT, emit });
  }

  const humanized = humanize(request.text, request.lang);

  /** Stub the streaming rewrite call: stream `humanized`, return it. */
  const callLLMStream = async ({ onDelta }) => {
    for (const chunk of chunkText(humanized)) {
      onDelta?.(chunk);
      await delay(22);
    }
    return { text: humanized };
  };

  /** Stub the two LLM judge calls with fixed passing preview scores. */
  const scoreFns = {
    scoreMPS: async () => ({ mps: 92, verdict: 'preview' }),
    scoreFidelity: async () => ({ fidelity: 88, verdict: 'preview' }),
    // scoreDeterministicSignals intentionally omitted -> real deterministic layer runs.
  };

  return runWebRewriteStream({
    request,
    repoRoot: REPO_ROOT,
    callLLMStream,
    scoreFns,
    emit,
  });
}

// ---------- /api/rewrite handler (real handler, mocked runner) ----------
const apiEnv = {
  // Resolved server-side for parity with api/rewrite.js; the mock runner ignores
  // it. Never a real provider key.
  PATINA_FREE_API_KEY: 'local-mock-key',
  // Non-production posture (in-memory quota path); the limiter below is allow-all.
  NODE_ENV: 'development',
};

// Real handler shell + REAL contract validation, but with an allow-all rate
// limiter so frontend iteration is not throttled by the production free-tier
// quota (5/hour). Production (api/rewrite.js) keeps the fail-closed KV+HMAC
// quota — this relaxation is local-test-only.
const rewriteApi = createRewriteHandler({
  env: apiEnv,
  rateLimiter: { check: async ({ tier }) => ({ allowed: true, tier }) },
  logger: { error: console.error },
  runRewrite: async ({ res, request }) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    await mockRunWebRewriteStream({
      request: { ...request, apiKey: request.apiKey ?? apiEnv.PATINA_FREE_API_KEY },
      emit: (frame) => res.write(encodeStreamFrame(frame)),
    });
    res.end();
  },
});

// ---------- server ----------
const { port, host } = parseArgs(process.argv.slice(2));

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const urlPath = url.pathname;

  if (urlPath === '/api/rewrite') {
    // The fail-closed rate limiter needs a client IP from a trusted header; a
    // local browser request has none, so inject one for the in-memory quota.
    req.headers['x-real-ip'] = req.socket.remoteAddress || '127.0.0.1';
    res.setHeader('X-Patina-Mock', DEV_LLM_ON ? '0' : '1');
    rewriteApi(req, res).catch((err) => {
      console.error('rewrite handler error:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('method not allowed');
    return;
  }
  serveStatic(req, res, urlPath).catch((err) => {
    console.error('static error:', err);
    if (!res.headersSent) res.writeHead(500).end('internal error');
  });
});

server.on('error', (err) => {
  if (/** @type {any} */ (err)?.code === 'EADDRINUSE') {
    console.error(`Port ${port} is in use. Re-run with --port <free-port>.`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log('');
  const mode = DEV_LLM_ON
    ? `REAL LLM via ${DEV_LLM.model} @ ${DEV_LLM.baseURL} (scoring ${DEV_LLM.realScore ? 'real' : 'stubbed'})`
    : 'offline humanizer mock (free) / real BYOK';
  console.log('  patina playground dev server');
  console.log(`  → http://${shown}:${port}/`);
  console.log(`  → /api/rewrite: ${mode}`);
  console.log('');
});
