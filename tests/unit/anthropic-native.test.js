import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeBody, createNativeStreamParser, nativeAnthropicEnabled, nativeEndpoint, normalizeNativeResponse } from '../../src/anthropic-native.js';
import { splitPromptForCaching } from '../../src/prompt-builder.js';
import { callLLM } from '../../src/api.js';
import { callLLMStream } from '../../src/streaming-api.js';

const FENCE = '⟦⟦⟦PATINA_INPUT_DATA⟧⟧⟧';
const BIG_PREFIX = 'STATIC CATALOG\n'.repeat(400); // > 4096 chars
const PROMPT = `${BIG_PREFIX}${FENCE}\nuser text here\n${FENCE}\n`;

const originalFetch = globalThis.fetch;
const originalFlag = process.env.PATINA_ANTHROPIC_NATIVE_CACHE;
beforeEach(() => { process.env.PATINA_ANTHROPIC_NATIVE_CACHE = '1'; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalFlag === undefined) delete process.env.PATINA_ANTHROPIC_NATIVE_CACHE;
  else process.env.PATINA_ANTHROPIC_NATIVE_CACHE = originalFlag;
});

test('nativeAnthropicEnabled requires both the flag and the first-party host', () => {
  assert.equal(nativeAnthropicEnabled({ baseURL: 'https://api.anthropic.com/v1' }), true);
  assert.equal(nativeAnthropicEnabled({ baseURL: 'https://api.anthropic.com/v1', env: {} }), false);
  assert.equal(nativeAnthropicEnabled({ baseURL: 'https://api.deepseek.com/v1' }), false);
  assert.equal(nativeAnthropicEnabled({ baseURL: 'https://evil.example/api.anthropic.com' }), false);
  assert.equal(nativeAnthropicEnabled({ baseURL: 'not a url' }), false);
  assert.equal(nativeEndpoint('https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/messages');
});

test('splitPromptForCaching splits at the first fence only when the prefix is cache-worthy', () => {
  const split = splitPromptForCaching(PROMPT);
  assert.equal(split.prefix, BIG_PREFIX);
  assert.ok(split.tail.startsWith(FENCE));
  assert.equal(split.prefix + split.tail, PROMPT);
  // Refine-shaped prompt: a fence appears early, so nothing is cacheable.
  const refine = splitPromptForCaching(`directive\n${FENCE}\nhistory\n${FENCE}\n${BIG_PREFIX}`);
  assert.equal(refine.prefix, null);
  assert.equal(refine.tail.includes(BIG_PREFIX), true);
  assert.equal(splitPromptForCaching('tiny').prefix, null);
});

test('buildNativeBody keeps one user message with a cache_control prefix block', () => {
  const body = buildNativeBody({ prompt: PROMPT, model: 'claude-sonnet-5', temperature: 0.7 });
  assert.equal(body.model, 'claude-sonnet-5');
  assert.ok(Number.isInteger(body.max_tokens) && body.max_tokens > 0);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  const [prefixBlock, tailBlock] = body.messages[0].content;
  assert.deepEqual(prefixBlock.cache_control, { type: 'ephemeral' });
  assert.equal(prefixBlock.text, BIG_PREFIX);
  assert.equal(tailBlock.cache_control, undefined);
  assert.equal(body.temperature, 0.7);
  // Out-of-range temperature is omitted, small prompts stay a plain string.
  assert.ok(!('temperature' in buildNativeBody({ prompt: 'x', model: 'm', temperature: 1.5 })));
  assert.equal(typeof buildNativeBody({ prompt: 'x', model: 'm' }).messages[0].content, 'string');
  assert.equal(buildNativeBody({ prompt: PROMPT, model: 'm', stream: true }).stream, true);
  // Thinking follows the provider default; the opt-out flag is experiment-only.
  assert.ok(!('thinking' in buildNativeBody({ prompt: PROMPT, model: 'm' })));
  assert.deepEqual(buildNativeBody({ prompt: PROMPT, model: 'm', env: { PATINA_ANTHROPIC_THINKING: '0' } }).thinking, { type: 'disabled' });
});

test('normalizeNativeResponse maps content, usage, and stop_reason to the OpenAI-ish shape', () => {
  const data = {
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
    content: [{ type: 'text', text: 'hello ' }, { type: 'tool_use' }, { type: 'text', text: 'world' }],
  };
  const normalized = normalizeNativeResponse(data);
  assert.equal(normalized.choices[0].message.content, 'hello world');
  assert.equal(normalized.choices[0].finish_reason, 'end_turn');
  assert.equal(normalized.usage.cache_read_input_tokens, 90);
  assert.equal(normalizeNativeResponse({}).choices[0].message.content, null);
});

test('createNativeStreamParser surfaces deltas and merges split usage', () => {
  const parser = createNativeStreamParser();
  assert.equal(parser.feed('event: message_start'), null);
  assert.equal(parser.feed('data: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":9000,"cache_read_input_tokens":8500}}}'), null);
  assert.equal(parser.feed('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}'), '안녕');
  assert.equal(parser.feed('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"하세요"}}'), '하세요');
  assert.equal(parser.feed('data: {"type":"message_delta","usage":{"output_tokens":42},"delta":{"stop_reason":"end_turn"}}'), null);
  assert.equal(parser.feed('data: {"type":"message_stop"}'), null);
  const state = parser.state();
  assert.equal(state.model, 'claude-sonnet-5');
  assert.deepEqual(state.usage, { input_tokens: 9000, cache_read_input_tokens: 8500, output_tokens: 42 });
  assert.equal(state.stopReason, 'end_turn');
  assert.equal(state.done, true);
});

test('callLLM native path issues /v1/messages with x-api-key and normalizes the response', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 9000, output_tokens: 20, cache_read_input_tokens: 8500 },
        content: [{ type: 'text', text: 'native ok' }],
      }),
    };
  };
  const meta = [];
  const result = await callLLM({
    prompt: PROMPT,
    apiKey: 'sk-ant-test',
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5',
    onResponse: (m) => meta.push(m),
  });
  assert.equal(result, 'native ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  const headers = calls[0].options.headers;
  assert.equal(headers['x-api-key'], 'sk-ant-test');
  assert.equal(headers.Authorization, undefined);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.stream, undefined, 'callLLM native stays buffered');
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(meta[0].provider, 'anthropic-native');
  assert.equal(meta[0].usage.cache_read_input_tokens, 8500);
  assert.equal(meta[0].cacheTokens.cachedReadTokens, 8500);
});

