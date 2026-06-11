import test from 'node:test';
import assert from 'node:assert';

import {
  fetchPreviewPage,
  extractProseBlocks,
  alignRewrites,
  buildPreviewHtml,
  buildFilePreviewHtml,
  harvestStreamOps,
  resolveStreamedHtml,
  prepareSnapshotHtml,
  inlineSrcdocIframes,
} from '../../src/preview.js';

const LONG_KO = '이 문장은 미리보기 추출 테스트를 위한 충분히 긴 한국어 단락입니다.';
const LONG_EN = 'This paragraph is comfortably long enough to pass the prose threshold.';

test('extractProseBlocks picks plain-text prose blocks and skips unsafe regions', () => {
  const html = [
    '<html><head><title>Ignored title that is long enough to match</title>',
    `<script type="application/json">{"html":"<p>${LONG_EN} inside script</p>"}</script>`,
    '</head><body>',
    `<p>${LONG_KO}</p>`,
    '<p>short</p>',
    `<h2>${LONG_EN}</h2>`,
    `<p>Has <strong>inline</strong> markup so the v1 walker must leave it alone entirely.</p>`,
    `<!-- <p>${LONG_EN} inside comment</p> -->`,
    `<li>12,345 · 67% · ★★★</li>`,
    `<p>Entity &amp; spacing\n  test paragraph that is long enough to qualify.</p>`,
    '</body></html>',
  ].join('\n');

  const { blocks, truncated } = extractProseBlocks(html);
  assert.strictEqual(truncated, false);
  assert.deepStrictEqual(blocks.map((b) => b.tag), ['p', 'h2', 'p', 'p']);
  assert.strictEqual(blocks[0].text, LONG_KO);
  assert.strictEqual(blocks[1].text, LONG_EN);
  // Inline-formatting blocks are extracted with their text flattened.
  assert.strictEqual(blocks[2].text, 'Has inline markup so the v1 walker must leave it alone entirely.');
  assert.ok(blocks[2].raw.includes('<strong>'));
  assert.strictEqual(blocks[3].text, 'Entity & spacing test paragraph that is long enough to qualify.');
  // Offsets point at the raw inner content.
  assert.strictEqual(html.slice(blocks[0].start, blocks[0].end), LONG_KO);
});

