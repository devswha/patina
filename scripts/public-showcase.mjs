#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { droppedNumbers } from '../src/verify.js';
import { evaluateNumberSafety } from '../src/features/meaning-proxy.js';
import { renderShareCard, wrapSnippetLines } from './share-card.mjs';

export const SHOWCASE_LANGUAGES = ['ko', 'en', 'zh', 'ja'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COPY = {
  ko: { name: '한국어', before: '다듬기 전', after: '다듬은 예시',
    intro: '딱딱한 초안을 읽기 편하게 다듬습니다. 아래는 원문의 사실과 수치를 유지한 설명용 예시이며 실시간 실행 결과가 아닙니다.',
    action: '내 글로 확인하기' },
  en: { name: 'English', before: 'Before', after: 'Prepared example',
    intro: 'Turn a stiff draft into clearer writing. This illustrative pair keeps the source facts and numbers; it is not a live model result.',
    action: 'Try your own draft' },
  zh: { name: '中文', before: '改写前', after: '改写示例',
    intro: '把生硬的草稿改得清楚好读。下面的说明性示例保留原文事实和数字，并非实时生成结果。',
    action: '用自己的草稿试试' },
  ja: { name: '日本語', before: '整える前', after: '整えた例',
    intro: '堅い下書きを読みやすい文章に整えます。以下は原文の事実や数字を保った説明用の例で、実行結果ではありません。',
    action: '自分の下書きで試す' },
};

export function validateShowcase(rows) {
  if (!Array.isArray(rows)) throw new Error('Showcase must be an array');
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid showcase row');
    if (!SHOWCASE_LANGUAGES.includes(row.lang) || row.kind !== 'illustrative') throw new Error('Invalid showcase language or evidence kind');
    for (const field of ['id', 'label', 'before', 'after', 'caption']) {
      if (typeof row[field] !== 'string' || !row[field].trim()) throw new Error(`Missing showcase ${field}`);
    }
    if (!/^[a-z0-9-]+$/.test(row.id) || !row.id.startsWith(`${row.lang}-`) || ids.has(row.id)) throw new Error('Invalid or duplicate showcase id');
    ids.add(row.id);
    if (['mps', 'fidelity', 'score', 'aiScore', 'beforeScore'].some(key => Object.hasOwn(row, key))) throw new Error('Illustrative examples cannot carry measured-score claims');
    if (droppedNumbers(row.before, row.after).length || droppedNumbers(row.after, row.before).length) throw new Error(`${row.id}: numeric tokens changed`);
    if (!evaluateNumberSafety(row.before, row.after, row.lang).ok) throw new Error(`${row.id}: production numeric gate rejects the example pair`);
  }
  for (const lang of SHOWCASE_LANGUAGES) {
    if (rows.filter(row => row.lang === lang).length !== 3) throw new Error(`Expected three ${lang} examples`);
  }
  return rows;
}

export async function loadShowcase(root = ROOT) {
  const rows = [];
  for (const lang of SHOWCASE_LANGUAGES) {
    const pack = await import(pathToFileURL(resolve(root, `playground/examples/${lang}.js`)));
    rows.push(...pack.default);
  }
  return validateShowcase(rows);
}

function quote(text) { return text.split('\n').map(line => line ? `> ${line}` : '>').join('\n'); }
function link(lang, channel) {
  return `https://patina.vibetip.help/?lang=${lang}&utm_source=${channel}&utm_campaign=multilingual-20260907`;
}
function cardExample(rows, lang) {
  const candidates = rows.filter(row => row.lang === lang);
  const selected = candidates.find(row => [row.before, row.after].every(text =>
    Array.from(text).length <= 1000
      && !wrapSnippetLines(text, { wrap: 44, maxLines: 9, maxChars: 1000 }).some(line => line.endsWith('…'))));
  if (!selected) throw new Error(`No ${lang} example fits the complete share card`);
  return selected;
}

export function buildShowcaseArtifacts(rows) {
  validateShowcase(rows);
  const demo = ['# Examples in four languages', '',
    'These are prepared editorial examples, not transcripts or promises of a particular model output. The same source pairs appear in the playground. Numbers and names stay with their original claims; model-based checks and editorial review do not guarantee that every future rewrite will pass.', '',
    'Run a rewrite on your own text to inspect its actual approval status and meaning scores. For CLI verification, use `patina --verify --lang <ko|en|zh|ja> input.txt`; the source checkout is required for changes awaiting npm publication.', ''];
  const artifacts = new Map();
  for (const lang of SHOWCASE_LANGUAGES) {
    const copy = COPY[lang];
    demo.push(`## ${copy.name}`, '', copy.intro, '');
    for (const row of rows.filter(item => item.lang === lang)) {
      demo.push(`### ${row.label}`, '', `Example: \`${row.id}\``, '', `**${copy.before}**`, '', quote(row.before), '',
        `**${copy.after}**`, '', quote(row.after), '', row.caption, '');
    }
    const row = cardExample(rows, lang);
    const svg = renderShareCard({ before: row.before, after: row.after, lang, illustrative: true });
    artifacts.set(`assets/social/patina-before-after-${lang}.svg`, svg);
    if (lang === 'en') artifacts.set('assets/social/patina-before-after.svg', svg);
    demo.push(`[${copy.action}](${link(lang, 'github')}) · [Share card](../assets/social/patina-before-after-${lang}.svg)`, '');
  }
  demo.push('## Recorded demonstrations', '',
    'Older GIFs remain available in [the recording archive](../assets/demo/README.md). Their pixels and score labels describe those captures only; they do not verify the examples above.', '',
    'To refresh these pages and SVG cards after editing the shared examples, run `node scripts/public-showcase.mjs --write`. Use `--check` to detect stale artifacts without rewriting them.', '');
  artifacts.set('docs/DEMO.md', demo.join('\n'));
  return artifacts;
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--write', '--check'].includes(argv[0])) throw new Error('Use --write or --check');
  const artifacts = buildShowcaseArtifacts(await loadShowcase());
  const stale = [];
  for (const [file, contents] of artifacts) {
    if (argv[0] === '--write') writeFileSync(resolve(ROOT, file), contents, 'utf8');
    else {
      let actual;
      try { actual = readFileSync(resolve(ROOT, file), 'utf8'); } catch { actual = null; }
      if (actual !== contents) stale.push(file);
    }
  }
  if (stale.length) throw new Error(`Stale showcase artifacts: ${stale.join(', ')}`);
  console.log(`${argv[0] === '--write' ? 'Wrote' : 'Checked'} ${artifacts.size} multilingual showcase artifacts.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
