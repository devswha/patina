import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { hashText } from '../../scripts/rebaseline-summary.mjs';
import {
  BANNED_KEYS,
  FAMILIES,
  MISS_REASONS,
  NEAR,
  SCHEMA,
  TAXONOMY_VERSION,
  andMax,
  blindOrder,
  buildBlindSheet,
  buildKoreanDiagnosis,
  classifyMissReason,
  collectBannedKeys,
  extractMissReview,
  findHangul,
  gate,
  orMin,
  selectPopulation,
  validateMissReview,
  writeJsonlString,
} from '../../scripts/ko-miss-review-lib.mjs';
import { parseArgs as parseExtractArgs, writeOutputs } from '../../scripts/ko-miss-review-extract.mjs';
import { runValidation } from '../../scripts/ko-miss-review-validate.mjs';
import { runAdjudicate, runBlind, runMerge } from '../../scripts/ko-miss-review-kit.mjs';
import { buildReport, summarize, renderReport } from '../../scripts/ko-miss-review-report.mjs';

// Synthetic Korean fixtures. The three "miss" texts are unflagged by the
// analyzer (two sentences, polite endings, no lexicon hits); the "drift" text
// is flagged hot through the KO ending-monotony gate. The extractor asserts
// these preconditions itself, so a fixture that stops behaving errors loudly.
const MISS_TEXTS = {
  'fx-ko-gpt-001': '오늘은 팀 회의에서 새로운 일정에 대해 이야기했어요. 다음 주부터는 매주 수요일 오전에 짧게 모이기로 했고, 회의록은 제가 정리해서 공유할게요.',
  'fx-ko-gpt-002': '주말에 집 근처 공원을 한 바퀴 돌았는데 생각보다 사람이 많았습니다. 벤치가 거의 다 차 있어서 잠깐 서서 쉬다가 돌아왔고, 다음에는 아침 일찍 가 보려고 합니다.',
  'fx-ko-gpt-003': '이번 업데이트에서는 로그인 화면의 글자 크기를 조금 키웠습니다. 작은 화면에서 버튼이 겹치던 문제도 함께 고쳤으니 확인해 보시고 이상하면 알려 주세요.',
};
const DRIFT_TEXT = '이 기능은 사용자 경험을 개선한다. 설정은 관리자 화면에서 변경한다. 결과는 대시보드에 바로 표시된다. 오류는 로그 화면에서 확인한다. 권한은 팀 단위로 관리한다.';
const REGISTERS_BY_ID = { 'fx-ko-gpt-001': 'blog', 'fx-ko-gpt-002': 'chat-update', 'fx-ko-gpt-003': 'product-doc', 'fx-ko-gpt-004': 'academic-summary' };
const PROVENANCE = { git_commit: 'a'.repeat(40), features_tree: 'b'.repeat(40), worktree_clean: true };

function scoredRow(sampleId, text, overrides = {}) {
  return {
    sample_id: sampleId,
    language: 'ko',
    class: 'ai-like',
    register: REGISTERS_BY_ID[sampleId] ?? 'blog',
    model_family: 'gpt-family',
    provider: 'codex-cli',
    model: 'gpt-5.5',
    generated_at: '2026-05-22',
    prompt_id: `${sampleId}-prompt`,
    decoding: { surface: 'codex-cli', temperature: 'provider-default' },
    postprocess: { editing_pass: 'none' },
    redistribution: 'hash-only',
    source_review: { status: 'unit', rationale: 'unit fixture' },
    text_hash: hashText(text),
    expected_hot: true,
    predicted_hot: false,
    patina_score: 0,
    score_review: { scorer: 'patina deterministic analyzer', paragraph_count: 1, hot_paragraph_count: 0 },
    ...overrides,
  };
}

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'patina-ko-miss-review-'));
  const scored = [
    ...Object.entries(MISS_TEXTS).map(([id, text]) => scoredRow(id, text)),
    scoredRow('fx-ko-gpt-004', DRIFT_TEXT), // recorded as a miss, flagged hot today
    scoredRow('fx-ko-gpt-005', MISS_TEXTS['fx-ko-gpt-001'], { predicted_hot: true, patina_score: 100 }),
    scoredRow('fx-ko-claude-001', MISS_TEXTS['fx-ko-gpt-002'], { model_family: 'claude-family' }),
  ];
  const corpus = [
    ...Object.entries(MISS_TEXTS).map(([id, text]) => ({ sample_id: id, text })),
    { sample_id: 'fx-ko-gpt-004', text: DRIFT_TEXT },
    { sample_id: 'fx-ko-gpt-005', text: MISS_TEXTS['fx-ko-gpt-001'] },
    { sample_id: 'fx-ko-claude-001', text: MISS_TEXTS['fx-ko-gpt-002'] },
  ];
  const sourceManifest = join(dir, 'scored.public.jsonl');
  const privateCorpus = join(dir, 'private.jsonl');
  writeFileSync(sourceManifest, writeJsonlString(scored));
  writeFileSync(privateCorpus, writeJsonlString(corpus));
  return { dir, sourceManifest, privateCorpus };
}

