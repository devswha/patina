import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert';
import { loadConfig } from '../../src/config.js';
import { loadPatterns, loadDocumentType, loadCoreFile, splitFrontmatter } from '../../src/loader.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
function documentPolicySource(id, name, { purpose = 'Explain a thing.' } = {}) {
  return [
    '---',
    `document-type: ${id}`,
    `name: ${name}`,
    'version: 1.0.0',
    'scope: Test documents',
    `purpose: ${purpose}`,
    'audience:',
    '  - Test readers',
    'structure:',
    '  - Keep source order',
    'style:',
    '  - Use concrete terms',
    'avoid:',
    '  - Inventing facts',
    'pattern-overrides:',
    '  en:',
    '    7: amplify',
    '---',
    '# Documentation only',
  ].join('\n');
}


describe('Config Loading', () => {
  it('should load .patina.default.yaml', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    assert.ok(config);
    assert.match(config.version, /^\d+\.\d+\.\d+$/);
    assert.ok(config.language);
    assert.ok(config.documentType);
    assert.ok(config.patterns);
    assert.ok(config.scoring);
    assert.ok(config.verification);
  });

  it('should have combined-weights for all calibrated Document Types', () => {
    const config = loadConfig(resolve(REPO_ROOT, '.patina.default.yaml'));
    const weights = config.scoring?.['combined-weights'];
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
    assert.ok(weights.namuwiki);
  });
});

