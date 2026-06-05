import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYGROUND_LEXICONS } from '../../playground/data/lexicons.js';
import {
  analyzePlaygroundText,
  buildCliCommand,
  buildFalsePositiveReportUrl,
  renderAuditDiff,
  SUPPORTED_LANGS,
  splitProseSentences,
  countFormatting,
} from '../../playground/analyzer.js';
import { analyzeText } from '../../src/features/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const SAMPLES = {
  ko: '이 솔루션은 생산성 향상의 핵심 기반으로 자리매김하고 있습니다.',
  en: 'This transformative solution empowers teams to unlock the full potential of a seamless workflow.',
  zh: '总而言之，这一方案能够全面提升用户体验，并为未来发展提供新的可能。',
  ja: 'まとめると、この仕組みはユーザー体験を向上させ、より良い未来につながります。',
};

function analyzeNodeText(text, lang) {
  return analyzeText(text, { lang, repoRoot: REPO_ROOT });
}

test('playground lexicons are generated for every supported language', () => {
  assert.deepEqual(Object.keys(PLAYGROUND_LEXICONS).sort(), [...SUPPORTED_LANGS].sort());
  for (const lang of SUPPORTED_LANGS) {
    const lexicon = PLAYGROUND_LEXICONS[lang];
    assert.equal(lexicon.lang, lang);
    assert.match(lexicon.source, new RegExp(`lexicon/ai-${lang}\\.md`));
    assert.ok(lexicon.strict.length + lexicon.phrases.length >= 50, `${lang} lexicon is unexpectedly small`);
  }
});

test('playground analyzer returns score, audit items, and diff HTML for ko/en/zh/ja', () => {
  for (const lang of SUPPORTED_LANGS) {
    const analysis = analyzePlaygroundText(SAMPLES[lang], { lang });
    assert.equal(analysis.lang, lang);
    assert.ok(Number.isInteger(analysis.overall));
    assert.ok(analysis.overall > 0, `${lang} sample should surface an editing signal`);
    assert.ok(analysis.auditItems.length >= 1, `${lang} sample should have an audit item`);
    assert.ok(analysis.paragraphs[0].lexicon.matches >= 1, `${lang} sample should hit lexicon`);

    const html = renderAuditDiff(analysis);
    assert.match(html, /diff-card/);
    assert.match(html, /<mark>/);
  }
});

test('playground and node analyzers agree on shared deterministic signals', () => {
  for (const lang of SUPPORTED_LANGS) {
    const nodeAnalysis = analyzeNodeText(SAMPLES[lang], lang);
    const playgroundAnalysis = analyzePlaygroundText(SAMPLES[lang], { lang });
    assert.equal(
      playgroundAnalysis.paragraphs[0].lexicon.matches > 0,
      nodeAnalysis.paragraphs[0].lexicon.matches > 0,
      `${lang} lexicon-hit presence should match node analyzer`,
    );
  }

  const cases = [
    {
      name: 'model-output leakage',
      text: 'This paragraph contains turn0search0 from copied model output.',
      lang: 'en',
      nodeHot: (analysis) => analysis.markupLeakage.leaked,
      playgroundHot: (analysis) => analysis.markupLeakage.leaked,
    },
    {
      name: 'fake-candor opener density',
      text: "Here's the thing. Let's be honest. The rollout still needs one owner and one deadline.",
      lang: 'en',
      nodeHot: (analysis) => analysis.discourseTells.fakeCandor.hot,
      playgroundHot: (analysis) => analysis.discourseTells.fakeCandor.hot,
    },
    {
      name: 'short non-hot control',
      text: 'I changed one parser branch and wrote down the reason.',
      lang: 'en',
      nodeHot: (analysis) => analysis.hot,
      playgroundHot: (analysis) => analysis.hotCount > 0,
    },
  ];

  for (const sample of cases) {
    const nodeAnalysis = analyzeNodeText(sample.text, sample.lang);
    const playgroundAnalysis = analyzePlaygroundText(sample.text, { lang: sample.lang });
    assert.equal(
      sample.playgroundHot(playgroundAnalysis),
      sample.nodeHot(nodeAnalysis),
      `${sample.name} verdict should match node analyzer`,
    );
  }
});

