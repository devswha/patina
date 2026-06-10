import { extractOverallScore } from '../output.js';
import { createLogger } from '../logger.js';

export function applyScoreGate(result, output, gate, logger = createLogger()) {
  const overall = extractScoreOverall(result, output);
  if (overall === null) {
    throw new Error('score gate could not find a numeric `overall` value in --score output.');
  }
  if (overall > gate) {
    logger.warn('score.gate_failed', { message: `[patina] score gate failed: overall ${overall} > ${gate}` });
    process.exitCode = Math.max(Number(process.exitCode) || 0, 3);
  }
}

export function extractScoreOverall(result, output) {
  return extractOverallScore(result, String(output ?? result ?? ''), {
    coerce: toFiniteScore,
    pipeBoundary: true,
  });
}

// Not the same as output.js toFiniteNumber: that helper strips non-numeric
// characters before Number() (so "**12**" parses), while the score gate
// rejects any value that is not already a plain number.
function toFiniteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
