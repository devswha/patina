// @ts-check
// EnhancedRewriteEngine adapter contract (open-core boundary).
//
// The PUBLIC repo ships only this contract + a deterministic STUB adapter for
// plumbing/e2e. The real enhanced ko engine is a PRIVATE cross-track asset that
// MUST implement the SAME contract and pass the SAME contract test before
// payment-open. Keeping the contract public + the implementation private is the
// open-core moat: the wire shape is known, the quality is not shippable.
//
// A conforming engine exposes:
//   isAvailable(env): boolean        — whether this adapter can serve a request
//   async rewrite(request): Result   — { text, scores:{mps,fidelity} }
// and throws a typed EnhancedEngineError for invalid input / unavailability.
// It must never embed or emit a private asset (corpus/lexicon/pattern bodies).

import { MPS_FLOOR, FIDELITY_FLOOR, SUPPORTED_LANGS } from './web-rewrite-contract.js';

/** Typed error so callers can fail closed on a known shape. */
export class EnhancedEngineError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'EnhancedEngineError';
    this.code = code;
  }
}

/**
 * Validate an enhanced-rewrite request shape (shared by every adapter).
 * @param {any} request
 * @returns {{text:string, lang:string, mode:string}}
 */
export function assertValidEnhancedRequest(request) {
  if (!request || typeof request !== 'object') throw new EnhancedEngineError('bad_request', 'request must be an object');
  const { text, lang, mode } = request;
  if (typeof text !== 'string' || text.trim().length === 0) throw new EnhancedEngineError('bad_request', 'text required');
  if (!SUPPORTED_LANGS.includes(lang)) throw new EnhancedEngineError('bad_request', 'unsupported lang');
  if (mode !== 'first' && mode !== 'refine') throw new EnhancedEngineError('bad_request', 'mode must be first|refine');
  return { text, lang, mode };
}

/**
 * Create the PUBLIC stub enhanced engine. It is deterministic, carries NO
 * private asset, and is for plumbing/e2e only — it does NOT humanize. It
 * returns the input text unchanged with floor-passing scores so the rewrite
 * pipeline (gate -> entitlement -> metering -> engine -> response) can be
 * exercised end to end without the private engine.
 *
 * @param {{kind?:string}} [opts]
 */
export function createStubEnhancedEngine({ kind = 'stub' } = {}) {
  return {
    kind,
    /** @param {Record<string,string|undefined>} [_env] */
    isAvailable(_env) {
      return true;
    },
    /**
     * @param {any} request
     * @returns {Promise<{text:string, scores:{mps:number, fidelity:number}, engine:string}>}
     */
    async rewrite(request) {
      const { text } = assertValidEnhancedRequest(request);
      // Plumbing only: echo the input unchanged. A stub MUST NOT claim to have
      // improved anything; scores are exactly at the floor so the pipeline does
      // not treat stub output as a quality win.
      return { text, scores: { mps: MPS_FLOOR, fidelity: FIDELITY_FLOOR }, engine: kind };
    },
  };
}

/**
 * Shared contract test. Both the public stub and the private enhanced engine
 * MUST pass this. `assert` is injected (node:assert) so this module stays
 * dependency-free and usable from any test runner.
 *
 * @param {() => {isAvailable:Function, rewrite:Function}} makeEngine
 * @param {{ equal:Function, ok:Function, rejects:Function, match?:Function }} assert
 */
export async function runEnhancedEngineContract(makeEngine, assert) {
  const engine = makeEngine();

  // isAvailable returns a boolean.
  assert.equal(typeof engine.isAvailable(), 'boolean');
  assert.equal(typeof engine.isAvailable({}), 'boolean');

  // A valid request yields { text, scores{mps,fidelity} } at or above floor.
  const ok = await engine.rewrite({ text: '안녕하세요 테스트', lang: 'ko', mode: 'first' });
  assert.equal(typeof ok.text, 'string');
  assert.ok(ok.text.length > 0);
  assert.ok(Number.isFinite(ok.scores.mps) && ok.scores.mps >= MPS_FLOOR);
  assert.ok(Number.isFinite(ok.scores.fidelity) && ok.scores.fidelity >= FIDELITY_FLOOR);

  // Invalid inputs throw the typed error (fail-closed, no silent default).
  await assert.rejects(() => engine.rewrite(null), /request must be an object/);
  await assert.rejects(() => engine.rewrite({ text: '', lang: 'ko', mode: 'first' }), /text required/);
  await assert.rejects(() => engine.rewrite({ text: 'x', lang: 'xx', mode: 'first' }), /unsupported lang/);
  await assert.rejects(() => engine.rewrite({ text: 'x', lang: 'ko', mode: 'bogus' }), /first\|refine/);

  // The output must not embed private-asset markers (open-core leak guard).
  const out = JSON.stringify(ok);
  for (const marker of ['.private.', '.enhanced.', '.reinforced.', 'corpus/']) {
    assert.ok(!out.includes(marker), `engine output leaked a private marker: ${marker}`);
  }
}
