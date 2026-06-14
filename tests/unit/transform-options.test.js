import test from 'node:test';
import assert from 'node:assert';

import { parseArgs, validateTransformRequest, buildTransformVariants } from '../../src/cli/args.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import { buildPreviewHtml, diffWordSegments } from '../../src/preview.js';

const BASE = {
  config: { language: 'en', profile: 'default' },
  patterns: [],
  profile: null,
  voice: null,
  scoring: null,
  text: 'Sample body text for prompt construction.',
};

test('parseArgs accepts --restyle and --jargon values and rejects unknown ones', () => {
  const parsed = parseArgs(['--restyle', 'content', '--jargon', 'remove', 'draft.md']);
  assert.equal(parsed.restyle, 'content');
  assert.equal(parsed.jargon, 'remove');

  assert.equal(parseArgs(['--restyle', 'voice']).restyle, 'voice');
  assert.equal(parseArgs(['--restyle', 'sentence']).restyle, 'sentence');
  assert.equal(parseArgs(['--jargon', 'explain']).jargon, 'explain');

  assert.throws(() => parseArgs(['--restyle', 'rewrite-everything']), /unknown restyle depth/);
  assert.throws(() => parseArgs(['--jargon', 'simplify']), /unknown jargon policy/);
  assert.throws(() => parseArgs(['--restyle']), /restyle/i);
});

test('validateTransformRequest rejects non-rewrite modes only when a transform is active', () => {
  // Defaults (or explicit defaults) pass with every mode.
  validateTransformRequest({ score: true });
  validateTransformRequest({ ouroboros: true, restyle: 'sentence', jargon: 'keep' });

  // Active transform + non-rewrite mode is an input error.
  assert.throws(() => validateTransformRequest({ restyle: 'voice', score: true }), /--restyle cannot be combined with --score/);
  assert.throws(() => validateTransformRequest({ restyle: 'content', audit: true }), /--restyle cannot be combined with --audit/);
  assert.throws(() => validateTransformRequest({ jargon: 'remove', diff: true }), /--jargon cannot be combined with --diff/);
  assert.throws(() => validateTransformRequest({ restyle: 'content', ouroboros: true }), /--restyle cannot be combined with --ouroboros/);

  // Plain rewrite and preview are the supported surfaces.
  validateTransformRequest({ restyle: 'content', jargon: 'remove' });
  validateTransformRequest({ restyle: 'voice', preview: true });
});

test('strict rewrite prompt carries the transformation directive only when opted in', () => {
  const base = buildPrompt({ ...BASE, mode: 'rewrite' });
  assert.ok(!base.includes('Transformation Directive'));

  const explicitDefaults = buildPrompt({ ...BASE, mode: 'rewrite', restyle: 'sentence', jargon: 'keep' });
  assert.strictEqual(explicitDefaults, base);

  const voice = buildPrompt({ ...BASE, mode: 'rewrite', restyle: 'voice' });
  assert.ok(voice.includes('Transformation Directive'));
  assert.ok(voice.includes('Full voice transformation (--restyle voice)'));
  assert.ok(!voice.includes('Content-level re-planning'));

  const content = buildPrompt({ ...BASE, mode: 'rewrite', restyle: 'content', jargon: 'remove' });
  assert.ok(content.includes('Content-level re-planning (--restyle content)'));
  assert.ok(content.includes('Meaning-Preservation Score as advisory'));
  assert.ok(content.includes('Remove jargon (--jargon remove)'));

  const explain = buildPrompt({ ...BASE, mode: 'rewrite', jargon: 'explain' });
  assert.ok(explain.includes('Gloss technical terms (--jargon explain)'));
  assert.ok(!explain.includes('--restyle'));

  // The directive must come after the conservative rewrite instructions it
  // overrides, and before the input text.
  const directiveAt = content.indexOf('Transformation Directive');
  assert.ok(directiveAt > content.indexOf('## Instructions'));
  assert.ok(directiveAt < content.indexOf('## Input Text'));
});