test('playground ports thematic-break discourse tells from the node analyzer', () => {
  const text = [
    '---',
    '# First section',
    'This practical note uses a plain sentence with uneven length.',
    '',
    '***',
    '# Second section',
    'The middle paragraph records the concrete tradeoff before the recommendation.',
    '',
    '___',
    '# Third section',
    'The final paragraph names the owner and the next review window.',
  ].join('\n');

  const nodeAnalysis = analyzeNodeText(text, 'en');
  const playgroundAnalysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(nodeAnalysis.discourseTells.thematicBreaks.hot, true);
  assert.equal(
    playgroundAnalysis.discourseTells.thematicBreaks.count,
    nodeAnalysis.discourseTells.thematicBreaks.count,
  );
  assert.equal(
    playgroundAnalysis.discourseTells.thematicBreaks.adjacentToHeading,
    nodeAnalysis.discourseTells.thematicBreaks.adjacentToHeading,
  );
  assert.equal(
    playgroundAnalysis.discourseTells.thematicBreaks.hot,
    nodeAnalysis.discourseTells.thematicBreaks.hot,
  );
  assert.ok(playgroundAnalysis.paragraphs.some((paragraph) => paragraph.thematicBreaks.hot));
  assert.ok(playgroundAnalysis.paragraphs.some((paragraph) => paragraph.reasons.some((reason) => reason.code === 'thematic-break')));
});

test('playground excludes Markdown list blocks from prose rhythm samples', () => {
  const text = `Here is what the tool does for you:
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models
- distribute work across Codex, Claude, and Gemini`;

  assert.deepEqual(splitProseSentences(text), ['Here is what the tool does for you:']);

  const nodeAnalysis = analyzeNodeText(text, 'en');
  const playgroundAnalysis = analyzePlaygroundText(text, { lang: 'en' });
  assert.equal(playgroundAnalysis.paragraphs[0].sentenceCount, nodeAnalysis.paragraphs[0].sentenceCount);
  assert.equal(playgroundAnalysis.paragraphs[0].burstiness.band, nodeAnalysis.paragraphs[0].burstiness.band);
  assert.equal(playgroundAnalysis.hotCount > 0, nodeAnalysis.hot);

  const twoSentenceResidue = `This intro names the list. It stays under the burstiness gate.
- send hook events to external gateways
- discover and invoke MCP servers
- hand bounded sub-questions to other CLIs and models`;
  const residueNode = analyzeNodeText(twoSentenceResidue, 'en');
  const residuePlayground = analyzePlaygroundText(twoSentenceResidue, { lang: 'en' });
  assert.equal(residuePlayground.paragraphs[0].sentenceCount, residueNode.paragraphs[0].sentenceCount);
  assert.equal(residuePlayground.paragraphs[0].burstiness.band, residueNode.paragraphs[0].burstiness.band);
  assert.equal(residuePlayground.hotCount > 0, residueNode.hot);
});

test('playground flags a single emoji marker because pattern 17 is any-hit', () => {
  const text = 'Status update 🙂 the deploy finished on time.';
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 1);
  assert.equal(analysis.paragraphs[0].formatting.docEmoji, 1);
  assert.ok(analysis.paragraphs[0].reasons.some((reason) => reason.code === 'emoji-overuse'));
});

test('playground counts joined emoji by visible glyph and still flags them once', () => {
  const text = `Status update 👩‍💻 the deploy finished on time.

Budget note 👨‍👩‍👧‍👦 the team stayed within plan.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.paragraphs[0].formatting.docEmoji, 2);
  assert.equal(analysis.hotCount, 2);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.some((reason) => reason.code === 'emoji-overuse')));

  assert.deepEqual(countFormatting('👩‍💻 👨‍👩‍👧‍👦', { segmenter: null }), { emDash: 0, bold: 0, emoji: 2 });
});

test('playground marks repeated em dashes as a document-level formatting tell', () => {
  const text = `Status update — the deploy finished on time.

Budget note — the team stayed within plan.

Support review — response time dropped this week.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 3);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.formatting.docEmDash === 3));
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.some((reason) => reason.code === 'em-dash-overuse')));
});

test('playground does not hot-classify em dashes below the threshold', () => {
  const text = `Status update — the deploy finished on time.

Budget note — the team stayed within plan.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 0);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.every((reason) => reason.code !== 'em-dash-overuse')));
});

test('playground marks repeated bold spans as a document-level formatting tell', () => {
  const text = `**Status** update for the deploy.

**Budget** note for the team.

**Support** review from this week.

**Latency** trend from the dashboard.

**Owner** list for the rollout.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 5);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.formatting.docBold === 5));
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.some((reason) => reason.code === 'bold-overuse')));
});

test('playground marks 3 bold spans in one paragraph even below the document threshold', () => {
  const text = '**Status** update with a **Budget** note and a **Support** review.';
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 1);
  assert.ok(analysis.paragraphs[0].reasons.some((reason) => reason.code === 'bold-overuse'));
});

test('playground does not hot-classify bold spans below both thresholds', () => {
  const text = '**Status** update with a **Budget** note for the deploy.';
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.hotCount, 0);
  assert.ok(analysis.paragraphs.every((paragraph) => paragraph.reasons.every((reason) => reason.code !== 'bold-overuse')));
});