function extractFixture(ws, overrides = {}) {
  return extractMissReview({
    sourceManifest: ws.sourceManifest,
    privateCorpus: ws.privateCorpus,
    analyzedAt: '2026-09-02T08:00:00.000Z',
    onDrift: 'exclude',
    provenance: PROVENANCE,
    ...overrides,
  });
}

function marginsFor(deficits, advisoryPresent = false) {
  const families = {};
  for (const family of FAMILIES) {
    const value = deficits[family];
    families[family] = value === undefined ? { deficit: null, absent: true } : { deficit: value, absent: false };
  }
  const near = FAMILIES.filter((family) => !families[family].absent && families[family].deficit <= NEAR);
  const present = FAMILIES.filter((family) => !families[family].absent);
  const closest = present.sort((a, b) => families[a].deficit - families[b].deficit)[0] ?? null;
  return {
    taxonomy_version: TAXONOMY_VERSION,
    near: NEAR,
    families,
    near_families: near,
    min_deficit: closest ? families[closest].deficit : null,
    closest_family: closest,
    advisory: { present: advisoryPresent },
  };
}

test('gate deficits are normalized to the threshold, 0 at equality, absent without a value', () => {
  assert.equal(gate(2, 3, '>=').deficit, 0.333333);
  assert.equal(gate(3, 3, '>=').deficit, 0);
  assert.equal(gate(0.36, 0.3, '<').deficit, 0.2);
  assert.equal(gate(0.3, 0.3, '<').deficit, 0);
  assert.equal(gate(0.1, 0.3, '<').deficit, 0);
  assert.equal(gate(5, 3, '>').deficit, 0);
  assert.equal(gate(null, 3, '>=').absent, true);
  assert.equal(gate(null, 3, '>=').deficit, null);
  const and = andMax({ a: gate(2, 4, '>='), b: gate(0.33, 0.3, '<') });
  assert.equal(and.deficit, 0.5);
  assert.equal(andMax({ a: gate(2, 4, '>='), b: gate(null, 1, '<') }).absent, true);
  const or = orMin({ a: gate(2, 4, '>='), b: gate(0.33, 0.3, '<'), c: gate(null, 1, '>=') });
  assert.equal(or.deficit, 0.1);
  assert.equal(orMin({ a: gate(null, 1, '>=') }).absent, true);
});

test('classifyMissReason walks the decision tree in order', () => {
  assert.equal(classifyMissReason(marginsFor({ burstiness: 0.05, mattr: 0.08, lexicon: 1 })), 'multi-threshold-near');
  for (const family of FAMILIES) {
    assert.equal(classifyMissReason(marginsFor({ [family]: 0.1, lexicon: family === 'lexicon' ? 0.1 : 1 })), `threshold-near-${family}`);
  }
  assert.equal(classifyMissReason(marginsFor({ burstiness: 0.4, mattr: 1.2 }, true)), 'threshold-far');
  assert.equal(classifyMissReason(marginsFor({ burstiness: 1, mattr: 1.2 }, true)), 'advisory-only-coverage-gap');
  assert.equal(classifyMissReason(marginsFor({ burstiness: 1, mattr: 1.2 }, false)), 'no-modeled-signal');
  assert.equal(classifyMissReason(marginsFor({}, false)), 'no-modeled-signal');
  for (const code of MISS_REASONS) assert.match(code, /^[a-z][a-z0-9-]{0,63}$/u);
});

test('selectPopulation keeps only the frozen KO GPT-family miss cell', () => {
  const rows = [scoredRow('a', 'x'), scoredRow('b', 'y', { predicted_hot: true }), scoredRow('c', 'z', { model_family: 'claude-family' }), scoredRow('d', 'w', { language: 'en' })];
  assert.deepEqual(selectPopulation(rows).map((row) => row.sample_id), ['a']);
});