test('non-rewrite strict prompts never carry the directive even if options leak through', () => {
  for (const mode of ['score', 'audit', 'diff']) {
    const prompt = buildPrompt({ ...BASE, mode, restyle: 'content', jargon: 'remove' });
    assert.ok(!prompt.includes('Transformation Directive'), `${mode} prompt must not carry the directive`);
  }
});

test('minimal rewrite prompt carries a localized directive', () => {
  const ko = buildPrompt({
    ...BASE,
    config: { language: 'ko', profile: 'default' },
    mode: 'rewrite',
    promptMode: 'minimal',
    restyle: 'content',
    jargon: 'remove',
  });
  assert.ok(ko.includes('변환 지시 (사용자 요청)'));
  assert.ok(ko.includes('컨텐츠 재기획 (--restyle content)'));
  assert.ok(ko.includes('개발 용어 제거 (--jargon remove)'));

  const en = buildPrompt({ ...BASE, mode: 'rewrite', promptMode: 'minimal', restyle: 'voice' });
  assert.ok(en.includes('Transformation Directive (user-requested)'));
  assert.ok(en.includes('Full voice transformation (--restyle voice)'));

  const minimalDefault = buildPrompt({ ...BASE, mode: 'rewrite', promptMode: 'minimal' });
  assert.ok(!minimalDefault.includes('Transformation Directive'));
});

test('parseArgs accepts comma lists for compare mode and dedupes them', () => {
  assert.equal(parseArgs(['--restyle', 'sentence,voice,content']).restyle, 'sentence,voice,content');
  assert.equal(parseArgs(['--restyle', 'voice, voice ,content']).restyle, 'voice,content');
  assert.equal(parseArgs(['--jargon', 'keep,remove']).jargon, 'keep,remove');
  assert.throws(() => parseArgs(['--restyle', 'voice,everything']), /unknown restyle depth everything/);
  assert.throws(() => parseArgs(['--restyle', ',,']), /--restyle expects a value/);
});

test('buildTransformVariants expands the cross product with labels and a cap', () => {
  assert.deepStrictEqual(buildTransformVariants({}), [{ restyle: 'sentence', jargon: 'keep', tone: null, label: 'cleanup' }]);
  assert.deepStrictEqual(buildTransformVariants({ restyle: 'sentence,voice', jargon: 'remove' }), [
    { restyle: 'sentence', jargon: 'remove', tone: null, label: 'remove' },
    { restyle: 'voice', jargon: 'remove', tone: null, label: 'voice+remove' },
  ]);
  assert.equal(buildTransformVariants({ restyle: 'sentence,voice,content' }).length, 3);
  // 3 restyles × 2 jargons = 6 > cap of 4.
  assert.throws(
    () => buildTransformVariants({ restyle: 'sentence,voice,content', jargon: 'keep,remove' }),
    /too many transform variants/
  );
});

test('tone joins the variant cross product with per-tone labels', () => {
  assert.equal(parseArgs(['--tone', 'casual,marketing']).tone, 'casual,marketing');
  assert.throws(() => parseArgs(['--tone', 'casual,shouty']), /unknown tone shouty/);

  // Single tone: carried on the variant, absent from the label.
  assert.deepStrictEqual(buildTransformVariants({ restyle: 'voice', tone: 'casual' }), [
    { restyle: 'voice', jargon: 'keep', tone: 'casual', label: 'voice' },
  ]);
  // Multiple tones: tone appears in every label.
  assert.deepStrictEqual(buildTransformVariants({ restyle: 'voice', tone: 'casual,professional' }), [
    { restyle: 'voice', jargon: 'keep', tone: 'casual', label: 'voice·casual' },
    { restyle: 'voice', jargon: 'keep', tone: 'professional', label: 'voice·professional' },
  ]);
  // Tone-only comparison: the tone IS the label.
  assert.deepStrictEqual(
    buildTransformVariants({ tone: 'casual,marketing' }).map((v) => v.label),
    ['casual', 'marketing']
  );
  // Tone multiplies into the cap: 2 restyles × 1 jargon × 3 tones = 6 > 4.
  assert.throws(
    () => buildTransformVariants({ restyle: 'sentence,voice', tone: 'casual,professional,marketing' }),
    /too many transform variants/
  );
  // Tone-only list still needs --preview, and the error names --tone.
  assert.throws(
    () => validateTransformRequest({ tone: 'casual,marketing' }),
    /comparing transform variants requires --preview/
  );
  assert.throws(
    () => validateTransformRequest({ tone: 'casual,marketing', preview: true, score: true }),
    /--tone cannot be combined with --score/
  );
  validateTransformRequest({ tone: 'casual,marketing', preview: true });
});