test('extractProseBlocks recovers prose nested in rejected containers', () => {
  const html = [
    `<li><a href="/x">a navigation item that is long enough to look like prose</a></li>`,
    `<p>Real prose with an inline <a href="/y">link</a> embedded inside it stays extractable.</p>`,
    `<li>outer text with nested list <ul><li>${LONG_EN}</li></ul></li>`,
    `<li><p>${LONG_KO}</p></li>`,
    `<blockquote><p>A quoted paragraph long enough to clear the threshold easily.</p></blockquote>`,
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  // Rejecting an outer block must not consume the prose inside it: the inner
  // list item, the li > p paragraph (markdown loose lists), and the quoted
  // paragraph are all recovered. The outer li's own mixed text stays out.
  assert.deepStrictEqual(blocks.map((b) => b.text), [
    'Real prose with an inline link embedded inside it stays extractable.',
    LONG_EN,
    LONG_KO,
    'A quoted paragraph long enough to clear the threshold easily.',
  ]);
  // Offsets still point at the recovered inner content.
  for (const block of blocks) {
    assert.strictEqual(html.slice(block.start, block.end), block.raw);
  }
});

test('extractProseBlocks keeps short single-link blocks out but keeps whole-card anchors', () => {
  const card = '카드 전체가 하나의 링크로 감싸인 충분히 긴 제목과 설명 텍스트입니다. 팔십 자를 확실히 넘기도록 조금 더 길게 적어 실제 본문으로 인정받게 만들어 줍니다.';
  const html = [
    `<li><a href="/about">a navigation item that is long enough to look like prose</a></li>`,
    `<p><a href="/item/1">${card}</a></p>`,
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  assert.deepStrictEqual(blocks.map((b) => b.text), [card]);
});

test('extractProseBlocks strips invisible comments instead of dropping the prose', () => {
  // Comments are invisible, so a comment inside a paragraph (React SSR text
  // separators, hydration markers, leftover Suspense markers) must neither
  // drop the block nor leak into its text — and a comment carrying a
  // terminator-looking token must not truncate the block (finding: comment
  // not skipped by the block-end scan).
  const html = [
    `<p>React SSR splits adjacent text nodes <!-- -->with empty comments that carry no structure.</p>`,
    `<p>Hydration markers <!-- marker --> stay out of the text but keep the block, long enough here.</p>`,
    `<p>A stray close in a comment <!-- </p> --> must not truncate this paragraph at all here.</p>`,
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  assert.deepStrictEqual(blocks.map((b) => b.text), [
    'React SSR splits adjacent text nodes with empty comments that carry no structure.',
    'Hydration markers stay out of the text but keep the block, long enough here.',
    'A stray close in a comment must not truncate this paragraph at all here.',
  ]);
  // The stored raw is still the exact source slice (lossless swap).
  for (const block of blocks) assert.strictEqual(html.slice(block.start, block.end), block.raw);
});

test('extractProseBlocks handles HTML5 optional end tags (li, p)', () => {
  const html = [
    '<ul><li>첫 번째 목록 항목은 닫는 태그 없이도 추출되어야 하는 본문입니다',
    '<li>두 번째 목록 항목도 닫는 태그 없이 다음 항목에서 끝납니다 이렇게</ul>',
    `<p>닫는 태그가 생략된 문단은 다음 블록 요소가 열릴 때 끝납니다 여기까지<div>after</div>`,
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  assert.deepStrictEqual(blocks.map((b) => b.tag), ['li', 'li', 'p']);
  for (const block of blocks) {
    assert.strictEqual(html.slice(block.start, block.end), block.raw);
  }
  assert.ok(blocks[2].text.startsWith('닫는 태그가 생략된 문단'));
});

test('extractProseBlocks never truncates a block at a tag token inside an attribute value', () => {
  // The terminator/opener scan must skip quoted attribute values. A block
  // opener-like substring (<hr>, </div>) inside an inline child's attribute,
  // or a '>' inside the block's own opening tag, must not move the computed
  // block boundary into the middle of an attribute (which the in-place swap
  // would then splice and corrupt).
  const endSide = '<p>This paragraph is clearly long enough to be real prose and ends here <a data-icon="<hr>" href="/x">link</a> and this tail must stay inside.</p>';
  const e = extractProseBlocks(endSide).blocks;
  assert.ok(e.length === 0 || (e[0].raw.includes('this tail must stay inside') && endSide.slice(e[0].start, e[0].end) === e[0].raw));

  const closeInAttr = '<div>product copy that is plenty long for prose here <a title="close with </div> tag">x</a> trailing text stays.</div>';
  const c = extractProseBlocks(closeInAttr).blocks;
  assert.ok(c.length === 0 || (c[0].raw.includes('trailing text stays') && closeInAttr.slice(c[0].start, c[0].end) === c[0].raw));

  const startSide = `<div data-state='{"label":"a > b"}'>Leaf div body copy that is comfortably long enough to register as prose content.</div>`;
  const s = extractProseBlocks(startSide).blocks;
  assert.strictEqual(s.length, 1);
  assert.ok(s[0].text.startsWith('Leaf div body copy'));
  assert.strictEqual(startSide.slice(s[0].start, s[0].end), s[0].raw);
});

test('extractProseBlocks splices cleanly when a block contains a tag-token in an attribute', () => {
  const html = '<div title="a>b" class="x">Long enough prose text content here for the threshold.</div>';
  const { blocks } = extractProseBlocks(html);
  assert.strictEqual(blocks.length, 1);
  const { html: out } = buildPreviewHtml({ html, blocks, rewrites: ['REWRITTEN'], sourceUrl: 'https://t/' });
  // The opening <div> tag and its attributes stay intact; the overlay span is
  // never spliced inside the attribute value.
  assert.ok(out.includes('<div title="a>b" class="x">'));
  assert.ok(out.includes('<span class="ptna-after">REWRITTEN</span>'));
});

test('extractProseBlocks recovers the first paragraph of a loose list (p closed by li)', () => {
  const html = '<ul><li><p>First list paragraph that is clearly long enough to count as prose here'
    + '<li><p>Second list paragraph that is clearly long enough as well to count</ul>';
  const { blocks } = extractProseBlocks(html);
  assert.strictEqual(blocks.length, 2);
  assert.ok(blocks[0].text.startsWith('First list paragraph'));
  assert.ok(blocks[1].text.startsWith('Second list paragraph'));
});

test('extractProseBlocks keeps prose tags over container divs at the block cap', () => {
  const cards = Array.from({ length: 110 }, (_, i) =>
    `<div>card title number ${i} that is long enough here</div><div>badge copy long enough here ${i}</div>`).join('');
  const paras = Array.from({ length: 5 }, (_, i) =>
    `<p>Real article paragraph number ${i} that is clearly long enough to be prose content</p>`).join('');
  const { blocks, truncated } = extractProseBlocks(cards + paras, { maxBlocks: 200 });
  assert.strictEqual(truncated, true);
  // All five real <p> paragraphs survive the cap; junk divs are dropped first.
  assert.strictEqual(blocks.filter((b) => b.tag === 'p').length, 5);
  // Document order is preserved for the reverse-order swap.
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i - 1].start <= blocks[i].start);
});

test('extractProseBlocks extracts leaf div/section copy and skips chrome containers', () => {
  const html = [
    '<div class="hero"><div><div>가장 안쪽 리프 디브에 들어있는 충분히 긴 본문 카피입니다.</div></div></div>',
    '<section>섹션이 직접 들고 있는 충분히 긴 설명 문장도 추출 대상입니다.</section>',
    '<nav><div>내비게이션 안의 충분히 긴 메뉴 텍스트는 추출하지 않습니다 절대로</div></nav>',
    '<button><div>버튼 레이블의 충분히 긴 텍스트도 추출하지 않습니다 클릭하세요</div></button>',
    '<table><tr><td>표 셀 안의 충분히 긴 데이터 텍스트도 추출하지 않습니다 그대로</td></tr></table>',
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  assert.deepStrictEqual(blocks.map((b) => [b.tag, b.text]), [
    ['div', '가장 안쪽 리프 디브에 들어있는 충분히 긴 본문 카피입니다.'],
    ['section', '섹션이 직접 들고 있는 충분히 긴 설명 문장도 추출 대상입니다.'],
  ]);
});

test('extractProseBlocks reports truncation at the block cap', () => {
  const html = Array.from({ length: 5 }, (_, i) => `<p>${LONG_EN} number ${i}</p>`).join('');
  const { blocks, truncated } = extractProseBlocks(html, { maxBlocks: 3 });
  assert.strictEqual(blocks.length, 3);
  assert.strictEqual(truncated, true);
});

test('alignRewrites maps paragraphs 1:1 and falls back to LCS hunks on mismatch', () => {
  const blocks = [{ text: 'one' }, { text: 'two' }];
  assert.deepStrictEqual(alignRewrites(blocks, 'ONE\n\nTWO'), { rewrites: ['ONE', 'TWO'], unalignedCount: 0 });

  // Model merged both paragraphs: unpairable hunk keeps the original text.
  assert.deepStrictEqual(
    alignRewrites(blocks, 'merged into a single paragraph'),
    { rewrites: ['one', 'two'], unalignedCount: 2 },
  );

  // Mixed: an unchanged block anchors the LCS; inside the unequal hunk the
  // changed block pairs by bigram similarity and the surplus paragraph drops.
  const mixed = [{ text: 'same anchor paragraph' }, { text: 'the old text body' }, { text: 'tail anchor' }];
  assert.deepStrictEqual(
    alignRewrites(mixed, 'same anchor paragraph\n\nthe new text body\n\ncompletely unrelated insertion 12345\n\ntail anchor'),
    { rewrites: ['same anchor paragraph', 'the new text body', 'tail anchor'], unalignedCount: 0 },
  );

  // Whole-page rewrite with merged paragraphs: similarity pairing still maps
  // most blocks, dissimilar ones keep the original.
  const wide = [{ text: '프롬프트를 어떻게 써야 할지 막막합니다' }, { text: '크레딧만 날리고 결과물이 없어요' }, { text: 'HYPERREAL' }];
  const out = alignRewrites(wide, '프롬프트를 뭐라고 입력해야 할지 모르겠어요\n\n크레딧을 다 써도 마음에 드는 게 없어요');
  assert.strictEqual(out.rewrites[0], '프롬프트를 뭐라고 입력해야 할지 모르겠어요');
  assert.strictEqual(out.rewrites[1], '크레딧을 다 써도 마음에 드는 게 없어요');
  assert.strictEqual(out.rewrites[2], 'HYPERREAL');
  assert.strictEqual(out.unalignedCount, 1);
});

test('buildPreviewHtml swaps rewrites in place and hardens the snapshot', () => {
  const html = [
    '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>',
    '<body onload="boom()">',
    '<script>window.hydrate()</script>',
    '<a href="javascript:alert(1)">link</a>',
    `<p>${LONG_KO}</p>`,
    `<p>${LONG_EN}</p>`,
    '</body></html>',
  ].join('\n');
  const { blocks } = extractProseBlocks(html);
  assert.strictEqual(blocks.length, 2);

  const { html: out, changedCount } = buildPreviewHtml({
    html,
    blocks,
    rewrites: ['고쳐 쓴 <문장> 입니다', LONG_EN],
    sourceUrl: 'https://example.test/page',
    explanationHtml: '<article class="explain-card">note body</article>',
    scoreChip: 'score 42 → 17',
  });

  assert.strictEqual(changedCount, 1);
  // Changed block: escaped rewrite + raw original behind the toggle.
  assert.ok(out.includes('<span class="ptna-blk" id="ptna-1" data-n="1">'));
  assert.ok(out.includes('<span class="ptna-after">고쳐 쓴 &lt;문장&gt; 입니다</span>'));
  assert.ok(out.includes(`<span class="ptna-before">${LONG_KO}</span>`));
  // Unchanged block left untouched.
  assert.ok(out.includes(`<p>${LONG_EN}</p>`));
  // Snapshot hardening.
  assert.ok(!out.includes('window.hydrate'));
  assert.ok(!out.includes('onload='));
  assert.ok(!out.includes('javascript:alert'));
  // The page's own permissive CSP is removed and replaced by patina's
  // restrictive one (no scripts, no sub-frames; passive resources allowed).
  assert.ok(!out.includes('default-src *'));
  assert.ok(out.includes("default-src 'none'"));
  assert.ok(out.includes("frame-src 'none'"));
  assert.ok(out.includes('img-src * data: blob:'));
  // Overlay chrome: three view states, notes panel, score chip.
  assert.ok(out.includes('<base href="https://example.test/page">'));
  assert.ok(out.includes('id="ptna-style"'));
  assert.ok(out.includes('id="ptna-v-rew"'));
  assert.ok(out.includes('id="ptna-v-orig"'));
  assert.ok(out.includes('id="ptna-v-both"'));
  assert.ok(out.includes('1 of 2 blocks rewritten'));
  assert.ok(out.includes('href="#ptna-1"'));
  assert.ok(out.includes('<details class="ptna-notes">'));
  assert.ok(out.includes('note body'));
  assert.ok(out.includes('score 42 → 17'));
});

test('buildFilePreviewHtml renders LCS hunks in one document without count alignment', () => {
  const original = `intro stays exactly the same here\n\n${LONG_KO}\n\nclosing line also stays the same`;
  // Model merged two thoughts into one paragraph — counts differ, still fine.
  const rewritten = `intro stays exactly the same here\n\n고쳐 쓴 문장입니다\n\n덧붙인 문장입니다\n\nclosing line also stays the same`;

  const { html: out, changedCount } = buildFilePreviewHtml({
    originalText: original,
    rewrittenText: rewritten,
    sourcePath: '/tmp/draft.md',
    explanationHtml: '<article class="explain-card">why card</article>',
    scoreChip: 'score 60 → 12',
  });

  assert.strictEqual(changedCount, 1);
  assert.ok(out.includes('Content-Security-Policy'));
  assert.ok(out.includes('Source: /tmp/draft.md'));
  assert.ok(out.includes('intro stays exactly the same here'));
  assert.ok(out.includes('<span class="ptna-after">고쳐 쓴 문장입니다\n\n덧붙인 문장입니다</span>'));
  assert.ok(out.includes(`<span class="ptna-before">${LONG_KO}</span>`));
  assert.ok(out.includes('id="ptna-v-both"'));
  assert.ok(out.includes('1 change(s)') || out.includes('1 of'));
  assert.ok(out.includes('why card'));
  assert.ok(out.includes('score 60 → 12'));
});

test('buildPreviewHtml keeps an existing base tag and omits the toggle when nothing changed', () => {
  const html = `<html><head><base href="https://keep.test/"></head><body><p>${LONG_EN}</p></body></html>`;
  const { blocks } = extractProseBlocks(html);
  const { html: out, changedCount } = buildPreviewHtml({
    html,
    blocks,
    rewrites: [LONG_EN],
    sourceUrl: 'https://other.test/',
  });
  assert.strictEqual(changedCount, 0);
  assert.ok(out.includes('href="https://keep.test/"'));
  assert.ok(!out.includes('href="https://other.test/"'));
  assert.ok(!out.includes('id="ptna-v-rew"'));
  assert.ok(!out.includes('class="ptna-views"'));
  assert.ok(out.includes('0 of 1 blocks rewritten'));
});

test('harvestStreamOps reads $RC and $RS pairs from inline scripts', () => {
  const html = '<script>$RC("B:0","S:0")</script><script>$RS("S:7","P:2")</script>';
  assert.deepStrictEqual(harvestStreamOps(html), [
    { kind: 'boundary', targetId: 'B:0', contentId: 'S:0' },
    { kind: 'placeholder', contentId: 'S:7', targetId: 'P:2' },
  ]);
});

test('resolveStreamedHtml swaps boundary fallbacks and placeholders into place', () => {
  const html = [
    '<body>',
    '<main><!--$?--><template id="B:0"></template><div class="spinner">loading…</div><!--/$--></main>',
    '<aside><template id="P:2"></template></aside>',
    `<div hidden id="S:0"><p>${LONG_KO}</p></div>`,
    '<div hidden id="S:7"><span>sidebar content arrived</span></div>',
    '<div hidden id="S:9"><p>orphaned segment with no swap call</p></div>',
    '</body>',
  ].join('');
  const ops = [
    { kind: 'boundary', targetId: 'B:0', contentId: 'S:0' },
    { kind: 'placeholder', contentId: 'S:7', targetId: 'P:2' },
  ];

  const out = resolveStreamedHtml(html, ops);
  assert.ok(out.includes(`<main><!--$?--><p>${LONG_KO}</p><!--/$--></main>`));
  assert.ok(out.includes('<aside><span>sidebar content arrived</span></aside>'));
  assert.ok(!out.includes('spinner'));
  assert.ok(!out.includes('hidden id="S:'));
  assert.ok(!out.includes('orphaned segment'));
});

test('resolveStreamedHtml keeps fallbacks whose segment never streamed', () => {
  const html = '<body><!--$?--><template id="B:0"></template><p>still loading fallback text here</p><!--/$--></body>';
  const out = resolveStreamedHtml(html, [{ kind: 'boundary', targetId: 'B:0', contentId: 'S:0' }]);
  assert.ok(out.includes('still loading fallback text here'));
});

test('inlineSrcdocIframes decodes srcdoc detail content into first-class DOM', () => {
  const inner = '<section class="page"><h1>상세 페이지의 충분히 긴 제목 텍스트입니다 여기</h1>'
    + '<p>이 문단은 충분히 긴 상세 설명 본문이라 추출 대상이 됩니다.</p>'
    + '<script>track()</script><img src="data:image/png;base64,AAAA"></section>';
  const escaped = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<body><h2>위 본문</h2><iframe title="상세" sandbox="allow-same-origin" srcdoc="${escaped}"></iframe></body>`;

  const out = inlineSrcdocIframes(html);
  assert.ok(!/<iframe/i.test(out));
  assert.ok(out.includes('<div class="ptna-srcdoc">'));
  assert.ok(out.includes('<section class="page">'));
  assert.ok(!out.includes('track()')); // active content stripped inside srcdoc
  const { blocks } = extractProseBlocks(out);
  assert.ok(blocks.some((b) => b.text.includes('상세 설명 본문')));
  assert.ok(blocks.some((b) => b.text.includes('충분히 긴 제목')));
});

test('inlineSrcdocIframes also accepts single-quoted srcdoc', () => {
  const html = `<body><iframe srcdoc='<p>${LONG_KO}</p><script>track()</script>'></iframe></body>`;
  const out = inlineSrcdocIframes(html);
  assert.ok(!/<iframe/i.test(out));
  assert.ok(out.includes('<div class="ptna-srcdoc">'));
  assert.ok(!out.includes('track()'));
  const { blocks } = extractProseBlocks(out);
  assert.deepStrictEqual(blocks.map((b) => b.text), [LONG_KO]);
});

test('stripActiveContent neutralizes attacker markup surfaced through frames/srcdoc', () => {
  // Unclosed <script> is removed, not left intact, and does not nuke the page.
  const unclosed = prepareSnapshotHtml('<body><p>kept content that is long enough here</p><script>fetch("//evil")//');
  assert.ok(!unclosed.includes('<script'));
  assert.ok(unclosed.includes('kept content that is long enough here'));

  // A '>' inside a quoted attribute cannot hide a later on* handler.
  const handler = prepareSnapshotHtml('<body><b title=">" onerror="boom()">x</b><p>long enough body content here</p></body>');
  assert.ok(!/onerror/i.test(handler));

  // A '/'-separated event handler (<a/onclick=…>) is stripped too.
  const slash = prepareSnapshotHtml('<body><a/onclick=alert(1) href="/x">x</a><p>long enough body content here</p></body>');
  assert.ok(!/onclick/i.test(slash));

  // A handler glued directly to the closing quote of the previous attribute
  // (<a href="x"onclick=…>) is stripped while the neighbour attribute survives.
  const glued = prepareSnapshotHtml('<body><a href="x"onclick="steal()">x</a><p>long enough body content here</p></body>');
  assert.ok(!/onclick/i.test(glued));
  assert.ok(glued.includes('href="x"'));

  // Two ADJACENT handlers — the first's closing quote is the only separator
  // for the second — must BOTH be stripped (fixed-point pass), not just one.
  const chained = prepareSnapshotHtml('<body><div onfocus="a()"onmouseover="b()"onblur="c()">x</div><p>long enough body content here</p></body>');
  assert.ok(!/onfocus|onmouseover|onblur/i.test(chained));
  const chainedHref = prepareSnapshotHtml('<body><a href="x"onfocus="a()"onblur="b()">y</a><p>long enough body content here</p></body>');
  assert.ok(!/onfocus|onblur/i.test(chainedHref));
  assert.ok(chainedHref.includes('href="x"'));

  // A leading C0 control char before the scheme cannot smuggle javascript:.
  const ctrl = prepareSnapshotHtml(
    `<body><a href="${String.fromCharCode(1)}javascript:alert(1)">x</a><p>long enough body content here</p></body>`,
  );
  assert.ok(!/javascript:alert/i.test(ctrl));

  // An entity-encoded javascript: URL is neutralized (it would decode to
  // javascript: only in the browser).
  const entityJs = prepareSnapshotHtml('<body><a href="&#106;avascript:alert(1)">x</a><p>long enough body content here</p></body>');
  assert.ok(!/javascript:alert/i.test(entityJs) && !/&#106;avascript:alert/i.test(entityJs));

  // A literal "<script>" inside another tag's attribute value is not treated
  // as a real script element (the rest of the document survives).
  const literal = prepareSnapshotHtml('<body><div data-x="<script>boom()</script>">visible content that is long enough</div><p>tail paragraph kept here</p></body>');
  assert.ok(literal.includes('tail paragraph kept here'));
});

test('buildPreviewHtml ships a CSP that forbids scripts and sub-frames but keeps passive resources', () => {
  // A data:/javascript: iframe renders its own document the stripper cannot
  // sanitize; the CSP (script/frame none, img/style/font allowed) is the
  // defense that keeps it inert without breaking the snapshot's fidelity.
  const html = '<html><head></head><body>'
    + '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>'
    + `<p>${LONG_EN}</p></body></html>`;
  const { blocks } = extractProseBlocks(prepareSnapshotHtml(html));
  const { html: out } = buildPreviewHtml({ html, blocks, rewrites: [LONG_EN], sourceUrl: 'https://t/' });
  assert.ok(out.includes("default-src 'none'"));
  assert.ok(out.includes("frame-src 'none'"));
  assert.ok(out.includes("object-src 'none'"));
  assert.ok(out.includes('img-src * data: blob:'));
  assert.ok(out.includes("style-src * 'unsafe-inline'"));
  // The CSP must NOT set base-uri 'none' — that would nullify the injected
  // <base href> and break every relative image/CSS/link on the snapshot.
  assert.ok(!out.includes('base-uri'));
  assert.ok(out.includes('<base href="https://t/">'));
});

test('extractProseBlocks keeps prose after a self-closed or unclosed excluded container', () => {
  // A self-closed inline SVG icon (ubiquitous in headers/headings) must not be
  // treated as an unclosed container that excludes everything after it.
  const header = '<header><a href="/"><svg width="32" height="32" viewBox="0 0 24 24"/></a></header>'
    + '<article><p>First paragraph long enough to be prose content here.</p>'
    + '<p>Second paragraph long enough to be prose content here.</p></article>';
  assert.strictEqual(extractProseBlocks(header).blocks.length, 2);

  // A self-closed <svg/> must not borrow a LATER, unrelated <svg>'s close tag
  // and exclude the prose in between.
  const between = '<svg viewBox="0 0 1 1"/><p>Prose between two svgs that is long enough to be content here.</p>'
    + '<svg><path d="M0 0"></path></svg>';
  assert.strictEqual(extractProseBlocks(between).blocks.length, 1);

  // A genuinely-closed container is still excluded (its serialized markup must
  // never be rewritten), and the prose after it is kept.
  const closed = '<script type="application/json">{"x":"<p>serialized long enough text here</p>"}</script>'
    + '<p>real visible prose long enough here.</p>';
  const { blocks } = extractProseBlocks(closed);
  assert.strictEqual(blocks.length, 1);
  assert.ok(blocks[0].text.includes('real visible prose'));
});

test('extractProseBlocks is not fooled by a container open tag inside a comment', () => {
  // A commented-out container open tag must not pair with a LATER real close
  // tag and exclude (swallow) the real prose between them.
  const html = '<!-- <nav> --><p>This real paragraph is long enough and must be extracted normally.</p><nav>menu</nav>';
  const { blocks } = extractProseBlocks(html);
  assert.deepStrictEqual(blocks.map((b) => b.text), [
    'This real paragraph is long enough and must be extracted normally.',
  ]);
  // A container name living only inside a <script> string is likewise inert.
  const scripted = '<script>var x="<style>";</script><p>Prose after a script that mentions style and is long enough.</p><style>.x{}</style>';
  assert.deepStrictEqual(extractProseBlocks(scripted).blocks.map((b) => b.text), [
    'Prose after a script that mentions style and is long enough.',
  ]);
});

test('extractProseBlocks stays linear on many unclosed openers (no quadratic hang)', () => {
  // Pathological input that previously hung for minutes: tens of thousands of
  // unclosed <div> openers followed by a long run of stray '<' in text. The
  // single-pass tokenizer + bounded forward scan keep this fast.
  const source = '<div>'.repeat(40000) + '< '.repeat(900000);
  const start = process.hrtime.bigint();
  extractProseBlocks(source);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 3000, `extraction took ${ms.toFixed(0)}ms`);
});

test('buildPreviewHtml badges single-quoted image anchors', () => {
  const html = `<html><body><img src='/img/banner.png' alt="x"><p>${LONG_EN}</p></body></html>`;
  const { blocks } = extractProseBlocks(html);
  const { html: out, imageChangedCount } = buildPreviewHtml({
    html,
    blocks,
    rewrites: [LONG_EN],
    sourceUrl: 'https://example.test/',
    imageFindings: [{ kind: 'url', url: 'https://example.test/img/banner.png', anchor: '/img/banner.png', text: '이미지 속 문장', rewritten: '고친 문장', changed: true }],
  });
  assert.strictEqual(imageChangedCount, 1);
  assert.ok(out.includes('<span class="ptna-img" data-n="I1">'));
});

test('prepareSnapshotHtml resolves a streamed page end to end', () => {
  const html = [
    '<html><head></head><body>',
    '<main><!--$?--><template id="B:1"></template><div role="status">spinner</div><!--/$--></main>',
    `<div hidden id="S:1"><p>${LONG_EN}</p></div>`,
    '<script>$RC("B:1","S:1")</script>',
    '</body></html>',
  ].join('');
  const out = prepareSnapshotHtml(html);
  assert.ok(out.includes(`<p>${LONG_EN}</p>`));
  assert.ok(!out.includes('spinner'));
  assert.ok(!out.includes('<script'));
  const { blocks } = extractProseBlocks(out);
  assert.strictEqual(blocks.length, 1);
});

test('fetchPreviewPage validates status, content type, and size', async () => {
  const page = (body, init = {}) => Promise.resolve({
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    url: init.url ?? '',
    headers: { get: (name) => ({ 'content-type': 'text/html; charset=utf-8', ...init.headers })[name.toLowerCase()] ?? null },
    text: async () => body,
  });

  const ok = await fetchPreviewPage('https://example.test/', { fetchImpl: () => page('<p>hi</p>') });
  assert.strictEqual(ok.html, '<p>hi</p>');
  assert.strictEqual(ok.finalUrl, 'https://example.test/');

  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', { fetchImpl: () => page('nope', { status: 404 }) }),
    /HTTP 404/,
  );
  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', {
      fetchImpl: () => page('{}', { headers: { 'content-type': 'application/json' } }),
    }),
    /not HTML/,
  );
  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', { fetchImpl: () => page('x'.repeat(64)), maxBytes: 10 }),
    /preview limit/,
  );
});

test('fetchPreviewPage aborts on timeout', async () => {
  const hang = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
  });
  await assert.rejects(
    () => fetchPreviewPage('https://example.test/', { fetchImpl: hang, timeoutMs: 20 }),
    /timed out/,
  );
});