test('buildKoreanDiagnosis attributes translationese to its paragraph', () => {
  const text = [
    '회의는 내일 오전 열 시에 시작한다. 참석자는 자료를 미리 읽어 온다.',
    '당신은 커맨드 기둥을 설정한다. 이것은 담당자에 의해 검토된다. 그것은 운영팀에 의해 다시 조정된다.',
  ].join('\n\n');

  const diagnosis = buildKoreanDiagnosis(text, { repoRoot: resolve('.') });

  assert.equal(diagnosis.schema, 'koDiagnosis.v1');
  assert.equal(diagnosis.paragraphs.length, 2);
  assert.equal(diagnosis.paragraphs[0].preserveOnly, true);
  assert.equal(diagnosis.paragraphs[1].preserveOnly, false);
  assert.ok(diagnosis.paragraphs[1].signals.some((signal) => signal.startsWith('translationese:')));
});

test('buildKoreanDiagnosis routes unflagged prose as clean', () => {
  const diagnosis = buildKoreanDiagnosis('창문을 열자 빗소리가 가까워졌다. 잠시 뒤 골목이 조용해졌다.', { repoRoot: resolve('.') });

  assert.equal(diagnosis.route, 'clean');
  assert.deepEqual(diagnosis.paragraphs.map((paragraph) => paragraph.preserveOnly), [true]);
});

test('buildKoreanDiagnosis emits bounded signal identifiers without source text', () => {
  const secret = '고객비밀문구';
  const text = `${secret}는 운영팀에 의해 검토된다. ${secret}는 운영팀에 의해 기록된다.`;

  const diagnosis = buildKoreanDiagnosis(text, { repoRoot: resolve('.') });

  assert.equal(JSON.stringify(diagnosis).includes(secret), false);
  assert.ok(diagnosis.paragraphs.every((paragraph) => paragraph.signals.length <= 12));
});

test('buildKoreanDiagnosis globally bounds paragraph output', () => {
  const text = Array.from(
    { length: 200 },
    (_, index) => `문단 ${index + 1}의 결과는 담당자에 의해 검토된다.`,
  ).join('\n\n');

  const diagnosis = buildKoreanDiagnosis(text, { repoRoot: resolve('.') });

  assert.equal(diagnosis.paragraphs.length, 64);
  assert.equal(diagnosis.omittedParagraphCount, 136);
  assert.ok(JSON.stringify(diagnosis).length < 30_000);
});

