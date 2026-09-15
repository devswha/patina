// Phase D: packaged built-in persona smoke test.
// Guards the bug where persona runtime (src/personas/*) shipped but the persona
// DATA files (personas/{lang}/*.md) were excluded from the npm artifact, so
// loadPersona would fail for end users. Verifies the files allowlist, the actual
// `npm pack` contents, and that the built-in persona loads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPersona, listPersonas } from '../../src/personas/loader.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));

test('package files allowlist includes personas/', () => {
  assert.ok(pkg.files.includes('personas/'), 'package.json files must include personas/ so built-in personas ship');
});

test('npm pack artifact contains the built-in KO Persona catalog', () => {
  // Bare `npm` is npm.cmd on Windows, which Node refuses to spawn without a
  // shell since the CVE-2024-27980 fix.
  const res = process.platform === 'win32'
    ? spawnSync('npm.cmd', ['pack', '--dry-run', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', shell: true })
    : spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const packed = JSON.parse(res.stdout)[0].files.map((f) => f.path);
  assert.ok(packed.includes('personas/ko/natural-ko.md'), 'natural-ko Persona must be in the packed artifact');
  assert.ok(packed.includes('personas/ko/technical-explainer.md'), 'technical-explainer Persona must be in the packed artifact');
});

test('loadPersona resolves the built-in natural-ko from the package layout', () => {
  const persona = loadPersona(REPO_ROOT, 'ko', 'natural-ko');
  assert.equal(persona.id, 'natural-ko');
  assert.equal(persona.lang, 'ko');
  assert.equal(persona.schema, 'patina.persona.v2');
  assert.equal(Object.hasOwn(persona, 'mps'), false);
  const ids = listPersonas(REPO_ROOT, 'ko').map((p) => p.id ?? p);
  assert.ok(ids.includes('natural-ko'), 'natural-ko must be discoverable via listPersonas');
});

test('report-only corpus harness scripts are wired as package scripts', () => {
  assert.equal(pkg.scripts['benchmark:ai-tells-baseline'], 'node scripts/ai-tells-corpus-baseline.mjs');
  assert.equal(pkg.scripts['benchmark:detector-candidates'], 'node scripts/detector-candidate-eval.mjs');
});
