import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectText, inspectAuditSource, normalizedOffsetMap } from '../../src/inspection.js';
import { formatOutput } from '../../src/output.js';
import { maskInspectionNonProse } from '../../src/inspection-masks.js';
import { loadConfig } from '../../src/config.js';

const sample = "In today's rapidly evolving landscape, this comprehensive solution unlocks unprecedented opportunities. Furthermore, it fosters seamless collaboration and takes productivity to the next level.";

test('Korean inspect JSON exposes a read-only structure fingerprint without changing score', () => {
  const text = '헤더 행을 숫자 열로 읽었다. 열 이름을 한 번 더 보는 규칙을 넣었다. 같은 실수는 줄었다.';
  const first = inspectText(text, { language: 'ko' });
  const second = inspectText(text, { language: 'ko' });
  assert.equal(first.available, true);
  assert.equal(first.score, second.score);
  assert.equal(first.interpretation, second.interpretation);
  assert.equal(first.structureFingerprint.schema, 'koStructureFingerprint.v1');
  assert.equal(first.structureFingerprint.paragraphCount, 1);
  assert.ok(Array.isArray(first.advisories));
  assert.equal(inspectText(sample, { language: 'en' }).structureFingerprint, null);
});

test('inspect advisories do not change score and skip STAR on technical types', () => {
  const source = '# Problem\n\n- header years read as measurements\n\n# Method\n\n- second pass\n\n# Result\n\n- four pull requests';
  const rewrite = `${source}\n\nI learned that headers must be split from values.`;
  const technical = inspectText(source, { language: 'en', rewrite, documentType: 'technical' });
  const project = inspectText(source, { language: 'en', rewrite, documentType: 'project-writeup' });
  assert.equal(technical.score, project.score);
  assert.equal(technical.interpretation, project.interpretation);
  assert.ok(!technical.advisories.some((row) => row.code === 'invented-lesson-coda'));
  assert.ok(project.advisories.some((row) => row.code === 'invented-lesson-coda'));
});

test('inspection is backend-free and agrees with the existing offline CLI score', () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = () => assert.fail('inspection called a provider');
  try {
    const result = inspectText(sample, { language: 'en' });
    assert.equal(result.available, true); assert.equal(result.deterministicOnly, true);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every((row) => row.start >= 0 && row.end <= sample.length && row.start < row.end));
    const cli = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../../bin/patina.js', import.meta.url)), '--score', '--offline', '--format', 'json', '--lang', 'en'], { input: sample, encoding: 'utf8' }));
    assert.equal(result.score, cli.overall);
  } finally { globalThis.fetch = originalFetch; }
});

test('duplicate paragraphs and CRLF map to distinct source ranges', () => {
  const text = `${sample}\r\n\r\n${sample}`;
  const result = inspectText(text, { language: 'en' });
  const paragraphs = result.diagnostics.filter((row) => row.code === 'ai-like-paragraph');
  assert.equal(paragraphs.length, 2);
  assert.equal(text.slice(paragraphs[0].start, paragraphs[0].end), sample);
  assert.equal(text.slice(paragraphs[1].start, paragraphs[1].end), sample);
  assert.ok(paragraphs[1].start > paragraphs[0].end);
});

test('NFC and emoji offsets preserve whole original graphemes', () => {
  const source = `cafe\u0301 👩‍💻\r\n${sample}`;
  const map = normalizedOffsetMap(source);
  assert.equal(map.normalized, source.normalize('NFC'));
  const accent = map.normalized.indexOf('é');
  assert.equal(source.slice(map.starts[accent], map.ends[accent]), 'e\u0301');
  const result = inspectText(source, { language: 'en' });
  for (const row of result.diagnostics) assert.ok(row.end <= source.length);
});

test('disabled deterministic analysis is unavailable, never a perfect zero', () => {
  const config = loadConfig(); config.scoring.deterministic.enabled = false;
  const result = inspectText(sample, { language: 'en', config });
  assert.equal(result.available, false); assert.equal(result.score, null); assert.deepEqual(result.diagnostics, []);
});

