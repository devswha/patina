import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  globToRegExp,
  matchForbidden,
  runGate,
} from '../../scripts/check-no-private-assets.mjs';

const hitByPath = (paths) => new Map(matchForbidden(paths).map((hit) => [hit.path, hit.pattern]));

describe('monetization leak guard red-team: private asset placement', () => {
  it('catches monetization private assets across nested source, corpus, and server paths', () => {
    const planted = [
      'src/paywall/private/persona-license.js',
      'src/x/private/y.js',
      'revenue/corpus/premium-ko/seed.jsonl',
      'packages/patina-humanizer/corpus/deep/monetization/train.jsonl',
      'server/billing/entitlements.js',
    ];

    assert.deepEqual(hitByPath(planted), new Map([
      ['src/paywall/private/persona-license.js', '**/private/**'],
      ['src/x/private/y.js', '**/private/**'],
      ['revenue/corpus/premium-ko/seed.jsonl', '**/corpus/**'],
      ['packages/patina-humanizer/corpus/deep/monetization/train.jsonl', '**/corpus/**'],
      ['server/billing/entitlements.js', '**/server/**'],
    ]));
  });

  it('treats explicitly private filename markers as case-insensitive leak shapes', () => {
    const upperPrivate = 'src/payments/pro-pricing.PRIVATE.js';

    assert.deepEqual(matchForbidden([upperPrivate]), [
      { path: upperPrivate, pattern: '**/*.private.*' },
    ]);
  });
});

describe('monetization leak guard red-team: false-positive probes', () => {
  it('does not catch safe paths that merely contain server-like text', () => {
    const benignServerWords = [
      'observer/x.js',
      'src/serverless.js',
      'src/features/observer-score.js',
      'docs/integrations/serverless.md',
    ];

    assert.deepEqual(matchForbidden(benignServerWords), []);
  });

  it('does not catch benign public monetization modules', () => {
    const benignMonetization = [
      'src/features/pricing.js',
      'src/personas/license-gates.js',
      'docs/integrations/stripe-public.md',
      'packages/patina-humanizer/src/billing-public.js',
    ];

    assert.deepEqual(matchForbidden(benignMonetization), []);
  });
});

describe('monetization leak guard red-team: packed and tracked sources', () => {
  it('fails runGate when monetization private assets leak through package and git sources', () => {
    const result = runGate({
      packedFiles: [
        'src/index.js',
        'packages/patina-humanizer/src/paywall.private.js',
      ],
      trackedFiles: [
        'README.md',
        'src/monetization/private/keys.js',
      ],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.counts, { packed: 2, tracked: 2 });
    assert.deepEqual(result.violations, [
      {
        path: 'packages/patina-humanizer/src/paywall.private.js',
        pattern: '**/*.private.*',
        source: 'package',
      },
      {
        path: 'src/monetization/private/keys.js',
        pattern: '**/private/**',
        source: 'git',
      },
    ]);
  });

  it('passes runGate for empty and benign-only inputs', () => {
    assert.deepEqual(runGate(), {
      ok: true,
      violations: [],
      counts: { packed: 0, tracked: 0 },
    });

    assert.deepEqual(runGate({
      packedFiles: ['src/index.js', 'packages/patina-humanizer/bin/patina-humanizer.js'],
      trackedFiles: ['README.md', 'src/features/pricing.js'],
    }), {
      ok: true,
      violations: [],
      counts: { packed: 2, tracked: 2 },
    });
  });
});

describe('monetization leak guard red-team: enhanced engine shapes', () => {
  it('catches each reinforced/enhanced/corpus shape independently', () => {
    const engineShapes = [
      'src/engines/pricing.enhanced.js',
      'src/engines/persona.reinforced.json',
      'src/engines/enhanced/paywall.js',
      'src/engines/reinforced/scorer.js',
      'src/engines/corpus/premium.jsonl',
    ];

    assert.deepEqual(hitByPath(engineShapes), new Map([
      ['src/engines/pricing.enhanced.js', '**/*.enhanced.*'],
      ['src/engines/persona.reinforced.json', '**/*.reinforced.*'],
      ['src/engines/enhanced/paywall.js', '**/enhanced/**'],
      ['src/engines/reinforced/scorer.js', '**/reinforced/**'],
      ['src/engines/corpus/premium.jsonl', '**/corpus/**'],
    ]));
  });

  it('keeps glob compilation anchored to complete path segments', () => {
    const serverGlob = globToRegExp('server/**');
    assert.equal(serverGlob.test('server/billing.js'), true);
    assert.equal(serverGlob.test('observer/server/billing.js'), false);
    assert.equal(serverGlob.test('src/serverless.js'), false);
  });
});
