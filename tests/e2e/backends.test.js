import { describe, it } from 'node:test';
import assert from 'node:assert';
import { selectBackend, listBackends } from '../../src/backends/index.js';
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

  it('explicit --backend overrides --model heuristic', () => {
    const { backend } = selectBackend({ name: 'openai-http', model: 'codex' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('throws on unknown backend name', () => {
    assert.throws(() => selectBackend({ name: 'invented-backend' }), /Unknown backend/);
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
