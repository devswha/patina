// @ts-check
// Single source of truth for "which persona (if any) is active for a rewrite".
// Shared by the CLI run path (src/cli/run.js) and the web/hosted rewrite path
// (src/web-rewrite.js) so both surfaces resolve voice ownership identically —
// the two must not drift (a web-only copy is exactly how the ko voice-parity
// regression happened after the v6.2 profile-voice retirement).
import { loadPersona } from './loader.js';
import { inputError } from '../errors.js';

// Languages with a persona library (personas/{lang}/). Multilingual as of the
// persona multilang line; each ships at least a `preserve` default.
export const PERSONA_LANGS = new Set(['ko', 'en', 'zh', 'ja']);

/**
 * Resolve the active persona for a rewrite invocation, or null when none applies.
 *
 * Policy (identical for CLI and web):
 * - persona only applies when the effective mode is `rewrite`, preview is off,
 *   and the language has a persona library;
 * - `ko` keeps its implicit-preserve default (a plain rewrite resolves preserve);
 * - `en`/`zh`/`ja` are opt-in: a plain rewrite stays persona-free unless a
 *   persona is explicitly requested via `parsed.persona` or a non-default
 *   `config.persona`.
 *
 * @param {object} [options]
 * @param {object} [options.parsed] Parsed CLI args (web passes `{}`).
 * @param {object} [options.config] Effective config (may carry `persona`).
 * @param {string} [options.mode] Effective output mode.
 * @param {string} [options.lang] Rewrite language.
 * @param {string} [options.repoRoot] Bundle/repo root for persona lookup.
 * @returns {object|null} Normalized persona object, or null when none applies.
 * @throws {import('../errors.js').PatinaCliError} When a persona is explicitly
 *   requested for a surface that does not support it.
 */
export function resolvePersonaForRun({ parsed = {}, config = {}, mode = 'rewrite', lang = 'ko', repoRoot = process.cwd() } = {}) {
  const defaultPreserve = parsed.persona === undefined && config.persona === 'preserve';
  const explicitPersona = parsed.persona !== undefined || (config.persona !== undefined && !defaultPreserve);
  const personaId = parsed.persona ?? config.persona ?? null;
  const effective = mode === 'rewrite' && !parsed.preview && PERSONA_LANGS.has(lang);
  if (explicitPersona && !effective) {
    throw inputError(
      'persona is only supported for rewrite mode',
      'A persona runs only when the effective mode is rewrite, preview is off, and the language is one of ko, en, zh, ja.',
      'Use `patina --persona <name> <file>` on a rewrite (drop --score/--audit/--diff/--preview), or remove the persona setting.'
    );
  }
  if (!effective) return null;
  // Back-compat: ko keeps its implicit-preserve default (a plain `patina` run
  // resolves preserve). For en/zh/ja the persona axis is opt-in — a plain rewrite
  // stays persona-free unless the user explicitly asks (--persona / config), so
  // existing non-ko rewrites are unchanged.
  if (lang !== 'ko' && !explicitPersona) return null;
  return loadPersona(repoRoot, lang, personaId ?? 'preserve');
}
