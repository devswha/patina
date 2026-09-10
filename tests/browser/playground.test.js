// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIXTURE_API_KEY,
  FIXTURE_LICENSE,
  INPUT_TEXT,
  OUTPUT_TEXT,
  launchChromium,
  openPlayground,
  startDevServer,
} from './fixtures.js';

/**
 * @param {() => Promise<boolean>} check
 * @param {number} [timeout]
 */
async function eventually(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for browser state');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * @param {import('playwright').Locator} locator
 * @returns {Promise<string>}
 */
async function text(locator) {
  return (await locator.textContent()) || '';
}

/**
 * @param {import('playwright').Page} page
 */
async function submitHero(page) {
  await page.locator('#hero-input').fill(INPUT_TEXT);
  await page.locator('#hero-send').click();
}

test('playground browser regressions', { timeout: 120000 }, async (t) => {
  const base = await startDevServer(t);
  const browser = await launchChromium(t);

  await t.test('example copy resets cleanly and repeated clicks do not race timers', async () => {
    const app = await openPlayground(browser, base);
    try {
      const copy = app.page.locator('#example-panel .editor__btn');
      assert.equal(await text(copy), 'Copy example');
      await app.page.clock.install();

      await copy.click();
      await eventually(async () => (await text(copy)) === 'Copied');
      await app.page.clock.fastForward(1000);
      assert.equal(await text(copy), 'Copied', 'the first reset is 1400ms after the first click');
      await copy.click();
      await eventually(async () => (await text(copy)) === 'Copied');
      await app.page.clock.fastForward(500);
      assert.equal(await text(copy), 'Copied', 'the second click must own the reset timer');

      await app.page.locator('#example-choice').selectOption('en-report-support');
      assert.equal(await text(copy), 'Copy example', 'switching rows resets the transient label');
      await app.page.clock.fastForward(1000);
      assert.equal(await text(copy), 'Copy example', 'the previous row timer must not mutate the new row');

      await copy.click();
      await eventually(async () => (await text(copy)) === 'Copied');
    } finally {
      await app.close();
    }
  });

  await t.test('Escape and outside click dismiss settings while IME Enter stays a draft', async () => {
    const rewriteRequests = [];
    const app = await openPlayground(browser, base, { onRequest: (request) => rewriteRequests.push(request) });
    try {
      const settings = app.page.locator('#settings-panel');
      await app.page.locator('#settings-label').click();
      assert.equal(await settings.getAttribute('open'), '');

      // Focus the prompt without a mouse event (which would intentionally
      // dismiss the panel), then exercise the controller's document Escape path.
      await app.page.locator('#hero-input').focus();
      await app.page.keyboard.press('Escape');
      assert.equal(await settings.getAttribute('open'), null);
      assert.equal(await app.page.evaluate(() => globalThis.document.activeElement?.id), 'settings-label');

      await app.page.locator('#settings-label').click();
      assert.equal(await settings.getAttribute('open'), '');
      await app.page.locator('.hero__title').click();
      assert.equal(await settings.getAttribute('open'), null);

      await app.page.locator('#hero-input').fill(INPUT_TEXT);
      await app.page.evaluate(() => {
        const input = globalThis.document.querySelector('#hero-input');
        const event = new globalThis.KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Enter',
          isComposing: true,
        });
        Object.defineProperty(event, 'keyCode', { value: 229 });
        input.dispatchEvent(event);
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(rewriteRequests.length, 0, 'IME composition Enter must not submit');
      assert.equal(await app.page.locator('#app').getAttribute('data-view'), 'landing');
    } finally {
      await app.close();
    }
  });

  await t.test('Free, BYOK and Pro entrypoints work in a narrow viewport', async () => {
    const app = await openPlayground(browser, base, {
      viewport: { width: 390, height: 844 },
    });
    try {
      assert.equal(await app.page.evaluate(() => globalThis.innerWidth), 390);
      assert.equal(await app.page.locator('#tier').inputValue(), 'free');

      await app.page.locator('#price-free').click();
      assert.equal(await app.page.locator('#tier').inputValue(), 'free');
      assert.equal(await app.page.locator('#settings-panel').getAttribute('open'), null);

      await app.page.locator('#price-byok').click();
      assert.equal(await app.page.locator('#tier').inputValue(), 'byok');
      assert.equal(await app.page.locator('#byok-row').isHidden(), false);
      assert.equal(await app.page.evaluate(() => globalThis.document.activeElement?.id), 'api-key');
      await app.page.locator('#api-key').fill(FIXTURE_API_KEY);
      await submitHero(app.page);
      await eventually(async () => (await app.page.locator('[data-output-status="approved"]').count()) === 1);
      assert.equal(app.requests.at(-1)?.body.tier, 'byok');
      assert.equal(app.requests.at(-1)?.body.apiKey, FIXTURE_API_KEY);
      assert.equal(app.requests.at(-1)?.authorization, '');
      assert.equal(app.requests.at(-1)?.body.text, INPUT_TEXT);

      await app.page.locator('#home-link').click();
      await app.page.locator('#pro-existing').click();
      assert.equal(await app.page.locator('#tier').inputValue(), 'pro');
      assert.equal(await app.page.locator('#pro-row').isHidden(), false);
      assert.equal(await app.page.evaluate(() => globalThis.document.activeElement?.id), 'license-key');
      await app.page.locator('#license-key').fill(FIXTURE_LICENSE);
      await app.page.locator('#license-sign-in').click();
      assert.equal(await app.page.locator('#license-key').inputValue(), '');
      assert.equal(await app.page.locator('#license-sign-in').isHidden(), true);

      await app.page.keyboard.press('Escape');
      assert.equal(await app.page.locator('#settings-panel').getAttribute('open'), null);
      await submitHero(app.page);
      await eventually(async () => (await app.page.locator('[data-output-status="approved"]').count()) === 1);
      assert.equal(app.requests.at(-1)?.body.tier, 'pro');
      assert.equal(app.requests.at(-1)?.body.apiKey, undefined);
      assert.equal(app.requests.at(-1)?.authorization, `Bearer ${FIXTURE_LICENSE}`);
      assert.equal(app.requests.at(-1)?.body.text, INPUT_TEXT);
    } finally {
      await app.close();
    }
  });

  await t.test('accepted, below-floor, transmission-failure and cancellation states are visible and copy-safe', async (t) => {
    await t.test('accepted output exposes the approved copy action', async () => {
      const app = await openPlayground(browser, base, { scenario: 'accepted' });
      try {
        await submitHero(app.page);
        await eventually(async () => (await app.page.locator('[data-output-status="approved"]').count()) === 1);
        assert.equal(await text(app.page.locator('.msg--patina .msg__text').last()), OUTPUT_TEXT);
        const copy = app.page.locator('.msg--patina .output-action').first();
        assert.equal(await text(copy), 'Copy');
        await copy.click();
        await eventually(async () => (await text(copy)) === 'Copied');
      } finally {
        await app.close();
      }
    });

    await t.test('an intentionally bad accepted terminal is rejected below the floor', async () => {
      const app = await openPlayground(browser, base, { scenario: 'belowfloor' });
      try {
        await submitHero(app.page);
        await eventually(async () => (await app.page.locator('.msg__text--unapproved').count()) === 1);
        assert.equal(await app.page.locator('.msg--patina .output-actions').count(), 0);
        assert.match(await text(app.page.locator('.msg--patina .error-note').last()), /drifted too far/i);
        assert.notEqual(await app.page.locator('.msg--patina .msg__text').last().getAttribute('data-output-status'), 'approved');
      } finally {
        await app.close();
      }
    });

    await t.test('transmission failure stays unapproved and offers no copy action', async () => {
      const app = await openPlayground(browser, base, { scenario: 'transmissionfailure' });
      try {
        await submitHero(app.page);
        await eventually(async () => (await app.page.locator('.msg--patina .error-note').count()) === 1);
        assert.match(await text(app.page.locator('.msg--patina .error-note').last()), /temporarily unavailable/i);
        assert.equal(await app.page.locator('.msg--patina .output-actions').count(), 0);
      } finally {
        await app.close();
      }
    });

    await t.test('stop cancels an in-flight local stream and keeps the result unapproved', async () => {
      const app = await openPlayground(browser, base, { scenario: 'cancel' });
      try {
        await submitHero(app.page);
        await eventually(async () => (await app.page.locator('#send[aria-label="Stop"]').count()) === 1);
        await app.page.locator('#send[aria-label="Stop"]').click();
        await eventually(async () => (await app.page.locator('.msg--patina .error-note').count()) === 1);
        assert.match(await text(app.page.locator('.msg--patina .error-note').last()), /cancelled/i);
        assert.equal(await app.page.locator('.msg--patina .output-actions').count(), 0);
      } finally {
        await app.close();
      }
    });
  });
});
