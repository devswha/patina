import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildPrompt } from '../../src/prompt-builder.js';
import { loadPersona } from '../../src/personas/loader.js';
import { formatPersonaDirective } from '../../src/personas/compose.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const base = {
  config: { language: 'ko', profile: 'default' },
  patterns: [],
  profile: null,
  voice: null,
  scoring: null,
  text: '테스트 문장입니다.',
  mode: 'rewrite',
};

test('strict and minimal prompts include the same persona directive', () => {
  const persona = loadPersona(REPO_ROOT, 'ko', 'preserve');
  const directive = formatPersonaDirective(persona, { korean: true });
  const strictPrompt = buildPrompt({ ...base, persona, promptMode: 'strict' });
  const minimalPrompt = buildPrompt({ ...base, persona, promptMode: 'minimal' });

  assert.ok(strictPrompt.includes(directive));
  assert.ok(minimalPrompt.includes(directive));
});

test('content persona keeps safety floors and excludes worldview', () => {
  const persona = loadPersona(REPO_ROOT, 'ko', 'pragmatic-founder');
  const prompt = buildPrompt({ ...base, persona, promptMode: 'strict' });

  assert.match(prompt, /MPS\/fidelity hard-floor는 그대로 강제한다/);
  assert.doesNotMatch(formatPersonaDirective(persona, { korean: true }), /advisory/i);
  assert.doesNotMatch(prompt, /worldview/i);
  assert.doesNotMatch(prompt, /세계관은 schema 자리만/i);
});

test('omitting persona leaves prompt unchanged', () => {
  const withoutPersona = buildPrompt({ ...base, promptMode: 'strict' });
  const explicitNull = buildPrompt({ ...base, persona: null, promptMode: 'strict' });
  assert.equal(explicitNull, withoutPersona);
});
