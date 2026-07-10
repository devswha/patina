import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import yaml from 'js-yaml';
import { validateProfileName } from './security.js';
import { inputError, runtimeError } from './errors.js';

/**
 * Read a UTF-8 text file.
 *
 * @param {string} path File path to read.
 * @returns {string} File contents.
 * @throws {Error} When the file cannot be read.
 * @example
 * const markdown = loadFile('README.md');
 */
export function loadFile(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Split Markdown-style YAML frontmatter from a document body.
 *
 * @param {string} content File contents.
 * @returns {{frontmatter: object|null, body: string}} Parsed frontmatter and trimmed body.
 * @throws {Error} When YAML frontmatter is invalid.
 * @example
 * const { frontmatter, body } = splitFrontmatter('---\ntitle: x\n---\nBody');
 */
export function splitFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return {
    frontmatter: yaml.load(match[1]),
    body: match[2].trim(),
  };
}

/**
 * Load language-specific pattern packs from patterns/{lang}-*.md, plus any
 * user or pro packs in custom/patterns/{lang}-*.md. On a filename collision
 * the custom pack wins (same precedence the persona and lexicon loaders give
 * custom/), so an installed pack can also override a built-in one.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} lang Language code, such as ko, en, zh, or ja.
 * @param {string[]} [skipPatterns=[]] Pack names to omit, without .md.
 * @returns {Array<{file: string, frontmatter: object|null, body: string, isStructure: boolean, isScoreOnly: boolean}>} Pattern packs.
 * @throws {Error} When the patterns directory or a pattern file cannot be read.
 * @example
 * const patterns = loadPatterns(getRepoRoot(), 'en');
 */
export function loadPatterns(repoRoot, lang, skipPatterns = []) {
  const patternsDir = resolve(repoRoot, 'patterns');
  const customDir = resolve(repoRoot, 'custom', 'patterns');

  const discover = (dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith(`${lang}-`) && f.endsWith('.md'))
      .filter((f) => !skipPatterns.includes(f.slice(0, -3)))
      .map((f) => ({ file: f, path: resolve(dir, f) }));
  };

  // custom/ entries shadow built-ins with the same filename.
  const byFile = new Map();
  for (const entry of discover(patternsDir)) byFile.set(entry.file, entry);
  for (const entry of discover(customDir)) byFile.set(entry.file, entry);
  const entries = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));

  const packs = [];
  for (const entry of entries) {
    const content = loadFile(entry.path);
    const { frontmatter, body } = splitFrontmatter(content);
    packs.push({
      file: entry.file,
      frontmatter,
      body,
      isStructure: frontmatter?.phase === 'structure',
      isScoreOnly: frontmatter?.score_only === true,
    });
  }
  return packs;
}

/**
 * Load a named profile from profiles/{profileName}.md after path validation.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} profileName Profile file stem.
 * @returns {{frontmatter: object|null, body: string}} Parsed profile document.
 * @throws {Error} When the profile name is invalid or the file cannot be read.
 * @example
 * const profile = loadProfile(getRepoRoot(), 'default');
 */
export function loadProfile(repoRoot, profileName) {
  validateProfileName(profileName);
  const profilesDir = resolve(repoRoot, 'profiles');
  const profilePath = resolve(profilesDir, `${profileName}.md`);
  if (!profilePath.startsWith(profilesDir + sep)) {
    // Defense-in-depth after validateProfileName; an escape here is an internal
    // invariant breach, not user input — keep it a typed runtime error (#449).
    throw runtimeError(
      'profile path escaped the profiles directory',
      `${profilePath} is outside ${profilesDir}.`,
      'This is an internal guard; report it if you see it with a normal --profile value.'
    );
  }
  const content = loadFile(profilePath);
  return splitFrontmatter(content);
}

