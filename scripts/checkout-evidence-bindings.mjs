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

// The approved staging tuple is source controlled; environment variables cannot
// add, alter, or promote checkout bindings.
export const CHECKOUT_EVIDENCE_BINDINGS = deepFreeze({
  [checkoutEvidenceBindingKey({
    channel: 'staging',
    evidence: 'PAY-STG-20260716-1199625-1875389',
    origin: 'https://vibetip.lemonsqueezy.com',
    path: '/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514',
  })]: true,
});
