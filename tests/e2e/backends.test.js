import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  invokeBackendChain,
  selectBackend,
  selectBackendChain,
  listBackends,
} from '../../src/backends/index.js';
import { DEFAULT_BACKEND_TIMEOUT_MS } from '../../src/backends/contract.js';
import { isAvailable as codexAvailable, isAuthenticated as codexAuthd } from '../../src/backends/codex-cli.js';

describe('Backend Selection', () => {
  it('selects openai-http by default', () => {
    const { backend, autoSelected } = selectBackend({});
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
  });

  it('selects openai-http for unrelated models', () => {
    const { backend } = selectBackend({ model: 'gpt-4o' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('selects codex-cli when --backend codex-cli is explicit', () => {
    const { backend, autoSelected, reason } = selectBackend({ name: 'codex-cli' });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(autoSelected, false);
    assert.strictEqual(reason, 'explicit');
  });

  it('selects openai-http when --backend openai-http is explicit', () => {
    const { backend, autoSelected } = selectBackend({ name: 'openai-http' });
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
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

  it('does not match `claudette` or `gemininet` or other false positives', () => {
    assert.strictEqual(selectBackend({ model: 'claudette-1' }).backend.name, 'openai-http');
    assert.strictEqual(selectBackend({ model: 'gemininet' }).backend.name, 'openai-http');
  });

  it('selects claude-cli / gemini-cli when --backend is explicit', () => {
    assert.strictEqual(selectBackend({ name: 'claude-cli' }).backend.name, 'claude-cli');
    assert.strictEqual(selectBackend({ name: 'gemini-cli' }).backend.name, 'gemini-cli');
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
    assert.strictEqual(seenTimeout, DEFAULT_BACKEND_TIMEOUT_MS);
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

  it('only treats AbortError as fallbackable for the first backend', async () => {
    await assert.rejects(
      invokeBackendChain({
        backends: [
          {
            name: 'first',
            invoke: async () => {
              const err = new Error('timeout');
              err.name = 'AbortError';
              throw err;
            },
          },
          {
            name: 'second',
            invoke: async () => {
              const err = new Error('timeout again');
              err.name = 'AbortError';
              throw err;
            },
          },
          { name: 'third', invoke: async () => 'should not run' },
        ],
        prompt: 'rewrite this',
      }),
      /timeout again/
    );
  });
});

describe('Codex auto-fallback removed (issue #88)', () => {
  it('does NOT auto-select codex-cli even when codex is installed and authenticated', { skip: !(codexAvailable() && codexAuthd()) }, () => {
    const { backend, autoSelected } = selectBackend({});
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
  });

  it('selects openai-http by default when nothing is specified', () => {
    const { backend, autoSelected, reason } = selectBackend({});
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
    assert.strictEqual(reason, 'default');
  });

  it('still routes to codex-cli when --backend codex-cli is explicit', () => {
    const { backend, autoSelected } = selectBackend({ name: 'codex-cli' });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(autoSelected, false);
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

  it('reports codex-cli availability based on actual install', () => {
    const list = listBackends();
    const codex = list.find((b) => b.name === 'codex-cli');
    assert.strictEqual(codex.available, codexAvailable());
  });

  it('reports authenticated status for each backend', () => {
    const list = listBackends();
    for (const b of list) {
      assert.strictEqual(typeof b.authenticated, 'boolean');
      assert.strictEqual(typeof b.authHint, 'string');
    }
  });
});
