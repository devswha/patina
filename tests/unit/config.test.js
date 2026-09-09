import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../../src/config.js';
import { buildScoreMathCore } from '../../src/prompt-builder.js';
import { combinedScore } from '../../src/scoring.js';

function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'patina-config-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(home);
  mkdirSync(project);
  return { root, home, project };
}

async function withEnv({ home, cwd }, fn) {
  const oldHome = process.env.HOME;
  const oldCwd = process.cwd();
  process.env.HOME = home;
  process.chdir(cwd);
  try {
    await fn();
  } finally {
    process.chdir(oldCwd);
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
  }
}

test('loadConfig: additive list keys union across default, global, and project config', async () => {
  const { root, home, project } = tempWorkspace();
  const defaultPath = join(root, 'default.yaml');
  writeFileSync(defaultPath, `
blocklist: [default-term, shared]
allowlist: [safe]
skip-patterns: [ko-filler]
model-list: [claude, gemini]
nested:
  blocklist: [nested-default]
`);
  writeFileSync(join(home, '.patina.yaml'), `
blocklist: [global-term, shared]
allowlist: [safe, global-safe]
skip-patterns: [ko-style]
model-list: [codex]
nested:
  blocklist: [nested-global]
`);
  writeFileSync(join(project, '.patina.yaml'), `
blocklist: [project-term]
allowlist: [project-safe]
skip-patterns: [ko-style, ko-content]
model-list: [gemini]
nested:
  blocklist: [nested-project]
`);

  await withEnv({ home, cwd: project }, async () => {
    const config = loadConfig(defaultPath);
    assert.deepEqual(config.blocklist, ['default-term', 'shared', 'global-term', 'project-term']);
    assert.deepEqual(config.allowlist, ['safe', 'global-safe', 'project-safe']);
    assert.deepEqual(config['skip-patterns'], ['ko-filler', 'ko-style', 'ko-content']);
    assert.deepEqual(config['model-list'], ['gemini']);
    assert.deepEqual(config.nested.blocklist, ['nested-default', 'nested-global', 'nested-project']);
  });
});

test('loadConfig: non-additive arrays replace so exact list values remain controllable', async () => {
  const { root, home, project } = tempWorkspace();
  const defaultPath = join(root, 'default.yaml');
  writeFileSync(defaultPath, 'patterns: [ko-content, ko-style]\nmodel-list: [claude, gemini]\n');
  writeFileSync(join(home, '.patina.yaml'), 'patterns: [en-content]\nmodel-list: [codex]\n');

  await withEnv({ home, cwd: project }, async () => {
    const config = loadConfig(defaultPath);
    assert.deepEqual(config.patterns, ['en-content']);
    assert.deepEqual(config['model-list'], ['codex']);
  });
});

test('loadConfig: when HOME equals cwd the shared .patina.yaml is applied once, not twice (G5)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'patina-config-same-'));
  const defaultPath = join(root, 'default.yaml');
  writeFileSync(defaultPath, 'register: casual\n');
  // blocklist is an additive list key whose union dedupes primitives, so a
  // double-merge of the same file is only observable with object entries:
  // each YAML parse yields fresh object identities the Set cannot collapse.
  // With HOME === cwd the two candidate paths resolve equal and must dedupe.
  writeFileSync(join(root, '.patina.yaml'), 'blocklist:\n  - term: shared-entry\n');

  await withEnv({ home: root, cwd: root }, async () => {
    const config = loadConfig(defaultPath);
    assert.strictEqual(config.blocklist.length, 1);
    assert.deepStrictEqual(config.blocklist, [{ term: 'shared-entry' }]);
  });
});
test('loadConfig preserves partial scoring defaults and explicit zero overrides', async () => {
  const { root, home, project } = tempWorkspace();
  const defaultPath = join(root, 'default.yaml');
  const overridePath = join(root, 'override.yaml');
  writeFileSync(defaultPath, `
scoring:
  category-weights:
    en:
      content: 0.25
      style: 0.25
      language: 0.25
      structure: 0.25
  combined-weights:
    default:
      ai-likeness: 0.6
      fidelity: 0.4
`);
  writeFileSync(overridePath, `
scoring:
  category-weights:
    en:
      content: 0
  combined-weights:
    default:
      ai-likeness: 0
`);

  await withEnv({ home, cwd: project }, async () => {
    const config = loadConfig(defaultPath, { overridePath });
    assert.deepEqual(config.scoring['category-weights'].en, {
      content: 0,
      style: 0.25,
      language: 0.25,
      structure: 0.25,
    });
    assert.deepEqual(config.scoring['combined-weights'].default, {
      'ai-likeness': 0,
      fidelity: 0.4,
    });

    const scoreMath = buildScoreMathCore(config, 'en');
    assert.match(scoreMath, /^- content: 0$/m);
    assert.match(scoreMath, /^- style: 0\.25$/m);
    assert.equal(
      combinedScore({aiLikeness: 100,
      fidelity: 0, documentType: 'default', config,}),
      40
    );
  });
});


