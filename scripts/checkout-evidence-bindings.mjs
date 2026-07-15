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

// Add reviewed immutable PAY-STG/PAY-B evidence bindings here only after human
// verification of the exact Lemon Squeezy checkout URL. The executable generator
// uses this source-controlled table; environment variables cannot add a binding.
export const CHECKOUT_EVIDENCE_BINDINGS = deepFreeze({});
