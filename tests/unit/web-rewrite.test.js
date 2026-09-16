// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWebConfig, resolveBundleRoot } from '../../src/web-config.js';
import { buildDocumentSignals } from '../../src/features/document-signals.js';
import { buildWebRewritePrompt, loadWebAssets, runWebRewrite } from '../../src/web-rewrite.js';
import { WEB_PERSONAS } from '../../src/web-rewrite-contract.js';
import { classifyWebPromptBudget, resolveWebPromptBudget } from '../../src/web-prompt-budget.js';
import { buildKoreanDiagnosis, serializeKoreanDiagnosis } from '../../src/features/korean-diagnosis.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
    // validateRewriteRequest always emits these three, so the fixture carries
    // them too and cannot drift into a shape the real contract never produces.
    persona: undefined,
    documentType: 'default',
    register: undefined,
    ...overrides,
  };
}

function configFor(lang) {
  const config = loadWebConfig({ repoRoot });
  config.language = lang;
  config.documentType = 'default';
  return config;
}

test('web prompt budget only classifies an explicit low-risk first turn as minimal', () => {
  const lowRisk = baseRequest('en', { text: 'Welcome home.', original: 'Welcome home.' });
  assert.deepEqual(classifyWebPromptBudget(lowRisk), { selected: 'minimal', reason: 'eligible' });

  const strictCases = /** @type {Array<[Record<string, unknown>, string]>} */ ([
    [{ ...lowRisk, mode: 'refine' }, 'not_first_turn'],
    [{ ...lowRisk, lang: 'unknown' }, 'unsupported_language'],
    [{ ...lowRisk, text: '   ' }, 'invalid_text'],
    [{ ...lowRisk, text: 'First paragraph.\nSecond paragraph.' }, 'multiple_blocks'],
    [{ ...lowRisk, text: 'a'.repeat(201) }, 'text_too_long'],
    [{ ...lowRisk, documentType: 'article' }, 'non_default_document_type'],
    [{ ...lowRisk, persona: 'blog-essay' }, 'persona_or_register'],
    [{ ...lowRisk, register: 'professional' }, 'persona_or_register'],
    [{ ...lowRisk, jargon: 'remove' }, 'transformation_options'],
    [{ ...lowRisk, rewriteHeadings: true }, 'transformation_options'],
    [{ ...lowRisk, rewriteHeadings: 'keep' }, 'transformation_options'],
    [{ ...lowRisk, tone: 'keep' }, 'transformation_options'],
    [{ ...lowRisk, history: [{ role: 'user', content: 'change it' }] }, 'unexpected_context'],
    [{ ...lowRisk, history: 'invalid' }, 'unexpected_context'],
    [{ ...lowRisk, original: 'Different anchor.' }, 'unexpected_context'],
    [{ ...lowRisk, original: 42 }, 'unexpected_context'],
    [{ ...lowRisk, text: 'We shipped 3 units.' }, 'number_date_or_percent'],
    [{ ...lowRisk, text: 'The rate is 10 percent.' }, 'number_date_or_percent'],
    [{ ...lowRisk, text: 'The launch is in June.' }, 'number_date_or_percent'],
    [{ ...lowRisk, text: '안 됩니다.' }, 'negation_or_polarity'],
    [{ ...lowRisk, text: '这不是答案。' }, 'negation_or_polarity'],
    [{ ...lowRisk, text: 'これはありません。' }, 'negation_or_polarity'],
    [{ ...lowRisk, text: 'The service failed because capacity ran out.' }, 'causation'],
    [{ ...lowRisk, text: '수요 때문에 가격이 올랐습니다.' }, 'causation'],
    [{ ...lowRisk, text: '因为降雨，所以活动取消了。' }, 'causation'],
    [{ ...lowRisk, text: '雨のため、イベントは中止です。' }, 'causation'],
    [{ ...lowRisk, text: 'One claim. Another claim.' }, 'multiple_claims'],
    [{ ...lowRisk, text: 'Welcome and enjoy.' }, 'multiple_claims'],
  ]);
  for (const [candidate, reason] of strictCases) {
    assert.deepEqual(classifyWebPromptBudget(candidate), { selected: 'strict', reason }, reason);
  }
});

test('web prompt budget defaults invalid policy to off and only active applies minimal', () => {
  const request = baseRequest('en', { text: 'Welcome home.', original: 'Welcome home.' });
  assert.deepEqual(resolveWebPromptBudget(request, {}), {
    policy: 'off', selected: 'minimal', applied: 'strict', reason: 'eligible',
  });
  assert.deepEqual(resolveWebPromptBudget(request, { PATINA_WEB_PROMPT_BUDGET: 'invalid' }), {
    policy: 'off', selected: 'minimal', applied: 'strict', reason: 'eligible',
  });
  assert.deepEqual(resolveWebPromptBudget(request, { PATINA_WEB_PROMPT_BUDGET: 'shadow' }), {
    policy: 'shadow', selected: 'minimal', applied: 'strict', reason: 'eligible',
  });
  assert.deepEqual(resolveWebPromptBudget(request, { PATINA_WEB_PROMPT_BUDGET: 'active' }), {
    policy: 'active', selected: 'minimal', applied: 'minimal', reason: 'eligible',
  });
});

