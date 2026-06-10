// Strip MDX -> prose and score with the deterministic analyzer (no backend).
// Usage: node scripts/qa/mdx-score.mjs <docsDir> <langSuffix>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeText } from '../../src/features/index.js';
import { stripProse } from '../prose-score.mjs';

function stripMdx(raw) {
  return stripProse(raw, {
    dropListItems: true,
    dropStandaloneLinks: true,
    keepInlineCode: true,
  });
}

function walk(dir, pat) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, pat));
    else if (pat.test(e)) out.push(p);
  }
  return out;
}

const [dir, lang] = process.argv.slice(2);
// en files have no language suffix (foo.mdx); ko/zh/ja are foo.<lang>.mdx.
const allMdx = walk(dir, /\.mdx$/);
const files = lang === 'en'
  ? allMdx.filter((f) => !/\.(ko|zh|ja)\.mdx$/.test(f))
  : allMdx.filter((f) => new RegExp(`\\.${lang}\\.mdx$`).test(f));
// Minimum prose paragraphs to trust a hot/total ratio. Below this, one hot
// intro produces a misleading 100% (denominator artifact). patina itself skips
// stylometry on <=2 paragraphs, so honor the same floor here.
const MIN_PROSE_PARAS = 3;
const rows = [];
const thin = []; // <MIN_PROSE_PARAS prose paras but a hot intro -> template candidate
for (const f of files) {
  const prose = stripMdx(readFileSync(f, 'utf8'));
  if (prose.length < 40) continue;
  const a = analyzeText(prose, { lang });
  const total = a.paragraphs.length || 1;
  const hot = a.paragraphs.filter((p) => p.hot).length;
  const rel = f.replace(dir + '/', '');
  const rec = {
    f: rel,
    score: Math.round((hot / total) * 100),
    hot, total,
    leak: a.markupLeakage?.leaked || false,
    candor: a.discourseTells?.fakeCandor?.hot || false,
  };
  if (total < MIN_PROSE_PARAS) {
    if (hot > 0) thin.push(rec);
  } else {
    rows.push(rec);
  }
}
rows.sort((x, y) => y.score - x.score);
console.log(`scored ${rows.length} files (lang=${lang}, >=${MIN_PROSE_PARAS} prose paras)`);
console.log('TOP 15 most AI-ish:');
for (const r of rows.slice(0, 15)) {
  console.log(`  ${String(r.score).padStart(3)}  ${r.hot}/${r.total}${r.leak ? ' LEAK' : ''}${r.candor ? ' CANDOR' : ''}  ${r.f}`);
}
const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
console.log(`avg: ${avg} | >50: ${rows.filter((r) => r.score > 50).length} | ==0: ${rows.filter((r) => r.score === 0).length}`);
console.log(`\nTHIN prose (<${MIN_PROSE_PARAS} paras) with a hot intro — template-intro candidates: ${thin.length}`);
for (const r of thin) console.log(`  ${r.hot}/${r.total}  ${r.f}`);
