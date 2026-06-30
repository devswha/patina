import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStubEnhancedEngine,
  runEnhancedEngineContract,
  assertValidEnhancedRequest,
  EnhancedEngineError,
} from '../../src/enhanced-rewrite-engine-contract.js';
import { MPS_FLOOR, FIDELITY_FLOOR } from '../../src/web-rewrite-contract.js';

test('the public stub engine passes the shared EnhancedRewriteEngine contract', async () => {
  await runEnhancedEngineContract(() => createStubEnhancedEngine(), assert);
});

test('the stub echoes input at floor scores (plumbing only, makes no quality claim)', async () => {
  const engine = createStubEnhancedEngine();
  const r = await engine.rewrite({ text: '안녕하세요', lang: 'ko', mode: 'first' });
  assert.equal(r.text, '안녕하세요');
  assert.equal(r.scores.mps, MPS_FLOOR);
  assert.equal(r.scores.fidelity, FIDELITY_FLOOR);
  assert.equal(r.engine, 'stub');
});

test('assertValidEnhancedRequest throws typed EnhancedEngineError on bad input', () => {
  assert.throws(() => assertValidEnhancedRequest(null), EnhancedEngineError);
  assert.throws(() => assertValidEnhancedRequest({ text: '', lang: 'ko', mode: 'first' }), /text required/);
  assert.throws(() => assertValidEnhancedRequest({ text: 'x', lang: 'de', mode: 'first' }), /unsupported lang/);
  assert.throws(() => assertValidEnhancedRequest({ text: 'x', lang: 'ko', mode: 'nope' }), /first\|refine/);
});

test('the stub output carries no private-asset marker', async () => {
  const r = await createStubEnhancedEngine().rewrite({ text: 'hello', lang: 'en', mode: 'first' });
  const dump = JSON.stringify(r);
  for (const m of ['.private.', '.enhanced.', '.reinforced.', 'corpus/']) assert.ok(!dump.includes(m));
});
