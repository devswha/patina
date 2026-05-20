import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderShareCard, truncateText } from '../../scripts/share-card.mjs';

describe('share-card renderer', () => {
  it('renders a stable SVG skeleton with score, MPS, and brand mark', () => {
    const svg = renderShareCard({
      before: 'Coffee has emerged as a pivotal cultural phenomenon.',
      after: 'Coffee changed how people meet.',
      aiScore: 24,
      mps: 93,
      lang: 'en',
    });

    assert.match(svg, /<svg[^>]+width="1200" height="630"/u);
    assert.match(svg, /<g id="patina-brand-mark"/u);
    assert.match(svg, /AI score 24\/100/u);
    assert.match(svg, /MPS 93/u);

    const snapshot = [
      svg.match(/<svg[^>]+>/u)?.[0],
      svg.match(/<g id="patina-brand-mark"[\s\S]*?<\/g>/u)?.[0].replace(/\s+/gu, ' ').trim(),
      svg.match(/>AI score [^<]+<\/text>/u)?.[0].replace(/^>|<\/text>$/gu, ''),
      svg.match(/>MPS [^<]+<\/text>/u)?.[0].replace(/^>|<\/text>$/gu, ''),
    ].join('\n');

    assert.strictEqual(snapshot, [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">',
      '<g id="patina-brand-mark" transform="translate(72 39) scale(0.10546875)" aria-hidden="true"> <path d="M92 196C160 86 320 74 420 164L346 238C288 190 218 198 174 258Z" fill="#c46a2a"/> <path d="M420 316C352 426 192 438 92 348L160 270C224 322 294 314 338 254Z" fill="#2dd4bf"/> <circle cx="252" cy="248" r="54" fill="#ffe6a8" stroke="#020617" stroke-width="10"/> </g>',
      'AI score 24/100',
      'MPS 93',
    ].join('\n'));
  });

  it('truncates long input and escapes XML without leaking the full source', () => {
    const long = `<script data-x="1">${'가'.repeat(330)} & done</script>`;
    const svg = renderShareCard({
      before: long,
      after: '괜찮게 다듬은 문장입니다.',
      aiScore: 12.5,
      mps: 91.4,
      lang: 'ko',
    });

    assert.ok(!svg.includes(long), 'full input should not be embedded');
    assert.ok(!svg.includes('<script'), 'raw XML-sensitive text should not appear');
    assert.match(svg, /&lt;script/u);
    assert.match(svg, /data-x=&quot;1&quot;&gt;/u);
    assert.match(svg, /…/u);
    assert.match(svg, /AI score 12\.5\/100/u);
    assert.match(svg, /MPS 91\.4/u);
  });

  it('keeps CJK glyphs in visible text under the system font stack', () => {
    const svg = renderShareCard({
      before: '한국어 中文 日本語 문장을 한 카드에 넣습니다.',
      after: '한국어·中文·日本語가 그대로 보입니다.',
      aiScore: null,
      mps: null,
      lang: 'zh',
    });

    assert.match(svg, /한국어 中文 日本語/u);
    assert.match(svg, /한국어·中文·日本語/u);
    assert.match(svg, /Noto Sans CJK KR/u);
    assert.match(svg, /AI score n\/a/u);
    assert.match(svg, /MPS n\/a/u);
  });

  it('limits snippets to roughly 280 code points', () => {
    const truncated = truncateText('나'.repeat(320));
    assert.strictEqual(Array.from(truncated).length, 280);
    assert.ok(truncated.endsWith('…'));
  });
});