test('web rewrite prompt applies minimal only when requested and refine remains strict', () => {
  const config = configFor('en');
  const assets = loadWebAssets({ repoRoot, lang: 'en', documentType: 'default', config });
  const first = baseRequest('en', { text: 'Welcome home.', original: 'Welcome home.' });
  const strict = buildWebRewritePrompt({ request: first, config, assets });
  const minimal = buildWebRewritePrompt({ request: first, config, assets, promptMode: 'minimal' });
  assert.notEqual(minimal, strict);
  assert.doesNotMatch(minimal, /## Pattern Packs/);
  assert.doesNotMatch(minimal, /5–8 words|20\+ words/);
  assert.match(minimal, /Do not force a short input to expand/);
  assert.match(strict, /## Pattern Packs/);

  const refine = buildWebRewritePrompt({
    request: { ...first, mode: 'refine', original: 'Welcome home.', history: [] },
    config,
    assets,
    promptMode: 'minimal',
  });
  assert.match(refine, /## Pattern Packs/);
});

test('runWebRewrite first-turn uses real patina assets for every supported language', async () => {
  for (const lang of languages) {
    const calls = [];
    const config = configFor(lang);
    const assets = loadWebAssets({ repoRoot, lang, documentType: 'default', config });
    const documentTypeToken = String(assets.documentType.frontmatter?.name);
    const patternToken = String(assets.patterns[0].body).split(/\s+/).find((token) => token.length >= 4);
    assert.notEqual(documentTypeToken, 'undefined');
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
    assert.match(calls[0].prompt, /## Document Policy/);
    assert.equal(assets.persona, null, `${lang} default web rewrite must preserve source voice`);
    assert.ok(calls[0].prompt.includes(documentTypeToken), `${lang} prompt missing Document Type token ${documentTypeToken}`);
    assert.ok(calls[0].prompt.includes(patternToken), `${lang} prompt missing pattern token ${patternToken}`);
  }
});

test('ko web rewrite preserves source voice when Persona is omitted', () => {
  const config = configFor('ko');
  const assets = loadWebAssets({ repoRoot, lang: 'ko', documentType: 'default', config });
  assert.equal(assets.persona, null);
  const prompt = buildWebRewritePrompt({ request: baseRequest('ko'), config, assets });
  assert.doesNotMatch(prompt, /페르소나:/);
});

test('en/zh/ja web rewrite stays Persona-free by default', () => {
  for (const lang of ['en', 'zh', 'ja']) {
    const config = configFor(lang);
    const assets = loadWebAssets({ repoRoot, lang, documentType: 'default', config });
    assert.equal(assets.persona, null, `${lang} web assets must be Persona-free`);
    const prompt = buildWebRewritePrompt({ request: baseRequest(lang), config, assets });
    assert.doesNotMatch(prompt, /Persona:/);
  }
});

test('WEB_PERSONAS offers only bundled personas (curated set stays in sync with personas/)', () => {
  for (const lang of Object.keys(WEB_PERSONAS)) {
    for (const p of WEB_PERSONAS[lang]) {
      const file = join(repoRoot, 'personas', lang, `${p.id}.md`);
      assert.ok(existsSync(file), `WEB_PERSONAS.${lang} offers ${p.id} but ${file} is missing from the bundle`);
    }
  }
});

test('loadWebAssets resolves an explicit request persona for any language (opt-in voice)', () => {
  // en defaults to source-voice preservation; an explicit offered voice loads
  // that Persona, matching CLI --persona.
  const config = configFor('en');
  const assets = loadWebAssets({ repoRoot, lang: 'en', documentType: 'default', config, personaId: 'blog-essay' });
  assert.ok(assets.persona, 'explicit persona must resolve');
  assert.equal(assets.persona.id, 'blog-essay');
  const prompt = buildWebRewritePrompt({ request: baseRequest('en', { persona: 'blog-essay' }), config, assets });
  assert.match(prompt, /Persona: .* \(blog-essay\)/);
});

test('refine prompt carries a TRUSTED directive outside the data fence, with anchor/draft/history fenced', () => {
  const config = configFor('en');
  const assets = loadWebAssets({ repoRoot, lang: 'en', documentType: 'default', config });
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

test('loadWebAssets caches by language and Document Type', () => {
  const config = configFor('ja');
  const first = loadWebAssets({ repoRoot, lang: 'ja', documentType: 'default', config });
  const second = loadWebAssets({ repoRoot, lang: 'ja', documentType: 'default', config });
  assert.equal(second, first);
});

test('missing assets throw typed errors instead of returning a generic prompt', () => {
  const config = configFor('en');
  assert.throws(
    () => loadWebAssets({ repoRoot, lang: 'xx', documentType: 'default', config }),
    (/** @type {any} */ err) => err?.name === 'PatinaCliError' && err?.exitCode === 2 && /pattern assets/.test(err.message),
  );
  assert.throws(
    () => loadWebAssets({ repoRoot, lang: 'en', documentType: 'definitely-missing-document-type', config }),
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

test('hosted first-turn and refine prompts receive CLI Korean documentSignals', async () => {
  const text = '주제만 주면 한 세트가 나옵니다. 직접 디자인할 필요가 없습니다. 캐러셀을 완성합니다. 바로 시작합니까?';
  const { signals } = buildDocumentSignals({ text, lang: 'ko' });
  assert.equal(signals.length, 1);
  const config = configFor('ko');
  const assets = loadWebAssets({ repoRoot, lang: 'ko', documentType: 'default', config });
  const firstPrompt = buildWebRewritePrompt({
    request: baseRequest('ko', { text, original: text }),
    config,
    assets,
    documentSignals: signals,
  });
  assert.ok(firstPrompt.includes('## Document Signals (deterministic measurements)'));
  assert.ok(firstPrompt.includes(signals[0]));

  const refinePrompt = buildWebRewritePrompt({
    request: baseRequest('ko', {
      mode: 'refine',
      text,
      original: text,
      history: [{ role: 'user', content: '조금 더 짧게.' }],
    }),
    config,
    assets,
    documentSignals: signals,
  });
  assert.ok(refinePrompt.includes(signals[0]));

  let seen = '';
  await runWebRewrite({
    request: baseRequest('ko', { text, original: text }),
    config,
    repoRoot,
    callLLM: async ({ prompt }) => {
      seen = prompt;
      return '한 세트가 나옵니다.';
    },
  });
  assert.ok(seen.includes(signals[0]), 'runWebRewrite must inject the shared Korean signals');
});

test('hosted rewrite prompts keep non-Korean documentSignals empty', async () => {
  const text = 'Welcome home. This draft is English only. It has no Korean endings.';
  for (const lang of ['en', 'zh', 'ja']) {
    assert.deepEqual(buildDocumentSignals({ text, lang }).signals, []);
    const config = configFor(lang);
    const assets = loadWebAssets({ repoRoot, lang, documentType: 'default', config });
    const prompt = buildWebRewritePrompt({
      request: baseRequest(lang, { text, original: text }),
      config,
      assets,
      documentSignals: buildDocumentSignals({ text, lang }).signals,
    });
    assert.doesNotMatch(prompt, /Document Signals|문서 신호/);
  }

  let seen = '';
  await runWebRewrite({
    request: baseRequest('en', { text, original: text }),
    config: configFor('en'),
    repoRoot,
    callLLM: async ({ prompt }) => {
      seen = prompt;
      return 'Welcome home.';
    },
  });
  assert.doesNotMatch(seen, /Document Signals|문서 신호/);
});

test('Korean web prompt carries the bounded deterministic diagnosis', () => {
  // Given: a Korean paragraph with a paragraph-attributed translationese signal.
  const text = '결과는 담당자에 의해 검토된다. 일정은 운영팀에 의해 다시 조정된다.';
  const request = baseRequest('ko', { text, original: text });
  const config = configFor('ko');
  const assets = loadWebAssets({ repoRoot, lang: 'ko', documentType: 'default', config });
  const diagnosis = buildKoreanDiagnosis(text, { repoRoot });

  // When: the hosted prompt is built with the diagnosis.
  const prompt = buildWebRewritePrompt({
    request,
    config,
    assets,
    documentSignals: [serializeKoreanDiagnosis(diagnosis)],
  });

  // Then: the machine-consumed diagnosis is present without source text.
  assert.ok(prompt.includes(serializeKoreanDiagnosis(diagnosis)));
  assert.equal(serializeKoreanDiagnosis(diagnosis).includes('담당자'), false);
});

test('runWebRewrite does not bypass the model for detector-clean Korean prose', async () => {
  // Given: Korean prose outside the deterministic detector's known signals.
  const text = '창문을 열자 빗소리가 가까워졌다. 잠시 뒤 골목이 조용해졌다.';
  let calls = 0;

  // When: the shipping hosted rewrite runs without the research flag.
  const result = await runWebRewrite({
    request: baseRequest('ko', { text, original: text }),
    config: configFor('ko'),
    repoRoot,
    callLLM: async () => {
      calls += 1;
      return '창문을 여니 빗소리가 한층 가까워졌다. 이내 골목은 다시 조용해졌다.';
    },
  });

  // Then: detector silence never certifies a no-op.
  assert.equal(result.rewrite, '창문을 여니 빗소리가 한층 가까워졌다. 이내 골목은 다시 조용해졌다.');
  assert.equal(calls, 1);
});
