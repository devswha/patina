#!/usr/bin/env node
// Empirical check: does the Anthropic OpenAI-compatibility endpoint honor
// prompt caching (cache_control) for our provider preset? Two identical
// requests with a >1024-token shared prefix; the second response's usage
// should show cached prompt tokens if caching works. Costs a few cents.
//
// Key handling: reads PATINA_PRO_API_KEY_LOCAL or ~/.patina/pro-key.local.
// The key is never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODEL = process.env.G002_MODEL || 'claude-sonnet-5';
const BASE = 'https://api.anthropic.com/v1';

function loadKey() {
  if (process.env.PATINA_PRO_API_KEY_LOCAL) return process.env.PATINA_PRO_API_KEY_LOCAL.trim();
  try { return readFileSync(join(homedir(), '.patina', 'pro-key.local'), 'utf8').trim(); } catch {}
  console.error('no key: set PATINA_PRO_API_KEY_LOCAL or write ~/.patina/pro-key.local');
  process.exit(2);
}

const prefix = 'You are a careful editor. Reference glossary follows.\n' + Array.from({ length: 300 }, (_, i) => `term-${i}: definition of term ${i} with enough words to pad the shared prefix for cache eligibility.`).join('\n');

async function call(key, tail, cacheControl) {
  const content = cacheControl
    ? [{ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }, { type: 'text', text: tail }]
    : prefix + tail;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content }] }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, usage: body.usage ?? null, error: body.error?.message ?? null };
}

const key = loadKey();
for (const mode of [true, false]) {
  const label = mode ? 'cache_control blocks' : 'plain string content';
  const first = await call(key, '\nSay OK.', mode);
  if (first.status !== 200) { console.log(`[${label}] first call: HTTP ${first.status} ${first.error ?? ''}`); continue; }
  const second = await call(key, '\nSay OK again.', mode);
  console.log(`[${label}] first usage:`, JSON.stringify(first.usage));
  console.log(`[${label}] second usage:`, JSON.stringify(second.usage));
}
console.log('interpret: cached_tokens / cache_read_input_tokens > 0 on the second call means caching works on this path.');
