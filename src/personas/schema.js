// patina-lane: B (persona / LLM rewrite) — persona config SSOT. See docs/ARCHITECTURE.md.
// Persona frontmatter schema + validation (patina.persona.v1).
//
// A persona is the single voice-composition config unit (deep-interview R4):
// the YAML frontmatter is the deterministic SSOT; the Markdown body is
// docs-only and MUST NOT reach compose/prompt/gate inputs. validatePersona()
// returns a normalized, frontmatter-derived object only — never the body.
//
// Safety invariant (deep-interview R3/R7, ralplan critic item #1/#2):
// a persona can NEVER make MPS/fidelity advisory, lower the floors below the
// core minimum, disable the detector, or skip patterns. worldview is schema
// reserved but inactive in v1. Any attempt is an input error.

import { inputError } from '../errors.js';

export const PERSONA_SCHEMA_ID = 'patina.persona.v1';

// Core safety floors. A persona may raise these (stricter) but never lower them.
export const MIN_MPS_FLOOR = 70;
export const MIN_FIDELITY_FLOOR = 70;

export const PERSONA_DEPTHS = Object.freeze(['style-only', 'content']);
export const ACTIVE_BLOCK_TYPES = Object.freeze([
  'preferred_words',
  'preferred_metaphors',
  'explanation_habits',
  'sentence_structure',
]);
export const RESERVED_BLOCK_TYPES = Object.freeze(['worldview']);
export const ALL_BLOCK_TYPES = Object.freeze([...ACTIVE_BLOCK_TYPES, ...RESERVED_BLOCK_TYPES]);

// Keys that would weaken the safety contract if a persona file set them. They
// are rejected anywhere they appear in the frontmatter (top level or nested).
const FORBIDDEN_KEYS = Object.freeze([
  'disable_mps',
  'disable_fidelity',
  'disable_detector',
  'bypass_detector',
  'skip_patterns',
  'skipPatterns',
  'skip_detector',
  'allowlist',
  'blocklist',
]);

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SUPPORTED_LANGS = Object.freeze(['ko', 'en', 'zh', 'ja']);

function fail(what, why, action) {
  return inputError(what, why, action);
}

