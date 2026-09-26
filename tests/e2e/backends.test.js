import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  invokeBackendChain,
  selectBackend,
  selectBackendChain,
  listBackends,
} from '../../src/backends/index.js';
import { DEFAULT_BACKEND_TIMEOUT_MS } from '../../src/backends/contract.js';
import { DEFAULT_BEST_MODELS } from '../../src/model-defaults.js';

describe('Backend Selection', () => {
  it('selects openai-http by default', () => {
    const { backend, reason } = selectBackend({});
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(reason, 'default');
  });

  it('selects openai-http for unrelated models', () => {
    const { backend } = selectBackend({ model: 'gpt-4o' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('selects codex-cli when --backend codex-cli is explicit', () => {
    const { backend, reason } = selectBackend({ name: 'codex-cli' });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(reason, 'explicit');
  });

  it('selects openai-http when --backend openai-http is explicit', () => {
    const { backend } = selectBackend({ name: 'openai-http' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('routes --model codex to codex-cli via heuristic', () => {
    const { backend, reason } = selectBackend({ model: 'codex' });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(reason, 'model heuristic');
  });

  it('routes --model codex-mini-latest to codex-cli via prefix', () => {
    const { backend } = selectBackend({ model: 'codex-mini-latest' });
    assert.strictEqual(backend.name, 'codex-cli');
  });

  it('does not match `codexa` or other false positives', () => {
    const { backend } = selectBackend({ model: 'codexa-1.0' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('routes --model claude-* to claude-cli via heuristic', () => {
    const { backend, reason } = selectBackend({ model: 'claude-sonnet-4-6' });
    assert.strictEqual(backend.name, 'claude-cli');
    assert.strictEqual(reason, 'model heuristic');
  });

  it('routes --model gemini-* to gemini-cli via heuristic', () => {
    const { backend, reason } = selectBackend({ model: 'gemini-3-flash-preview' });
    assert.strictEqual(backend.name, 'gemini-cli');
    assert.strictEqual(reason, 'model heuristic');
  });

  it('leaves --model kimi-* on the HTTP default now that kimi-cli is removed', () => {
    const { backend, reason } = selectBackend({ model: 'kimi-code/kimi-for-coding' });
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(reason, 'default');
  });

  it('does not route provider/default model sources into local CLI heuristics', () => {
    assert.strictEqual(
      selectBackend({ model: 'gemini-2.5-pro', modelSource: 'provider:gemini' }).backend.name,
      'openai-http'
    );
    assert.strictEqual(
      selectBackend({ model: 'claude-sonnet-4-6', modelSource: 'default' }).backend.name,
      'openai-http'
    );
  });

  it('does not match `claudette`, `gemininet`, or other false positives', () => {
    assert.strictEqual(selectBackend({ model: 'claudette-1' }).backend.name, 'openai-http');
    assert.strictEqual(selectBackend({ model: 'gemininet' }).backend.name, 'openai-http');
  });

  it('selects claude-cli / gemini-cli when --backend is explicit', () => {
    assert.strictEqual(selectBackend({ name: 'claude-cli' }).backend.name, 'claude-cli');
    assert.strictEqual(selectBackend({ name: 'gemini-cli' }).backend.name, 'gemini-cli');
  });

  it('rejects the removed kimi-cli backend by name', () => {
    assert.throws(() => selectBackend({ name: 'kimi-cli' }), /Unknown backend: kimi-cli/);
  });

  it('parses an explicit comma-separated backend fallback chain', () => {
    const { backends, reason } = selectBackendChain({ name: 'claude-cli,codex-cli,openai-http' });
    assert.deepStrictEqual(backends.map((b) => b.name), ['claude-cli', 'codex-cli', 'openai-http']);
    assert.strictEqual(reason, 'explicit chain');
  });

  it('rejects unknown names inside a backend fallback chain', () => {
    assert.throws(
      () => selectBackendChain({ name: 'claude-cli,not-real' }),
      /Unknown backend: not-real/
    );
  });

  it('suggests every backend when no fallback chain remains', async () => {
    await assert.rejects(
      invokeBackendChain({ backends: [], prompt: 'rewrite this' }),
      /openai-http, codex-cli, claude-cli, gemini-cli, or agy-cli/
    );
  });

  it('explicit --backend overrides --model heuristic', () => {
    const { backend } = selectBackend({ name: 'openai-http', model: 'codex' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('throws on unknown backend name', () => {
    assert.throws(() => selectBackend({ name: 'invented-backend' }), /Unknown backend/);
  });
});

describe('Backend Fallback Chain', () => {
  it('passes the shared default timeout through the backend contract', async () => {
    let seenTimeout = null;
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'first',
          invoke: async ({ timeout }) => {
            seenTimeout = timeout;
            return 'ok';
          },
        },
      ],
      prompt: 'rewrite this',
    });

    assert.strictEqual(result, 'ok');
    // The run phase now receives the time remaining on the single shared
    // deadline (#506 defect 1), not a fresh full timeout. With an uncapped
    // backend almost no time is deducted, so it is the full budget minus the
    // sub-ms setup — never more than the budget.
    assert.ok(
      seenTimeout > DEFAULT_BACKEND_TIMEOUT_MS - 1000 && seenTimeout <= DEFAULT_BACKEND_TIMEOUT_MS,
      `expected ~${DEFAULT_BACKEND_TIMEOUT_MS} remaining budget, got ${seenTimeout}`
    );
  });

  it('passes backend retry defaults through the backend contract', async () => {
    let seenMaxRetries = null;
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'openai-http',
          invoke: async ({ maxRetries }) => {
            seenMaxRetries = maxRetries;
            return 'ok';
          },
        },
      ],
      prompt: 'rewrite this',
    });

    assert.strictEqual(result, 'ok');
    assert.strictEqual(seenMaxRetries, 2);
  });

  it('falls through 429/503 backend errors to the next backend', async () => {
    const events = [];
    const logger = { warn: (event, fields) => events.push({ event, ...fields }) };
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'first',
          invoke: async () => {
            const err = new Error('rate limited');
            err.status = 429;
            throw err;
          },
        },
        { name: 'second', invoke: async () => 'ok' },
      ],
      prompt: 'rewrite this',
      logger,
    });

    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(events.map((entry) => entry.event), ['backend.fallback']);
    assert.match(events[0].message, /first failed with HTTP 429; falling back to second/);
  });

  it('invokes each backend at most once and never transport-retries the same backend (#C3)', async () => {
    const counts = { first: 0, second: 0 };
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'first',
          invoke: async () => {
            counts.first += 1;
            const err = new Error('rate limited');
            err.status = 429;
            throw err;
          },
        },
        {
          name: 'second',
          invoke: async () => {
            counts.second += 1;
            return 'ok';
          },
        },
      ],
      prompt: 'rewrite this',
      logger: { warn() {} },
    });
    assert.strictEqual(result, 'ok');
    // Fallback advances to the next backend; it never re-invokes the same one
    // (transport retry of a single backend is callLLM's job, not the chain's).
    assert.strictEqual(counts.first, 1);
    assert.strictEqual(counts.second, 1);
  });

  it('does not fall through non-retryable backend errors', async () => {
    let secondCalled = false;
    await assert.rejects(
      invokeBackendChain({
        backends: [
          {
            name: 'first',
            invoke: async () => {
              const err = new Error('unauthorized');
              err.status = 401;
              throw err;
            },
          },
          { name: 'second', invoke: async () => { secondCalled = true; } },
        ],
        prompt: 'rewrite this',
      }),
      /unauthorized/
    );
    assert.strictEqual(secondCalled, false);
  });

  it('falls through timeout/abort errors at any non-final hop (#506 defect 2)', async () => {
    const events = [];
    const logger = { warn: (event, fields) => events.push({ event, ...fields }) };
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'first',
          invoke: async () => {
            const err = new Error('timed out');
            err.name = 'TimeoutError';
            throw err;
          },
        },
        {
          name: 'second',
          invoke: async () => {
            const err = new Error('aborted internally');
            err.name = 'AbortError';
            throw err;
          },
        },
        { name: 'third', invoke: async () => 'ok' },
      ],
      prompt: 'rewrite this',
      logger,
    });

    // Previously the abort/timeout gate stopped fallback after the first hop;
    // now it falls through at every non-final hop, just like 429/503 (#506).
    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(events.map((entry) => entry.event), ['backend.fallback', 'backend.fallback']);
  });

  it('falls through local CLI timeout-shaped errors at non-final hops (#525)', async () => {
    const events = [];
    const logger = { warn: (event, fields) => events.push({ event, ...fields }) };
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'claude-cli',
          invoke: async () => {
            throw new Error('claude-cli backend: timed out after 50ms');
          },
        },
        { name: 'openai-http', invoke: async () => 'ok' },
      ],
      prompt: 'rewrite this',
      logger,
    });

    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(events.map((entry) => entry.event), ['backend.fallback']);
    assert.match(events[0].message, /claude-cli failed with Error; falling back to openai-http/);
  });

  it('surfaces the final-hop timeout instead of swallowing it (#506 defect 2)', async () => {
    let thirdCalls = 0;
    await assert.rejects(
      invokeBackendChain({
        backends: [
          {
            name: 'first',
            invoke: async () => { const e = new Error('t1'); e.name = 'TimeoutError'; throw e; },
          },
          {
            name: 'second',
            invoke: async () => { const e = new Error('t2'); e.name = 'TimeoutError'; throw e; },
          },
          {
            name: 'third',
            invoke: async () => {
              thirdCalls += 1;
              const e = new Error('final timeout');
              e.name = 'TimeoutError';
              throw e;
            },
          },
        ],
        prompt: 'rewrite this',
        logger: { warn() {} },
      }),
      /final timeout/
    );
    // The final hop runs (no `next` to fall through to) and its error surfaces.
    assert.strictEqual(thirdCalls, 1);
  });

  it('a fall-through hop receives the REMAINING shared deadline, not a fresh full timeout (#506 defect 1, #528 I4)', async () => {
    let secondTimeout = null;
    const result = await invokeBackendChain({
      backends: [
        {
          name: 'first',
          invoke: async () => {
            // Consume a measurable slice of the shared budget, then fail over.
            await new Promise((resolve) => setTimeout(resolve, 80));
            const err = new Error('slow then rate-limited');
            err.status = 429;
            throw err;
          },
        },
        {
          name: 'second',
          invoke: async ({ timeout }) => {
            secondTimeout = timeout;
            return 'ok';
          },
        },
      ],
      prompt: 'rewrite this',
      timeout: 5000,
      logger: { warn() {} },
    });

    assert.strictEqual(result, 'ok');
    // One shared deadline spans the whole chain: the ~80ms the first hop spent
    // must be deducted from the second hop's budget. A regression that handed
    // the fallback backend a fresh full 5000ms would be caught here.
    assert.ok(secondTimeout <= 5000, `fall-through hop budget ${secondTimeout} exceeded the shared deadline`);
    assert.ok(secondTimeout < 5000 - 40, `fall-through hop saw ${secondTimeout}ms — the first hop's elapsed time was not deducted`);
  });
});

