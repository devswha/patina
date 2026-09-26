import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDoctorReport } from '../../src/commands/doctor.js';

const engines = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).engines.node;

// Backend detection spawns each installed CLI; an empty PATH keeps every report fast.
function report(options) {
  const path = process.env.PATH;
  process.env.PATH = '';
  try {
    return buildDoctorReport(options);
  } finally {
    process.env.PATH = path;
  }
}

test('doctor holds Node to the full package.json engines floor, not just its major', () => {
  for (const [nodeVersion, ok] of [
    ['18.0.0', false], ['18.0.9', false], ['17.9.1', false], ['not-a-version', false],
    ['18.1.0', true], ['18.20.4', true], ['20.0.0', true], ['22.23.1', true],
  ]) {
    const doctor = report({ version: '1.2.3', nodeVersion });
    const check = doctor.checks.find((c) => c.name === 'node');
    assert.equal(doctor.node.required, engines);
    assert.equal(doctor.node.version, nodeVersion);
    assert.equal(doctor.node.ok, ok, nodeVersion);
    assert.equal(check.status, ok ? 'ok' : 'blocker', nodeVersion);
    assert.equal(check.summary, `Node ${nodeVersion}`);
    assert.equal(check.detail, ok ? `meets package engine ${engines}` : `requires Node ${engines}`);
    assert.equal(doctor.blockers.some((blocker) => blocker.name === 'node'), !ok, nodeVersion);
  }
});

test('doctor checks the running Node when no version is injected', () => {
  assert.equal(report({ version: '1.2.3' }).node.version, process.versions.node);
});