test('callLLM keeps the OpenAI-compat request when the flag is off or the host differs', async () => {
  delete process.env.PATINA_ANTHROPIC_NATIVE_CACHE;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ model: 'claude-sonnet-5', usage: { prompt_tokens: 3, completion_tokens: 2 }, choices: [{ message: { content: 'compat ok' } }] }),
    };
  };
  const result = await callLLM({ prompt: 'hi', apiKey: 'k', baseURL: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' });
  assert.equal(result, 'compat ok');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer k');
});

test('callLLMStream native path parses Messages SSE into deltas and a usage-bearing attempt', async () => {
  const sse = [
    'data: {"type":"message_start","message":{"model":"claude-sonnet-5","usage":{"input_tokens":9000,"cache_read_input_tokens":8500}}}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"스트림 "}}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"완료"}}',
    'data: {"type":"message_delta","usage":{"output_tokens":11},"delta":{"stop_reason":"end_turn"}}',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: (async function* () { yield sse; })(),
    };
  };
  const deltas = [];
  const attempts = [];
  const result = await callLLMStream({
    prompt: PROMPT,
    apiKey: 'sk-ant-test',
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5',
    fetchImpl,
    onDelta: (d) => deltas.push(d),
    onAttempt: (a) => attempts.push(a),
  });
  assert.equal(result.text, '스트림 완료');
  assert.equal(result.finishReason, 'end_turn');
  assert.deepEqual(deltas, ['스트림 ', '완료']);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'sk-ant-test');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, 'success');
  assert.equal(attempts[0].effectiveModel, 'claude-sonnet-5');
  assert.deepEqual(attempts[0].usage, { input_tokens: 9000, cache_read_input_tokens: 8500, output_tokens: 11 });
});
