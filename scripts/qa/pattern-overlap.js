#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const DEFAULT_CORPUS = resolve(REPO_ROOT, 'tests/fixtures/pattern-overlap/corpus.json');
const DEFAULT_SCOPE = new Set(['language', 'style', 'filler']);

function parseArgs(argv) {
  const out = { threshold: 0.3, corpus: DEFAULT_CORPUS, json: false, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--threshold') out.threshold = Number(argv[++i]);
    else if (arg === '--corpus') out.corpus = resolve(process.cwd(), argv[++i]);
    else if (arg === '--json') out.json = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(out.threshold) || out.threshold < 0 || out.threshold > 1) {
    throw new Error('--threshold must be a number between 0 and 1');
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/qa/pattern-overlap.js [--threshold 0.3] [--corpus path] [--all] [--json]\n\nRuns each pattern independently against a fixture corpus using its watch-word list,\nthen prints a pairwise overlap matrix. Default scope is language/style/filler packs.`);
}

function splitFrontmatter(raw, file) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) throw new Error(`${file} is missing YAML frontmatter`);
  return { frontmatter: yaml.load(match[1]) || {}, body: match[2] };
}

function patternFiles() {
  const dir = resolve(REPO_ROOT, 'patterns');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => resolve(dir, name))
    .sort();
}

function numberedSections(body) {
  const headings = [...body.matchAll(/^###\s+(\d+)\.\s+(.+)$/gm)];
  return headings.map((heading, index) => ({
    number: heading[1],
    title: heading[2].trim(),
    body: body.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? body.length),
  }));
}

function isWatchLabel(label) {
  const normalized = label.replace(/[：:]/g, '').trim().toLowerCase();
  return [
    'watch words',
    '주의 어휘',
    '고빈도 ai 어휘',
    '고빈도 어휘',
    '고빈도 표현',
    '高频词汇',
    '注意词汇',
    '注意词',
    '高頻度語彙',
    '注意語彙',
    '注意語',
  ].some((needle) => normalized.includes(needle.toLowerCase()));
}

function cleanTerm(term) {
  return term
    .replace(/^[\s`*_"'“”‘’「」『』()（）]+|[\s`*_"'“”‘’「」『』()（）.。]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWatchTerms(sectionBody) {
  const terms = [];
  for (const line of sectionBody.split('\n')) {
    const match = line.match(/^\*\*([^*]+)\*\*\s*(.+)$/);
    if (!match || !isWatchLabel(match[1])) continue;
    const value = match[2].replace(/\s+—\s+/g, ', ');
    for (const raw of value.split(/[,，、;]/)) {
      const term = cleanTerm(raw);
      if (term.length >= 2) terms.push(term);
    }
  }
  return [...new Set(terms)];
}

function loadPatterns({ all }) {
  const patterns = [];
  const dedupe = new Map();
  for (const file of patternFiles()) {
    const raw = readFileSync(file, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw, file);
    const language = frontmatter.language;
    const pack = frontmatter.pack;
    const category = pack?.replace(`${language}-`, '');
    for (const item of frontmatter['dedupe-with'] || []) {
      const source = item.source;
      const target = item.target;
      if (!source || !target) continue;
      dedupe.set(pairKey(source, target), {
        source,
        target,
        owner: item.owner || source,
        reason: item.reason || '',
      });
    }
    if (!all && !DEFAULT_SCOPE.has(category)) continue;
    for (const section of numberedSections(body)) {
      const id = `${pack}:${section.number}`;
      patterns.push({
        id,
        language,
        pack,
        category,
        number: section.number,
        title: section.title,
        file: relative(REPO_ROOT, file),
        terms: extractWatchTerms(section.body),
      });
    }
  }
  return { patterns, dedupe };
}

function normalizeText(text, lang) {
  return /^(en)$/.test(lang) ? text.toLowerCase() : text;
}

function termMatches(text, term, lang) {
  const haystack = normalizeText(text, lang);
  const needle = normalizeText(term, lang);
  return haystack.includes(needle);
}

function hitsFor(pattern, corpus) {
  const hits = new Set();
  if (pattern.terms.length === 0) return hits;
  for (const doc of corpus) {
    if (doc.lang !== pattern.language) continue;
    if (pattern.terms.some((term) => termMatches(doc.text, term, pattern.language))) {
      hits.add(doc.id);
    }
  }
  return hits;
}

function intersectionSize(a, b) {
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count;
}

function unionSize(a, b) {
  return new Set([...a, ...b]).size;
}

function pairKey(a, b) {
  return [a, b].sort().join('↔');
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function buildMatrix(patterns, corpus, dedupe, threshold) {
  const hitMap = new Map(patterns.map((pattern) => [pattern.id, hitsFor(pattern, corpus)]));
  const rows = [];
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      const a = patterns[i];
      const b = patterns[j];
      if (a.language !== b.language) continue;
      const aHits = hitMap.get(a.id);
      const bHits = hitMap.get(b.id);
      if (aHits.size === 0 || bHits.size === 0) continue;
      const shared = intersectionSize(aHits, bHits);
      if (shared === 0) continue;
      const jaccard = shared / unionSize(aHits, bHits);
      const overlap = shared / Math.min(aHits.size, bHits.size);
      const documentation = dedupe.get(pairKey(a.id, b.id));
      rows.push({
        language: a.language,
        a: a.id,
        b: b.id,
        aHits: aHits.size,
        bHits: bHits.size,
        shared,
        jaccard,
        overlap,
        review: jaccard >= threshold,
        owner: documentation?.owner || '',
        status: jaccard >= threshold ? (documentation ? 'documented' : 'UNDOCUMENTED') : 'below-threshold',
        reason: documentation?.reason || '',
      });
    }
  }
  return rows.sort((a, b) => b.jaccard - a.jaccard || a.language.localeCompare(b.language) || a.a.localeCompare(b.a));
}

