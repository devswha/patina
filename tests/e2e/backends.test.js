import { describe, it } from 'node:test';
import assert from 'node:assert';
import { selectBackend, listBackends } from '../../src/backends/index.js';
import { isAvailable as codexAvailable } from '../../src/backends/codex-cli.js';

describe('Backend Selection', () => {
  it('selects openai-http by default when no model and no name given', () => {
    const b = selectBackend({});
    assert.strictEqual(b.name, 'openai-http');
  });

  it('selects openai-http for unrelated models like gpt-4o', () => {
    const b = selectBackend({ model: 'gpt-4o' });
    assert.strictEqual(b.name, 'openai-http');
  });

  it('selects codex-cli when --backend codex-cli is explicit', () => {
    const b = selectBackend({ name: 'codex-cli' });
    assert.strictEqual(b.name, 'codex-cli');
  });

  it('selects openai-http when --backend openai-http is explicit', () => {
    const b = selectBackend({ name: 'openai-http' });
    assert.strictEqual(b.name, 'openai-http');
  });

  it('routes --model codex to codex-cli via heuristic', () => {
    const b = selectBackend({ model: 'codex' });
    assert.strictEqual(b.name, 'codex-cli');
  });

  it('routes --model codex-mini-latest to codex-cli via prefix', () => {
    const b = selectBackend({ model: 'codex-mini-latest' });
    assert.strictEqual(b.name, 'codex-cli');
  });

  it('does not match `codexa` or other false positives', () => {
    const b = selectBackend({ model: 'codexa-1.0' });
    assert.strictEqual(b.name, 'openai-http');
  });

  it('explicit --backend overrides --model heuristic', () => {
    const b = selectBackend({ name: 'openai-http', model: 'codex' });
    assert.strictEqual(b.name, 'openai-http');
  });

  it('throws on unknown backend name', () => {
    assert.throws(() => selectBackend({ name: 'invented-backend' }), /Unknown backend/);
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
});
