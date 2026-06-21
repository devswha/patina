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
    title: '노션 템플릿 팩',
    eyebrow: '신규 출시',
    sectionHeading: '왜 팀들이 좋아할까요',
    tone: 'marketing',
    blocks: [
      {
        before: '새롭게 출시된 노션 템플릿 팩은 현대적인 팀을 위한 혁신적인 솔루션입니다. 본 제품은 다양한 업무 환경에 최적화된 체계적인 구성을 제공합니다. 사용자 친화적인 설계를 통해 누구나 손쉽게 활용할 수 있습니다. 직관적인 구조는 효율적인 협업 경험을 효과적으로 지원합니다. 이를 통해 업무 생산성을 획기적으로 극대화할 수 있습니다.',
        after: '프로젝트 페이지와 기획 문서, 인수인계를 매번 처음부터 다시 만들고 있다면 이 팩을 먼저 열어 보세요. 같은 워크스페이스를 반복해 세팅할 일이 줄어듭니다.',
      },
      {
        before: '이 팩은 다양한 워크플로우에 최적화된 30개의 템플릿을 제공합니다. 각 템플릿은 체계적인 구조와 직관적인 흐름으로 구성되어 있습니다. 사용자 친화적인 디자인은 누구나 손쉽게 활용하도록 돕습니다. 효율적인 관리 기능은 협업 생산성을 효과적으로 향상시킵니다. 이를 통해 팀의 업무 효율을 지속적으로 개선할 수 있습니다.',
        after: '업무별 템플릿 30개가 들어 있습니다. 레이아웃이 단순해서 팀원 누구나 바로 가져다 쓸 수 있어요.',
      },
      {
        before: '전체 프로젝트를 주도하거나 첫 워크스페이스를 세팅할 때 활용해 보십시오. 체계적인 구조는 팀의 맥락 관리를 효과적으로 지원합니다. 직관적인 흐름은 구성원 간 협업을 자연스럽게 촉진합니다. 효율적인 정리 기능은 업무 부담을 획기적으로 줄여 줍니다. 이를 통해 조직 전반의 생산성을 지속적으로 향상시킵니다.',
        after: '전체 프로젝트를 이끌거나 첫 공용 워크스페이스를 만들 때 쓰면 됩니다. 구조가 잡혀 있어 흩어진 맥락을 따라다닐 일이 줄어듭니다.',
      },
      {
        before: '복잡한 설정 없이 원하는 템플릿을 복제하여 손쉽게 사용할 수 있습니다. 필요한 항목만 조정하면 즉시 업무에 적용할 수 있습니다. 직관적인 편집 환경은 누구나 빠르게 적응하도록 돕습니다. 효율적인 워크플로우는 반복 작업을 효과적으로 최소화합니다. 이를 통해 업무 효율성을 극대화하는 새로운 경험을 제공합니다.',
        after: '복잡한 설정 없이 템플릿을 복제하고 필요한 항목만 고치세요. 팀 프로젝트든 개인 정리든 필요한 형태로 손보면 됩니다.',
      },
      {
        before: '무료로 제공되며, 노션 계정만 있으면 누구나 바로 복제해 사용할 수 있습니다.',
        after: '무료로 제공되며, 노션 계정만 있으면 누구나 바로 복제해 사용할 수 있습니다.',
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
      background: linear-gradient(180deg, #f6f7fb 0%, #eef0f7 100%);
      color: #14161c;
      font: 18px/1.7 "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main { max-width: 720px; margin: 0 auto; }
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
    .intro { text-align: center; font-size: 21px; color: #2a2e38; margin: 0 auto 8px; max-width: 640px; }
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