// Recursively assert no forbidden gate-weakening key appears anywhere.
function assertNoForbiddenKeys(node, personaId, path = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertNoForbiddenKeys(item, personaId, `${path}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw fail(
        `persona "${personaId}" sets forbidden key "${key}"`,
        `Persona files cannot weaken safety gates (found "${key}" at ${path || '<root>'}.${key}).`,
        'Remove the key. Personas are style-only/content composition and may never disable MPS, fidelity, the detector, or pattern packs.'
      );
    }
    assertNoForbiddenKeys(value, personaId, path ? `${path}.${key}` : key);
  }
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true;
}

function asStringArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberPairOr(value, fallback) {
  if (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [value[0], value[1]];
  }
  return fallback;
}

function normalizeBlocks(rawBlocks, personaId) {
  const blocks = rawBlocks && typeof rawBlocks === 'object' && !Array.isArray(rawBlocks) ? rawBlocks : {};

  const worldview = blocks.worldview ?? {};
  if (asBool(worldview.active, false)) {
    throw fail(
      `persona "${personaId}" activates worldview block`,
      'The worldview block is reserved in schema but inactive in v1 (content-risk: it can change a text\'s stance/framing).',
      'Set blocks.worldview.active: false. worldview will be enabled in v2 behind a bounded-stance guard.'
    );
  }

  const pw = blocks.preferred_words ?? {};
  const pm = blocks.preferred_metaphors ?? {};
  const eh = blocks.explanation_habits ?? {};
  const ss = blocks.sentence_structure ?? {};

  return {
    preferredWords: {
      active: asBool(pw.active),
      allow: asStringArray(pw.allow),
      avoid: asStringArray(pw.avoid),
      density: {
        targetPer1000Tokens: numberOr(pw.density?.target_per_1000_tokens, null),
        maxPerParagraph: numberOr(pw.density?.max_per_paragraph, null),
      },
    },
    preferredMetaphors: {
      active: asBool(pm.active),
      allow: asStringArray(pm.allow),
      // metaphor injection is content-risky: facts are never invented.
      forbidNewFacts: asBool(pm.forbid_new_facts, true),
      maxNewMetaphorsPer500Chars: numberOr(pm.max_new_metaphors_per_500_chars, 1),
    },
    explanationHabits: {
      active: asBool(eh.active),
      moves: asStringArray(eh.moves),
      avoid: asStringArray(eh.avoid),
    },
    sentenceStructure: {
      active: asBool(ss.active),
      register: typeof ss.register === 'string' ? ss.register : null,
      sentenceLengthCvTarget: numberPairOr(ss.sentence_length_cv_target, null),
      avgSentenceEojeolTarget: numberPairOr(ss.avg_sentence_eojeol_target, null),
      paragraphSentenceCountTarget: numberPairOr(ss.paragraph_sentence_count_target, null),
      openerDiversityMin: numberOr(ss.opener_diversity_min, null),
    },
    worldview: { active: false },
  };
}

function normalizeTargetFeatures(raw, personaId) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail(
      `persona "${personaId}" has a malformed target_features block`,
      'target_features must be a mapping of feature name -> { target, tolerance, weight } (or over_edit_churn -> { max, weight }).',
      'Fix the YAML shape of target_features.'
    );
  }
  const out = {};
  for (const [name, spec] of Object.entries(raw)) {
    if (!spec || typeof spec !== 'object') continue;
    if (name === 'over_edit_churn') {
      out.overEditChurn = { max: numberOr(spec.max, 0.45), weight: numberOr(spec.weight, 0) };
      continue;
    }
    out[name] = {
      target: numberOr(spec.target, null),
      tolerance: numberOr(spec.tolerance, null),
      weight: numberOr(spec.weight, 0),
    };
  }
  return out;
}

function normalizeGate(raw, minFloor, personaId, label) {
  const gate = raw && typeof raw === 'object' ? raw : {};
  const enforce = gate.enforce === undefined ? true : asBool(gate.enforce, true);
  if (!enforce) {
    throw fail(
      `persona "${personaId}" disables the ${label} gate`,
      `${label}.enforce must be true. A persona cannot turn off meaning-preservation gates.`,
      `Set ${label}.enforce: true.`
    );
  }
  const floor = numberOr(gate.floor, minFloor);
  if (floor < minFloor) {
    throw fail(
      `persona "${personaId}" lowers the ${label} floor below ${minFloor}`,
      `${label}.floor is ${floor} but the core minimum is ${minFloor}. A persona may raise a floor but never lower it.`,
      `Set ${label}.floor >= ${minFloor}.`
    );
  }
  return { enforce: true, floor };
}

/**
 * Validate persona frontmatter and return a normalized, frontmatter-derived
 * persona object. The Markdown body is never consumed here.
 *
 * @param {object|null} frontmatter Parsed YAML frontmatter.
 * @param {object} [ctx] Context: { id, lang } resolved from the file path.
 * @returns {object} Normalized persona.
 * @throws {PatinaCliError} input error (exit 2) on any schema/safety violation.
 */
export function validatePersona(frontmatter, ctx = {}) {
  const fileId = ctx.id ?? (frontmatter && frontmatter.id) ?? '<unknown>';

  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw fail(
      `persona "${fileId}" has no valid frontmatter`,
      'A persona file must start with a YAML frontmatter block (--- ... ---) holding the persona definition.',
      'Add a frontmatter block; the Markdown body is docs-only and is ignored at runtime.'
    );
  }

  assertNoForbiddenKeys(frontmatter, fileId);

  if (frontmatter.schema !== PERSONA_SCHEMA_ID) {
    throw fail(
      `persona "${fileId}" has an unsupported schema`,
      `Expected schema: ${PERSONA_SCHEMA_ID} but got ${JSON.stringify(frontmatter.schema)}.`,
      `Set "schema: ${PERSONA_SCHEMA_ID}" in the persona frontmatter.`
    );
  }

  const id = String(frontmatter.id ?? ctx.id ?? '').trim();
  if (!ID_RE.test(id)) {
    throw fail(
      `persona has an invalid id ${JSON.stringify(id)}`,
      'Persona id must match /^[a-z0-9][a-z0-9-]*$/ and match its filename.',
      'Rename the persona id, e.g. "pragmatic-founder".'
    );
  }
  if (ctx.id && ctx.id !== id) {
    throw fail(
      `persona id "${id}" does not match filename "${ctx.id}"`,
      'The frontmatter id and the persona filename must agree so the library is unambiguous.',
      `Set id: ${ctx.id} or rename the file to ${id}.md.`
    );
  }

  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim() ? frontmatter.name.trim() : id;
  const lang = String(frontmatter.lang ?? ctx.lang ?? 'ko').trim();
  if (!SUPPORTED_LANGS.includes(lang)) {
    throw fail(
      `persona "${id}" has unsupported lang "${lang}"`,
      `Supported languages: ${SUPPORTED_LANGS.join(', ')}.`,
      'Set a supported lang. v1 ships KO personas; EN/ZH/JA are structurally reserved.'
    );
  }

  const depth = String(frontmatter.depth ?? 'style-only').trim();
  if (!PERSONA_DEPTHS.includes(depth)) {
    throw fail(
      `persona "${id}" has invalid depth "${depth}"`,
      `Persona depth must be one of: ${PERSONA_DEPTHS.join(', ')}.`,
      'Use depth: style-only (default) or depth: content.'
    );
  }

  // Depth directive: content depth may relax emphasis/coverage only; it can
  // NEVER make MPS/fidelity advisory.
  const pdd = frontmatter.persona_depth_directive ?? {};
  if (asBool(pdd.mps_advisory, false) || asBool(pdd.fidelity_advisory, false)) {
    throw fail(
      `persona "${id}" tries to make MPS/fidelity advisory`,
      'persona_depth_directive.mps_advisory / fidelity_advisory must be false. Persona content depth relaxes emphasis/coverage only; meaning-preservation floors stay enforced.',
      'Remove or set those flags to false.'
    );
  }

  const mps = normalizeGate(frontmatter.mps, MIN_MPS_FLOOR, id, 'mps');
  const fidelity = normalizeGate(frontmatter.fidelity, MIN_FIDELITY_FLOOR, id, 'fidelity');

  const blocks = normalizeBlocks(frontmatter.blocks, id);
  const targetFeatures = normalizeTargetFeatures(frontmatter.target_features, id);

  return {
    schema: PERSONA_SCHEMA_ID,
    id,
    name,
    lang,
    source: frontmatter.source === 'learned' ? 'learned' : 'library',
    depth,
    personaDepthDirective: {
      contentScope: typeof pdd.content_scope === 'string' ? pdd.content_scope : 'emphasis-and-coverage-only',
      mpsAdvisory: false,
      fidelityAdvisory: false,
    },
    mps,
    fidelity,
    blocks,
    targetFeatures,
  };
}

/**
 * Whether a normalized persona is the meaning-preserving default ("preserve").
 * The default persona must be style-only with no content injection.
 */
export function isPreservePersona(persona) {
  return Boolean(persona) && persona.id === 'preserve' && persona.depth === 'style-only';
}
