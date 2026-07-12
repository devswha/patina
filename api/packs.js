// @ts-check
// Vercel function: licensed pro-pack delivery. All logic lives in
// src/pack-handler.js (testable); this file only wires production deps,
// mirroring api/rewrite.js.

import { createRestKv } from './rewrite.js';
import { createMemoryKv, isProductionPosture } from '../src/rate-limit.js';
import { createLemonSqueezyLicenseValidator } from '../src/entitlement.js';
import { createPackHandler } from '../src/pack-handler.js';

export function createPacksApiHandler({ env = /** @type {Record<string,string|undefined>} */ (process.env), logger = console } = {}) {
  const restKv = createRestKv(env);
  const kv = isProductionPosture(env) ? restKv : (restKv ?? createMemoryKv());
  const licenseValidator = createLemonSqueezyLicenseValidator({
    kv,
    hmacSecret: env.PATINA_LICENSE_HMAC_SECRET || env.PATINA_QUOTA_HMAC_SECRET,
    env,
    logger: /** @type {any} */ (logger),
  });
  return createPackHandler({ env, kv: /** @type {any} */ (kv), licenseValidator, logger });
}

const handler = createPacksApiHandler();
export default handler;
