// Tests for the deterministic AI-tells corpus baseline harness (Phase A).
// Verifies the exact-count drift guard, byte-stable JSON output, schema shape,
// and that no raw corpus text leaks into the report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBaseline, EXPECTED_COUNTS } from '../../scripts/ai-tells-corpus-baseline.mjs';
import { wilsonInterval } from '../../scripts/lib/wilson.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/ai-tells-corpus-baseline.mjs');
const CORPUS_DIR = resolve(REPO_ROOT, 'artifacts/persona-calibration-2026');

function makeSyntheticCorpus({ sycophancy = 298, tells = 85, humans = 7 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-corpus-'));
  mkdirSync(join(dir, 'human-controls'), { recursive: true });
  const syco = [];
  for (let i = 0; i < sycophancy; i += 1) {
    syco.push(JSON.stringify({ phrase: `syco phrase number ${i}`, lang: 'en', platform: 'test' }));
  }
  writeFileSync(join(dir, 'sycophancy-corpus.jsonl'), syco.join('\n') + '\n');
  const tll = [];
  for (let i = 0; i < tells; i += 1) {
    tll.push(JSON.stringify({ phrase: `tell phrase ${i}`, lang: 'en', platform: 'test', category: i % 2 ? 'structural' : 'lexical' }));
  }
  writeFileSync(join(dir, 'tells-corpus.jsonl'), tll.join('\n') + '\n');
  const hum = [];
  for (let i = 0; i < humans; i += 1) {
    hum.push(JSON.stringify({ id: `h${i}`, label: 'human', sha256: `${i}`.padStart(8, '0') }));
  }
  writeFileSync(join(dir, 'human-controls/ko.jsonl'), hum.join('\n') + '\n');
  writeFileSync(join(dir, 'sycophancy-terms.json'), JSON.stringify(['syco phrase number 1']));
  writeFileSync(join(dir, 'tells-terms.json'), JSON.stringify(['tell phrase 1']));
  return dir;
}

test('strict mode passes on the real committed corpus with exact counts', () => {
  const report = buildBaseline({ strict: true });
  assert.equal(report.counts.sycophancy, EXPECTED_COUNTS.sycophancy);
  assert.equal(report.counts.sycophancy_unique, EXPECTED_COUNTS.sycophancy_unique);
  assert.equal(report.counts.tells, EXPECTED_COUNTS.tells);
  assert.equal(report.counts.human_controls, EXPECTED_COUNTS.human_controls);
  assert.equal(EXPECTED_COUNTS.sycophancy, 298);
  assert.equal(EXPECTED_COUNTS.tells, 85);
  assert.equal(EXPECTED_COUNTS.human_controls, 7);
});

test('drift guard fails strict when sycophancy count drifts (e.g. 299)', () => {
  const dir = makeSyntheticCorpus({ sycophancy: 299 });
  try {
    assert.throws(
      () => buildBaseline({ strict: true, corpusDir: dir }),
      /drift/i,
      'strict mode must reject a corpus whose sycophancy count is not 298'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drift guard accepts a synthetic corpus with exact 298/85/7 counts', () => {
  const dir = makeSyntheticCorpus();
  try {
    const report = buildBaseline({ strict: true, corpusDir: dir });
    assert.equal(report.counts.sycophancy, 298);
    assert.equal(report.counts.tells, 85);
    assert.equal(report.counts.human_controls, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict mode fails when required corpus files are missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-empty-'));
  try {
    assert.throws(() => buildBaseline({ strict: true, corpusDir: dir }), /missing/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('smoke mode tolerates a missing corpus without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-empty-'));
  try {
    const report = buildBaseline({ strict: false, corpusDir: dir });
    assert.equal(report.counts.sycophancy, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--json --no-timestamp --strict output is byte-stable across runs', () => {
  const run = () => spawnSync(process.execPath, [SCRIPT, '--json', '--no-timestamp', '--strict'], { encoding: 'utf8' });
  const a = run();
  const b = run();
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout, 'identical flags must yield byte-identical output');
  assert.ok(!a.stdout.includes('generated_at'), '--no-timestamp must omit generated_at');
});

test('schema exposes confusion, Wilson intervals, slices, detector signals, term coverage', () => {
  const report = buildBaseline({ strict: true });
  const m = report.metrics;
  for (const field of ['tp', 'fp', 'fn', 'tn', 'recall', 'precision', 'fpr', 'recall_wilson_95']) {
    assert.ok(field in m.overall, `overall metrics missing ${field}`);
  }
  assert.ok('low' in m.overall.recall_wilson_95 && 'high' in m.overall.recall_wilson_95);
  for (const slice of ['sycophancy', 'lexical', 'structural', 'human_controls']) {
    assert.ok(slice in m.slices, `missing slice ${slice}`);
  }
  for (const sig of ['burstiness', 'mattr', 'lexicon', 'koDiagnostics']) {
    assert.ok(sig in report.detector_signal_fires, `missing signal ${sig}`);
  }
  assert.match(report.term_family_coverage.note, /measurement only/i);
});

test('report contains no raw corpus phrase text (privacy)', () => {
  const report = buildBaseline({ strict: true });
  const serialized = JSON.stringify(report);
  // Sample a real phrase from the committed corpus and assert it never appears.
  const firstLine = readFileSync(join(CORPUS_DIR, 'sycophancy-corpus.jsonl'), 'utf8').split('\n').find(Boolean);
  const phrase = JSON.parse(firstLine).phrase;
  assert.ok(phrase && phrase.length > 0);
  assert.ok(!serialized.includes(phrase), 'serialized report must not embed raw corpus phrases');
  for (const row of report.rows) {
    assert.ok(!('phrase' in row), 'rows must not carry phrase text');
    assert.ok(typeof row.hash === 'string' && row.hash.length > 0, 'rows must carry a stable hash');
  }
});

test('shared wilsonInterval util returns a valid 95% interval', () => {
  const z = wilsonInterval(0, 7);
  assert.ok(z.low >= 0 && z.low < 1e-9, '0/7 lower bound is ~0');
  assert.ok(z.high > 0.3 && z.high < 0.45, '0/7 upper bound is the ~0.35 smoke ceiling');
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });
  const all = wilsonInterval(10, 10);
  assert.ok(all.high === 1 || all.high > 0.9);
  assert.ok(all.low > 0.6 && all.low <= 1);
});

test('expanded human controls (n>7) are all evaluated with a Wilson FP interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-expand-'));
  try {
    mkdirSync(join(dir, 'human-controls/raw'), { recursive: true });
    // Minimal valid sycophancy/tells/terms so smoke mode builds cleanly.
    writeFileSync(join(dir, 'sycophancy-corpus.jsonl'), JSON.stringify({ phrase: 'x', lang: 'en' }) + '\n');
    writeFileSync(join(dir, 'tells-corpus.jsonl'), JSON.stringify({ phrase: 'y', lang: 'en', category: 'lexical' }) + '\n');
    writeFileSync(join(dir, 'sycophancy-terms.json'), JSON.stringify([]));
    writeFileSync(join(dir, 'tells-terms.json'), JSON.stringify([]));
    const n = 12;
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const id = 'hc' + i;
      rows.push(JSON.stringify({ id, label: 'human', sha256: ('' + i).padStart(8, '0') }));
      // Natural multi-paragraph Korean body so analyzeText has real prose to score.
      const body = [
        '오늘은 동네 카페에 갔다. 날이 흐려서 사람이 별로 없었고 조용했다.',
        '커피는 평소보다 조금 진했는데 그게 오히려 좋았다. 한참 앉아서 책을 읽었다.',
        '돌아오는 길에 골목 고양이를 만났다. 사진을 몇 장 찍고 천천히 걸어왔다.',
      ].join('\n\n');
      writeFileSync(join(dir, 'human-controls/raw/' + id + '.txt'), body);
    }
    writeFileSync(join(dir, 'human-controls/ko.jsonl'), rows.join('\n') + '\n');

    const report = buildBaseline({ strict: false, corpusDir: dir });
    assert.equal(report.counts.human_controls, n, 'all expanded controls counted');
    assert.equal(report.human_controls.evaluated, n, 'all expanded controls evaluated (raw present)');
    assert.equal(report.human_controls.not_evaluated, 0);
    const hc = report.metrics.slices.human_controls;
    assert.equal(hc.negatives, n, 'human-control slice negatives equals expanded n');
    assert.ok(hc.fpr_wilson_95 && typeof hc.fpr_wilson_95.low === 'number' && typeof hc.fpr_wilson_95.high === 'number',
      'expanded controls report a Wilson FP interval');
    assert.match(report.human_controls.basis, /smoke/i, 'human controls remain labelled smoke');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('human-controls discovery reads multiple {lang}.jsonl files and language-tags rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-multilang-'));
  try {
    mkdirSync(join(dir, 'human-controls/raw'), { recursive: true });
    writeFileSync(join(dir, 'sycophancy-corpus.jsonl'), JSON.stringify({ phrase: 'x', lang: 'en' }) + '\n');
    writeFileSync(join(dir, 'tells-corpus.jsonl'), JSON.stringify({ phrase: 'y', lang: 'en', category: 'lexical' }) + '\n');
    writeFileSync(join(dir, 'sycophancy-terms.json'), JSON.stringify([]));
    writeFileSync(join(dir, 'tells-terms.json'), JSON.stringify([]));
    const koBody = ['오늘은 동네 카페에 갔다. 조용해서 좋았다.', '커피를 마시며 책을 읽었다. 시간이 천천히 흘렀다.'].join('\n\n');
    const enBody = ['I walked to the corner shop this morning.', 'It was quiet, so I sat and read for a while before heading home.'].join('\n\n');
    writeFileSync(join(dir, 'human-controls/ko.jsonl'), JSON.stringify({ id: 'ko1', label: 'human', sha256: '00000001' }) + '\n');
    writeFileSync(join(dir, 'human-controls/en.jsonl'), JSON.stringify({ id: 'en1', label: 'human', sha256: '00000002' }) + '\n');
    writeFileSync(join(dir, 'human-controls/raw/ko1.txt'), koBody);
    writeFileSync(join(dir, 'human-controls/raw/en1.txt'), enBody);

    const report = buildBaseline({ strict: false, corpusDir: dir });
    assert.equal(report.counts.human_controls, 2, 'both ko and en controls discovered');
    assert.equal(report.human_controls.evaluated, 2);
    const langs = report.rows.filter((r) => r.category === 'human_controls').map((r) => r.lang).sort();
    assert.deepEqual(langs, ['en', 'ko'], 'rows are language-tagged from their jsonl filename');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
