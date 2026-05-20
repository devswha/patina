import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const PATTERN_DIR = resolve(REPO_ROOT, 'patterns');
const SCORING_PATH = resolve(REPO_ROOT, 'core/scoring.md');
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
const LANGS = ['ko', 'en', 'zh', 'ja'];

function patternFiles() {
  return readdirSync(PATTERN_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => resolve(PATTERN_DIR, name))
    .sort();
}

function parsePatternFile(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(FRONTMATTER_RE);
  assert.ok(m, `${path} must have YAML frontmatter`);
  const meta = yaml.load(m[1]);
  return {
    path,
    meta,
    patternHeadingCount: (m[2].match(/^###\s+\d+\./gm) || []).length,
    plainH3Count: (m[2].match(/^###\s+/gm) || []).length,
  };
}

function packCountsByLang() {
  const counts = {};
  for (const file of patternFiles()) {
    const parsed = parsePatternFile(file);
    const { language, pack, patterns } = parsed.meta;
    const category = pack.replace(`${language}-`, '');
    counts[language] ||= {};
    counts[language][category] = patterns;
  }
  return counts;
}

function scoringTables() {
  const raw = readFileSync(SCORING_PATH, 'utf8');
  const out = {};
  for (const lang of LANGS) {
    const section = raw.match(new RegExp(`### .*\\(${lang}\\)\\n([\\s\\S]*?)(?=\\n### |\\n---)`, 'm'))?.[1];
    assert.ok(section, `core/scoring.md must include ${lang} category table`);
    out[lang] = {};
    for (const line of section.split('\n')) {
      const m = line.match(/^\|\s*([^|*][^|]*?)\s*\|\s*[0-9.]+\s*\|\s*(\d+)\s*\|/);
      if (!m) continue;
      out[lang][m[1].trim()] = Number(m[2]);
    }
    const total = section.match(/^\|\s*\*\*Total\*\*\s*\|\s*\*\*[0-9.]+\*\*\s*\|\s*\*\*(\d+)\*\*/m);
    assert.ok(total, `${lang} scoring table must include Total row`);
    out[lang].Total = Number(total[1]);
  }
  return out;
}

test('pattern pack frontmatter counts match numbered pattern headings', () => {
  for (const file of patternFiles()) {
    const parsed = parsePatternFile(file);
    assert.equal(
      parsed.meta.patterns,
      parsed.patternHeadingCount,
      `${file}: frontmatter patterns must equal numbered ### pattern headings`
    );
    assert.equal(
      parsed.plainH3Count,
      parsed.patternHeadingCount,
      `${file}: non-pattern subsections should not use ### because tooling counts ### as pattern headings`
    );
  }
});

test('core/scoring.md category counts match pattern pack frontmatter', () => {
  const packs = packCountsByLang();
  const tables = scoringTables();
  for (const lang of LANGS) {
    for (const [category, count] of Object.entries(packs[lang])) {
      assert.equal(tables[lang][category], count, `${lang}/${category} scoring count drifted`);
    }
    const expectedTotal = Object.values(packs[lang]).reduce((sum, n) => sum + n, 0);
    assert.equal(tables[lang].Total, expectedTotal, `${lang} scoring total drifted`);
  }
});
