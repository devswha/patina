import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { runMaxMode, selectBest } from '../../src/max-mode.js';
import { formatOutput } from '../../src/output.js';

test('selectBest keeps config order and logs AI-score ties among MPS-passing candidates', () => {
  const logs = [];
  const selection = selectBest([
    { model: 'claude', ok: true, aiScore: 12, mps: 74 },
    { model: 'gemini', ok: true, aiScore: 12, mps: 91 },
    { model: 'codex', ok: true, aiScore: 18, mps: 88 },
  ], { log: (message) => logs.push(message) });

  assert.equal(selection.candidate.model, 'claude');
  assert.equal(selection.fallback, false);
  assert.deepEqual(logs, ['[patina-max] Tie on AI score — picked claude by config order']);
});

test('selectBest keeps config order and logs MPS ties when no candidate passes MPS floor', () => {
  const logs = [];
  const selection = selectBest([
    { model: 'claude', ok: true, aiScore: 42, mps: 62 },
    { model: 'gemini', ok: true, aiScore: 18, mps: 62 },
    { model: 'codex', ok: true, aiScore: 11, mps: 57 },
  ], { log: (message) => logs.push(message) });

  assert.equal(selection.candidate.model, 'claude');
  assert.equal(selection.fallback, true);
  assert.deepEqual(logs, ['[patina-max] Tie on MPS — picked claude by config order']);
});

test('selectBest returns an explicit empty non-fallback selection when no candidate is scoreable', () => {
  const selection = selectBest([
    { model: 'claude', ok: false, error: 'backend failed' },
    { model: 'gemini', ok: true, aiScore: null, mps: 90 },
  ]);

  assert.deepEqual(selection, { candidate: null, fallback: false });
});

test('runMaxMode aborts dispatch and returns partial results on wall-clock timeout', async () => {
  let sawAbortSignal = false;
  let signalWasAborted = false;

  const result = await runMaxMode({
    prompt: 'rewrite this',
    sourceText: 'source text',
    models: ['slow-model'],
    apiKey: 'test',
    baseURL: 'https://example.com/v1',
    config: {},
    patterns: [],
    wallClockBudgetMs: 1,
    callLLMMultipleImpl: ({ signal }) => new Promise((resolve) => {
      sawAbortSignal = typeof signal?.addEventListener === 'function';
      signal.addEventListener('abort', () => {
        signalWasAborted = signal.aborted;
        resolve([{ model: 'slow-model', ok: false, error: 'aborted' }]);
      }, { once: true });
    }),
  });

  assert.equal(sawAbortSignal, true);
  assert.equal(signalWasAborted, true);
  assert.equal(result.timedOut, true);
  assert.equal(result.allFailed, true);
  assert.equal(result.mpsFallback, false);
  assert.deepEqual(result.candidates, [
    { model: 'slow-model', ok: false, error: 'aborted' },
  ]);
  assert.equal(result.best, null);
});

test('runMaxMode uses callLLM, now, and sleep injectables across dispatch and scoring', async () => {
  const seen = [];
  const now = () => 1_000;
  const sleep = async () => {};
  const result = await runMaxMode({
    prompt: 'rewrite this',
    sourceText: 'source text',
    models: ['model-a'],
    apiKey: 'test',
    baseURL: 'https://example.com/v1',
    config: { language: 'en', ouroboros: { 'category-weights': { en: {} } } },
    patterns: [],
    wallClockBudgetMs: 1_000,
    now,
    sleep,
    callLLM: async (args) => {
      seen.push(args);
      assert.equal(args.now, now);
      assert.equal(args.sleep, sleep);

      if (args.prompt.includes('AI-likeness scoring engine')) {
        return '{ "overall": 12, "interpretation": "human" }';
      }
      if (args.prompt.includes('Meaning Preservation evaluator')) {
        return '{ "anchors": [], "pass_count": 1, "total_count": 1, "polarity_pass_count": 0, "polarity_total_count": 0, "mps": 94 }';
      }
      return 'Humanized result.';
    },
  });

  assert.equal(result.best.model, 'model-a');
  assert.equal(result.best.aiScore, 12);
  assert.equal(result.best.mps, 94);
  assert.equal(result.mpsFallback, false);
  assert.equal(seen.length, 3);
});

test('formatOutput surfaces the MAX MPS fallback warning', () => {
  const out = formatOutput({
    type: 'max-mode',
    candidates: [
      { model: 'claude', ok: true, aiScore: 85, mps: 65, result: 'Still sounds packaged.' },
      { model: 'gemini', ok: true, aiScore: 25, mps: 61, result: 'Meaning drifted.' },
    ],
    best: { model: 'claude', ok: true, aiScore: 85, mps: 65, result: 'Still sounds packaged.' },
    allFailed: false,
    mpsFallback: true,
    timedOut: false,
  }, 'rewrite');

  assert.match(out, /⚠ No candidate passed MPS ≥ 70 — selecting by highest MPS \(fallback\)/);
  assert.match(out, /> Exit code: 4/);
  assert.match(out, /\| claude \| 85 \| 65 \| ✅ best \|/);
});