test('validateTransformRequest gates compare mode on --preview and rejects --ocr', () => {
  assert.throws(
    () => validateTransformRequest({ restyle: 'sentence,voice' }),
    /comparing transform variants requires --preview/
  );
  assert.throws(
    () => validateTransformRequest({ restyle: 'sentence,voice', preview: true, ocr: true }),
    /--ocr cannot be combined/
  );
  validateTransformRequest({ restyle: 'sentence,voice,content', preview: true });
  validateTransformRequest({ jargon: 'keep,remove', preview: true });
});

test('buildPreviewHtml bakes variants behind a scriptless two-level radio toggle', () => {
  const text = 'The original paragraph text is comfortably long enough for extraction.';
  const html = `<html><body><p>${text}</p></body></html>`;
  const start = html.indexOf(text);
  const blocks = [{ tag: 'p', start, end: start + text.length, raw: text, text }];
  const variants = [
    { label: 'cleanup', restyle: 'sentence', jargon: 'keep', tone: null, rewrites: ['Cleaned up paragraph text, still recognizably the same claim.'] },
    { label: 'voice+remove', restyle: 'voice', jargon: 'remove', tone: null, rewrites: ['Totally re-voiced paragraph for regular readers, same claim.'] },
  ];
  const { html: out, changedCount } = buildPreviewHtml({
    html, blocks, rewrites: variants[0].rewrites, variants, sourceUrl: 'https://example.com/',
  });

  assert.strictEqual(changedCount, 1);
  // Both variant texts are in the page, classed per variant.
  assert.ok(out.includes('class="ptna-after ptna-v1"'));
  assert.ok(out.includes('class="ptna-after ptna-v2"'));
  assert.ok(out.includes('Cleaned up paragraph text'));
  assert.ok(out.includes('Totally re-voiced paragraph'));
  // Depth radios exist, come after the view radios, first one checked; each
  // depth carries its own (checked) option radio.
  assert.ok(out.includes('id="ptna-d-1" class="ptna-toggle-input" checked'));
  assert.ok(out.includes('id="ptna-d-2"'));
  assert.ok(out.indexOf('id="ptna-d-1"') > out.indexOf('id="ptna-v-both"'));
  assert.ok(out.includes('name="ptna-opt-2" id="ptna-do-2-1" class="ptna-toggle-input" checked'));
  // Bar depth buttons carry the depth names; single-option depths render no
  // option chip row.
  assert.ok(out.includes('for="ptna-d-1">cleanup</label>'));
  assert.ok(out.includes('for="ptna-d-2">voice</label>'));
  assert.ok(!out.includes('ptna-opts-1"'));
  // Scriptless show rules chain view radio, depth radio, and option radio.
  assert.ok(out.includes('#ptna-v-rew:checked ~ #ptna-d-2:checked ~ #ptna-do-2-1:checked ~ * .ptna-blk .ptna-after.ptna-v2{display:inline !important;}'));
  assert.ok(out.includes('#ptna-v-both:checked ~ #ptna-d-1:checked ~ #ptna-do-1-1:checked ~ * .ptna-blk .ptna-after.ptna-v1{display:inline !important;}'));
  // No scripts sneak in — the toggle is CSS-only.
  assert.ok(!/<script\b/i.test(out));
});

