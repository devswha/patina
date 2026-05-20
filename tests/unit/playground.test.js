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
  renderAuditDiff,
  SUPPORTED_LANGS,
} from '../../playground/analyzer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const SAMPLES = {
  ko: '이 솔루션은 생산성 향상의 핵심 기반으로 자리매김하고 있습니다.',
  en: 'This transformative solution empowers teams to unlock the full potential of a seamless workflow.',
  zh: '总而言之，这一方案能够全面提升用户体验，并为未来发展提供新的可能。',
  ja: 'まとめると、この仕組みはユーザー体験を向上させ、より良い未来につながります。',
};

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

test('playground HTML points canonical and OG metadata at patina.vibetip.help', () => {
  const html = readFileSync(resolve(REPO_ROOT, 'playground/index.html'), 'utf8');
  assert.match(html, /https:\/\/patina\.vibetip\.help\//);
  assert.match(html, /assets\/social\/patina-og\.svg/);
  assert.match(html, /audit-only playground/);
});

test('Vercel config exposes the playground at the domain root', () => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/' && rule.destination === '/playground/index.html'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/data/:path*' && rule.destination === '/playground/data/:path*'));
  assert.ok(config.headers[0].headers.some((header) => header.key === 'Content-Security-Policy'));
});

test('generated playground lexicon bundle is in sync with markdown lexicons', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-playground-data.mjs', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
