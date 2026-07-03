import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { getRepoRoot } from '../../src/config.js';
import { buildLiveAblationReport, comparePersonaFixtureLive } from '../../scripts/persona-ablation.mjs';
import { loadPersona } from '../../src/personas/loader.js';

const repoRoot = getRepoRoot();

// A mock rewrite that lightly edits the treatment (persona) side and leaves the
// baseline (preserve) side almost untouched, so persona-match improves and churn
// stays measurable — no LLM, fully deterministic.
function mockRewrite({ text, persona }) {
  if (persona.id === 'preserve') return `[BODY]\n${text}\n[/BODY]`;
  // Treatment: drop a stock AI-hype clause to nudge the voice.
  const edited = text.replace('오늘날처럼 빠르게 변화하는 환경 속에서 ', '').replace('바로 ', '');
  return `[BODY]\n${edited}\n[/BODY]`;
}

function mockScore() {
  return { mps: 92, fidelity: 91 };
}

const fixtures = [
  { fixture_id: 'm1', persona_id: 'pragmatic-founder', text: '결론부터 말씀드리자면, 오늘날처럼 빠르게 변화하는 환경 속에서 성장의 핵심은 바로 실행력입니다. 함께라면 불가능은 없습니다.' },
  { fixture_id: 'm2', persona_id: 'blog-essay', text: '바쁜 일상 속에서 우리는 종종 자기 자신을 돌보는 것을 잊곤 합니다. 오늘 하루만큼은 나를 위한 시간을 가져보는 건 어떨까요?' },
];

test('buildLiveAblationReport runs real rewrite+score injections deterministically', async () => {
  const report = await buildLiveAblationReport({
    repoRoot,
    lang: 'ko',
    fixtures,
    rewrite: mockRewrite,
    score: mockScore,
    round: 2,
  });
  assert.equal(report.mode, 'live');
  assert.equal(report.round, 2);
  assert.equal(report.rows.length, 2);
  assert.equal(report.raw_text_included, false);
  // MPS/fidelity from the (mock) scoring pass reach the rows.
  assert.equal(report.rows[0].treatment.mps, 92);
  assert.equal(report.rows[0].treatment.fidelity, 91);
  // Observed churn ceiling is derived from real deterministic churn.
  assert.ok(typeof report.observed.treatment_churn_max === 'number');
  assert.ok(report.observed.treatment_churn_max >= 0 && report.observed.treatment_churn_max <= 1);
  assert.ok(['promote-thresholds', 'keep-placeholder', 'fallback-bridge-only'].includes(report.decision));
});

test('comparePersonaFixtureLive strips BODY tags before deterministic churn', async () => {
  const persona = loadPersona(repoRoot, 'ko', 'pragmatic-founder');
  const preserve = loadPersona(repoRoot, 'ko', 'preserve');
  const row = await comparePersonaFixtureLive({
    fixture: fixtures[0],
    persona,
    preservePersona: preserve,
    thresholds: { mps_floor: 70, fidelity_floor: 70, churn_max: 0.45, persona_match_min: 70 },
    rewrite: mockRewrite,
    score: mockScore,
  });
  // preserve side is untouched → near-zero churn once BODY tags are stripped.
  assert.ok(row.baseline.churn < 0.05, `baseline churn should be ~0, got ${row.baseline.churn}`);
  // treatment dropped a clause → strictly positive churn.
  assert.ok(row.treatment.churn > 0, `treatment churn should be > 0, got ${row.treatment.churn}`);
});
