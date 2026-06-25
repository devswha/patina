import assert from 'node:assert/strict';

import {
  PROVIDER_PRESETS,
  REWRITE_MODES,
  STREAM_FRAME_TYPES,
  WEB_TIERS,
  evaluateFloors,
  parseStreamFrame,
  redactSecrets,
  resolveProviderModel,
  validateRewriteRequest,
} from '../../src/web-rewrite-contract.js';

const resolved = resolveProviderModel({ tier: WEB_TIERS.BYOK, provider: 'openai', model: 'gpt-4.1-mini' });
assert.equal(resolved.ok, true);
assert.equal(resolved.baseURL, PROVIDER_PRESETS.openai.baseURL);

const freeKey = validateRewriteRequest({
  mode: REWRITE_MODES.FIRST,
  lang: 'en',
  tier: WEB_TIERS.FREE,
  text: 'smoke test text',
  apiKey: 'sk-smuggled123456',
});
assert.equal(freeKey.ok, false);
assert.equal(freeKey.status, 400);

assert.equal(JSON.stringify(redactSecrets({ Authorization: 'Bearer sk-secret123456', nested: 'sk-inline123456' })).includes('sk-secret123456'), false);
assert.equal(evaluateFloors({ mps: 70, fidelity: 69 }).ok, false);
assert.equal(parseStreamFrame('{"type":"delta"').type, STREAM_FRAME_TYPES.ERROR);

console.log('web-rewrite-contract-smoke: OK');
