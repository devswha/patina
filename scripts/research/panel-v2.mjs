import { scoreText } from '../prose-score.mjs';

export const DET_DOCUMENT_THRESHOLD = 35;
export const MIN_FRESH_CORPUS_ACCURACY = 0.85;

export const PANEL_V2 = Object.freeze({
  chief: Object.freeze({
    id: 'judge-det',
    role: 'deterministic-document-verdict',
    threshold: DET_DOCUMENT_THRESHOLD,
  }),
  perceptual: Object.freeze([
    Object.freeze({ id: 'judge-gpt', family: 'gpt-family' }),
    Object.freeze({ id: 'judge-grok', family: 'xai-family' }),
  ]),
});

export function deterministicDocumentVerdict(text, { lang = 'ko', file = '' } = {}) {
  const result = scoreText(text, { file, lang });
  return {
    judge: PANEL_V2.chief.id,
    score: result.score,
    verdict: result.score >= DET_DOCUMENT_THRESHOLD ? 'ai' : 'human',
    threshold: DET_DOCUMENT_THRESHOLD,
    lang: result.lang,
    paragraphCount: result.paragraphCount,
    analysisSkipped: result.analysisSkipped,
  };
}

export function validateFreshCorpus(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('fresh-corpus validation requires at least one labeled row');
  }

  let correct = 0;
  for (const [index, row] of rows.entries()) {
    if (!row || !['ai', 'human'].includes(row.label) || !Number.isFinite(row.score)) {
      throw new TypeError(`fresh-corpus row ${index} requires label=ai|human and a finite score`);
    }
    const verdict = row.score >= DET_DOCUMENT_THRESHOLD ? 'ai' : 'human';
    if (verdict === row.label) correct += 1;
  }

  const accuracy = correct / rows.length;
  return {
    threshold: DET_DOCUMENT_THRESHOLD,
    minimumAccuracy: MIN_FRESH_CORPUS_ACCURACY,
    accuracy,
    correct,
    total: rows.length,
    binaryVerdictsAllowed: accuracy >= MIN_FRESH_CORPUS_ACCURACY,
  };
}

export function requireFreshCorpusValidation(rows) {
  const validation = validateFreshCorpus(rows);
  if (!validation.binaryVerdictsAllowed) {
    throw new Error(
      `judge-det binary verdict disabled: fresh-corpus accuracy ${validation.accuracy.toFixed(3)} < ${MIN_FRESH_CORPUS_ACCURACY.toFixed(2)}`,
    );
  }
  return validation;
}
