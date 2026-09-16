// @ts-check
// Single source of truth for "which persona (if any) is active for a rewrite".
// Shared by the CLI run path (src/cli/run.js) and the web/hosted rewrite path
// (src/web-rewrite.js) so both surfaces resolve voice ownership identically —
// the two must not drift.
import { loadPersona } from './loader.js';
import { inputError } from '../errors.js';

// Languages with a bundled persona library (personas/{lang}/).
export const PERSONA_LANGS = new Set(['ko', 'en', 'zh', 'ja']);

/**
 * Resolve the active persona for a rewrite invocation, or null when none applies.
 *
 * Policy (identical for CLI and web):
 * - personas apply only to rewrite surfaces and supported languages;
 * - every language is opt-in through `--persona`, web request, or config;
 * - omitting persona preserves the source voice.
 * @param {object} [options]
 * @param {Record<string, any>} [options.parsed] Parsed CLI args (web passes `{}`).
 * @param {import('../config.js').PatinaConfig} [options.config] Effective config (may carry `persona`).
 * @param {string} [options.mode] Effective output mode.
 * @param {string} [options.lang] Rewrite language.
 * @param {string} [options.repoRoot] Bundle/repo root for persona lookup.
 * @returns {object|null} Normalized persona object, or null when none applies.
 * @throws {import('../errors.js').PatinaCliError} When a persona is requested
 *   for a non-rewrite or unsupported-language surface.
 */
export function resolvePersonaForRun({ parsed = {}, config = {}, mode = 'rewrite', lang = 'ko', repoRoot = process.cwd() } = {}) {
  const personaId = parsed.persona ?? config.persona ?? null;
  const explicitPersona = typeof personaId === 'string' && personaId.length > 0;
  const supported = mode === 'rewrite' && PERSONA_LANGS.has(lang);
  if (explicitPersona && !supported) {
    throw inputError(
      'persona is only supported for rewrite mode',
      'A persona runs only for rewrite/preview in ko, en, zh, or ja.',
      'Use `patina --persona <name> <file>` on a rewrite, or remove the persona setting.'
    );
  }
  if (!supported || !explicitPersona) return null;
  return loadPersona(repoRoot, lang, personaId);
}
