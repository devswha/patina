import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  FORBIDDEN_GLOBS,
  globToRegExp,
  matchForbidden,
  runGate,
} from '../../scripts/check-no-private-assets.mjs';

describe('leak gate: glob compilation', () => {
  it('treats `*` as a single-segment wildcard', () => {
    const re = globToRegExp('src/*.js');
    assert.ok(re.test('src/foo.js'));
    assert.ok(!re.test('src/sub/foo.js'));
  });

  it('treats `**/` as any-depth, including zero directories', () => {
    const re = globToRegExp('**/*.private.*');
    assert.ok(re.test('foo.private.js'));
    assert.ok(re.test('src/a/b/foo.private.json'));
  });

  it('treats trailing `**` as any depth under a directory', () => {
    const re = globToRegExp('corpus/**');
    assert.ok(re.test('corpus/ko.jsonl'));
    assert.ok(re.test('corpus/a/b.jsonl'));
    assert.ok(!re.test('corpusary/ko.jsonl'));
  });

  it('does not match a partial directory name (anchored segments)', () => {
    const re = globToRegExp('**/private/**');
    assert.ok(re.test('packages/x/private/keys.txt'));
    assert.ok(!re.test('packages/x/aprivate/keys.txt'));
  });
});

describe('leak gate: forbidden pattern set', () => {
  it('exposes a non-empty, frozen pattern list', () => {
    assert.ok(FORBIDDEN_GLOBS.length > 0);
    assert.ok(Object.isFrozen(FORBIDDEN_GLOBS));
  });

  it('flags every cross-track asset shape', () => {
    const planted = [
      'src/leaked.private.js',
      'docs/table.enhanced.json',
      'lexicon/private/ko-raw.md',
      'patterns/enhanced/ko-extra.md',
      'lexicon/reinforced/ko.md',
      'corpus/ko-2026.jsonl',
      'server/app.js',
    ];
    const hits = matchForbidden(planted);
    assert.strictEqual(hits.length, planted.length, 'every planted private path must match');
  });

  it('leaves the open-baseline package paths clean', () => {
    const benign = [
      'src/backends/index.js',
      'README.md',
      'bin/patina.js',
      'scripts/check-no-private-assets.mjs',
      'artifacts/rebaseline-2025/human-controls.public.jsonl',
      'lexicon/en-ai.md',
      'patterns/ko-style.md',
    ];
    assert.deepStrictEqual(matchForbidden(benign), []);
  });
});

describe('leak gate: runGate over collected file lists', () => {
  it('passes when no source contains a forbidden path', () => {
    const result = runGate({
      packedFiles: ['src/index.js', 'README.md', 'packages/patina-humanizer/bin/patina-humanizer.js'],
      trackedFiles: ['src/index.js', 'README.md'],
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.violations, []);
    assert.deepStrictEqual(result.counts, { packed: 3, tracked: 2 });
  });

  // Follow-up ①, case A: a private file planted INSIDE a wholesale `files[]`
  // include directory shows up in the npm pack enumeration.
  it('catches a private file planted inside a published directory (package source)', () => {
    const result = runGate({
      packedFiles: ['src/cli.js', 'src/backends/ko-reinforced.private.js'],
      trackedFiles: ['src/cli.js'],
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.violations.length, 1);
    assert.deepStrictEqual(result.violations[0], {
      path: 'src/backends/ko-reinforced.private.js',
      pattern: '**/*.private.*',
      source: 'package',
    });
  });

  // Follow-up ①, case B: a private file committed under a NEW directory is
  // caught via git tracking even if it never reaches the npm package.
  it('catches a private file committed under a new directory (git source)', () => {
    const result = runGate({
      packedFiles: ['src/cli.js'],
      trackedFiles: ['src/cli.js', 'corpus/ko-2026-reinforced.jsonl'],
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.violations.length, 1);
    assert.deepStrictEqual(result.violations[0], {
      path: 'corpus/ko-2026-reinforced.jsonl',
      pattern: '**/corpus/**',
      source: 'git',
    });
  });

  it('reports violations from both sources at once', () => {
    const result = runGate({
      packedFiles: ['server/index.js'],
      trackedFiles: ['lexicon/reinforced/ko.md'],
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.violations.map((v) => v.source).sort(), ['git', 'package']);
  });
});