test('depth buttons reveal per-depth option chips for tone/jargon variants', () => {
  const text = 'A paragraph long enough that four baked variants can rewrite it differently.';
  const html = `<html><body><p>${text}</p></body></html>`;
  const start = html.indexOf(text);
  const blocks = [{ tag: 'p', start, end: start + text.length, raw: text, text }];
  const variants = [
    { label: 'voice·casual', restyle: 'voice', jargon: 'keep', tone: 'casual', rewrites: ['Casual voiced paragraph rewritten in a relaxed register for everyone.'] },
    { label: 'voice·professional', restyle: 'voice', jargon: 'keep', tone: 'professional', rewrites: ['Professionally voiced paragraph rewritten in a formal register.'] },
    { label: 'content·casual', restyle: 'content', jargon: 'keep', tone: 'casual', rewrites: ['Re-planned casual paragraph with a different structure entirely.'] },
    { label: 'content·professional', restyle: 'content', jargon: 'keep', tone: 'professional', rewrites: ['Re-planned formal paragraph with a different structure entirely.'] },
  ];
  const { html: out } = buildPreviewHtml({
    html, blocks, rewrites: variants[0].rewrites, variants, sourceUrl: 'https://example.com/',
  });

  // Two depth buttons, each with a two-chip option row (tone names only).
  assert.ok(out.includes('for="ptna-d-1">voice</label>'));
  assert.ok(out.includes('for="ptna-d-2">content</label>'));
  assert.ok(out.includes('class="ptna-views ptna-opts ptna-opts-1"'));
  assert.ok(out.includes('class="ptna-views ptna-opts ptna-opts-2"'));
  assert.ok(out.includes('for="ptna-do-1-2">professional</label>'));
  assert.ok(out.includes('for="ptna-do-2-1">casual</label>'));
  // Option rows are hidden unless their depth is selected.
  assert.ok(out.includes('.ptna-opts{display:none !important;}'));
  assert.ok(out.includes('#ptna-d-2:checked ~ .ptna-bar .ptna-opts-2{display:inline-flex !important;}'));
  // content·professional is variant 4 under depth 2, option 2.
  assert.ok(out.includes('#ptna-v-rew:checked ~ #ptna-d-2:checked ~ #ptna-do-2-2:checked ~ * .ptna-blk .ptna-after.ptna-v4{display:inline !important;}'));
  // The diff view maps through the same three-radio chain.
  assert.ok(out.includes('#ptna-v-diff:checked ~ #ptna-d-1:checked ~ #ptna-do-1-2:checked ~ * .ptna-blk .ptna-diff.ptna-v2{display:inline !important;}'));
});

test('buildPreviewHtml counts a block as changed when ANY variant changes it', () => {
  const text = 'A second paragraph that only one variant decides to touch at all.';
  const html = `<html><body><p>${text}</p></body></html>`;
  const start = html.indexOf(text);
  const blocks = [{ tag: 'p', start, end: start + text.length, raw: text, text }];

  const untouched = buildPreviewHtml({
    html, blocks, rewrites: [text], sourceUrl: 'https://example.com/',
    variants: [
      { label: 'cleanup', rewrites: [text] },
      { label: 'voice', rewrites: [text] },
    ],
  });
  assert.strictEqual(untouched.changedCount, 0);
  assert.ok(!untouched.html.includes('class="ptna-blk"'));

  const oneTouched = buildPreviewHtml({
    html, blocks, rewrites: [text], sourceUrl: 'https://example.com/',
    variants: [
      { label: 'cleanup', rewrites: [text] },
      { label: 'voice', rewrites: ['A fully re-voiced second paragraph from the braver variant.'] },
    ],
  });
  assert.strictEqual(oneTouched.changedCount, 1);
  // The unchanged variant still renders its (original) text so the toggle
  // honestly shows "this variant left the block alone".
  assert.ok(oneTouched.html.includes(`class="ptna-after ptna-v1">${text}</span>`));
});

test('buildPreviewHtml single-variant output carries no variant chrome', () => {
  const text = 'Single variant paragraph long enough to extract and rewrite normally.';
  const html = `<html><body><p>${text}</p></body></html>`;
  const start = html.indexOf(text);
  const blocks = [{ tag: 'p', start, end: start + text.length, raw: text, text }];
  const { html: out } = buildPreviewHtml({
    html, blocks, rewrites: ['A normally rewritten single-variant paragraph, nothing else.'], sourceUrl: 'https://example.com/',
  });
  assert.ok(!out.includes('name="ptna-depth"'));
  assert.ok(!out.includes('ptna-variants'));
  assert.ok(!out.includes('ptna-v1'));
});