test('inspection CLI emits bounded JSON with no raw text and rejects provider options', () => {
  const bin = fileURLToPath(new URL('../../bin/patina.js', import.meta.url));
  const raw = execFileSync(process.execPath, [bin, 'inspect', '--lang', 'en'], { input: sample, encoding: 'utf8' });
  const data = JSON.parse(raw); assert.equal(data.schemaVersion, 1); assert.equal(data.offsetEncoding, 'utf-16');
  assert.ok(!raw.includes(sample));
  assert.throws(() => execFileSync(process.execPath, [bin, 'inspect', '--provider', 'openai'], { input: sample, stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [bin, 'inspect', '-', 'README.md'], { input: sample, stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [bin, 'inspect', '--', '-', 'README.md'], { input: sample, stdio: 'pipe' }));
});

test('inspection honors excluded pattern packs', () => {
  const config = loadConfig(); config.documentType = 'social'; config['skip-patterns'] = ['en-style'];
  const result = inspectText('Good morning — see you at lunch.', { language: 'en', config });
  assert.equal(result.score, 0);
});

test('automatic Korean detection is invariant under NFC/NFD source encoding', () => {
  const text = '한국어 문장을 작성합니다. 오늘도 차분하게 이야기를 정리합니다.';
  const nfc = inspectText(text); const nfd = inspectText(text.normalize('NFD'));
  assert.equal(nfc.language, 'ko'); assert.equal(nfd.language, 'ko'); assert.equal(nfc.score, nfd.score);
  assert.notEqual(nfc.sourceHash, nfd.sourceHash);
});

test('sentence hints localize lexical evidence and preserve a calm neighboring sentence', () => {
  const text = 'I fixed the typo. ' + sample;
  const result = inspectText(text, { language: 'en' });
  const sentences = result.diagnostics.filter((row) => row.scope === 'sentence');
  assert.ok(sentences.length > 0);
  for (const row of sentences) {
    assert.ok(!text.slice(row.start, row.end).includes('I fixed the typo.'));
    assert.equal(row.code, 'ai-like-sentence'); assert.ok(row.evidenceCount > 0);
  }
  assert.equal(result.diagnostics.find((row) => row.scope === 'paragraph').localized, true);
});

test('sentence hints skip inline and fenced code without changing the score', () => {
  for (const text of ['``pivotal transformative landscape``', '```js\nconst x = "pivotal transformative landscape";\n```']) {
    const result = inspectText(text, { language: 'en' });
    assert.equal(result.diagnostics.filter((row) => row.scope === 'sentence').length, 0);
  }
  const source = `cafe\u0301 👩‍💻. ${sample}\r\n\r\n${sample}`;
  for (const row of inspectText(source, { language: 'en' }).diagnostics.filter((row) => row.scope === 'sentence')) {
    assert.ok(row.end <= source.length);
    assert.ok(source.slice(row.start, row.end).trim().length > 0);
  }
});

test('JSON audit metadata is source-bound and large audit reports remain usable', () => {
  const inspection = inspectAuditSource(sample, { language: 'en' });
  const result = JSON.parse(formatOutput('Audit report.', 'audit', { format: 'json' }, { inspection }));
  assert.equal(result.output, 'Audit report.');
  assert.equal(result.inspection.sourceHash, inspection.sourceHash);
  assert.ok(result.inspection.diagnostics.some((row) => row.scope === 'sentence'));
  const huge = inspectAuditSource('x'.repeat(200001), { language: 'en' });
  assert.equal(huge.available, false); assert.equal(huge.score, null);
  assert.equal(JSON.parse(formatOutput('Kept.', 'rewrite', { format: 'json' }, { inspection })).inspection, undefined);
});

test('localized masks handle multiline code, indented fences and quoted HTML attributes', () => {
  for (const text of ['`seamless\ntransformative curated`', '<span\n title="seamless transformative curated">ordinary</span>', '<span title="x > seamless transformative curated">ordinary</span>']) {
    assert.equal(inspectText(text, { language: 'en' }).diagnostics.filter((row) => row.scope === 'sentence').length, 0);
    assert.equal(maskInspectionNonProse(text).length, text.length);
  }
  const text = '```\nseamless transformative curated\n   ```\n\n' + sample;
  const diagnostics = inspectText(text, { language: 'en' }).diagnostics.filter((row) => row.scope === 'sentence');
  assert.ok(diagnostics.length > 0); assert.ok(diagnostics.every((row) => row.start >= text.indexOf(sample)));
});

test('long fence runs remain bounded below the inspection input limit', () => {
  const bin = fileURLToPath(new URL('../../bin/patina.js', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [bin, 'inspect', '--lang', 'en'], { input: '~'.repeat(4000), encoding: 'utf8', timeout: 1500 }));
  assert.equal(result.available, true);
});

test('HTML masks preserve Unicode offsets and require an exact closing tag name', () => {
  const prefix = 'İstanbul '.repeat(12);
  for (const tag of ['script', 'style']) {
    const code = `<${tag}>x = "</${tag}ure> seamless transformative curated";</${tag.toUpperCase()}>`;
    const source = `${prefix}${code}\n\n${sample}`;
    const masked = maskInspectionNonProse(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked.slice(0, prefix.length), prefix);
    assert.equal(masked.slice(prefix.length, prefix.length + code.length).trim(), '');
    assert.equal(masked.slice(source.indexOf(sample)), sample);
    const hints = inspectText(source, { language: 'en' }).diagnostics.filter((row) => row.scope === 'sentence');
    assert.ok(hints.length > 0);
    assert.ok(hints.every((row) => row.start >= source.indexOf(sample)));
  }
});
