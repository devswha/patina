import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadConfig } from '../../src/config.js';
import { loadPatterns, loadProfile, loadCoreFile, loadVoiceSample, splitFrontmatter } from '../../src/loader.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

describe('Config Loading', () => {
  it('should load .patina.default.yaml', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    assert.ok(config);
    assert.match(config.version, /^\d+\.\d+\.\d+$/);
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
  it('should load all pattern packs (24 base + 4 viral-hook)', () => {
    for (const lang of ['ko', 'en', 'zh', 'ja']) {
      const packs = loadPatterns(REPO_ROOT, lang);
      assert.strictEqual(packs.length, 7, `Expected 7 ${lang} packs (6 base + viral-hook)`);
    }
  });

  it('should mark score-only viral-hook packs across all languages', () => {
    for (const lang of ['ko', 'en', 'zh', 'ja']) {
      const packs = loadPatterns(REPO_ROOT, lang);
      const viralHook = packs.find((p) => p.frontmatter?.pack === `${lang}-viral-hook`);
      assert.ok(viralHook, `${lang}-viral-hook pack should exist`);
      assert.strictEqual(viralHook.isScoreOnly, true, `${lang}-viral-hook should be score-only`);

      const content = packs.find((p) => p.frontmatter?.pack === `${lang}-content`);
      assert.strictEqual(content.isScoreOnly, false, `${lang}-content should not be score-only`);
    }
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
    assert.strictEqual(packs.length, 6, 'Should skip en-filler (7 base+viral - 1 = 6)');
  });
});

describe('Profile Loading', () => {
  it('should load all checked-in profiles', () => {
    const names = [
      'default',
      'blog',
      'academic',
      'technical',
      'social',
      'email',
      'formal',
      'legal',
      'medical',
      'marketing',
      'casual-conversation',
      'instructional',
      'narrative',
      'code-comment',
      'commit-message',
      'release-notes',
    ];
    for (const name of names) {
      const profile = loadProfile(REPO_ROOT, name);
      assert.ok(profile, `Profile ${name} should load`);
      assert.ok(profile.frontmatter || profile.body, `Profile ${name} should have content`);
    }
  });

  it('should ship dev-native genre profiles with targeted guidance and examples', () => {
    const expected = {
      'code-comment': ['This function', 'TODO(#421)', 'Uninformative inline summary'],
      'commit-message': ['This commit', 'Tested:', 'Inflated future promise'],
      'release-notes': ['Generic excitement', 'Changed → Impact → Action', 'Breaking:'],
    };

    for (const [name, markers] of Object.entries(expected)) {
      const profile = loadProfile(REPO_ROOT, name);
      const overrides = profile.frontmatter?.['pattern-overrides'];
      assert.ok(overrides, `Profile ${name} should define pattern-overrides`);
      for (const lang of ['ko', 'en', 'zh', 'ja']) {
        assert.ok(overrides[lang], `Profile ${name} should define ${lang} overrides`);
      }
      for (const marker of markers) {
        assert.match(profile.body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      assert.match(profile.body, /\*\*Before\*\*/);
      assert.match(profile.body, /\*\*After\*\*/);
    }
  });

  it('should provide zh/ja pattern overrides for multilingual profile parity', () => {
    const names = ['blog', 'casual-conversation', 'formal', 'instructional', 'narrative'];
    const documentedValues = new Set(['suppress', 'reduce', 'amplify']);
    for (const name of names) {
      const profile = loadProfile(REPO_ROOT, name);
      const overrides = profile.frontmatter?.['pattern-overrides'];
      assert.ok(overrides, `Profile ${name} should define pattern-overrides`);
      for (const lang of ['zh', 'ja']) {
        assert.ok(overrides[lang], `Profile ${name} should define ${lang} overrides`);
        const values = Object.values(overrides[lang]);
        assert.ok(values.length > 0, `Profile ${name} ${lang} overrides should not be empty`);
        assert.ok(
          values.some((value) => documentedValues.has(value)),
          `Profile ${name} ${lang} should document suppress/reduce/amplify behavior`
        );
      }
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

  it('should load the first 1-3 voice sample paragraphs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'patina-voice-sample-'));
    const samplePath = resolve(dir, 'sample.md');
    writeFileSync(samplePath, ['one', 'two', 'three', 'four'].join('\n\n'), 'utf8');

    const sample = loadVoiceSample(samplePath);
    assert.deepStrictEqual(sample.paragraphs, ['one', 'two', 'three']);
    assert.strictEqual(sample.truncated, true);
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

  it('should inject voice samples into rewrite prompts as style-only anchors', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    const patterns = loadPatterns(REPO_ROOT, 'en');
    const prompt = buildPrompt({
      config,
      patterns,
      text: 'This is a test sentence.',
      mode: 'rewrite',
      voiceSample: {
        paragraphs: [
          'I usually explain the messy part first, then the result.',
          'Short aside: if the timing feels off, I say that plainly.',
        ],
      },
    });

    assert.ok(prompt.includes('Voice Anchor Examples'));
    assert.ok(prompt.includes('examples of how this person writes'));
    assert.ok(prompt.includes('do not import facts'));
    assert.ok(prompt.includes('I usually explain the messy part first'));
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