test('loadConfig: explicit config preserves four-layer scalar and additive precedence', async t => {
  const { root, home, project } = tempWorkspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const defaultPath = join(root, 'default.yaml');
  const overridePath = join(root, 'override.json');
  writeFileSync(defaultPath, JSON.stringify({ model: 'base-model', blocklist: ['base'], nested: { base: true } }));
  writeFileSync(join(home, '.patina.yaml'), JSON.stringify({ model: 'home-model', blocklist: ['home'], nested: { home: true } }));
  writeFileSync(join(project, '.patina.yaml'), JSON.stringify({ model: 'project-model', blocklist: ['project'], nested: { project: true } }));
  writeFileSync(overridePath, JSON.stringify({ model: 'explicit-model', blocklist: ['explicit', 'home'], nested: { explicit: true } }));
  await withEnv({ home, cwd: project }, async () => {
    assert.equal(loadConfig(defaultPath).model, 'project-model');
    const config = loadConfig(defaultPath, { overridePath });
    assert.equal(config.model, 'explicit-model');
    assert.deepEqual(config.blocklist, ['base', 'home', 'project', 'explicit']);
    assert.deepEqual(config.nested, { base: true, home: true, project: true, explicit: true });
  });
});

test('loadConfig: snapshot preserves absence and exact captured machine-consumed arrays', async t => {
  const { root, home, project } = tempWorkspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const defaultPath = join(root, 'default.yaml');
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(defaultPath, JSON.stringify({
    'document-type': 'technical', blocklist: [{ term: 'base' }], allowlist: ['base-safe'],
    'skip-patterns': ['en-filler'], nested: { blocklist: ['base-nested'] }, patterns: ['en-content']
  }));
  writeFileSync(join(home, '.patina.yaml'), JSON.stringify({ blocklist: ['home'] }));
  writeFileSync(join(project, '.patina.yaml'), JSON.stringify({ blocklist: ['project'] }));
  await withEnv({ home, cwd: project }, async () => {
    const captured = loadConfig(defaultPath);
    const snapshot = { ...captured, 'document-type': captured.documentType };
    delete snapshot.documentType;
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
    for (const path of [defaultPath, join(home, '.patina.yaml'), join(project, '.patina.yaml')]) {
      writeFileSync(path, JSON.stringify({ model: 'changed-model', baseURL: 'http://127.0.0.1:1/v1', provider: 'openai',
        persona: 'natural-en', blocklist: ['changed'], allowlist: ['changed-safe'], 'skip-patterns': ['en-content'],
        nested: { blocklist: ['changed-nested'], added: true }, patterns: ['en-style'] }));
    }
    assert.deepEqual(loadConfig(defaultPath, { snapshotPath }), captured);
    // No fallback to any base/home/project file, even if those become invalid.
    for (const path of [defaultPath, join(home, '.patina.yaml'), join(project, '.patina.yaml')]) writeFileSync(path, '[invalid');
    assert.deepEqual(loadConfig(defaultPath, { snapshotPath }), captured);
    assert.deepEqual(loadConfig(join(root, 'missing-default'), { snapshotPath }), captured);
  });
});

test('loadConfig: snapshot shares mapping and retired-key validation without ambient fallback', async t => {
  const { root, home, project } = tempWorkspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshotPath = join(root, 'snapshot.yaml');
  await withEnv({ home, cwd: project }, async () => {
    for (const invalid of ['', '[]', 'null', '42', '[invalid', 'profile: blog', 'tone: casual', 'formality: professional']) {
      writeFileSync(snapshotPath, invalid);
      assert.throws(() => loadConfig(undefined, { snapshotPath }));
    }
    assert.throws(() => loadConfig(undefined, { snapshotPath: join(root, 'missing') }));
    writeFileSync(snapshotPath, 'language: en');
    assert.deepEqual(loadConfig(undefined, { snapshotPath }), { language: 'en', documentType: 'default' });
    assert.throws(() => loadConfig(undefined, { snapshotPath, overridePath: snapshotPath }), { exitCode: 2 });
  });
});
