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

// The approved staging and production tuples are source controlled; environment
// variables cannot add, alter, or promote checkout bindings. The production
// tuple integrates the owner's PAY-B pre-deployment approval
// (docs/operations/pay-b-binding-20260723.json); enabling checkout still
// requires the full Gate-B/Gate-D env-side sequence.
export const CHECKOUT_EVIDENCE_BINDINGS = deepFreeze({
  [checkoutEvidenceBindingKey({
    channel: 'staging',
    evidence: 'PAY-STG-20260716-1199625-1875389',
    origin: 'https://vibetip.lemonsqueezy.com',
    path: '/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514',
  })]: true,
  [checkoutEvidenceBindingKey({
    channel: 'production',
    evidence: 'PAY-B-20260723-1236551-1932893',
    origin: 'https://vibetip.lemonsqueezy.com',
    path: '/checkout/buy/8ab3a49b-cc55-49e8-bd94-9cbdff5e6a7d',
  })]: true,
});
