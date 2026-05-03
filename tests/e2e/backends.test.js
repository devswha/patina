import { describe, it } from 'node:test';
import assert from 'node:assert';
import { selectBackend, listBackends } from '../../src/backends/index.js';
import { isAvailable as codexAvailable, isAuthenticated as codexAuthd } from '../../src/backends/codex-cli.js';

describe('Backend Selection', () => {
  it('selects openai-http by default when API key is present', () => {
    const { backend, autoSelected } = selectBackend({ hasApiKey: true });
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
  });

  it('selects openai-http for unrelated models when API key is present', () => {
    const { backend } = selectBackend({ model: 'gpt-4o', hasApiKey: true });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('selects codex-cli when --backend codex-cli is explicit', () => {
    const { backend, autoSelected, reason } = selectBackend({ name: 'codex-cli' });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(autoSelected, false);
    assert.strictEqual(reason, 'explicit');
  });

  it('selects openai-http when --backend openai-http is explicit even without key', () => {
    const { backend, autoSelected } = selectBackend({ name: 'openai-http', hasApiKey: false });
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
  });

  it('routes --model codex to codex-cli via heuristic', () => {
    const { backend, reason } = selectBackend({ model: 'codex', hasApiKey: true });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(reason, 'model heuristic');
  });

  it('routes --model codex-mini-latest to codex-cli via prefix', () => {
    const { backend } = selectBackend({ model: 'codex-mini-latest', hasApiKey: true });
    assert.strictEqual(backend.name, 'codex-cli');
  });

  it('does not match `codexa` or other false positives', () => {
    const { backend } = selectBackend({ model: 'codexa-1.0', hasApiKey: true });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('explicit --backend overrides --model heuristic', () => {
    const { backend } = selectBackend({ name: 'openai-http', model: 'codex' });
    assert.strictEqual(backend.name, 'openai-http');
  });

  it('throws on unknown backend name', () => {
    assert.throws(() => selectBackend({ name: 'invented-backend' }), /Unknown backend/);
  });
});

describe('Auto-fallback to codex-cli', () => {
  it('auto-selects codex-cli when no API key and codex is authenticated', { skip: !(codexAvailable() && codexAuthd()) }, () => {
    const { backend, autoSelected, reason } = selectBackend({ hasApiKey: false });
    assert.strictEqual(backend.name, 'codex-cli');
    assert.strictEqual(autoSelected, true);
    assert.match(reason, /no API key/);
  });

  it('does NOT auto-select when API key is present', () => {
    const { backend, autoSelected } = selectBackend({ hasApiKey: true });
    assert.strictEqual(backend.name, 'openai-http');
    assert.strictEqual(autoSelected, false);
  });

  it('does NOT auto-select when name is explicit', () => {
    const { autoSelected } = selectBackend({ name: 'openai-http', hasApiKey: false });
    assert.strictEqual(autoSelected, false);
  });
});

describe('Backend Listing', () => {
  it('returns at least openai-http and codex-cli', () => {
    const list = listBackends();
    const names = list.map((b) => b.name);
    assert.ok(names.includes('openai-http'));
    assert.ok(names.includes('codex-cli'));
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
