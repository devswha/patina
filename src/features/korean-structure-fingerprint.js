import { splitParagraphs, splitProseSentences, tokenize } from './segment.js';
import { detectTranslationese } from './translationese.js';
import { koreanPostEditeseFeatures } from './stylometry.js';

const KOREAN_STRUCTURE_FINGERPRINT_SCHEMA = 'koStructureFingerprint.v1';

const BULLET_RE = /^\s*(?:[-*+]|\d+[.)]|[가-힣][.)])\s+/;
const PROBLEM_RE = /문제|과제|어려움|지연|오류|장애/;
const CRISIS_RE = /위기|악화|실패|중단|피해|취소/;
const LESSON_RE = /교훈|배웠|원칙|개선|해결/;
const SUMMARY_RE = /결론|요약|정리하면|따라서/;

function round(value) {
  return Number(Number(value ?? 0).toFixed(3));
}

function distribution(values) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function shape(sentence, edge) {
  const tokens = tokenize(sentence, { lang: 'ko' });
  const selected = edge === 'start' ? tokens.slice(0, 1) : tokens.slice(-1);
  return selected
    .join(' ')
    .replace(/[0-9]+/g, '#')
    .replace(/[^\p{L}\p{N}#\s]/gu, '')
    .trim();
}

function repeatedCount(shapes) {
  const counts = new Map();
  for (const value of shapes.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function endingStats(sentences) {
  const endings = sentences
    .map((sentence) => sentence.replace(/[.!?…"'」』)\]]+$/g, '').trim().split(/\s+/).at(-1) ?? '')
    .filter(Boolean);
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const ending of endings) {
    const endingClass = /니다$/.test(ending) ? 'formal' : ending.endsWith('다') ? 'plain' : /[요죠]$/.test(ending) ? 'polite' : 'other';
    current = endingClass === previous ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = endingClass;
  }
  return {
    diversity: endings.length ? round(new Set(endings).size / endings.length) : 0,
    longestStreak: longest,
  };
}

function ruleCounts(result) {
  return Object.fromEntries(result.byRule.map((rule) => [rule.id, rule.count]));
}

function longestCommonSubsequenceLength(source, target) {
  const row = new Uint32Array(target.length + 1);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    let diagonal = 0;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const previous = row[targetIndex];
      row[targetIndex] = source[sourceIndex - 1] === target[targetIndex - 1]
        ? diagonal + 1
        : Math.max(row[targetIndex], row[targetIndex - 1]);
      diagonal = previous;
    }
  }
  return row[target.length];
}

function tokenOverlap(original, rewrite) {
  const source = tokenize(original, { lang: 'ko' });
  const target = tokenize(rewrite, { lang: 'ko' });
  if (source.length === 0 && target.length === 0) {
    return { editChurn: 0, untouchedSpanRatio: 1 };
  }
  const overlap = longestCommonSubsequenceLength(source, target);
  const denominator = Math.max(source.length + target.length, 1);
  const untouchedSpanRatio = (2 * overlap) / denominator;
  return {
    editChurn: round(1 - untouchedSpanRatio),
    untouchedSpanRatio: round(untouchedSpanRatio),
  };
}

function fingerprintVector(fingerprint) {
  const translationeseCount = Object.values(fingerprint.translationese)
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const metrics = fingerprint.postEditese ?? {};
  return [
    fingerprint.paragraphCount,
    fingerprint.sentenceCount,
    fingerprint.paragraphLength?.mean,
    fingerprint.sentenceLength?.mean,
    fingerprint.repeatedOpenerCount,
    fingerprint.repeatedCloserCount,
    fingerprint.endingDiversity,
    fingerprint.endingStreakMax,
    fingerprint.checklistDensity,
    fingerprint.triadicGroupingDensity,
    fingerprint.parallelSectionCueCount,
    fingerprint.arcs?.problemCrisisLesson ? 1 : 0,
    fingerprint.arcs?.problemListSummary ? 1 : 0,
    translationeseCount,
    metrics.interference?.byPassiveCount,
    metrics.interference?.lightVerbCount,
    metrics.rhythm?.sentenceEojeolCV,
  ].map((value) => Number(value || 0));
}

/**
 * Measure normalized distance between two structure fingerprints.
 *
 * @param {ReturnType<typeof fingerprintKoreanStructure>} left
 * @param {ReturnType<typeof fingerprintKoreanStructure>} right
 */
export function koreanStructureDistance(left, right) {
  const a = fingerprintVector(left);
  const b = fingerprintVector(right);
  const distance = a.reduce(
    (sum, value, index) =>
      sum + Math.abs(value - b[index]) / Math.max(1, Math.abs(value), Math.abs(b[index])),
    0,
  );
  return round(distance / a.length);
}

/**
 * Build a deterministic, measurement-only Korean structure fingerprint.
 *
 * @param {string} text
 */
export function fingerprintKoreanStructure(text) {
  const source = String(text ?? '').normalize('NFC');
  const paragraphs = splitParagraphs(source);
  const sentences = paragraphs.flatMap((paragraph) => splitProseSentences(paragraph));
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  const bullets = lines.filter((line) => BULLET_RE.test(line));
  const postEditese = koreanPostEditeseFeatures(source, { lang: 'ko' });
  const endings = endingStats(sentences);

  return {
    schema: KOREAN_STRUCTURE_FINGERPRINT_SCHEMA,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    paragraphLength: distribution(paragraphs.map((paragraph) => [...paragraph].length)),
    sentenceLength: distribution(sentences.map((sentence) => tokenize(sentence, { lang: 'ko' }).length)),
    repeatedOpenerCount: repeatedCount(sentences.map((sentence) => shape(sentence, 'start'))),
    repeatedCloserCount: repeatedCount(sentences.map((sentence) => shape(sentence, 'end'))),
    endingDiversity: endings.diversity,
    endingStreakMax: endings.longestStreak,
    checklistDensity: round(bullets.length / Math.max(1, lines.length)),
    triadicGroupingDensity: round(Math.floor(bullets.length / 3) / Math.max(1, paragraphs.length)),
    parallelSectionCueCount: repeatedCount(paragraphs.map((paragraph) => shape(paragraph, 'start'))),
    arcs: {
      problemCrisisLesson: PROBLEM_RE.test(source) && CRISIS_RE.test(source) && LESSON_RE.test(source),
      problemListSummary: PROBLEM_RE.test(source) && bullets.length > 0 && SUMMARY_RE.test(source),
    },
    translationese: ruleCounts(detectTranslationese(source, { lang: 'ko' })),
    postEditese: postEditese.metrics,
  };
}

/**
 * Compare source and candidate fingerprints.
 *
 * @param {string} original
 * @param {string} rewrite
 */
export function compareKoreanStructure(original, rewrite) {
  const before = fingerprintKoreanStructure(original);
  const after = fingerprintKoreanStructure(rewrite);
  return {
    schema: 'koStructureDelta.v1',
    before,
    after,
    fingerprintDistance: koreanStructureDistance(before, after),
    ...tokenOverlap(original, rewrite),
  };
}
