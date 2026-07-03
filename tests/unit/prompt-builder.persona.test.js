import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildPrompt } from '../../src/prompt-builder.js';
import { loadPersona } from '../../src/personas/loader.js';
import { formatPersonaDirective } from '../../src/personas/compose.js';
import { loadProfile } from '../../src/loader.js';

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

test('an explicit tone overrides the persona register; the persona keeps its other structure targets', () => {
  const persona = loadPersona(REPO_ROOT, 'ko', 'soft-professional');
  const noTone = formatPersonaDirective(persona, { lang: 'ko', tone: { tone: null, tone_source: 'profile_only' } });
  const withTone = formatPersonaDirective(persona, { lang: 'ko', tone: { tone: 'casual', tone_source: 'user' } });
  const withAuto = formatPersonaDirective(persona, { lang: 'ko', tone: { tone: 'auto', tone_source: 'auto' } });

  // No explicit tone → the persona's own register stands.
  assert.match(noTone, /polite_professional/);
  // Explicit tone (user or auto) owns register → the persona register is suppressed
  // so the directive never contradicts the Tone Resolution block.
  assert.doesNotMatch(withTone, /polite_professional/);
  assert.doesNotMatch(withAuto, /polite_professional/);
  // Non-register structure targets survive the override in every case.
  for (const d of [noTone, withTone, withAuto]) assert.match(d, /CV/);
});

test('any active persona (incl preserve) owns voice; profile body is only emitted when no persona is active', () => {
  const profile = loadProfile(REPO_ROOT, 'blog');
  const withProfile = { ...base, config: { language: 'ko', profile: 'blog' }, profile };

  // v6.2: the persona is the SOLE voice owner. Any active persona — a voice
  // persona (soft-professional) OR the preserve default — suppresses the whole
  // profile voice body and keeps only the pattern-policy defer note.
  for (const id of ['soft-professional', 'preserve']) {
    const persona = loadPersona(REPO_ROOT, 'ko', id);
    const strict = buildPrompt({ ...withProfile, persona, promptMode: 'strict' });
    assert.ok(!strict.includes(profile.body), `${id}: profile voice body must not be dumped into the prompt`);
    assert.match(strict, /voice guidance defers to the active persona/);
    const minimal = buildPrompt({ ...withProfile, persona, promptMode: 'minimal' });
    assert.ok(!minimal.includes(profile.body), `${id}: profile body must not be dumped in minimal mode`);
    assert.match(minimal, /패턴 정책은 적용/);
  }

  // No persona at all → the profile body still reaches the prompt (non-persona
  // paths: e.g. a non-ko no-persona rewrite, or non-rewrite modes).
  const noPersona = buildPrompt({ ...withProfile, persona: null, promptMode: 'strict' });
  assert.ok(noPersona.includes(profile.body), 'no-persona prompt should still include the profile body');
});