/**
 * Strip the individual pattern sections a profile marks `suppress` from loaded
 * pattern packs, so the rewrite/audit/score prompt never carries those rules.
 *
 * `pattern-overrides` in a profile's frontmatter is keyed by language then
 * numeric pattern id, with action `suppress` or `reduce`. v1 honors `suppress`
 * deterministically (the LLM cannot flag a rule it was never given); `reduce`
 * has no weight knob yet and is intentionally left in place. Packs without a
 * matching override are returned unchanged (same object identity).
 *
 * @param {Array<{body: string}>} packs Loaded pattern packs from loadPatterns.
 * @param {{frontmatter: object|null}|null} profile Loaded profile (loadProfile).
 * @param {string} lang Active language code.
 * @returns {Array<{body: string}>} Packs with suppressed sections removed.
 * @example
 * const packs = applyProfilePatternOverrides(loadPatterns(root, 'ko'), loadProfile(root, 'legal'), 'ko');
 */
export function applyProfilePatternOverrides(packs, profile, lang) {
  const overrides = profile?.frontmatter?.['pattern-overrides']?.[lang];
  if (!overrides || typeof overrides !== 'object') return packs;
  const suppressIds = Object.entries(overrides)
    .filter(([, action]) => action === 'suppress')
    .map(([id]) => String(id).trim())
    .filter(Boolean);
  if (suppressIds.length === 0) return packs;
  return packs.map((pack) => {
    const body = stripPatternSections(pack.body, suppressIds);
    return body === pack.body ? pack : { ...pack, body };
  });
}

// Remove each "### <id>. …" section — heading through the body up to the next
// "### " heading or end of pack — including the blank/`---` separator that
// trails a removed section, then normalize the seams left behind.
function stripPatternSections(body, ids) {
  const idSet = new Set(ids.map((id) => String(id)));
  const kept = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    const heading = line.match(/^###\s+(\d+)\./);
    if (heading) skipping = idSet.has(heading[1]);
    if (!skipping) kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+---\s*$/g, '')
    .trim();
}

/**
 * Load a Markdown file from the core/ directory.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} filename Core filename, such as scoring.md.
 * @returns {{frontmatter: object|null, body: string}} Parsed core document.
 * @throws {Error} When the file cannot be read or frontmatter is invalid.
 * @example
 * const scoring = loadCoreFile(getRepoRoot(), 'scoring.md');
 */
export function loadCoreFile(repoRoot, filename) {
  const path = resolve(repoRoot, 'core', filename);
  const content = loadFile(path);
  return splitFrontmatter(content);
}

/**
 * Maximum size (in bytes) of a single input file patina will read into memory.
 * Guards against accidental memory exhaustion on huge or binary inputs (#508 G1).
 */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * Map a low-level fs error to a typed inputError that names the file path.
 *
 * @param {string} path File path that failed to read.
 * @param {NodeJS.ErrnoException} err Underlying fs error.
 * @returns {import('./errors.js').PatinaCliError} Typed input error (exit code 2).
 */
function mapInputReadError(path, err) {
  const byCode = {
    ENOENT: 'file not found',
    EACCES: 'permission denied',
    EISDIR: 'path is a directory',
  };
  const why = (err && byCode[err.code]) || (err && err.message) || 'unknown read error';
  return inputError(
    `cannot read input file: ${path}`,
    `${path}: ${why}.`,
    'Check the path, permissions, and that it points to a readable text file.'
  );
}

/**
 * Read user input text from disk.
 *
 * @param {string} path Input file path.
 * @param {number} [maxBytes=MAX_INPUT_BYTES] Reject files larger than this many bytes.
 * @returns {string} UTF-8 input text.
 * @throws {import('./errors.js').PatinaCliError} Typed inputError (exit 2) when the file is missing, unreadable, a directory, or over the size cap.
 * @example
 * const text = loadInputText('draft.md');
 */
export function loadInputText(path, maxBytes = MAX_INPUT_BYTES) {
  let stats;
  try {
    stats = statSync(path);
  } catch (err) {
    throw mapInputReadError(path, err);
  }
  if (stats.size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw inputError(
      `input file too large: ${path}`,
      `The file is ${stats.size} bytes, over the ${maxBytes}-byte (~${mb} MB) limit.`,
      'Split the document into smaller files or trim it before running patina.'
    );
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw mapInputReadError(path, err);
  }
}
