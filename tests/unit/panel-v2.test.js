import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DET_DOCUMENT_THRESHOLD,
  PANEL_V2,
  requireFreshCorpusValidation,
  validateFreshCorpus,
} from '../../scripts/research/panel-v2.mjs';

describe('panel v2 judge policy', () => {
  it('promotes the deterministic document verdict to chief judge', () => {
    assert.equal(PANEL_V2.chief.id, 'judge-det');
    assert.equal(PANEL_V2.chief.threshold, 35);
    assert.equal(DET_DOCUMENT_THRESHOLD, 35);
    assert.deepEqual(PANEL_V2.perceptual.map(({ id }) => id), ['judge-gpt', 'judge-grok']);
  });

  it('uses score >= 35 for the document verdict', () => {
    const validation = validateFreshCorpus([
      { label: 'human', score: 34.999 },
      { label: 'ai', score: 35 },
    ]);
    assert.equal(validation.accuracy, 1);
    assert.equal(validation.binaryVerdictsAllowed, true);
  });

  it('enforces fresh-corpus accuracy of at least 0.85', () => {
    const passing = Array.from({ length: 20 }, (_, index) => ({
      label: index < 17 ? 'ai' : 'human',
      score: index < 17 ? 35 : 0,
    }));
    assert.equal(requireFreshCorpusValidation(passing).accuracy, 1);

    const failing = Array.from({ length: 20 }, (_, index) => ({
      label: 'ai',
      score: index < 16 ? 35 : 0,
    }));
    assert.throws(
      () => requireFreshCorpusValidation(failing),
      /binary verdict disabled: fresh-corpus accuracy 0\.800 < 0\.85/,
    );
  });

  it('rejects missing or malformed validation evidence', () => {
    assert.throws(() => validateFreshCorpus([]), /at least one labeled row/);
    assert.throws(
      () => validateFreshCorpus([{ label: 'unknown', score: 35 }]),
      /label=ai\|human and a finite score/,
    );
  });
});
