// Map rebaseline manifest / fixture provenance fields onto B2-native slice
// dimensions (Wave 0.1). B2 (tests/quality/slice-metrics.mjs) reports the
// dimensions `generator` and `edited`, but the rebaseline corpus pipeline
// records `model_family` and `edit_depth`. This is the single tested
// reconciliation layer: benchmark fixture ingestion resolves B2-native fields
// through it now, and fixture export reuses the same mapper in Wave 0.2.
// Explicit B2-native values always win over the provenance aliases; class-based
// defaults fill the rest so existing
// unedited fixtures report a meaningful `edited: none` and human controls
// report `generator: human` instead of a blanket `unspecified`.

import { UNSPECIFIED } from './slice-metrics.mjs';

const NATURAL_CLASSES = new Set(['natural-human', 'natural', 'human-control']);
// Classes that, absent an explicit edit pass, are genuinely un-edited.
const UNEDITED_CLASSES = new Set(['natural-human', 'natural', 'human-control', 'ai-like', 'ai']);

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

// B2 `generator`: explicit field > model_family alias > class default.
// Human controls map to `human`; AI rows with no recorded model stay unknown.
export function mapGenerator(meta = {}) {
  if (present(meta.generator)) return meta.generator;
  if (present(meta.model_family)) return meta.model_family;
  if (NATURAL_CLASSES.has(meta.class)) return 'human';
  return UNSPECIFIED;
}

// B2 `edited`: explicit field > edit_depth alias > class default.
// Un-edited classes default to `none`; genuinely unknown classes stay
// `unspecified`, so a natural-human row never fabricates edited-AI support.
export function mapEdited(meta = {}) {
  if (present(meta.edited)) return meta.edited;
  if (present(meta.edit_depth)) return meta.edit_depth;
  if (UNEDITED_CLASSES.has(meta.class)) return 'none';
  return UNSPECIFIED;
}

// Resolve the four metadata-backed B2 slice dimensions for a fixture/manifest
// row. `lengthBucket` is derived separately from the body and is not handled
// here. `register`/`domain` have no provenance alias, so they pass through with
// an `unspecified` default.
export function resolveSliceFields(meta = {}) {
  return {
    register: present(meta.register) ? meta.register : UNSPECIFIED,
    domain: present(meta.domain) ? meta.domain : UNSPECIFIED,
    generator: mapGenerator(meta),
    edited: mapEdited(meta),
  };
}
