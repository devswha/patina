import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadConfig } from '../../src/config.js';
import { loadPatterns, loadProfile, loadCoreFile, splitFrontmatter } from '../../src/loader.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

describe('Config Loading', () => {
  it('should load .patina.default.yaml', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    assert.ok(config);
    assert.strictEqual(config.version, '3.4.0');
    assert.ok(config.language);
    assert.ok(config.profile);
    assert.ok(config.patterns);
    assert.ok(config.ouroboros);
  });

  it('should have combined-weights for all profiles', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    const weights = config.ouroboros?.['combined-weights'];
    assert.ok(weights);
    assert.ok(weights.default);
    assert.ok(weights.academic);
    assert.ok(weights.blog);
    assert.ok(weights.technical);
    assert.ok(weights.social);
    assert.ok(weights.email);
    assert.ok(weights.legal);
    assert.ok(weights.medical);
    assert.ok(weights.marketing);
  });
});

describe('Pattern Loading', () => {
  it('should load all 24 pattern packs', () => {
    const packs = loadPatterns(REPO_ROOT, 'ko');
    assert.strictEqual(packs.length, 6, 'Expected 6 Korean packs');

    const enPacks = loadPatterns(REPO_ROOT, 'en');
    assert.strictEqual(enPacks.length, 6, 'Expected 6 English packs');

    const zhPacks = loadPatterns(REPO_ROOT, 'zh');
    assert.strictEqual(zhPacks.length, 6, 'Expected 6 Chinese packs');

    const jaPacks = loadPatterns(REPO_ROOT, 'ja');
    assert.strictEqual(jaPacks.length, 6, 'Expected 6 Japanese packs');
  });

  it('should parse frontmatter correctly', () => {
    const packs = loadPatterns(REPO_ROOT, 'en');
    const contentPack = packs.find((p) => p.frontmatter?.pack === 'en-content');
    assert.ok(contentPack, 'en-content pack should exist');
    assert.ok(contentPack.frontmatter.language);
    assert.ok(contentPack.frontmatter.patterns > 0);
    assert.ok(contentPack.body.length > 0);
  });

  it('should identify structure packs', () => {
    const packs = loadPatterns(REPO_ROOT, 'en');
    const structurePacks = packs.filter((p) => p.isStructure);
    assert.ok(structurePacks.length >= 1, 'Should have at least one structure pack');
  });

  it('should respect skip-patterns', () => {
    const packs = loadPatterns(REPO_ROOT, 'en', ['en-filler']);
    assert.strictEqual(packs.length, 5, 'Should skip en-filler');
  });
});

describe('Profile Loading', () => {
  it('should load all 10 profiles', () => {
    const names = ['default', 'blog', 'academic', 'technical', 'social', 'email', 'formal', 'legal', 'medical', 'marketing'];
    for (const name of names) {
      const profile = loadProfile(REPO_ROOT, name);
      assert.ok(profile, `Profile ${name} should load`);
      assert.ok(profile.frontmatter || profile.body, `Profile ${name} should have content`);
    }
  });
});

describe('Core File Loading', () => {
  it('should load voice.md', () => {
    const voice = loadCoreFile(REPO_ROOT, 'voice.md');
    assert.ok(voice);
    assert.ok(voice.body.length > 0);
  });

  it('should load scoring.md', () => {
    const scoring = loadCoreFile(REPO_ROOT, 'scoring.md');
    assert.ok(scoring);
    assert.ok(scoring.body.length > 0);
  });
});

describe('Frontmatter Splitting', () => {
  it('should split YAML frontmatter from body', () => {
    const content = `---\nname: test\nversion: 1.0.0\n---\n# Hello\nThis is body.`;
    const result = splitFrontmatter(content);
    assert.ok(result.frontmatter);
    assert.strictEqual(result.frontmatter.name, 'test');
    assert.strictEqual(result.frontmatter.version, '1.0.0');
    assert.ok(result.body.includes('Hello'));
  });

  it('should handle content without frontmatter', () => {
    const content = '# Hello\nThis is body.';
    const result = splitFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.ok(result.body.includes('Hello'));
  });
});

describe('Prompt Building', () => {
  it('should build a rewrite prompt', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    const patterns = loadPatterns(REPO_ROOT, 'en');
    const profile = loadProfile(REPO_ROOT, 'default');
    const voice = loadCoreFile(REPO_ROOT, 'voice.md');

    const prompt = buildPrompt({
      config,
      patterns,
      profile: profile.body ? profile : null,
      voice: voice.body ? voice : null,
      text: 'This is a test sentence.',
      mode: 'rewrite',
    });

    assert.ok(prompt.length > 1000, 'Prompt should be substantial');
    assert.ok(prompt.includes('Pattern Packs'), 'Prompt should mention Pattern Packs');
    assert.ok(prompt.includes('Input Text'), 'Prompt should include Input Text section');
    assert.ok(prompt.includes('This is a test sentence.'), 'Prompt should include the input text');
  });

  it('should build a score prompt', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    const patterns = loadPatterns(REPO_ROOT, 'en');
    const profile = loadProfile(REPO_ROOT, 'default');
    const voice = loadCoreFile(REPO_ROOT, 'voice.md');
    const scoring = loadCoreFile(REPO_ROOT, 'scoring.md');

    const prompt = buildPrompt({
      config,
      patterns,
      profile: profile.body ? profile : null,
      voice: voice.body ? voice : null,
      scoring: scoring.body ? scoring : null,
      text: 'This is a test sentence.',
      mode: 'score',
    });

    assert.ok(prompt.includes('Scoring Algorithm'), 'Score prompt should include scoring reference');
    assert.ok(prompt.includes('AI-likeness score'), 'Score prompt should ask for scoring');
  });

  it('should build an audit prompt', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    const patterns = loadPatterns(REPO_ROOT, 'en');

    const prompt = buildPrompt({
      config,
      patterns,
      text: 'This is a test sentence.',
      mode: 'audit',
    });

    assert.ok(prompt.includes('Detect AI patterns ONLY'), 'Audit prompt should instruct detection only');
  });
});

describe('CLI Entry Point', () => {
  it('bin/patina.js should exist and be executable', async () => {
    const fs = await import('node:fs');
    const binPath = resolve(REPO_ROOT, 'bin/patina.js');
    const stats = fs.statSync(binPath);
    assert.ok(stats.isFile());
    assert.ok(stats.mode & 0o111, 'Should be executable');
  });
});
