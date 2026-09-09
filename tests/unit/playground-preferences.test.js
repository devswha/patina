import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRewriteThread } from '../../playground/rewrite-client.js';
import { normalizePreferences, createThreadPreferences } from '../../playground/preferences.js';

const defaults = { lang: 'en', documentType: 'default', persona: '', register: '' };
const send = (thread, text = 'Refine this') => thread.buildRequest({ text, tier: 'free' });

test('conversation A/B preferences and payloads remain independent; defaults omit voice/register/document overrides', () => {
  const a = createRewriteThread({ lang: 'ko', documentType: 'namuwiki', persona: 'soft-professional', register: 'professional' });
  const b = createRewriteThread({ lang: 'ja', documentType: 'email', persona: 'natural-ja', register: 'casual' });
  a.commit({ userText: '원문 70%', assistantText: '원문 70%' });
  b.commit({ userText: '原文 80%', assistantText: '原文 80%' });
  a.updatePreferences({ documentType: 'blog', register: 'casual' });
  assert.deepEqual(a.preferences, { lang: 'ko', documentType: 'blog', persona: 'soft-professional', register: 'casual' });
  assert.deepEqual(b.preferences, { lang: 'ja', documentType: 'email', persona: 'natural-ja', register: 'casual' });
  assert.equal(send(a).original, '원문 70%');
  assert.equal(send(b).original, '原文 80%');
  assert.equal(send(a).lang, 'ko');
  assert.equal(send(a).persona, 'soft-professional');
  assert.equal(send(a).register, 'casual');
  assert.equal(send(b).documentType, 'email');
  a.updatePreferences({ persona: '', register: '', documentType: 'default' });
  for (const key of ['persona', 'register', 'documentType']) assert.equal(key in send(a), false);
  const snapshot = b.preferences;
  snapshot.persona = 'tampered';
  assert.equal(send(b).persona, 'natural-ja');
});

test('a conflicting language selection is rejected atomically after original anchoring', () => {
  const thread = createRewriteThread({ lang: 'ko', persona: 'soft-professional' });
  thread.commit({ userText: '원문', assistantText: '원문' });
  const before = thread.preferences;
  assert.equal(thread.updatePreferences({ lang: 'en', persona: 'natural-en', register: 'casual' }, { explicitLanguage: true }), false);
  assert.deepEqual(thread.preferences, before);
  thread.detectLanguage('ja');
  assert.equal(send(thread).lang, 'ko');
  assert.equal(send(thread).original, '원문');
  assert.equal(thread.updatePreferences({ register: 'professional' }), true);
  assert.equal(send(thread).register, 'professional');
});

test('first-turn detection preserves explicit language and valid settings; incompatible language-specific options drop safely', () => {
  const thread = createRewriteThread({ lang: 'ko', documentType: 'namuwiki', persona: 'soft-professional', register: 'professional' });
  thread.detectLanguage('ja');
  assert.deepEqual(thread.preferences, { lang: 'ja', documentType: 'default', persona: '', register: 'professional' });
  thread.updatePreferences({ lang: 'ko', persona: 'blog-essay' }, { explicitLanguage: true });
  thread.detectLanguage('en');
  assert.equal(send(thread).lang, 'ko');
  assert.equal(send(thread).persona, 'blog-essay');
  // No accepted original yet: failed requests do not lock a stale source language.
  assert.equal(thread.original, undefined);
  thread.updatePreferences({ lang: 'en' }, { explicitLanguage: true });
  assert.equal(send(thread).lang, 'en');
  assert.equal(send(thread).persona, 'blog-essay');
  thread.commit({ userText: 'source', assistantText: 'rewrite' });
  thread.reset();
  assert.equal(thread.updatePreferences({ lang: 'ko' }), true);
});

test('normalization accepts only contract settings and drops unknown persona, language, register, and Korean-only documents', () => {
  for (const input of [undefined, null, {}, { lang: 'fr', documentType: 'removed', persona: 'evil', register: 'formal' }]) {
    assert.deepEqual(normalizePreferences(input), defaults);
  }
  assert.equal(normalizePreferences({ lang: 'en', documentType: 'namuwiki' }).documentType, 'default');
  const prefs = createThreadPreferences({ lang: 'ko', persona: 'soft-professional' });
  const value = prefs.value;
  value.persona = 'x';
  assert.equal(prefs.value.persona, 'soft-professional');
});
