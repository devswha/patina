function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  }
  return value;
}

export function checkoutEvidenceBindingKey({ channel, evidence, origin, path }) {
  return JSON.stringify([channel, evidence, origin, path]);
}

// The approved production tuple is source controlled; environment variables
// cannot add, alter, or promote checkout bindings. The production tuple
// integrates the verified Polar identities
// (docs/operations/pay-b-binding-polar-20260729.json) and the production
// zero-amount purchase runtime evidence
// (docs/operations/pay-live-runtime-polar-20260729.json); enabling checkout
// still requires PATINA_PRO_CHECKOUT_ENABLED, a matching PATINA_PRO_CHECKOUT_URL
// and PATINA_PRO_GATE_EVIDENCE_ID in the build environment.
export const CHECKOUT_EVIDENCE_BINDINGS = deepFreeze({
  [checkoutEvidenceBindingKey({
    channel: 'production',
    evidence: 'PAY-B-20260729-POLAR-ea8385dc-4c9c3f17',
    origin: 'https://buy.polar.sh',
    path: '/polar_cl_qKqtaZKLhUNJetr1h7XHY6wn8lRJEtG5DAPr02tG1pW',
  })]: true,
});
