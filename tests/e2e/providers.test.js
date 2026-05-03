import { describe, it } from 'node:test';
import assert from 'node:assert';
import { selectProvider, resolveProviderConfig, PROVIDERS } from '../../src/providers.js';

function withEnv(envOverrides, fn) {
  const original = {};
  for (const k of Object.keys(envOverrides)) {
    original[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

describe('Provider Selection', () => {
  it('returns null for empty provider name', () => {
    assert.strictEqual(selectProvider(undefined), null);
    assert.strictEqual(selectProvider(null), null);
    assert.strictEqual(selectProvider(''), null);
  });

  it('returns the provider preset for valid names', () => {
    const gemini = selectProvider('gemini');
    assert.strictEqual(gemini.name, 'gemini');
    assert.match(gemini.baseURL, /generativelanguage/);
    assert.strictEqual(gemini.apiKeyEnv, 'GEMINI_API_KEY');
  });

  it('throws on unknown provider', () => {
    assert.throws(() => selectProvider('madeup'), /Unknown provider/);
  });

  it('lists all four providers', () => {
    const names = Object.keys(PROVIDERS).sort();
    assert.deepStrictEqual(names, ['gemini', 'groq', 'openai', 'together']);
  });

  it('marks free-tier providers correctly', () => {
    assert.strictEqual(PROVIDERS.gemini.freeTier, true);
    assert.strictEqual(PROVIDERS.groq.freeTier, true);
    assert.strictEqual(PROVIDERS.together.freeTier, true);
    assert.strictEqual(PROVIDERS.openai.freeTier, false);
  });
});

describe('Provider Config Resolution', () => {
  it('uses explicit flags over everything', () => {
    withEnv({ PATINA_API_KEY: 'env-key', GEMINI_API_KEY: 'gemini-env' }, () => {
      const provider = selectProvider('gemini');
      const r = resolveProviderConfig({
        provider,
        apiKey: 'flag-key',
        baseURL: 'https://flag.example.com',
        model: 'flag-model',
      });
      assert.strictEqual(r.apiKey, 'flag-key');
      assert.strictEqual(r.baseURL, 'https://flag.example.com');
      assert.strictEqual(r.model, 'flag-model');
      assert.strictEqual(r.apiKeySource, 'flag');
    });
  });

  it('reads provider-specific env var when --provider is set', () => {
    withEnv({ PATINA_API_KEY: undefined, GEMINI_API_KEY: 'gemini-env' }, () => {
      const r = resolveProviderConfig({ provider: selectProvider('gemini') });
      assert.strictEqual(r.apiKey, 'gemini-env');
      assert.strictEqual(r.apiKeySource, 'env:GEMINI_API_KEY');
      assert.match(r.baseURL, /generativelanguage/);
      assert.strictEqual(r.model, 'gemini-1.5-flash');
    });
  });

  it('falls back to PATINA_API_KEY when provider env var missing', () => {
    withEnv({ PATINA_API_KEY: 'patina-env', GEMINI_API_KEY: undefined }, () => {
      const r = resolveProviderConfig({ provider: selectProvider('gemini') });
      assert.strictEqual(r.apiKey, 'patina-env');
      assert.strictEqual(r.apiKeySource, 'env:PATINA_API_KEY');
    });
  });

  it('falls back to PATINA_* env vars when no provider', () => {
    withEnv({
      PATINA_API_KEY: 'p-key',
      PATINA_API_BASE: 'https://p.example.com',
      PATINA_MODEL: 'p-model',
      GEMINI_API_KEY: undefined,
    }, () => {
      const r = resolveProviderConfig({ provider: null });
      assert.strictEqual(r.apiKey, 'p-key');
      assert.strictEqual(r.baseURL, 'https://p.example.com');
      assert.strictEqual(r.model, 'p-model');
    });
  });

  it('uses defaults when nothing set', () => {
    withEnv({
      PATINA_API_KEY: undefined,
      PATINA_API_BASE: undefined,
      PATINA_MODEL: undefined,
    }, () => {
      const r = resolveProviderConfig({ provider: null });
      assert.strictEqual(r.apiKey, null);
      assert.strictEqual(r.baseURL, 'https://api.openai.com/v1');
      assert.strictEqual(r.model, 'gpt-4o');
      assert.strictEqual(r.baseURLSource, 'default');
    });
  });

  it('uses provider defaultModel when --model not given', () => {
    withEnv({ GROQ_API_KEY: 'g-key', PATINA_MODEL: undefined }, () => {
      const r = resolveProviderConfig({ provider: selectProvider('groq') });
      assert.strictEqual(r.model, 'llama-3.3-70b-versatile');
      assert.strictEqual(r.modelSource, 'provider:groq');
    });
  });

  it('honors explicit --model over provider default', () => {
    withEnv({ GROQ_API_KEY: 'g-key' }, () => {
      const r = resolveProviderConfig({
        provider: selectProvider('groq'),
        model: 'mixtral-8x7b',
      });
      assert.strictEqual(r.model, 'mixtral-8x7b');
      assert.strictEqual(r.modelSource, 'flag');
    });
  });
});
