import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { loadConfig } from '../../src/config.js';
import { scoreDeterministicSignals } from '../../src/scoring.js';
import {
  STRUCTURAL_FEATURE_NAMES,
  loadStructuralModel,
  resolveStructuralModelPath,
} from '../../src/features/index.js';
import { buildDeterministicAuditBackstop } from '../../src/output.js';

function constantModel({ bias = 10, threshold = 0.5, lang = 'ko' } = {}) {
  return {
    lang,
    weights: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(0),
    bias,
    threshold,
    scaler: {
      mu: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(0),
      sigma: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(1),
    },
    featureNames: STRUCTURAL_FEATURE_NAMES,
  };
}

function writeModel(dir, model = constantModel()) {
  const path = resolve(dir, 'model-ko.json');
  writeFileSync(path, JSON.stringify(model), 'utf8');
  return path;
}

test('resolveStructuralModelPath prefers explicit env/config and treats default search as optional', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-model-'));
  const envPath = writeModel(dir);
  const configPath = resolve(dir, 'config-model.json');

  assert.deepEqual(resolveStructuralModelPath({}, { cwd: dir, env: {}, lang: 'ko' }), null);
  assert.equal(
    resolveStructuralModelPath({ stylometry: { structural_model: { path: configPath } } }, { cwd: dir, env: {}, lang: 'ko' }).path,
    configPath,
  );
  assert.equal(
    resolveStructuralModelPath({ stylometry: { structural_model: { path: configPath } } }, { cwd: dir, env: { PATINA_STRUCTURAL_MODEL: envPath }, lang: 'ko' }).path,
    envPath,
  );
});

test('loadStructuralModel loads private weights from an explicit path', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-model-'));
  const path = writeModel(dir);
  const model = loadStructuralModel({ stylometry: { structural_model: { path } } }, { env: {}, cwd: dir, lang: 'ko' });

  assert.equal(model.lang, 'ko');
  assert.deepEqual(model.featureNames, STRUCTURAL_FEATURE_NAMES);
});

test('loadStructuralModel rejects a stale model trained at another feature width (#436)', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-model-'));
  const stale = {
    lang: 'ko',
    weights: new Array(8).fill(0.5),
    bias: 0,
    threshold: 0.5,
    scaler: { mu: new Array(8).fill(0), sigma: new Array(8).fill(1) },
  };
  const path = writeModel(dir, stale);

  assert.throws(
    () => loadStructuralModel({ stylometry: { structural_model: { path } } }, { env: {}, cwd: dir, lang: 'ko' }),
    /Invalid structural model at .*expects 8 features but this patina version extracts 12/,
  );
});

test('configured private model lifts deterministic scoring without hosted service', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-model-'));
  const path = writeModel(dir);
  const text = '오늘은 날씨가 좋았다. 점심을 먹었다.';
  const baseConfig = loadConfig();

  const baseline = scoreDeterministicSignals({ text, config: baseConfig });
  assert.equal(baseline.overall, 0);
  assert.deepEqual(baseline.bands.structuralClassifier, { available: false, hot: null, score: null, floor: 0 });

  const enhanced = scoreDeterministicSignals({
    text,
    config: {
      ...baseConfig,
      stylometry: {
        ...baseConfig.stylometry,
        structural_model: { path },
      },
    },
  });

  assert.equal(enhanced.bands.structuralClassifier.available, true);
  assert.equal(enhanced.bands.structuralClassifier.hot, true);
  assert.ok(enhanced.bands.structuralClassifier.score > 0.99);
  assert.ok(enhanced.overall >= 99);
  assert.equal(enhanced.interpretation, 'heavily AI');
});

test('audit backstop surfaces a hot private structural model verdict', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-model-'));
  const path = writeModel(dir);
  const md = buildDeterministicAuditBackstop('오늘은 날씨가 좋았다. 점심을 먹었다.', {
    lang: 'ko',
    config: { stylometry: { structural_model: { path } } },
  });

  assert.match(md, /structural-classifier/);
  assert.match(md, /문서 단위 구조 분류기/);
});