test('diffWordSegments aligns common words and merges del/ins runs', () => {
  assert.deepStrictEqual(diffWordSegments('the same text', 'the same text'), [
    { type: 'same', text: 'the same text' },
  ]);
  assert.deepStrictEqual(diffWordSegments('권장하는 tmux 기반 환경으로 시작합니다.', '권장 환경은 tmux 기반입니다.'), [
    { type: 'del', text: '권장하는' },
    { type: 'ins', text: '권장 환경은' },
    { type: 'same', text: 'tmux' },
    { type: 'del', text: '기반 환경으로 시작합니다.' },
    { type: 'ins', text: '기반입니다.' },
  ]);
  assert.deepStrictEqual(diffWordSegments('', 'all new words'), [{ type: 'ins', text: 'all new words' }]);
  assert.deepStrictEqual(diffWordSegments('all gone', ''), [{ type: 'del', text: 'all gone' }]);
  // Over the LCS cell cap: degrade to whole-text del+ins, never quadratic.
  const big = Array.from({ length: 210 }, (_, i) => `w${i}`).join(' ');
  const bigger = Array.from({ length: 210 }, (_, i) => `x${i}`).join(' ');
  const capped = diffWordSegments(big, bigger);
  assert.deepStrictEqual(capped.map((s) => s.type), ['del', 'ins']);
});

test('preview pages carry a word-level diff view behind a fourth radio', () => {
  const text = 'The quick brown fox jumps over the lazy dog tonight.';
  const html = `<html><body><p>${text}</p></body></html>`;
  const start = html.indexOf(text);
  const blocks = [{ tag: 'p', start, end: start + text.length, raw: text, text }];
  const { html: out } = buildPreviewHtml({
    html, blocks, sourceUrl: 'https://example.com/',
    rewrites: ['The quick red fox jumps over the lazy dog tonight.'],
  });
  // Fourth view radio + bar label.
  assert.ok(out.includes('id="ptna-v-diff"'));
  assert.ok(out.includes('for="ptna-v-diff">diff</label>'));
  // Word-level markup: only the changed token is marked.
  assert.ok(out.includes('<span class="ptna-diff">'));
  assert.ok(out.includes('<del class="ptna-w-del">brown</del>'));
  assert.ok(out.includes('<ins class="ptna-w-ins">red</ins>'));
  assert.ok(!out.includes('<del class="ptna-w-del">The quick'));
  // Show/hide rules for the diff view exist.
  assert.ok(out.includes('#ptna-v-diff:checked ~ * .ptna-blk .ptna-diff{display:inline !important;'));
  assert.ok(out.includes('#ptna-v-diff:checked ~ * .ptna-blk .ptna-after{display:none !important;}'));
});

test('variant compare pages carry one word-diff per variant', () => {
  const text = 'A paragraph that two variants will rewrite differently enough today.';
  const html = `<html><body><p>${text}</p></body></html>`;
  const start = html.indexOf(text);
  const blocks = [{ tag: 'p', start, end: start + text.length, raw: text, text }];
  const { html: out } = buildPreviewHtml({
    html, blocks, rewrites: [text], sourceUrl: 'https://example.com/',
    variants: [
      { label: 'cleanup', rewrites: ['A paragraph that two variants will rewrite slightly differently today.'] },
      { label: 'voice', rewrites: ['Completely re-voiced paragraph, rewritten beyond recognition today.'] },
    ],
  });
  assert.ok(out.includes('class="ptna-diff ptna-v1"'));
  assert.ok(out.includes('class="ptna-diff ptna-v2"'));
  // Per-variant show rule and the re-hide guard against the single-variant rule.
  assert.ok(out.includes('#ptna-v-diff:checked ~ #ptna-d-2:checked ~ #ptna-do-2-1:checked ~ * .ptna-blk .ptna-diff.ptna-v2{display:inline !important;}'));
  assert.ok(out.includes('#ptna-v-diff:checked ~ * .ptna-blk .ptna-diff{display:none !important;}'));
});