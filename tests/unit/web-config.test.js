// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadWebConfig, resolveBundleRoot } from '../../src/web-config.js';

function readBaseline(root = resolveBundleRoot()) {
  return yaml.load(readFileSync(resolve(root, '.patina.default.yaml'), 'utf8'));
}

test('loadWebConfig returns the baseline config mapping', () => {
  const config = loadWebConfig();
  assert.equal(config.language, 'ko');
  assert.equal(config.profile, 'default');
  assert.ok(config.lexicon && typeof config.lexicon === 'object');
  assert.deepEqual(config, readBaseline());
});

test('loadWebConfig ignores ambient project .patina.yaml overrides', () => {
  const root = resolveBundleRoot();
  const ambientPath = resolve(root, '.patina.yaml');
  const previous = existsSync(ambientPath) ? readFileSync(ambientPath, 'utf8') : null;

  try {
    writeFileSync(ambientPath, 'language: en\nprofile: poisoned\nlexicon:\n  enabled: false\n', 'utf8');
    const config = loadWebConfig({ repoRoot: root });
    assert.deepEqual(config, readBaseline(root));
    assert.equal(config.language, 'ko');
    assert.equal(config.profile, 'default');
    assert.equal(config.lexicon.enabled, true);
  } finally {
    if (previous === null) rmSync(ambientPath, { force: true });
    else writeFileSync(ambientPath, previous, 'utf8');
  }
});

test('resolveBundleRoot points at bundled assets', () => {
  const root = resolveBundleRoot();
  assert.ok(existsSync(resolve(root, '.patina.default.yaml')));
  assert.ok(existsSync(resolve(root, 'patterns')));
});
