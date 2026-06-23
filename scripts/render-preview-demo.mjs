#!/usr/bin/env node
// Render a localized README hero preview page deterministically.
//
// The README hero GIF is a capture of patina's `--preview` surface. Capturing
// the real `--preview` output needs a live model call, which makes the asset
// non-reproducible. This helper rebuilds the *same* preview page from a
// checked-in sample page plus a hand-authored before/after rewrite pair, with
// no LLM in the loop: the chrome, the inline diff, the view toggles, and the
// deterministic score chip are all the genuine patina preview machinery.
//
// Usage:
//   node scripts/render-preview-demo.mjs --lang ko --out /tmp/patina-preview-ko.html
//
// Then open the page, capture the Rewritten / Original / Both / Diff viewports,
// and assemble the GIF (see assets/demo/README.md).

import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { extractProseBlocks, buildPreviewHtml, buildContextCardHtml } from '../src/preview.js';
import { scoreDeterministicSignals } from '../src/scoring.js';

// Localized sample landing pages. Each block's `before` is the AI-sounding
// source prose baked into the page; `after` is the humanized rewrite patina
// would produce. A block whose `after` equals its `before` stays unrewritten,
// which is what drives the "N of M blocks rewritten" count.
const SAMPLES = {
  ko: {
    title: 'AI가 쓴 글은 왜 티가 날까',
    eyebrow: '에디터 노트',
    sectionHeading: '어디서 티가 나나',
    tone: 'casual',
    blocks: [
      {
        before: '결론적으로, AI가 작성한 글은 다양한 측면에서 특유의 패턴을 지속적으로 드러내는 경향이 있다고 할 수 있습니다. 이러한 문장들은 체계적인 구조를 통해 효율적으로 구성될 수 있습니다. 하지만 효과적인 표현의 이면에는 미묘한 위화감이 지속적으로 존재할 수 있습니다. 과도한 수식어와 번역투는 글의 진정성을 효과적으로 저해할 수 있습니다. 이를 통해 우리는 글의 신뢰도가 지속적으로 약화될 수 있다는 점을 확인할 수 있습니다.',
        after: 'AI가 쓴 글은 묘하게 금방 티가 난다. 문장은 매끄러운데, 읽다 보면 어딘가 겉돈다. 번역투와 군더더기 수식어가 글의 진심을 가린다.',
      },
      {
        before: '가장 먼저 드러나는 것은 번역투라고 할 수 있습니다. AI 기술을 통해 효율성을 효과적으로 향상시킬 수 있다는 식의 문장이 대표적이라고 할 수 있습니다. 이러한 표현은 한국어의 자연스러운 흐름을 지속적으로 방해할 수 있습니다. 또한 다양한 영어식 구문이 체계적으로 반복되는 경향이 있습니다. 이를 통해 문장은 점점 더 딱딱해질 수 있습니다.',
        after: '가장 먼저 드러나는 건 번역투다. "AI 기술을 통해 효율성을 향상시킬 수 있다" 같은 문장은 영어를 그대로 옮긴 티가 난다. "AI로 일을 더 빠르게 한다"면 충분하다.',
      },
      {
        before: '과도한 수식어와 관용구도 매우 빈번하게 관찰될 수 있습니다. 혁신적인, 획기적인, 시사하는 바가 크다와 같은 표현이 다양한 문장에서 지속적으로 등장합니다. 이러한 어휘들은 구체적인 내용 없이 글의 무게감만 효과적으로 더합니다. 그 결과 독자는 실제 정보를 효율적으로 얻기 어려워질 수 있습니다. 결국 글 전체의 설득력은 지속적으로 저하될 수 있습니다.',
        after: '과한 수식어와 상투구도 자주 보인다. "혁신적인", "획기적인", "시사하는 바가 크다" 같은 말은 알맹이 없이 무게만 잡는다.',
      },
      {
        before: '뿐만 아니라, 거의 모든 문장이 할 수 있습니다 또는 인 것으로 보입니다와 같은 형태로 지속적으로 끝나는 경향이 있습니다. 이러한 완곡한 표현은 글쓴이의 입장을 효과적으로 모호하게 만들 수 있습니다. 또한 문장의 길이가 다양한 변화 없이 균일하게 유지되는 특징이 있습니다. 이를 통해 글은 기계적인 리듬을 지속적으로 드러낼 수 있습니다. 결과적으로 사람이 쓴 글 특유의 호흡은 효과적으로 사라질 수 있습니다.',
        after: '문장이 죄다 "~할 수 있습니다", "~인 것으로 보입니다"로 끝나는 것도 그렇다. 이렇게 에두르면 글쓴이가 뭘 말하려는지 흐려진다. 문장 길이까지 똑같아서 읽는 리듬이 밋밋해진다.',
      },
      {
        before: '고치는 방법은 단순하다. 뜻은 그대로 두고, 군더더기와 번역투만 걷어내면 된다.',
        after: '고치는 방법은 단순하다. 뜻은 그대로 두고, 군더더기와 번역투만 걷어내면 된다.',
      },
    ],
  },
};

function htmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSamplePage(sample) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(sample.title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 64px 24px 140px;
      background: #f4f6fb;
      color: #14161c;
      font: 21px/1.75 "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main { max-width: 680px; margin: 0 auto; }
    .eyebrow {
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.22em;
      color: #5b8c79;
      text-transform: none;
      margin: 0 0 14px;
    }
    h1 {
      text-align: center;
      font-size: 52px;
      line-height: 1.12;
      font-weight: 800;
      letter-spacing: -0.01em;
      margin: 0 0 26px;
    }
    .intro { text-align: center; font-size: 23px; color: #2a2e38; margin: 0 auto 8px; max-width: 600px; }
    hr { border: 0; border-top: 1px solid rgba(20,22,28,0.08); margin: 46px 0; }
    h2 { font-size: 30px; font-weight: 800; margin: 0 0 22px; }
    p { margin: 0 0 20px; }
    section p { color: #2a2e38; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">${htmlEscape(sample.eyebrow)}</p>
    <h1>${htmlEscape(sample.title)}</h1>
    <p class="intro">${htmlEscape(sample.blocks[0].before)}</p>
    <hr>
    <h2>${htmlEscape(sample.sectionHeading)}</h2>
    <section>
${sample.blocks.slice(1).map((block) => `      <p>${htmlEscape(block.before)}</p>`).join('\n')}
    </section>
  </main>
</body>
</html>`;
}

function parseArgs(argv) {
  const args = { lang: 'ko', out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') args.lang = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
  }
  if (!args.out) args.out = `/tmp/patina-preview-${args.lang}.html`;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sample = SAMPLES[args.lang];
  if (!sample) {
    console.error(`No sample defined for --lang ${args.lang} (have: ${Object.keys(SAMPLES).join(', ')})`);
    return 1;
  }

  const html = renderSamplePage(sample);
  const { blocks } = extractProseBlocks(html);
  if (blocks.length !== sample.blocks.length) {
    console.error(`Block mismatch: extracted ${blocks.length}, sample defines ${sample.blocks.length}.`);
    console.error('Extracted block texts:\n' + blocks.map((b, i) => `  [${i}] ${b.text}`).join('\n'));
    return 1;
  }

  // Map each extracted block to its authored rewrite by normalized source text.
  const norm = (text) => String(text).replace(/\s+/g, ' ').trim();
  const rewrites = blocks.map((block) => {
    const pair = sample.blocks.find((entry) => norm(entry.before) === norm(block.text));
    if (!pair) {
      throw new Error(`No rewrite pair for block: ${block.text}`);
    }
    return pair.after;
  });

  const config = loadConfig();
  config.language = args.lang;
  const scoreConfig = { ...config, language: args.lang };

  const beforeText = blocks.map((block) => block.text).join('\n\n');
  const afterText = rewrites.join('\n\n');
  const beforeScore = scoreDeterministicSignals({ text: beforeText, config: scoreConfig });
  const afterScore = scoreDeterministicSignals({ text: afterText, config: scoreConfig });
  const scoreChip = beforeScore?.overall != null && afterScore?.overall != null
    ? `score ${beforeScore.overall} → ${afterScore.overall}`
    : null;

  const built = buildPreviewHtml({
    html,
    blocks,
    rewrites,
    sourceUrl: '',
    scoreChip,
    contextCardHtml: buildContextCardHtml({
      tone: { tone: sample.tone, tone_source: 'user' },
    }),
  });

  writeFileSync(args.out, built.html, 'utf8');
  console.log(`wrote ${args.out}`);
  console.log(`blocks: ${built.changedCount} of ${built.totalCount} rewritten`);
  console.log(`score chip: ${scoreChip ?? '(none)'}`);
  return 0;
}

process.exit(main());
