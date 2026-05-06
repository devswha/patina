import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { resolveTone } from '../../src/config.js';
import { toneToBackboneProfile } from '../../src/loader.js';
import { formatOutput } from '../../src/output.js';

// --- resolveTone ---

test('resolveTone: CLI tone wins over config tone', () => {
  const r = resolveTone({ cliTone: 'casual', configTone: 'academic', lang: 'ko' });
  assert.equal(r.tone, 'casual');
  assert.equal(r.tone_source, 'user');
});

test('resolveTone: config tone used when CLI tone absent', () => {
  const r = resolveTone({ cliTone: undefined, configTone: 'professional', lang: 'en' });
  assert.equal(r.tone, 'professional');
  assert.equal(r.tone_source, 'user');
});

test('resolveTone: no tone → profile_only', () => {
  const r = resolveTone({ cliTone: undefined, configTone: undefined, lang: 'ko' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'profile_only');
});

test('resolveTone: empty string configTone → profile_only', () => {
  const r = resolveTone({ cliTone: undefined, configTone: '', lang: 'ko' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'profile_only');
});

test('resolveTone: auto → tone_source auto', () => {
  const r = resolveTone({ cliTone: 'auto', configTone: undefined, lang: 'ko' });
  assert.equal(r.tone, 'auto');
  assert.equal(r.tone_source, 'auto');
});

test('resolveTone: zh + named tone → unsupported_language_fallback', () => {
  const r = resolveTone({ cliTone: 'casual', configTone: undefined, lang: 'zh' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'unsupported_language_fallback');
  assert.ok(r.warning);
});

test('resolveTone: ja + auto → unsupported_language_fallback', () => {
  const r = resolveTone({ cliTone: 'auto', configTone: undefined, lang: 'ja' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'unsupported_language_fallback');
  assert.ok(r.warning.includes('auto-detection'));
});

test('resolveTone: invalid cliTone throws', () => {
  assert.throws(
    () => resolveTone({ cliTone: 'bogus', lang: 'ko' }),
    /Unknown tone 'bogus'/
  );
});

test('resolveTone: invalid configTone throws', () => {
  assert.throws(
    () => resolveTone({ cliTone: undefined, configTone: 'nope', lang: 'ko' }),
    /Invalid tone 'nope' in config/
  );
});

test('resolveTone: all 6 named tones accepted', () => {
  for (const t of ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional']) {
    const r = resolveTone({ cliTone: t, lang: 'en' });
    assert.equal(r.tone, t);
    assert.equal(r.tone_source, 'user');
    assert.equal(r.tone_confidence, 'high');
  }
});

// --- toneToBackboneProfile ---

test('toneToBackboneProfile: maps known tones to backbone profiles', () => {
  assert.equal(toneToBackboneProfile('casual'), 'blog');
  assert.equal(toneToBackboneProfile('professional'), 'email');
  assert.equal(toneToBackboneProfile('academic'), 'academic');
  assert.equal(toneToBackboneProfile('narrative'), 'narrative');
  assert.equal(toneToBackboneProfile('marketing'), 'marketing');
  assert.equal(toneToBackboneProfile('instructional'), 'instructional');
});

test('toneToBackboneProfile: unknown tone returns null', () => {
  assert.equal(toneToBackboneProfile('auto'), null);
  assert.equal(toneToBackboneProfile('unknown'), null);
});

// --- formatOutput tone footer ---

test('formatOutput: appends YAML tone footer', () => {
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: ['user-specified'], tone_confidence: 'high' };
  const out = formatOutput('Hello world', 'rewrite', {}, { tone });
  assert.ok(out.includes('tone: casual'));
  assert.ok(out.includes('tone_source: user'));
  assert.ok(out.includes('tone_confidence: high'));
});

test('formatOutput: no tone → no footer', () => {
  const out = formatOutput('Hello world', 'rewrite', {});
  assert.equal(out, 'Hello world');
});

test('formatOutput: does not duplicate complete footer', () => {
  const existing = 'Body text\n---\ntone: casual\ntone_source: user\ntone_evidence: []\ntone_confidence: high\n---';
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: [], tone_confidence: 'high' };
  const out = formatOutput(existing, 'rewrite', {}, { tone });
  const count = (out.match(/tone_source:/g) || []).length;
  assert.equal(count, 1);
});

test('formatOutput: appends footer when partial footer present (missing keys)', () => {
  const partial = 'Body text\n---\ntone: casual\n---';
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: [], tone_confidence: 'high' };
  const out = formatOutput(partial, 'rewrite', {}, { tone });
  const count = (out.match(/tone_source:/g) || []).length;
  assert.equal(count, 1);
});

test('formatOutput: null tone emits null values', () => {
  const tone = { tone: null, tone_source: 'profile_only', tone_evidence: [], tone_confidence: null };
  const out = formatOutput('Text', 'rewrite', {}, { tone });
  assert.ok(out.includes('tone: null'));
  assert.ok(out.includes('tone_confidence: null'));
});

// --- stripSelfAudit (v3.11) ---

test('stripSelfAudit: extracts [BODY] block and drops [SELF_AUDIT]', () => {
  const raw = '[BODY]\nHello world\n[/BODY]\n\n[SELF_AUDIT]\n- residual signal: foo\n[/SELF_AUDIT]';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Hello world');
});

test('stripSelfAudit: keeps YAML footer that follows [/BODY]', () => {
  const raw = '[BODY]\nHello world\n[/BODY]\n\n[SELF_AUDIT]\nstuff\n[/SELF_AUDIT]\n\n---\ntone: null\ntone_source: profile_only\ntone_evidence: []\ntone_confidence: null\n---';
  const out = formatOutput(raw, 'rewrite', {});
  assert.ok(out.startsWith('Hello world'));
  assert.ok(out.includes('tone_source: profile_only'));
  assert.ok(!out.includes('residual'));
});

test('stripSelfAudit: passes through unchanged when no tags emitted', () => {
  const raw = 'Plain rewrite text without tags.';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Plain rewrite text without tags.');
});

test('stripSelfAudit: only applied to rewrite/diff/ouroboros modes', () => {
  const raw = '[BODY]\nclean\n[/BODY]\n[SELF_AUDIT]\nleak\n[/SELF_AUDIT]';
  const audit = formatOutput(raw, 'audit', {});
  // Audit mode should not strip — tags should round-trip as-is.
  assert.ok(audit.includes('[BODY]'));
  assert.ok(audit.includes('[SELF_AUDIT]'));
});
