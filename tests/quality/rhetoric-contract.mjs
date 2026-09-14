/**
 * PLAN v2 P0 rhetoric evaluation contract.
 *
 * Synthetic development cases only — not quality claims, not a product scorer.
 * T/C/N judgments stay out of src/features so analysis stays independent of
 * research evaluation.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const KO_DIAGNOSTIC_FIXTURE_PATH = resolve(
  REPO_ROOT,
  'tests/fixtures/rewrite-quality/ko-diagnostic/cases.jsonl',
);

export const INCONCLUSIVE_STATUSES = Object.freeze([
  'skipped',
  'timeout',
  'auth',
  'schema',
  'model_mismatch',
]);

const EVALUABLE_STATUSES = new Set(['ok', 'completed']);

export const EXPECTED_KO_DIAGNOSTIC_IDS = Object.freeze([
  'ko-diag-t-innovative',
  'ko-diag-t-count-hype',
  'ko-diag-c-traffic-outage',
  'ko-diag-c-users-intensity',
  'ko-diag-c-error-possibility',
  'ko-diag-c-quoted-explosion',
  'ko-diag-c-exponential',
  'ko-diag-n-slogan',
]);

/**
 * Per-fixture decorative-problem checks. Not a shared banned-word list:
 * C/N cases that keep 폭발적으로 / 지수적으로 / 놀라운 must not fail here.
 */
export const DECORATIVE_PROBLEM_CHECKS = Object.freeze({
  'ko-diag-t-innovative': remainsInnovativeHype,
  'ko-diag-t-count-hype': remainsCountHype,
});

export function isInconclusiveStatus(status) {
  return INCONCLUSIVE_STATUSES.includes(status);
}

export function remainsInnovativeHype(text) {
  return /혁신적|획기적|놀라운|혁명적|경이로운|유례없는|전례\s*없는/.test(String(text ?? ''));
}

export function remainsCountHype(text) {
  return /폭발적|엄청나|급격히|급격하게|비약적|눈부시게|어마어마|기하급수적|대폭적|급속도로/.test(
    String(text ?? ''),
  );
}

export function namedDecorativeProblemRemains(fixtureId, text) {
  const check = DECORATIVE_PROBLEM_CHECKS[fixtureId];
  if (!check) return false;
  return check(text);
}

export function loadKoDiagnosticFixtures(path = KO_DIAGNOSTIC_FIXTURE_PATH) {
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => validateKoDiagnosticFixture(JSON.parse(line), `${path}:${index + 1}`));
  const ids = rows.map((row) => row.id);
  if (ids.length !== EXPECTED_KO_DIAGNOSTIC_IDS.length) {
    throw new Error(`expected ${EXPECTED_KO_DIAGNOSTIC_IDS.length} KO diagnostic fixtures, got ${ids.length}`);
  }
  for (const id of EXPECTED_KO_DIAGNOSTIC_IDS) {
    if (!ids.includes(id)) throw new Error(`missing KO diagnostic fixture ${id}`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('duplicate KO diagnostic fixture id');
  return rows;
}

export function getKoDiagnosticFixture(id, fixtures = loadKoDiagnosticFixtures()) {
  const fixture = fixtures.find((row) => row.id === id);
  if (!fixture) throw new Error(`unknown KO diagnostic fixture ${id}`);
  return fixture;
}

function validateKoDiagnosticFixture(row, source) {
  for (const field of ['id', 'cohort', 'taskIntent', 'source']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) {
      throw new Error(`missing ${field} in ${source}`);
    }
  }
  if (!['T', 'C', 'N'].includes(row.cohort)) {
    throw new Error(`cohort must be T|C|N in ${source}`);
  }
  if (row.cohort === 'T') {
    if (typeof row.editableProblem !== 'string' || !row.editableProblem.trim()) {
      throw new Error(`T fixture needs editableProblem in ${source}`);
    }
    if (!DECORATIVE_PROBLEM_CHECKS[row.id]) {
      throw new Error(`T fixture ${row.id} has no per-id problem check`);
    }
  } else if (typeof row.protectedRelation !== 'string' || !row.protectedRelation.trim()) {
    throw new Error(`${row.cohort} fixture needs protectedRelation in ${source}`);
  }
  if (row.qualityClaim === true) {
    throw new Error(`KO diagnostic fixtures are not quality claims (${source})`);
  }
  return {
    language: 'ko',
    kind: 'synthetic-development',
    qualityClaim: false,
    ...row,
    source: row.source.trim(),
  };
}

/**
 * @param {object} input
 * @param {object|string} [input.fixture]
 * @param {string} [input.fixtureId]
 * @param {string} [input.finalText]
 * @param {string} input.status
 * @param {boolean|null} [input.meaningPass]
 */
export function evaluateRhetoricContract(input = {}) {
  const fixture = resolveFixture(input);
  const status = input.status;
  if (typeof status !== 'string' || !status.trim()) {
    throw new Error('evaluateRhetoricContract requires a status string');
  }

  const rhetoricEditAllowed = fixture.cohort === 'T';
  const base = {
    fixtureId: fixture.id,
    cohort: fixture.cohort,
    status,
    rhetoricEditAllowed,
    meaningPass: null,
    uncorrectedFailure: null,
    score: null,
  };

  if (isInconclusiveStatus(status) || !EVALUABLE_STATUSES.has(status)) {
    return base;
  }

  const meaningPass = input.meaningPass ?? null;
  const uncorrectedFailure = rhetoricEditAllowed
    ? namedDecorativeProblemRemains(fixture.id, input.finalText ?? '')
    : false;

  return {
    ...base,
    meaningPass,
    uncorrectedFailure,
  };
}

export function isRhetoricSuccess(result) {
  if (!result || isInconclusiveStatus(result.status) || !EVALUABLE_STATUSES.has(result.status)) {
    return false;
  }
  if (result.score === 0) return false;
  if (result.uncorrectedFailure !== false) return false;
  if (result.meaningPass !== true) return false;
  return true;
}

function resolveFixture(input) {
  if (input.fixture && typeof input.fixture === 'object') return input.fixture;
  const id = input.fixtureId ?? input.fixture;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('evaluateRhetoricContract requires fixture or fixtureId');
  }
  return getKoDiagnosticFixture(id);
}
