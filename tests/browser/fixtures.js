import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { fidelityResult, mpsResult } from '../fixtures/verification-results.js';
import { buildWebRewriteReceipt } from '../../src/web-rewrite-receipt.js';
import { encodeStreamFrame } from '../../src/web-rewrite-contract.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const INPUT_TEXT = 'It is important to note that we retain 12 audit logs.';
export const OUTPUT_TEXT = 'We retain 12 audit logs.';
export const FIXTURE_API_KEY = 'sk-browser-fixture-key';
export const FIXTURE_LICENSE = 'license-browser-fixture';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixtureDiff() {
  return {
    beforeChars: INPUT_TEXT.length,
    afterChars: OUTPUT_TEXT.length,
    charDelta: OUTPUT_TEXT.length - INPUT_TEXT.length,
    beforeWords: INPUT_TEXT.split(/\s+/).length,
    afterWords: OUTPUT_TEXT.split(/\s+/).length,
    wordDelta: OUTPUT_TEXT.split(/\s+/).length - INPUT_TEXT.split(/\s+/).length,
  };
}

function fixtureSignals() {
  return {
    before: { signalScore: 32, hotParagraphs: 0, paragraphCount: 1 },
    after: { signalScore: 0, hotParagraphs: 0, paragraphCount: 1 },
  };
}

function fixtureReceipt(request, mps, fidelity) {
  return buildWebRewriteReceipt({
    request,
    documentType: request.documentType || 'default',
    original: request.original || request.text,
    latest: request.text,
    prompt: 'browser regression fixture',
    output: OUTPUT_TEXT,
    mps,
    fidelity,
    signals: fixtureSignals(),
    diff: fixtureDiff(),
  });
}

function framesForScenario(scenario, request) {
  const mps = mpsResult(scenario === 'belowfloor' ? 69 : 100);
  const fidelity = fidelityResult(12);
  const receipt = fixtureReceipt(request, mps, fidelity);
  const start = { type: 'start' };
  const deltas = [];
  for (let i = 0; i < OUTPUT_TEXT.length; i += 4) {
    deltas.push({ type: 'delta', text: OUTPUT_TEXT.slice(i, i + 4) });
  }

  if (scenario === 'transmissionfailure') {
    return { frames: [start, ...deltas.slice(0, 2), {
      type: 'error',
      status: 503,
      error: 'rewrite service unavailable',
    }] };
  }
  if (scenario === 'cancel') {
    return {
      delayMs: 1500,
      frames: [start, ...deltas, {
        type: 'done',
        rewrite: OUTPUT_TEXT,
        mps,
        fidelity,
        signals: fixtureSignals(),
        diff: fixtureDiff(),
        receipt,
      }],
    };
  }
  // `belowfloor` intentionally uses a syntactically accepted `done` frame with
  // a score below the shared 70-point floor. The browser must reject it.
  return {
    frames: [start, ...deltas, {
      type: 'done',
      rewrite: OUTPUT_TEXT,
      mps,
      fidelity,
      signals: fixtureSignals(),
      diff: fixtureDiff(),
      receipt,
    }],
  };
}

/**
 * Spawn the repository's real local preview server on an ephemeral port.
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
export async function startDevServer(t) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/dev-server.mjs'), '--host', '127.0.0.1', '--port', '0'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATINA_DEV_LLM_BASE_URL: '',
      PATINA_DEV_LLM_KEY: '',
      PATINA_DEV_LLM_MODEL: '',
      PATINA_DEV_LLM_SCORE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });

  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Preview startup timed out: ${output}`)), 10000);
    const onError = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    const onExit = () => onError(new Error(`Preview exited before listening: ${output}`));
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout.on('data', () => {
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      if (!address) return;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      resolve(address);
    });
  });
}

/**
 * Launch Chromium using an explicitly supplied executable or Playwright's
 * managed browser.
 * @param {import('node:test').TestContext} t
 */
export async function launchChromium(t) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(async () => {
    await browser.close();
  });
  return browser;
}

/**
 * Install a same-origin-only network boundary and a deterministic local stream
 * fixture. Every rewrite request is captured so tests can assert tier and
 * authorization behavior without contacting an auth or provider endpoint.
 * @param {import('playwright').Page} page
 * @param {string} base
 * @param {{scenario?: string, onRequest?: (request: {body: Record<string, unknown>, authorization: string}) => void}} [options]
 */
export async function installBrowserFixture(page, base, { scenario = 'accepted', onRequest } = {}) {
  const origin = new URL(base).origin;
  const requests = [];

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== origin) {
      // The document includes a remote font preconnect/style for production,
      // but browser regressions never allow it (or any other external request)
      // out.
      await route.abort();
      return;
    }
    if (requestUrl.pathname !== '/api/rewrite') {
      await route.continue();
      return;
    }
    let body;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = {};
    }
    const request = {
      body: /** @type {Record<string, unknown>} */ (body || {}),
      authorization: route.request().headers().authorization || '',
    };
    requests.push(request);
    onRequest?.(request);
    const fixture = framesForScenario(scenario, request.body);
    if (fixture.delayMs) await wait(fixture.delayMs);
    try {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store',
        },
        body: fixture.frames.map(encodeStreamFrame).join(''),
      });
    } catch {
      // Cancellation closes the page request before the delayed fixture can
      // fulfill it. That is the expected transport behavior for this case.
    }
  });

  return requests;
}

/**
 * Create a context with clipboard permission and a page whose local routes are
 * installed before navigation.
 * @param {import('playwright').Browser} browser
 * @param {string} base
 * @param {{viewport?: {width:number,height:number}, scenario?: string, onRequest?: (request: {body: Record<string, unknown>, authorization: string}) => void}} [options]
 */
export async function openPlayground(browser, base, {
  viewport = { width: 1280, height: 900 },
  scenario = 'accepted',
  onRequest,
} = {}) {
  const context = await browser.newContext({
    viewport,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const requests = await installBrowserFixture(page, base, { scenario, onRequest });
  const url = new URL(base);
  url.searchParams.set('lang', 'en');
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.locator('#example-panel').waitFor();
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    context,
    page,
    requests,
    async close() {
      await context.close();
    },
  };
}
