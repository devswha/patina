import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const PATTERN_DIR = resolve(REPO_ROOT, 'patterns');
const LEXICON_DIR = resolve(REPO_ROOT, 'lexicon');
const DOCS_DIR = resolve(REPO_ROOT, 'docs');
const SCORING_PATH = resolve(REPO_ROOT, 'core/scoring.md');
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
const LANGS = ['ko', 'en', 'zh', 'ja'];

function patternFiles() {
  return readdirSync(PATTERN_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => resolve(PATTERN_DIR, name))
    .sort();
}

function lexiconFiles() {
  return readdirSync(LEXICON_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => resolve(LEXICON_DIR, name))
    .sort();
}

function parseFrontmatterFile(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(FRONTMATTER_RE);
  assert.ok(m, `${path} must have YAML frontmatter`);
  const meta = yaml.load(m[1]);
  return { meta, body: m[2] };
}

function parsePatternFile(path) {
  const parsed = parseFrontmatterFile(path);
  return {
    path,
    meta: parsed.meta,
    patternHeadingCount: (parsed.body.match(/^###\s+\d+\./gm) || []).length,
    plainH3Count: (parsed.body.match(/^###\s+/gm) || []).length,
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

function patternHeadings(path) {
  const raw = readFileSync(path, 'utf8');
  return [...raw.matchAll(/^###\s+(\d+)\.\s+(.+)$/gm)].map((m) => ({
    number: Number(m[1]),
    name: m[2].trim(),
  }));
}

function numberedSections(path) {
  const raw = readFileSync(path, 'utf8');
  const headings = [...raw.matchAll(/^###\s+(\d+)\.\s+.+$/gm)];
  return headings.map((m, index) => ({
    number: Number(m[1]),
    body: raw.slice((m.index ?? 0) + m[0].length, headings[index + 1]?.index ?? raw.length),
  }));
}

function extractFireCondition(body) {
  const match = body.match(/(?:\*\*(?:Fire condition|발화 조건|触发条件|発火条件)(?:：|:)\*\*|- (?:Fire condition|발화 조건|触发条件|発火条件):)\s+([^\n]+)/);
  return match?.[1]?.trim() ?? null;
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

test('pattern and lexicon packs carry corpus snapshot metadata', () => {
  for (const file of [...patternFiles(), ...lexiconFiles()]) {
    const { meta } = parseFrontmatterFile(file);
    const snapshot = meta['corpus-snapshot'];
    assert.equal(typeof snapshot, 'object', `${file}: corpus-snapshot metadata is required`);
    assert.equal(typeof snapshot.id, 'string', `${file}: corpus-snapshot.id is required`);
    assert.equal(typeof snapshot.status, 'string', `${file}: corpus-snapshot.status is required`);
    assert.equal(typeof snapshot.source, 'string', `${file}: corpus-snapshot.source is required`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(snapshot, 'last_validated'),
      `${file}: corpus-snapshot.last_validated is required, use null when not validated`
    );
  }
});

test('pattern freshness process defines cadence, candidate fixtures, and promotion gates', () => {
  const processDoc = readFileSync(resolve(REPO_ROOT, 'process/pattern-freshness.md'), 'utf8');
  assert.match(processDoc, /quarterly review process/i);
  assert.match(processDoc, /50-document evaluation fixture/i);
  assert.match(processDoc, /Precision floor/);
  assert.match(processDoc, /Recall floor/);
  assert.match(processDoc, /corpus-snapshot:/);

  const template = readFileSync(resolve(REPO_ROOT, '.github/ISSUE_TEMPLATE/pattern_proposal.yml'), 'utf8');
  assert.match(template, /id: register_scope/);
  assert.match(template, /id: evaluation_fixture/);
  assert.match(template, /id: measurement/);
});

test('viral-hook packs remain score-only with expanded severity-documented coverage', () => {
  for (const lang of LANGS) {
    const file = resolve(PATTERN_DIR, `${lang}-viral-hook.md`);
    const parsed = parsePatternFile(file);
    assert.equal(parsed.meta.score_only, true, `${lang}-viral-hook must stay score-only`);
    assert.equal(parsed.meta.patterns, 9, `${lang}-viral-hook should ship nine patterns`);

    const newSections = numberedSections(file).filter(({ number }) => number >= 6);
    assert.equal(newSections.length, 4, `${lang}-viral-hook should add exactly four patterns beyond the original five`);
    for (const { number, body } of newSections) {
      assert.match(body, /(?:Fire condition|발화 조건|触发条件|発火条件)/, `${lang}-viral-hook #${number} missing fire condition`);
      assert.match(body, /(?:Severity rubric|심각도 기준|严重度标尺|重大度の目安)/, `${lang}-viral-hook #${number} missing severity rubric`);
      assert.match(body, /(?:Exclusion|제외 조건|排除条件|除外条件)/, `${lang}-viral-hook #${number} missing exclusion`);
      assert.match(body, /(?:Before|이전|改写前|変更前)/, `${lang}-viral-hook #${number} missing before example`);
      assert.match(body, /(?:After|이후|改写后|変更後)/, `${lang}-viral-hook #${number} missing after example`);
    }
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

test('per-language pattern references cover source pattern packs', () => {
  const selector = readFileSync(resolve(DOCS_DIR, 'PATTERNS.md'), 'utf8');
  for (const lang of LANGS) {
    const pageName = `PATTERNS-${lang.toUpperCase()}.md`;
    assert.match(selector, new RegExp(`\\[${pageName}\\]\\(${pageName}\\)`));

    const doc = readFileSync(resolve(DOCS_DIR, pageName), 'utf8');
    const sourceFiles = patternFiles().filter((file) => parsePatternFile(file).meta.language === lang);
    const expectedHeadings = sourceFiles.flatMap((file) => patternHeadings(file));
    const actualHeadingCount = (doc.match(/^###\s+/gm) || []).length;

    assert.equal(
      actualHeadingCount,
      expectedHeadings.length,
      `${pageName} must list every ${lang} pattern heading`
    );

    for (const file of sourceFiles) {
      assert.match(doc, new RegExp(`\\[${basename(file)}\\]\\(\\.\\./patterns/`));
    }

    for (const { name } of expectedHeadings) {
      assert.match(doc, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

test('zh and ja patterns document semantic risk and preservation notes', () => {
  for (const lang of ['zh', 'ja']) {
    const sourceFiles = patternFiles().filter((file) => parsePatternFile(file).meta.language === lang);
    for (const file of sourceFiles) {
      for (const { number, body } of numberedSections(file)) {
        assert.match(body, /\*\*Semantic Risk:\*\*\s+(LOW|MEDIUM|HIGH)/, `${file} #${number} missing Semantic Risk`);
        assert.match(body, /\*\*Preservation Note:\*\*\s+\S/, `${file} #${number} missing Preservation Note`);
      }
    }
  }
});

test('README and PATTERNS selector counts stay aligned with pattern packs', () => {
  const packs = packCountsByLang();
  const rewriteCounts = Object.fromEntries(
    LANGS.map((lang) => [lang, packs[lang].language + packs[lang].content + packs[lang].style + packs[lang].communication + packs[lang].structure + packs[lang].filler]),
  );
  const viralCounts = Object.fromEntries(LANGS.map((lang) => [lang, packs[lang]['viral-hook']]));
  const totalPerLang = rewriteCounts.ko + viralCounts.ko;
  const total = totalPerLang * LANGS.length;

  const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(
    readme,
    new RegExp(`\\*\\*${total} patterns\\*\\* \\| ${rewriteCounts.ko} rewrite-capable \\+ ${viralCounts.ko} score-only viral-hook per language \\(${totalPerLang} each across KO/EN/ZH/JA\\)`),
  );
  assert.match(readme, /full 168-pattern catalog/);

  const selector = readFileSync(resolve(DOCS_DIR, 'PATTERNS.md'), 'utf8');
  assert.match(selector, new RegExp(`Patina ships ${total} pattern entries across four languages\\.`));
  const labels = { ko: 'Korean', en: 'English', zh: 'Chinese', ja: 'Japanese' };
  for (const lang of LANGS) {
    assert.match(selector, new RegExp(`\\| ${labels[lang]} \\| .* \\| ${rewriteCounts[lang]} \\| ${viralCounts[lang]} \\|`));
  }
});

test('pattern 33 ships examples in every language, keeps a 2+ rewrite gate, and stays mirrored in docs', () => {
  const checks = [
    { lang: 'ko', source: resolve(PATTERN_DIR, 'ko-language.md'), success: 'examples/33-success-01.md', failure: 'examples/33-failure-01.md', threshold: /2회 이상/, audit: /audit hint/i },
    { lang: 'en', source: resolve(PATTERN_DIR, 'en-language.md'), success: 'examples/en-33-success-01.md', failure: 'examples/en-33-failure-01.md', threshold: /2\+/, audit: /audit hint/i },
    { lang: 'zh', source: resolve(PATTERN_DIR, 'zh-language.md'), success: 'examples/zh-33-success-01.md', failure: 'examples/zh-33-failure-01.md', threshold: /2 处以上|2处以上/, audit: /audit/i },
    { lang: 'ja', source: resolve(PATTERN_DIR, 'ja-language.md'), success: 'examples/ja-33-success-01.md', failure: 'examples/ja-33-failure-01.md', threshold: /2回以上/, audit: /audit hint/i },
  ];

  for (const check of checks) {
    assert.ok(existsSync(resolve(REPO_ROOT, check.success)), `${check.lang} pattern 33 must have a success example`);
    assert.ok(existsSync(resolve(REPO_ROOT, check.failure)), `${check.lang} pattern 33 must have a failure example`);

    const section = numberedSections(check.source).find(({ number }) => number === 33);
    assert.ok(section, `${check.source} must include pattern 33`);
    assert.match(section.body, check.threshold, `${check.source} pattern 33 must require recurrence before rewrite`);
    assert.match(section.body, check.audit, `${check.source} pattern 33 must demote a single instance to audit-only`);

    const docLang = check.lang === 'ko' ? 'KO' : check.lang.toUpperCase();
    const doc = readFileSync(resolve(DOCS_DIR, `PATTERNS-${docLang}.md`), 'utf8');
    assert.match(doc, check.threshold, `docs/PATTERNS-${docLang}.md pattern 33 must require recurrence before rewrite`);
    assert.match(doc, check.audit, `docs/PATTERNS-${docLang}.md pattern 33 must demote a single instance to audit-only`);
    assert.match(doc, new RegExp(check.success.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(doc, new RegExp(check.failure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('mirrored docs keep fire conditions aligned for drift-prone numbered patterns', () => {
  const docByLang = {
    ko: resolve(DOCS_DIR, 'PATTERNS-KO.md'),
    en: resolve(DOCS_DIR, 'PATTERNS-EN.md'),
    zh: resolve(DOCS_DIR, 'PATTERNS-ZH.md'),
    ja: resolve(DOCS_DIR, 'PATTERNS-JA.md'),
  };

  for (const lang of LANGS) {
    const source = resolve(PATTERN_DIR, `${lang}-language.md`);
    const sourceSections = Object.fromEntries(numberedSections(source).map((section) => [section.number, section.body]));
    const docSections = Object.fromEntries(numberedSections(docByLang[lang]).map((section) => [section.number, section.body]));
    for (const number of [32, 33]) {
      assert.equal(
        extractFireCondition(docSections[number]),
        extractFireCondition(sourceSections[number]),
        `${lang} pattern ${number} fire condition drifted between source and docs`,
      );
    }
  }
});

test('CJK translationese patterns require clause-level punctuation rewrites', () => {
  const checks = [
    {
      lang: 'ko',
      source: resolve(PATTERN_DIR, 'ko-structure.md'),
      doc: resolve(DOCS_DIR, 'PATTERNS-KO.md'),
      guard: /구두점만 바꾸지 않는다/,
      example: /TUI 없이 완전 자율로 설치하려면/,
    },
    {
      lang: 'zh',
      source: resolve(PATTERN_DIR, 'zh-structure.md'),
      doc: resolve(DOCS_DIR, 'PATTERNS-ZH.md'),
      guard: /do not replace only the punctuation/,
      example: /不用 TUI 就完成全自动安装/,
    },
    {
      lang: 'ja',
      source: resolve(PATTERN_DIR, 'ja-structure.md'),
      doc: resolve(DOCS_DIR, 'PATTERNS-JA.md'),
      guard: /記号だけを置き換えない/,
      example: /TUIなしで完全自律インストール/,
    },
  ];

  for (const check of checks) {
    const section = numberedSections(check.source).find(({ number }) => number === 26);
    assert.ok(section, `${check.lang} pattern 26 must exist`);
    assert.match(section.body, /issue #352/, `${check.lang} pattern 26 must cite the CJK punctuation regression`);
    assert.match(section.body, check.guard, `${check.lang} pattern 26 must ban token-level punctuation fixes`);
    assert.match(section.body, check.example, `${check.lang} pattern 26 must include a before/after clause-level example`);

    const doc = readFileSync(check.doc, 'utf8');
    assert.match(doc, /Context guard: issue #352/, `${check.lang} pattern docs must mirror the clause-level guard`);
    assert.match(doc, check.example, `${check.lang} pattern docs must mirror the clause-level example`);
  }
});

test('every rewrite pattern has success and failure examples in all four languages', () => {
  // #322: the symmetric pack counts hid missing worked examples (e.g. #29 once
  // had none). Derive the numbered pattern ids from the packs themselves so the
  // guard tracks every rewrite pattern, in every language, and self-extends as
  // patterns are added. Korean examples are unprefixed; en/zh/ja are prefixed.
  for (const lang of LANGS) {
    const sourceFiles = patternFiles().filter((file) => {
      const { meta } = parsePatternFile(file);
      return meta.language === lang && !meta.score_only;
    });
    const numbers = [...new Set(sourceFiles.flatMap((file) => patternHeadings(file).map((heading) => heading.number)))].sort((a, b) => a - b);
    assert.ok(numbers.length > 0, `${lang} should expose numbered pattern headings`);
    const prefix = lang === 'ko' ? '' : `${lang}-`;
    for (const number of numbers) {
      const id = String(number).padStart(2, '0');
      assert.ok(
        existsSync(resolve(REPO_ROOT, `examples/${prefix}${id}-success-01.md`)),
        `${lang} pattern ${id} must have a success example`
      );
      assert.ok(
        existsSync(resolve(REPO_ROOT, `examples/${prefix}${id}-failure-01.md`)),
        `${lang} pattern ${id} must have a failure example`
      );
    }
  }
});
