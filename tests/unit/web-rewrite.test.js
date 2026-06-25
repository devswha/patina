// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWebConfig, resolveBundleRoot } from '../../src/web-config.js';
import { buildWebRewritePrompt, loadWebAssets, runWebRewrite } from '../../src/web-rewrite.js';

const repoRoot = resolveBundleRoot();
const languages = ['ko', 'en', 'zh', 'ja'];

function baseRequest(lang, overrides = {}) {
  return {
    mode: 'first',
    lang,
    tier: 'byok',
    text: `Draft text for ${lang} with generic AI phrasing.`,
    original: `Draft text for ${lang} with generic AI phrasing.`,
    history: [],
    provider: 'openai',
    model: 'gpt-5.1',
    baseURL: 'https://api.openai.com/v1',
    apiKey: `key-${lang}`,
    ...overrides,
  };
}

function configFor(lang) {
  const config = loadWebConfig({ repoRoot });
  config.language = lang;
  config.profile = 'default';
  return config;
}

test('runWebRewrite first-turn uses real patina assets for every supported language', async () => {
  for (const lang of languages) {
    const calls = [];
    const config = configFor(lang);
    const assets = loadWebAssets({ repoRoot, lang, profile: 'default', config });
    const profileToken = String(assets.profile.body).split(/\s+/).find((token) => token.length >= 4);
    const patternToken = String(assets.patterns[0].body).split(/\s+/).find((token) => token.length >= 4);
    assert.ok(profileToken);
    assert.ok(patternToken);

    const result = await runWebRewrite({
      request: baseRequest(lang),
      config,
      repoRoot,
      callLLM: async (options) => {
        calls.push(options);
        return '[BODY]Canned rewrite[/BODY]\n[SELF_AUDIT]ok[/SELF_AUDIT]';
      },
    });

    assert.equal(calls.length, 1, lang);
    assert.equal(result.rewrite, 'Canned rewrite');
    assert.match(calls[0].prompt, /## Pattern Packs/);
    assert.match(calls[0].prompt, /## Profile/);
    assert.ok(calls[0].prompt.includes(profileToken), `${lang} prompt missing profile token ${profileToken}`);
    assert.ok(calls[0].prompt.includes(patternToken), `${lang} prompt missing pattern token ${patternToken}`);
  }
});

test('refine prompt carries a TRUSTED directive outside the data fence, with anchor/draft/history fenced', () => {
  const config = configFor('en');
  const assets = loadWebAssets({ repoRoot, lang: 'en', profile: 'default', config });
  const prompt = buildWebRewritePrompt({
    request: baseRequest('en', {
      mode: 'refine',
      original: 'ORIGINAL ANCHOR: Keep this claim about June revenue.',
      text: 'LATEST DRAFT: Revenue improved in June.',
      history: [{ role: 'user', content: 'Make it warmer but preserve the numbers.' }],
    }),
    config,
    assets,
  });

  // The trusted refine directive must appear, and BEFORE the fenced Input Text,
  // so the model is not told (inside a treat-as-data fence) to ignore it.
  const directiveIdx = prompt.indexOf('Refine directive — trusted instruction');
  const inputTextIdx = prompt.indexOf('## Input Text');
  assert.ok(directiveIdx >= 0, 'trusted refine directive must be present');
  assert.ok(inputTextIdx >= 0, 'Input Text section must be present');
  assert.ok(directiveIdx < inputTextIdx, 'refine directive must precede the fenced Input Text (be trusted, not data)');

  // Anchor + draft + history are present...
  assert.ok(prompt.includes('ORIGINAL ANCHOR: Keep this claim about June revenue.'));
  assert.ok(prompt.includes('LATEST DRAFT: Revenue improved in June.'));
  assert.ok(prompt.includes('user: Make it warmer but preserve the numbers.'));
  assert.ok(prompt.includes('## Pattern Packs'));

  // ...and the original anchor + history sit inside treat-as-data fences (reference),
  // while the latest draft is the rewrite target under Input Text.
  const fence = '⟦⟦⟦PATINA_INPUT_DATA⟧⟧⟧';
  const fenceCount = prompt.split(fence).length - 1;
  assert.ok(fenceCount >= 6, 'expected anchor, history, and input-text fences (3 pairs)');
  // The latest draft must be the rewrite target: it appears after the Input Text heading.
  assert.ok(prompt.indexOf('LATEST DRAFT: Revenue improved in June.') > inputTextIdx, 'latest draft must be the Input Text rewrite target');
  // The original anchor appears before Input Text (as a fenced reference section).
  assert.ok(prompt.indexOf('ORIGINAL ANCHOR: Keep this claim about June revenue.') < inputTextIdx, 'original anchor must be a reference section, not the rewrite target');
});

test('loadWebAssets caches by language and profile', () => {
  const config = configFor('ja');
  const first = loadWebAssets({ repoRoot, lang: 'ja', profile: 'default', config });
  const second = loadWebAssets({ repoRoot, lang: 'ja', profile: 'default', config });
  assert.equal(second, first);
});

test('missing assets throw typed errors instead of returning a generic prompt', () => {
  const config = configFor('en');
  assert.throws(
    () => loadWebAssets({ repoRoot, lang: 'xx', profile: 'default', config }),
    (/** @type {any} */ err) => err?.name === 'PatinaCliError' && err?.exitCode === 2 && /pattern assets/.test(err.message),
  );
  assert.throws(
    () => loadWebAssets({ repoRoot, lang: 'en', profile: 'definitely-missing-profile', config }),
    (/** @type {any} */ err) => err?.name === 'PatinaCliError' && err?.exitCode === 2 && /assets could not be loaded/.test(err.message),
  );
});

test('runWebRewrite forwards BYOK provider options to callLLM', async () => {
  const request = baseRequest('ko', {
    apiKey: 'sk-test-forward',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  });
  const calls = [];
  const result = await runWebRewrite({
    request,
    config: configFor('ko'),
    repoRoot,
    signal: new AbortController().signal,
    timeout: 1234,
    callLLM: async (options) => {
      calls.push(options);
      return 'Plain canned rewrite';
    },
  });

  assert.equal(result.rewrite, 'Plain canned rewrite');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'sk-test-forward');
  assert.equal(calls[0].baseURL, 'https://api.openai.com/v1');
  assert.equal(calls[0].model, 'gpt-4.1-mini');
  assert.equal(calls[0].timeout, 1234);
  assert.ok(calls[0].signal);
});
