import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_URL = 'https://github.com/devswha/patina/blob/dev/docs/WORKFLOW.md';
const FORM_PATHS = [
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/calibration_concern.yml',
  '.github/ISSUE_TEMPLATE/false_positive.yml',
  '.github/ISSUE_TEMPLATE/benchmark_corpus.yml',
  '.github/ISSUE_TEMPLATE/pattern_proposal.yml',
  '.github/ISSUE_TEMPLATE/research_proposal.yml'
];

function loadForm(relativePath) {
  const source = readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
  return yaml.load(source);
}

test('all issue forms link to workflow policy and collect scope and acceptance', () => {
  for (const relativePath of FORM_PATHS) {
    const form = loadForm(relativePath);
    assert.ok(Array.isArray(form.body), `${relativePath} should define a body`);
    const acceptance = form.body.find((field) => field.id === 'acceptance');
    assert.ok(acceptance, `${relativePath} should define an acceptance field`);
    assert.equal(acceptance.type, 'textarea');
    assert.equal(acceptance.attributes.label, 'Scope and acceptance');
    assert.equal(acceptance.validations.required, true);
    assert.match(JSON.stringify(form), new RegExp(POLICY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
