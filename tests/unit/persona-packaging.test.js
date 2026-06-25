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

test('npm pack artifact contains the built-in KO personas (incl. natural-ko)', () => {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const packed = JSON.parse(res.stdout)[0].files.map((f) => f.path);
  assert.ok(packed.includes('personas/ko/natural-ko.md'), 'natural-ko persona must be in the packed artifact');
  assert.ok(packed.includes('personas/ko/preserve.md'), 'preserve persona must be in the packed artifact');
});

test('loadPersona resolves the built-in natural-ko from the package layout', () => {
  const persona = loadPersona(REPO_ROOT, 'ko', 'natural-ko');
  assert.equal(persona.id, 'natural-ko');
  assert.equal(persona.lang, 'ko');
  assert.equal(persona.mps.floor, 70);
  assert.equal(persona.fidelity.floor, 70);
  const ids = listPersonas(REPO_ROOT, 'ko').map((p) => p.id ?? p);
  assert.ok(ids.includes('natural-ko'), 'natural-ko must be discoverable via listPersonas');
});

test('report-only corpus harness scripts are wired as package scripts', () => {
  assert.equal(pkg.scripts['benchmark:ai-tells-baseline'], 'node scripts/ai-tells-corpus-baseline.mjs');
  assert.equal(pkg.scripts['benchmark:detector-candidates'], 'node scripts/detector-candidate-eval.mjs');
});
