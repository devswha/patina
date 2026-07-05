import { existsSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { inputError } from '../errors.js';
import { loadFile, splitFrontmatter } from '../loader.js';
import { validatePersona } from './schema.js';

const PERSONA_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function assertPersonaId(id) {
  if (!PERSONA_ID_RE.test(String(id ?? ''))) {
    throw inputError(
      `invalid persona id: ${JSON.stringify(id)}`,
      'Persona id must match /^[a-z0-9][a-z0-9-]*$/.',
      'Use a lowercase persona id such as preserve or pragmatic-founder.'
    );
  }
}

export function safePersonaPath(baseDir, id) {
  const path = resolve(baseDir, `${id}.md`);
  if (!path.startsWith(baseDir + sep)) {
    throw inputError(
      `persona path escaped its library: ${id}`,
      `${path} is outside ${baseDir}.`,
      'Use a normal persona id without path separators.'
    );
  }
  return path;
}

/**
 * Resolve a persona Markdown path, preferring custom/personas over personas.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} lang Persona language code.
 * @param {string} id Persona id.
 * @returns {string} Resolved persona file path.
 */
export function resolvePersonaPath(repoRoot, lang, id) {
  assertPersonaId(id);
  const customDir = resolve(repoRoot, 'custom', 'personas', lang);
  const libraryDir = resolve(repoRoot, 'personas', lang);
  const customPath = safePersonaPath(customDir, id);
  const libraryPath = safePersonaPath(libraryDir, id);
  return existsSync(customPath) ? customPath : libraryPath;
}

/**
 * Load and validate a persona. Markdown body is docs-only and is never returned.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} lang Persona language code.
 * @param {string} id Persona id.
 * @returns {object} Normalized persona frontmatter object.
 */
export function loadPersona(repoRoot, lang, id) {
  const personaPath = resolvePersonaPath(repoRoot, lang, id);
  if (!existsSync(personaPath)) {
    const available = listPersonas(repoRoot, lang);
    const hint = available.length > 0 ? `Available personas: ${available.join(', ')}.` : `No personas found for lang ${lang}.`;
    throw inputError(
      `persona not found: ${id}`,
      `${personaPath} does not exist. ${hint}`,
      `Create personas/${lang}/${id}.md or choose an available persona.`
    );
  }
  const content = loadFile(personaPath);
  const { frontmatter } = splitFrontmatter(content);
  return validatePersona(frontmatter, { id, lang });
}

/**
 * List persona ids from the built-in and custom persona libraries.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} lang Persona language code.
 * @returns {string[]} Sorted persona ids.
 */
export function listPersonas(repoRoot, lang) {
  const dirs = [
    resolve(repoRoot, 'personas', lang),
    resolve(repoRoot, 'custom', 'personas', lang),
  ];
  const ids = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.md')) ids.add(file.slice(0, -3));
    }
  }
  return [...ids].sort();
}
