import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  hashSha256,
  buildManifest,
  appendResult,
  writeManifest,
  MANIFEST_SCHEMA_VERSION,
} from '../../src/manifest.js';

test('hashSha256 returns deterministic sha256-prefixed hex', () => {
  const a = hashSha256('hello');
  const b = hashSha256('hello');
  assert.equal(a, b, 'same input → same hash');
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test('hashSha256 stringifies non-string inputs', () => {
  const a = hashSha256({ x: 1 });
  const b = hashSha256({ x: 1 });
  assert.equal(a, b);
  assert.notEqual(hashSha256({ x: 1 }), hashSha256({ x: 2 }));
});

test('hashSha256 returns null for null/undefined input', () => {
  assert.equal(hashSha256(null), null);
  assert.equal(hashSha256(undefined), null);
});

test('buildManifest captures core run metadata + schema version', () => {
  const m = buildManifest({
    patinaVersion: '3.9.0',
    mode: 'rewrite',
    lang: 'ko',
    profile: 'default',
    provider: 'openai',
    backend: 'openai-http',
    model: 'gpt-4o',
    configPath: '/tmp/config.yaml',
    config: { language: 'ko' },
    patterns: [
      { file: 'ko-structure.md', frontmatter: { pack: 'ko-structure' }, body: '' },
      { file: 'ko-content.md', frontmatter: {}, body: '' },
    ],
    startedAt: '2026-05-06T00:00:00Z',
    finishedAt: '2026-05-06T00:00:01Z',
  });

  assert.equal(m.manifestVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(m.patina, '3.9.0');
  assert.equal(m.mode, 'rewrite');
  assert.equal(m.lang, 'ko');
  assert.equal(m.provider, 'openai');
  assert.deepEqual(m.patterns, ['ko-structure', 'ko-content.md']); // falls back to file when no pack
  assert.match(m.configHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(m.results, []);
});

test('buildManifest tolerates missing optional fields', () => {
  const m = buildManifest({
    patinaVersion: '3.9.0',
    mode: 'rewrite',
    lang: 'en',
    profile: 'default',
    config: {},
  });
  assert.equal(m.provider, null);
  assert.equal(m.backend, null);
  assert.equal(m.model, null);
  assert.equal(m.configPath, null);
  assert.deepEqual(m.patterns, []);
});

test('appendResult records input + prompt hash + output ref', () => {
  const results = [];
  appendResult(results, {
    inputPath: 'foo.md',
    prompt: 'PROMPT BODY',
    outputRef: { kind: 'file', name: 'output-1.txt' },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].input, 'foo.md');
  assert.match(results[0].promptHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(results[0].output, { kind: 'file', name: 'output-1.txt' });
});

test('writeManifest creates dir, writes manifest.json + outputs', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-manifest-'));
  const manifest = buildManifest({
    patinaVersion: '3.9.0',
    mode: 'rewrite',
    lang: 'ko',
    profile: 'default',
    config: {},
    results: [{ input: 'a.md', promptHash: 'sha256:abc', output: { kind: 'file', name: 'out.txt' } }],
    startedAt: '2026-05-06T00:00:00Z',
  });
  const path = writeManifest(dir, manifest, [{ name: 'out.txt', content: 'rendered output' }]);
  assert.equal(path, resolve(dir, 'manifest.json'));
  assert.ok(existsSync(path));
  assert.equal(readFileSync(resolve(dir, 'out.txt'), 'utf8'), 'rendered output');
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(onDisk.manifestVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(onDisk.results[0].output.name, 'out.txt');
});
