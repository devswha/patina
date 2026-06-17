import { extractOverallScore } from '../output.js';
import { runtimeError } from '../errors.js';
import { createLogger } from '../logger.js';

export function applyScoreGate(result, output, gate, logger = createLogger()) {
  const overall = extractScoreOverall(result, output);
  if (overall === null) {
    throw runtimeError(
      'score gate could not find a numeric overall value',
      'The --score output carried no parseable `overall` number, so the --exit-on gate cannot be applied.',
      'Rerun with `--format json` to inspect the score payload, or drop --exit-on if the backend cannot produce strict score output.'
    );
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

// Strict numeric coercer for the score gate: accepts a value that is already a
// plain number (Number()), and rejects anything else. output.js toFiniteNumber
// (#505) parses strictly too; the two agree on every value the scoring pipeline
// actually emits (a number, or null). They can still differ on non-string,
// non-number junk (e.g. [] -> 0 here vs null there) that the pipeline never
// produces, so the divergence is unreachable end-to-end (#527 H14).
function toFiniteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
