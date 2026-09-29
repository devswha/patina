import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FORM_PATHS = [
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/calibration_concern.yml',
  '.github/ISSUE_TEMPLATE/false_positive.yml',
  '.github/ISSUE_TEMPLATE/benchmark_corpus.yml',
  '.github/ISSUE_TEMPLATE/pattern_proposal.yml',
  '.github/ISSUE_TEMPLATE/research_proposal.yml'
];

test('issue forms have usable fields and unique identifiers', () => {
  for (const relativePath of FORM_PATHS) {
    const form = yaml.load(readFileSync(resolve(REPO_ROOT, relativePath), 'utf8'));
    assert.ok(form.name && form.description, `${relativePath} needs a name and description`);
    assert.ok(Array.isArray(form.body) && form.body.length > 0, `${relativePath} needs fields`);
    const ids = new Set();
    for (const field of form.body) {
      assert.ok(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'].includes(field.type), field.type);
      if (field.type === 'markdown') {
        assert.ok(field.attributes.value.trim(), `${relativePath} has an empty notice`);
        continue;
      }
      assert.ok(field.id && !ids.has(field.id), `${relativePath}: duplicate or missing id ${field.id}`);
      ids.add(field.id);
      assert.ok(field.attributes.label, `${relativePath}: ${field.id} needs a label`);
      if (field.validations?.required !== undefined) assert.equal(typeof field.validations.required, 'boolean');
      if (field.type === 'dropdown' || field.type === 'checkboxes') {
        assert.ok(field.attributes.options.length > 0, `${relativePath}: ${field.id} needs choices`);
      }
    }
  }
});
