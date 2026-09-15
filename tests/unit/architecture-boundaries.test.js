import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it } from 'node:test';

import {
  AUDITED_EXCEPTIONS,
  PUBLISHED_BIN_PACKAGES,
  REPO_ROOT,
  SAFE_SHARED_MODULES,
  buildImportGraph,
  checkArchitecture,
  classifyModule,
  collectModuleFiles,
  parseModuleImports,
  readPublishedEntrypoints,
} from '../../scripts/check-architecture.mjs';

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

function fixture(entries) {
  const root = mkdtempSync(join(tmpdir(), 'patina-architecture-'));
  temporaryRoots.push(root);
  for (const [path, source] of Object.entries(entries)) {
    const filePath = join(root, path);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, source);
  }
  return root;
}

describe('architecture import graph', () => {
  it('extracts static imports, re-exports, and literal dynamic imports with locations', () => {
    const parsed = parseModuleImports([
      '// import("../comment-only.js") must not become an edge',
      'export { value } from "./re-export.js";',
      'import "./static.js";',
      'export async function load() { return import("./dynamic.js"); }',
      'const text = "import(\\"../string-only.js\\")";',
    ].join('\n'));

    assert.deepEqual(
      parsed.imports.map(({ specifier, kind }) => ({ specifier, kind })),
      [
        { specifier: './re-export.js', kind: 're-export' },
        { specifier: './static.js', kind: 'import' },
        { specifier: './dynamic.js', kind: 'dynamic-import' },
      ],
    );
    assert.deepEqual(parsed.unresolvedDynamic, []);
  });

  it('does not treat a non-literal dynamic import as a verified graph edge', () => {
    const root = fixture({
      'src/features/entry.js': 'export async function load(name) { return import(name); }\n',
    });
    const graph = buildImportGraph({ root });
    assert.equal(graph.diagnostics.length, 1);
    assert.equal(graph.diagnostics[0].type, 'unresolved-dynamic-import');

    const result = checkArchitecture({ root });
    assert.ok(result.violations.some((violation) => violation.rule === 'unresolved-dynamic-import'));
  });

  it('treats bare Node builtins as boundary targets', () => {
    const root = fixture({
      'src/features/http.js': 'import "http";\n',
      'src/features/subprocess.js': 'import "child_process";\n',
      'playground/fs.js': 'import "fs";\n',
    });

    const result = checkArchitecture({ root });
    assert.ok(result.violations.some(
      (violation) => violation.rule === 'features-no-model-network'
        && violation.origin === 'src/features/http.js'
        && violation.target === 'http',
    ));
    assert.ok(result.violations.some(
      (violation) => violation.rule === 'features-no-model-network'
        && violation.origin === 'src/features/subprocess.js'
        && violation.target === 'child_process',
    ));
    assert.ok(result.violations.some(
      (violation) => violation.rule === 'browser-no-server-secret'
        && violation.origin === 'playground/fs.js'
        && violation.target === 'fs',
    ));
  });

  it('catches indirect and dynamic feature, browser, and runtime research edges', () => {
    const root = fixture({
      'src/features/entry.js': [
        'import { bridge } from "./feature-bridge.js";',
        'export { value } from "./feature-re-export.js";',
        'export { bridge };',
      ].join('\n'),
      'src/features/feature-bridge.js': 'export async function bridge() { return import("../api.js"); }\n',
      'src/features/feature-re-export.js': 'export { value } from "../api.js";\n',
      'src/api.js': 'export const value = true;\n',
      'playground/app.js': 'import { loadSecret } from "./browser-bridge.js"; export { loadSecret };\n',
      'playground/browser-bridge.js': 'export async function loadSecret() { return import("../src/auth.js"); }\n',
      'src/auth.js': 'export const privateKey = true;\n',
      'src/runtime.js': 'import "./runtime-bridge.js";\n',
      'src/runtime-bridge.js': 'export { study } from "../scripts/research/study.js";\n',
      'scripts/research/study.js': 'export const study = true;\n',
    });

    const result = checkArchitecture({ root });
    const featureViolation = result.violations.find(
      (violation) => violation.rule === 'features-no-model-network' && violation.origin === 'src/features/entry.js',
    );
    assert.ok(featureViolation);
    assert.deepEqual(featureViolation.path, [
      'src/features/entry.js',
      'src/features/feature-bridge.js',
      'src/api.js',
    ]);
    assert.deepEqual(featureViolation.edgeKinds, ['import', 'dynamic-import']);

    const browserViolation = result.violations.find(
      (violation) => violation.rule === 'browser-no-server-secret' && violation.origin === 'playground/app.js',
    );
    assert.ok(browserViolation);
    assert.deepEqual(browserViolation.path, [
      'playground/app.js',
      'playground/browser-bridge.js',
      'src/auth.js',
    ]);
    assert.deepEqual(browserViolation.edgeKinds, ['import', 'dynamic-import']);

    const researchViolation = result.violations.find(
      (violation) => violation.rule === 'runtime-no-research' && violation.origin === 'src/runtime.js',
    );
    assert.ok(researchViolation);
    assert.deepEqual(researchViolation.path, [
      'src/runtime.js',
      'src/runtime-bridge.js',
      'scripts/research/study.js',
    ]);
    assert.deepEqual(researchViolation.edgeKinds, ['import', 're-export']);
  });

  it('allows only known deterministic/shared modules and keeps exceptions explicit', () => {
    const root = fixture({
      'src/features/entry.js': 'import { applyTextEdits } from "../edit-controls.js"; export { applyTextEdits };\n',
      'src/edit-controls.js': 'export function applyTextEdits() {}\n',
      'playground/app.js': 'import { isWellFormedText } from "../src/web-rewrite-contract.js"; export { isWellFormedText };\n',
      'src/web-rewrite-contract.js': 'export function isWellFormedText() { return true; }\n',
      'src/runtime.js': 'import { scoreText } from "../scripts/prose-score.mjs"; export { scoreText };\n',
      'scripts/prose-score.mjs': 'export function scoreText() { return 0; }\n',
    });

    const result = checkArchitecture({ root });
    assert.deepEqual(result.violations, []);
    assert.equal(classifyModule('src/edit-controls.js'), 'safe-shared');
    assert.equal(classifyModule('src/features/entry.js'), 'deterministic-feature');
    assert.equal(classifyModule('src/api.js'), 'model-network');
    assert.equal(classifyModule('src/auth.js'), 'server-secret');
    assert.equal(classifyModule('scripts/research/study.js'), 'research');
    assert.ok(SAFE_SHARED_MODULES.includes('src/web-rewrite-contract.js'));
    assert.ok(AUDITED_EXCEPTIONS.every((entry) => entry.reason && entry.from && entry.target));
  });

  it('collects every declared product bin, including the score script and alias bin', () => {
    const metadata = readPublishedEntrypoints(REPO_ROOT);
    assert.deepEqual(metadata.diagnostics, []);
    assert.deepEqual(
      [...new Set(metadata.entries.map((entry) => entry.path))].sort(),
      [
        'bin/patina.js',
        'packages/patina-humanizer/bin/patina-humanizer.js',
        'scripts/precommit-score.mjs',
      ],
    );

    const modules = new Set(collectModuleFiles(REPO_ROOT));
    for (const entry of metadata.entries) {
      assert.ok(modules.has(resolve(REPO_ROOT, entry.path)), `${entry.manifest} bin ${entry.binName} was omitted from graph roots`);
    }
    assert.deepEqual(
      PUBLISHED_BIN_PACKAGES.map(({ manifest, packageName }) => ({ manifest, packageName })),
      [
        { manifest: 'package.json', packageName: 'patina-cli' },
        { manifest: 'packages/patina-humanizer/package.json', packageName: 'patina-humanizer' },
      ],
    );
  });

  it('checks transitive research imports from each declared published bin', () => {
    const root = fixture({
      'package.json': JSON.stringify({
        name: 'patina-cli',
        bin: { patina: 'bin/patina.js', 'patina-score': 'scripts/precommit-score.mjs' },
      }),
      'packages/patina-humanizer/package.json': JSON.stringify({
        name: 'patina-humanizer',
        bin: { 'patina-humanizer': 'bin/patina-humanizer.js' },
      }),
      'bin/patina.js': 'export { value } from "./cli-helper.mjs";\n',
      'bin/cli-helper.mjs': 'export { value } from "../scripts/research/study.mjs";\n',
      'scripts/precommit-score.mjs': 'import "./score-helper.mjs";\n',
      'scripts/score-helper.mjs': 'export { value } from "./research/study.mjs";\n',
      'packages/patina-humanizer/bin/patina-humanizer.js': 'import "./alias-helper.mjs";\n',
      'packages/patina-humanizer/bin/alias-helper.mjs': 'export { value } from "../../../scripts/research/study.mjs";\n',
      'scripts/research/study.mjs': 'export const value = true;\n',
    });

    const result = checkArchitecture({ root });
    assert.deepEqual(result.diagnostics, []);
    for (const origin of [
      'bin/patina.js',
      'scripts/precommit-score.mjs',
      'packages/patina-humanizer/bin/patina-humanizer.js',
    ]) {
      const violation = result.violations.find(
        (candidate) => candidate.rule === 'runtime-no-research' && candidate.origin === origin,
      );
      assert.ok(violation, `research edge from published entrypoint ${origin} was not checked`);
      assert.deepEqual(violation.path.at(-1), 'scripts/research/study.mjs');
    }
  });

  it('fails when package metadata declares a bin that cannot be graph-scanned', () => {
    const root = fixture({
      'package.json': JSON.stringify({
        name: 'patina-cli',
        bin: {
          patina: 'bin/patina.js',
          'patina-score': 'scripts/precommit-score.mjs',
          'missing-bin': 'scripts/missing-entrypoint.mjs',
        },
      }),
      'packages/patina-humanizer/package.json': JSON.stringify({
        name: 'patina-humanizer',
        bin: { 'patina-humanizer': 'bin/patina-humanizer.js' },
      }),
      'bin/patina.js': 'export const value = true;\n',
      'scripts/precommit-score.mjs': 'export const value = true;\n',
      'packages/patina-humanizer/bin/patina-humanizer.js': 'export const value = true;\n',
    });

    const result = checkArchitecture({ root });
    const omission = result.violations.find(
      (violation) => violation.rule === 'graph-incomplete'
        && violation.type === 'published-entrypoint-omitted'
        && violation.path?.[0] === 'scripts/missing-entrypoint.mjs',
    );
    assert.ok(omission, 'a declared but missing published bin must fail metadata completeness');
  });
});