function renderMarkdown(rows, opts) {
  const corpusPath = relative(REPO_ROOT, opts.corpus);
  const lines = [];
  lines.push('# Pattern overlap matrix');
  lines.push('');
  lines.push(`- Fixture corpus: \`${corpusPath}\``);
  lines.push(`- Scope: ${opts.all ? 'all pattern packs' : 'language/style/filler packs'}`);
  lines.push(`- Review threshold: Jaccard >= ${pct(opts.threshold)}`);
  lines.push('- Method: each pattern fires independently when any extracted watch term appears in a fixture document.');
  lines.push('');
  lines.push('| Lang | Pattern A | Pattern B | A hits | B hits | Shared | Jaccard | Overlap coeff. | Status | Owner |');
  lines.push('|------|-----------|-----------|--------|--------|--------|---------|----------------|--------|-------|');
  if (rows.length === 0) {
    lines.push('| — | — | — | 0 | 0 | 0 | 0% | 0% | no overlaps | — |');
  } else {
    for (const row of rows) {
      lines.push(`| ${row.language} | ${row.a} | ${row.b} | ${row.aHits} | ${row.bHits} | ${row.shared} | ${pct(row.jaccard)} | ${pct(row.overlap)} | ${row.status} | ${row.owner || '—'} |`);
    }
  }
  const reviewRows = rows.filter((row) => row.review);
  lines.push('');
  lines.push(`Review pairs >= ${pct(opts.threshold)}: ${reviewRows.length}`);
  const missing = reviewRows.filter((row) => row.status === 'UNDOCUMENTED');
  lines.push(`Undocumented review pairs: ${missing.length}`);
  if (missing.length > 0) {
    lines.push('');
    lines.push('## Undocumented pairs');
    for (const row of missing) lines.push(`- ${row.a} ↔ ${row.b} (${pct(row.jaccard)} Jaccard)`);
  }
  const documented = reviewRows.filter((row) => row.status === 'documented');
  if (documented.length > 0) {
    lines.push('');
    lines.push('## Documented review pairs');
    for (const row of documented) {
      lines.push(`- ${row.a} ↔ ${row.b}: owner=${row.owner}; ${row.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(opts.corpus, 'utf8'));
  const { patterns, dedupe } = loadPatterns(opts);
  const rows = buildMatrix(patterns, corpus, dedupe, opts.threshold);
  if (opts.json) console.log(JSON.stringify({ threshold: opts.threshold, rows }, null, 2));
  else process.stdout.write(renderMarkdown(rows, opts));

  if (rows.some((row) => row.review && row.status === 'UNDOCUMENTED')) {
    process.exitCode = 1;
  }
}

main();