describe('Backend Listing', () => {
  it('returns at least openai-http, codex-cli, claude-cli, gemini-cli', () => {
    const list = listBackends();
    const names = list.map((b) => b.name);
    for (const expected of ['openai-http', 'codex-cli', 'claude-cli', 'gemini-cli']) {
      assert.ok(names.includes(expected), `expected backend ${expected}`);
    }
  });

  it('reports openai-http as always available (HTTP, no install check)', () => {
    const list = listBackends();
    const http = list.find((b) => b.name === 'openai-http');
    assert.strictEqual(http.available, true);
  });

  it('reports authenticated status for each backend', () => {
    const list = listBackends();
    for (const b of list) {
      assert.strictEqual(typeof b.authenticated, 'boolean');
      assert.strictEqual(typeof b.authHint, 'string');
    }
  });

  it('reports default best-model ids for user-facing backend status', () => {
    const byName = new Map(listBackends().map((b) => [b.name, b.defaultModel]));
    assert.strictEqual(byName.get('openai-http'), DEFAULT_BEST_MODELS.openai);
    assert.strictEqual(byName.get('codex-cli'), DEFAULT_BEST_MODELS.codexCli);
    assert.strictEqual(byName.get('claude-cli'), DEFAULT_BEST_MODELS.claudeCli);
    assert.strictEqual(byName.get('gemini-cli'), DEFAULT_BEST_MODELS.geminiCli);
  });
});