test('playground keeps one Korean lexicon hit as an audit hint', () => {
  const analysis = analyzePlaygroundText('이 문서는 다음 작업의 자리매김을 설명한다.', { lang: 'ko' });
  assert.equal(analysis.paragraphs[0].lexicon.matches, 1);
  assert.equal(analysis.paragraphs[0].lexicon.hot, false);
  assert.equal(analysis.paragraphs[0].hot, false);
  assert.equal(analysis.auditItems.length, 1);
});

test('playground short-circuits the score when markup leakage is present', () => {
  const text = `This paragraph reads like ordinary notes about the deploy and the on-call rotation.

The middle paragraph mentions turn0search1 copied straight out of a model response.

The closing paragraph stays calm and human, with uneven sentence lengths and no tells.`;
  const analysis = analyzePlaygroundText(text, { lang: 'en' });

  assert.equal(analysis.markupLeakage.leaked, true);
  assert.ok(analysis.overall >= 90, `expected leakage floor, got ${analysis.overall}`);

  const clean = analyzePlaygroundText(text.replace('turn0search1 copied straight out of a model response', 'a quote copied straight out of the meeting notes'), { lang: 'en' });
  assert.equal(clean.markupLeakage.leaked, false);
  assert.ok(clean.overall < 90, `clean prose should not hit the leakage floor, got ${clean.overall}`);
});

test('playground diff escapes pasted HTML before highlighting', () => {
  const analysis = analyzePlaygroundText('<script>alert(1)</script> This transformative workflow is seamless.', { lang: 'en' });
  const html = renderAuditDiff(analysis);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<mark>transformative<\/mark>/);
});

test('Open in CLI command preserves input and avoids heredoc delimiter collisions', () => {
  const command = buildCliCommand('first line\nPATINA_TEXT\nlast line', 'ko');
  assert.match(command, /cat > patina-input\.txt <<'PATINA_TEXT_2'/);
  assert.match(command, /first line\nPATINA_TEXT\nlast line/);
  assert.match(command, /npx patina-cli --lang ko --score patina-input\.txt/);
  assert.match(command, /npx patina-cli --lang ko --audit patina-input\.txt/);
});

test('Report false positive pre-fills the GitHub false-positive form from the audit', () => {
  const text = SAMPLES.ko;
  const analysis = analyzePlaygroundText(text, { lang: 'ko' });
  const url = buildFalsePositiveReportUrl(text, 'ko', analysis);
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://github.com/devswha/patina/issues/new');
  assert.equal(parsed.searchParams.get('template'), 'false_positive.yml');
  assert.equal(parsed.searchParams.get('language'), 'ko');
  assert.match(parsed.searchParams.get('fired_paragraph'), /자리매김/);
  const out = parsed.searchParams.get('score_output');
  assert.match(out, /patina playground/);
  assert.match(out, /Score: \d+\/100/);
  assert.match(out, /Hot paragraphs: \d+\/\d+/);
});

test('Report false positive caps the pasted paragraph and tolerates empty input', () => {
  const long = 'A'.repeat(5000);
  const fired = new URL(buildFalsePositiveReportUrl(long, 'en')).searchParams.get('fired_paragraph');
  assert.ok(fired.length < 2000, 'fired_paragraph should be truncated to keep the URL small');
  assert.match(fired, /truncated/);

  const empty = new URL(buildFalsePositiveReportUrl('', 'ja')).searchParams;
  assert.equal(empty.get('language'), 'ja');
  assert.equal(empty.get('template'), 'false_positive.yml');
});

test('playground HTML exposes the false-positive report button', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  assert.match(html, /id="report-fp"/);
  assert.match(html, /Report false positive/);
});

test('playground HTML points canonical and OG metadata at patina.vibetip.help', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  assert.match(html, /https:\/\/patina\.vibetip\.help\//);
  assert.match(html, /assets\/social\/patina-og\.svg/);
  assert.match(html, /audit-only playground/);
});

test('playground HTML wires Vercel analytics without inline script', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  const analytics = readFileSync(resolve(REPO_ROOT, 'playground/analytics.js'), 'utf8');
  assert.match(html, /<script defer src="\/analytics\.js"><\/script>/);
  assert.match(html, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>/);
  assert.doesNotMatch(html, /window\.va\s*=/);
  assert.match(analytics, /window\.va/);
  assert.match(analytics, /window\.vaq/);
});


test('Vercel config exposes the playground at the domain root', () => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/' && rule.destination === '/playground'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/analytics.js' && rule.destination === '/playground/analytics.js'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/data/:path*' && rule.destination === '/playground/data/:path*'));
  const csp = config.headers[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value;
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /connect-src 'self'(?:;|$)/);
});

test('generated playground lexicon bundle is in sync with markdown lexicons', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-playground-data.mjs', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