test('extractMissReview emits hash-only rows, excludes drifted rows, and regenerates byte-identically', () => {
  const ws = makeWorkspace();
  try {
    const result = extractFixture(ws);
    assert.deepEqual(result.errors, []);
    assert.equal(result.population.candidates, 4);
    assert.equal(result.rows.length, 3);
    assert.equal(result.exclusions.length, 1);
    assert.equal(result.exclusions[0].sample_id, 'fx-ko-gpt-004');
    assert.deepEqual(result.exclusions[0].hot_signals, ['rhythm:burstiness-low', 'rhythm:ending-monotony']);
    assert.equal(result.exclusions[0].exclusion_reason, 'precondition-violated:document-hot');

    for (const row of result.rows) {
      assert.equal(row.schema, SCHEMA);
      assert.equal(row.analysis_role, 'discovery-only');
      assert.equal(row.taxonomy_version, TAXONOMY_VERSION);
      assert.equal(row.signals.document.hot, false);
      assert.equal(row.predicted_hot, false);
      assert.equal(row.expected_hot, true);
      assert.equal(row.text, undefined);
      assert.match(row.source_manifest_hash, /^sha256:[0-9a-f]{64}$/u);
      assert.match(row.analysis_provenance.options_hash, /^sha256:[0-9a-f]{64}$/u);
      assert.match(row.analysis_provenance.signals_hash, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(row.analysis_provenance.normalized_text_hash, row.text_hash);
      assert.deepEqual(collectBannedKeys(row), []);
      assert.equal(findHangul(row), null);
      assert.ok(MISS_REASONS.includes(row.computed_reason));
      assert.equal(row.margins.near, NEAR);
      assert.equal(row.review, null);
      assert.equal(row.signals.paragraphs[0].sentence_count, 2);
      // the standard burstiness gate is blocked by sentence count on every fixture
      assert.equal(row.margins.families.burstiness.gates.standard.gates.sentence_count.deficit, 0.333333);
      assert.equal(row.margins.families.structure.gates.structural_classifier.absent, true);
    }
    assert.equal(findHangul(result.exclusions[0]), null);

    const again = extractFixture(ws);
    assert.equal(JSON.stringify(again.rows), JSON.stringify(result.rows));
    assert.equal(JSON.stringify(again.exclusions), JSON.stringify(result.exclusions));

    const strict = extractFixture(ws, { onDrift: 'fail' });
    assert.equal(strict.errors.length, 1);
    assert.match(strict.errors[0], /fx-ko-gpt-004: current analyzer flags the document hot \(rhythm:burstiness-low, rhythm:ending-monotony\)/u);
    assert.equal(strict.rows.length, 3);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

test('extractMissReview reports missing private text and hash mismatches', () => {
  const ws = makeWorkspace();
  try {
    const corpus = readFileSync(ws.privateCorpus, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    corpus[0].text = `${corpus[0].text} 수정됨.`;
    corpus.splice(1, 1);
    writeFileSync(ws.privateCorpus, writeJsonlString(corpus));
    const result = extractFixture(ws);
    assert.ok(result.errors.some((error) => /fx-ko-gpt-001: text_hash mismatch/u.test(error)));
    assert.ok(result.errors.some((error) => /fx-ko-gpt-002: private text not found/u.test(error)));
    const missing = extractMissReview({ sourceManifest: join(ws.dir, 'nope.jsonl'), privateCorpus: ws.privateCorpus, provenance: PROVENANCE });
    assert.match(missing.errors[0], /JSONL input not found/u);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

test('validateMissReview passes fresh output and catches tampering, leaks and population gaps', () => {
  const ws = makeWorkspace();
  try {
    const result = extractFixture(ws);
    const base = { exclusions: result.exclusions, sourceManifest: ws.sourceManifest, privateCorpus: ws.privateCorpus };
    const clean = validateMissReview({ rows: result.rows, ...base });
    assert.deepEqual(clean.errors, []);
    assert.equal(clean.population.candidates, 4);
    assert.equal(clean.regeneration.identical, 3);
    assert.equal(clean.warnings.filter((w) => /unreviewed/u.test(w)).length, 3);
    assert.ok(validateMissReview({ rows: result.rows, ...base, requireReview: true }).errors.some((e) => /unreviewed rows/u.test(e)));

    const clone = () => JSON.parse(JSON.stringify(result.rows));
    let rows = clone();
    rows[0].text_hash = `sha256:${'0'.repeat(64)}`;
    assert.ok(validateMissReview({ rows, ...base }).errors.some((e) => /text_hash differs from the source manifest/u.test(e)));

    rows = clone();
    rows[0].computed_reason = 'no-modeled-signal';
    assert.ok(validateMissReview({ rows, ...base }).errors.some((e) => /does not follow the decision tree/u.test(e)));

    rows = clone();
    rows[0].signals.document.hot = true;
    const tampered = validateMissReview({ rows, ...base }).errors;
    assert.ok(tampered.some((e) => /precondition triple/u.test(e)));
    assert.ok(tampered.some((e) => /signals_hash does not match/u.test(e)));

    rows = clone();
    rows[1].signals.paragraphs[0].hits = ['leak'];
    assert.ok(validateMissReview({ rows, ...base }).errors.some((e) => /banned key present: signals.paragraphs\[0\].hits/u.test(e)));

    rows = clone();
    rows[1].review = { labels: [], disagreement: false, final_reason: rows[1].computed_reason };
    rows[1].reviewer_notes = '원문 문장을 그대로 붙여 넣음';
    const hangul = validateMissReview({ rows, ...base }).errors;
    assert.ok(hangul.some((e) => /Hangul text is not allowed/u.test(e)));
    assert.ok(hangul.some((e) => /at least two independent labels/u.test(e)));

    rows = clone();
    rows[2].review = { labels: [], disagreement: false, final_reason: rows[2].computed_reason, adjudication: { rationale: MISS_TEXTS['fx-ko-gpt-003'].slice(0, 12).replace(/[ᄀ-ᇿ㄰-㆏가-힯]/gu, 'x') } };
    assert.ok(!validateMissReview({ rows, ...base }).errors.some((e) => /substring of a private source text/u.test(e)));
    rows[2].review.adjudication.rationale = 'see: 로그인 화면의 글자 크기';
    const leak = validateMissReview({ rows, ...base }).errors;
    assert.ok(leak.some((e) => /substring of a private source text/u.test(e)));
    assert.ok(leak.some((e) => /Hangul text is not allowed/u.test(e)));

    rows = clone().slice(1);
    assert.ok(validateMissReview({ rows, ...base }).errors.some((e) => /population row fx-ko-gpt-001 is missing/u.test(e)));

    const noCorpus = validateMissReview({ rows: clone(), exclusions: result.exclusions, sourceManifest: ws.sourceManifest, privateCorpus: join(ws.dir, 'absent.jsonl') });
    assert.deepEqual(noCorpus.errors, []);
    assert.ok(noCorpus.warnings.some((w) => /private corpus not present/u.test(w)));
    assert.equal(noCorpus.regeneration, null);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

test('blind sheets hide identity fields and reviewers get their own deterministic order', () => {
  const ws = makeWorkspace();
  try {
    const result = extractFixture(ws);
    const sheet = buildBlindSheet(result.rows, 'reviewer-a');
    assert.equal(sheet.header.reviewer, 'reviewer-a');
    assert.equal(sheet.rows.length, 3);
    for (const row of sheet.rows) {
      assert.deepEqual(Object.keys(row).sort(), ['blind_id', 'margins', 'miss_reason', 'reviewer_notes', 'signals']);
      assert.equal(row.margins.near_families, undefined);
      assert.equal(row.margins.closest_family, undefined);
      assert.equal(row.margins.min_deficit, undefined);
      const json = JSON.stringify(row);
      for (const needle of ['fx-ko-gpt', 'codex-cli', 'gpt-5.5', 'sha256:', 'computed_reason', 'register', 'patina_score']) {
        assert.equal(json.includes(needle), false, `sheet leaks ${needle}`);
      }
    }
    const orderA = blindOrder(result.rows, 'reviewer-a').map((entry) => entry.row.sample_id);
    const orderAgain = blindOrder(result.rows, 'reviewer-a').map((entry) => entry.row.sample_id);
    assert.deepEqual(orderA, orderAgain);
    const orderB = blindOrder(result.rows, 'reviewer-b').map((entry) => entry.row.sample_id);
    assert.deepEqual([...orderB].sort(), [...orderA].sort());
    assert.throws(() => buildBlindSheet(result.rows, 'Reviewer A'), /pseudonymous slug/u);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

function fillSheet(path, fill) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const [header, ...rows] = lines;
  const filled = rows.map((row, index) => ({ ...row, ...fill(row, index) }));
  writeFileSync(path, writeJsonlString([header, ...filled]));
  return { header, rows: filled };
}

test('kit merge records two labels, blocks unresolved disagreement, and accepts adjudication', () => {
  const ws = makeWorkspace();
  try {
    const result = extractFixture(ws);
    const manifest = join(ws.dir, 'manifest.jsonl');
    const exclusions = join(ws.dir, 'exclusions.jsonl');
    writeOutputs(result, { output: manifest, exclusionsOutput: exclusions });
    const a = runBlind({ input: manifest, reviewer: 'reviewer-a', output: join(ws.dir, 'a.jsonl') });
    runBlind({ input: manifest, reviewer: 'reviewer-b', output: join(ws.dir, 'b.jsonl') });
    assert.equal(a.rows, 3);
    const computedByBlind = new Map(blindOrder(result.rows, 'reviewer-b').map((entry) => [entry.blind_id, entry.row.computed_reason]));
    fillSheet(join(ws.dir, 'a.jsonl'), (row) => ({ miss_reason: classifyMissReason({ ...row.margins, near_families: FAMILIES.filter((f) => !row.margins.families[f].absent && row.margins.families[f].deficit <= NEAR), min_deficit: Math.min(...FAMILIES.filter((f) => !row.margins.families[f].absent).map((f) => row.margins.families[f].deficit)) }), reviewer_notes: 'sentence-count sub-gate blocks the standard burstiness gate', reviewed_at: '2026-09-02T09:00:00Z' }));
    // reviewer-b disagrees on the first row of their own order
    fillSheet(join(ws.dir, 'b.jsonl'), (row, index) => ({ miss_reason: index === 0 ? 'no-modeled-signal' : computedByBlind.get(row.blind_id), reviewer_notes: 'checked margins', reviewed_at: '2026-09-02T09:30:00Z' }));

    const blocked = runMerge({ input: manifest, sheets: [join(ws.dir, 'a.jsonl'), join(ws.dir, 'b.jsonl')], output: join(ws.dir, 'merged.jsonl') });
    assert.deepEqual(blocked.errors, []);
    assert.equal(blocked.unresolved.length, 1);
    assert.equal(blocked.written, false);
    assert.equal(blocked.agreement.agreed, 2);

    const adj = runAdjudicate({ input: manifest, adjudicator: 'reviewer-c', sheets: [join(ws.dir, 'a.jsonl'), join(ws.dir, 'b.jsonl')], output: join(ws.dir, 'adj.jsonl') });
    assert.equal(adj.disputed, 1);
    const adjSheet = fillSheet(join(ws.dir, 'adj.jsonl'), () => ({ final_reason: 'threshold-far', rationale: 'margins show a finite deficit below one on burstiness; the tree gives threshold-far', reviewed_at: '2026-09-02T10:00:00Z' }));
    assert.equal(adjSheet.rows[0].labels.length, 2);

    const merged = runMerge({ input: manifest, sheets: [join(ws.dir, 'a.jsonl'), join(ws.dir, 'b.jsonl')], adjudication: join(ws.dir, 'adj.jsonl'), output: join(ws.dir, 'merged.jsonl') });
    assert.deepEqual(merged.errors, []);
    assert.deepEqual(merged.unresolved, []);
    assert.equal(merged.written, true);
    const rows = readFileSync(join(ws.dir, 'merged.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(rows.length, 3);
    const disputed = rows.filter((row) => row.review.disagreement);
    assert.equal(disputed.length, 1);
    assert.equal(disputed[0].review.adjudication.reviewer, 'reviewer-c');
    assert.equal(disputed[0].miss_reason, 'threshold-far');
    assert.equal(disputed[0].reviewer, 'reviewer-c');
    for (const row of rows) {
      assert.equal(row.review.labels.length, 2);
      assert.equal(row.miss_reason, row.review.final_reason);
      assert.equal(typeof row.reviewer_notes, 'string');
    }
    const check = runValidation({ input: join(ws.dir, 'merged.jsonl'), exclusions, sourceManifest: ws.sourceManifest, privateCorpus: ws.privateCorpus, requireReview: true });
    assert.deepEqual(check.errors, []);
    assert.equal(check.counts.reviewed, 3);

    const report = buildReport({ input: join(ws.dir, 'merged.jsonl'), exclusions, sourceManifest: ws.sourceManifest, privateCorpus: ws.privateCorpus, generatedAt: '2026-09-02T11:00:00Z', reviewerKinds: { 'reviewer-a': 'llm-agent', 'reviewer-b': 'llm-agent' } });
    assert.equal(report.summary.validation.pass, true);
    assert.equal(report.summary.population.candidates, 4);
    assert.equal(report.summary.exclusions.count, 1);
    assert.equal(report.summary.review.initialAgreement.agreed, 2);
    assert.equal(report.summary.review.adjudicated, 1);
    assert.match(report.markdown, /## register x miss_reason/u);
    assert.deepEqual(report.summary.sentenceCounts, { 2: 3 });
    assert.equal(report.summary.burstinessGate.standard + report.summary.burstinessGate.ending_monotony + report.summary.burstinessGate.tie, 3);
    assert.match(report.markdown, /\| 2 \| 3 \|/u);
    assert.match(report.markdown, /reviewer-a \(llm-agent\)/u);
    assert.match(report.markdown, /rhythm:ending-monotony \| 1/u);
    assert.match(report.markdown, /rhythm:burstiness-low \| 1/u);
    assert.equal(findHangul(report.summary), null);
    assert.equal(/[가-힯]/u.test(report.markdown), false);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

test('report summarize works on unreviewed rows and the extractor CLI validates --on-drift', () => {
  const ws = makeWorkspace();
  try {
    const result = extractFixture(ws);
    const validation = validateMissReview({ rows: result.rows, exclusions: result.exclusions });
    const summary = summarize({ rows: result.rows, exclusions: result.exclusions, validation, input: 'x.jsonl', exclusionsPath: null, manifestHash: `sha256:${'0'.repeat(64)}`, generatedAt: '2026-09-02T11:00:00Z', reviewerKinds: {} });
    assert.equal(summary.review.reviewed, 0);
    assert.equal(Object.values(summary.byReason).reduce((sum, n) => sum + n, 0), 3);
    assert.match(renderReport(summary), /No reviewer labels merged yet/u);
    assert.equal(parseExtractArgs(['--on-drift', 'exclude', '--analyzed-at', '2026-09-02T08:00:00Z']).onDrift, 'exclude');
    assert.throws(() => parseExtractArgs(['--on-drift', 'ignore']), /--on-drift must be fail or exclude/u);
    assert.throws(() => parseExtractArgs(['--analyzed-at', 'yesterday']), /ISO timestamp/u);
    assert.ok(BANNED_KEYS.includes('hits'));
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});
