// Persona frontmatter schema + validation (patina.persona.v2).
//
// A persona is a reusable voice definition. Its YAML frontmatter is the
// deterministic SSOT; the Markdown body is docs-only and never reaches the
// prompt. Document policy, register, and meaning-preservation thresholds live
// outside the persona schema.

import { inputError } from '../errors.js';
import { finiteOr } from '../features/numeric.js';

export const PERSONA_SCHEMA_ID = 'patina.persona.v2';
export const ACTIVE_BLOCK_TYPES = Object.freeze([
  'preferred_words',
  'preferred_metaphors',
  'explanation_habits',
  'sentence_structure',
]);
export const RESERVED_BLOCK_TYPES = Object.freeze(['worldview']);
export const ALL_BLOCK_TYPES = Object.freeze([...ACTIVE_BLOCK_TYPES, ...RESERVED_BLOCK_TYPES]);

// Keys owned by another axis. Rejecting them makes responsibility overlap
// visible instead of silently accepting a persona that changes safety,
// document policy, or register.
const FORBIDDEN_KEYS = Object.freeze([
  'mps',
  'fidelity',
  'depth',
  'disable_mps',
  'document-type',
  'documentType',
  'profile',
  'pattern-overrides',
  'patternOverrides',
  'tone',
  'formality',
  'verification',
  'thresholds',
  'persona_depth_directive',
  'register',
  'ko_register_plain_ratio',
  'ko_register_polite_ratio',
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
        `persona "${personaId}" sets out-of-scope key "${key}"`,
        `Persona files define voice only (found "${key}" at ${path || '<root>'}.${key}).`,
        'Move safety to verification, document rules to document-type, and casual/professional register to --register.'
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
      'The worldview block is reserved but inactive (content-risk: it can change a text\'s stance/framing).',
      'Set blocks.worldview.active: false. Persona v2 is strictly voice-only.'
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
        targetPer1000Tokens: finiteOr(pw.density?.target_per_1000_tokens, null),
        maxPerParagraph: finiteOr(pw.density?.max_per_paragraph, null),
      },
    },
    preferredMetaphors: {
      active: asBool(pm.active),
      allow: asStringArray(pm.allow),
      maxNewMetaphorsPer500Chars: finiteOr(pm.max_new_metaphors_per_500_chars, 1),
    },
    explanationHabits: {
      active: asBool(eh.active),
      moves: asStringArray(eh.moves),
      avoid: asStringArray(eh.avoid),
    },
    sentenceStructure: {
      active: asBool(ss.active),
      sentenceLengthCvTarget: numberPairOr(ss.sentence_length_cv_target, null),
      avgSentenceEojeolTarget: numberPairOr(ss.avg_sentence_eojeol_target, null),
      paragraphSentenceCountTarget: numberPairOr(ss.paragraph_sentence_count_target, null),
      openerDiversityMin: finiteOr(ss.opener_diversity_min, null),
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
      out.overEditChurn = { max: finiteOr(spec.max, 0.45), weight: finiteOr(spec.weight, 0) };
      continue;
    }
    out[name] = {
      target: finiteOr(spec.target, null),
      tolerance: finiteOr(spec.tolerance, null),
      weight: finiteOr(spec.weight, 0),
    };
  }
  return out;
}


/**
 * Validate persona frontmatter and return a normalized, frontmatter-derived
 * persona object. The Markdown body is never consumed here.
 *
 * @param {object|null} frontmatter Parsed YAML frontmatter.
 * @param {object} [ctx] Context: { id, lang } resolved from the file path.
 * @returns {object} Normalized persona.
 * @throws {PatinaCliError} input error (exit 2) on schema violations.
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



  const blocks = normalizeBlocks(frontmatter.blocks, id);
  const targetFeatures = normalizeTargetFeatures(frontmatter.target_features, id);

  return {
    schema: PERSONA_SCHEMA_ID,
    id,
    name,
    lang,
    source: frontmatter.source === 'learned' ? 'learned' : 'library',
    blocks,
    targetFeatures,
  };
}