describe('Pattern Loading', () => {
  for (const legacyCommunity of [false, true]) {
    it(`loads symlinked custom packs with legacy community subtree ${legacyCommunity ? 'present' : 'absent'}`, (t) => {
      const root = mkdtempSync(resolve(tmpdir(), 'patina-symlink-patterns-'));
      const custom = mkdtempSync(resolve(tmpdir(), 'patina-custom-patterns-'));
      t.after(() => {
        rmSync(root, { recursive: true, force: true });
        rmSync(custom, { recursive: true, force: true });
      });
      mkdirSync(resolve(root, 'patterns'));
      writeFileSync(resolve(root, 'patterns/en-base.md'), 'Built-in text');
      mkdirSync(resolve(custom, 'patterns'));
      writeFileSync(resolve(custom, 'patterns/en-base.md'), 'Custom override');
      writeFileSync(resolve(custom, 'patterns/en-extra.md'), '---\nphase: structure\nscore_only: true\n---\nCustom extra');
      symlinkSync(custom, resolve(root, 'custom'));
      if (legacyCommunity) {
        mkdirSync(resolve(custom, 'community-packs/en-old'), { recursive: true });
        writeFileSync(resolve(custom, 'community-packs/en-old/installed.json'), '{invalid');
      }
      const packs = loadPatterns(root, 'en');
      assert.deepStrictEqual(packs.map((pack) => pack.file), ['en-base.md', 'en-extra.md']);
      assert.strictEqual(packs[0].body, 'Custom override');
      assert.strictEqual(packs[1].isStructure, true);
      assert.strictEqual(packs[1].isScoreOnly, true);
      assert.deepStrictEqual(loadPatterns(root, 'en', ['en-base']).map((pack) => pack.file), ['en-extra.md']);
      assert.deepStrictEqual(loadPatterns(root, 'ko'), []);
    });
  }

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

describe('Document Type Loading', () => {
  it('should load all checked-in Document Types', () => {
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
      'namuwiki',
    ];
    for (const name of names) {
      const documentType = loadDocumentType(REPO_ROOT, name);
      assert.ok(documentType, `Document Type ${name} should load`);
      assert.ok(documentType.frontmatter || documentType.body, `Document Type ${name} should have content`);
      const policy = documentType.frontmatter;
      assert.equal(typeof policy?.purpose, 'string', `Document Type ${name} should define purpose`);
      for (const field of ['audience', 'structure', 'style', 'avoid']) {

        assert.ok(Array.isArray(policy?.[field]), `Document Type ${name} should define ${field} as a list`);
        assert.ok(policy[field].length > 0, `Document Type ${name} should define at least one ${field} item`);
      }
      const actions = Object.values(policy?.['pattern-overrides'] ?? {}).flatMap((overrides) =>
        Object.values(overrides ?? {})
      );
      assert.ok(
        actions.every((action) => ['suppress', 'reduce', 'amplify'].includes(action)),
        `Document Type ${name} should use only suppress/reduce/amplify pattern actions`
      );
    }
  });

  it('prefers a valid custom Document Type over a same-id built-in policy', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'patina-document-type-'));
    try {
      mkdirSync(resolve(root, 'document-types'), { recursive: true });
      mkdirSync(resolve(root, 'custom', 'document-types'), { recursive: true });
      writeFileSync(
        resolve(root, 'document-types', 'newsletter.md'),
        documentPolicySource('newsletter', 'Built-in newsletter')
      );
      writeFileSync(
        resolve(root, 'custom', 'document-types', 'newsletter.md'),
        documentPolicySource('newsletter', 'Custom newsletter')
      );

      const loaded = loadDocumentType(root, 'newsletter');
      assert.strictEqual(loaded.frontmatter.name, 'Custom newsletter');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a custom Document Type whose frontmatter crosses the axis contract', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'patina-document-type-'));
    try {
      mkdirSync(resolve(root, 'custom', 'document-types'), { recursive: true });
      const invalid = documentPolicySource('newsletter', 'Invalid newsletter')
        .replace('style:\n', 'register: professional\nstyle:\n');
      writeFileSync(resolve(root, 'custom', 'document-types', 'newsletter.md'), invalid);

      assert.throws(
        () => loadDocumentType(root, 'newsletter'),
        (error) => error?.exitCode === 2 && /register belongs to another rewrite axis/.test(error.message)
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ships the NamuWiki Document Type as a ko-scoped, license-safe policy', () => {
    const documentType = loadDocumentType(REPO_ROOT, 'namuwiki');
    assert.strictEqual(documentType.frontmatter?.language, 'ko');
    assert.match(documentType.frontmatter?.['license-note'], /do not copy/i);
    assert.ok(documentType.frontmatter?.['pattern-overrides']?.ko);
    assert.match(documentType.body, /실제 나무위키 문서 문장/);
    assert.match(documentType.body, /\*\*Before\*\*/);
    assert.match(documentType.body, /\*\*After\*\*/);
  });

  it('should ship dev-native Document Types with targeted guidance and examples', () => {
    const expected = {
      'code-comment': ['This function', 'TODO(#421)', 'Uninformative inline summary'],
      'commit-message': ['This commit', 'Tested:', 'Inflated future promise'],
      'release-notes': ['Generic excitement', 'Changed → Impact → Action', 'Breaking:'],
    };

    for (const [name, markers] of Object.entries(expected)) {
      const documentType = loadDocumentType(REPO_ROOT, name);
      const overrides = documentType.frontmatter?.['pattern-overrides'];
      assert.ok(overrides, `Document Type ${name} should define pattern-overrides`);
      for (const lang of ['ko', 'en', 'zh', 'ja']) {
        assert.ok(overrides[lang], `Document Type ${name} should define ${lang} overrides`);
      }
      for (const marker of markers) {
        assert.match(documentType.body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      assert.match(documentType.body, /\*\*Before\*\*/);
      assert.match(documentType.body, /\*\*After\*\*/);
    }
  });

  it('should provide zh/ja pattern overrides for multilingual Document Type parity', () => {
    const names = ['blog', 'casual-conversation', 'formal', 'instructional', 'narrative'];
    const documentedValues = new Set(['suppress', 'reduce', 'amplify']);
    for (const name of names) {
      const documentType = loadDocumentType(REPO_ROOT, name);
      const overrides = documentType.frontmatter?.['pattern-overrides'];
      assert.ok(overrides, `Document Type ${name} should define pattern-overrides`);
      for (const lang of ['zh', 'ja']) {
        assert.ok(overrides[lang], `Document Type ${name} should define ${lang} overrides`);
        const values = Object.values(overrides[lang]);
        assert.ok(values.length > 0, `Document Type ${name} ${lang} overrides should not be empty`);
        assert.ok(
          values.some((value) => documentedValues.has(value)),
          `Document Type ${name} ${lang} should document suppress/reduce/amplify behavior`
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
    const documentType = loadDocumentType(REPO_ROOT, 'default');
    const voice = loadCoreFile(REPO_ROOT, 'voice.md');

    const prompt = buildPrompt({
      config,
      patterns,
      documentType: documentType.body ? documentType : null,
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
    const documentType = loadDocumentType(REPO_ROOT, 'default');
    const voice = loadCoreFile(REPO_ROOT, 'voice.md');
    const scoring = loadCoreFile(REPO_ROOT, 'scoring.md');

    const prompt = buildPrompt({
      config,
      patterns,
      documentType: documentType.body ? documentType : null,
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
