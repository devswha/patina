import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import yaml from 'js-yaml';
import { validateDocumentTypeName } from './security.js';
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
 * Load a named document type. A custom policy at
 * custom/document-types/{name}.md shadows the built-in document-types/{name}.md.
 *
 * The Markdown body is explanatory documentation only. Runtime policy comes
 * from validated structured frontmatter.
 *
 * @param {string} repoRoot Repository root path.
 * @param {string} documentTypeName Document-type file stem.
 * @returns {{frontmatter: object, body: string}} Parsed and validated policy document.
 * @throws {Error} When the name is invalid or the file cannot be read.
 * @example
 * const documentType = loadDocumentType(getRepoRoot(), 'technical');
 */
export function loadDocumentType(repoRoot, documentTypeName) {
  validateDocumentTypeName(documentTypeName);
  const builtInDir = resolve(repoRoot, 'document-types');
  const customDir = resolve(repoRoot, 'custom', 'document-types');
  const builtInPath = resolve(builtInDir, `${documentTypeName}.md`);
  const customPath = resolve(customDir, `${documentTypeName}.md`);
  for (const [dir, path] of [[builtInDir, builtInPath], [customDir, customPath]]) {
    if (!path.startsWith(dir + sep)) {
      throw runtimeError(
        'document type path escaped its policy directory',
        `${path} is outside ${dir}.`,
        'This is an internal guard; report it if you see it with a normal --document-type value.'
      );
    }
  }
  const path = existsSync(customPath) ? customPath : builtInPath;
  const documentType = splitFrontmatter(loadFile(path));
  validateDocumentTypePolicy(documentType, documentTypeName);
  return documentType;
}

function validateDocumentTypePolicy(documentType, expectedName) {
  const policy = documentType?.frontmatter;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw invalidDocumentTypePolicy(expectedName, 'frontmatter must be a YAML mapping');
  }
  if (policy['document-type'] !== expectedName) {
    throw invalidDocumentTypePolicy(
      expectedName,
      `document-type must equal the filename stem "${expectedName}"`
    );
  }
  for (const key of ['persona', 'register', 'profile', 'tone', 'formality', 'verification', 'mps', 'fidelity']) {
    if (Object.prototype.hasOwnProperty.call(policy, key)) {
      throw invalidDocumentTypePolicy(
        expectedName,
        `${key} belongs to another rewrite axis or the global verification layer`
      );
    }
  }
  for (const field of ['name', 'version', 'scope', 'purpose']) {
    if (typeof policy[field] !== 'string' || policy[field].trim() === '') {
      throw invalidDocumentTypePolicy(expectedName, `${field} must be a non-empty string`);
    }
  }
  for (const field of ['audience', 'structure', 'style', 'avoid']) {
    const values = policy[field];
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'string' || value.trim() === '')) {
      throw invalidDocumentTypePolicy(expectedName, `${field} must be a non-empty list of strings`);
    }
  }
  const overrides = policy['pattern-overrides'];
  if (overrides === undefined) return;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw invalidDocumentTypePolicy(expectedName, 'pattern-overrides must be a language-scoped mapping');
  }
  const languages = new Set(['ko', 'en', 'zh', 'ja']);
  const actions = new Set(['suppress', 'reduce', 'amplify']);
  for (const [lang, entries] of Object.entries(overrides)) {
    if (!languages.has(lang) || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw invalidDocumentTypePolicy(
        expectedName,
        'pattern-overrides keys must be ko, en, zh, or ja mappings'
      );
    }
    for (const action of Object.values(entries)) {
      if (!actions.has(action)) {
        throw invalidDocumentTypePolicy(
          expectedName,
          'pattern override actions must be suppress, reduce, or amplify'
        );
      }
    }
  }
}

function invalidDocumentTypePolicy(name, detail) {
  return inputError(
    `invalid document type policy "${name}"`,
    `${detail}.`,
    'Define document-type, name, version, scope, purpose, audience, structure, style, avoid, and language-scoped pattern-overrides.'
  );
}

/**
 * Apply a document type's deterministic pattern policy.
 *
 * `suppress` removes the pattern definition before any prompt is built.
 * `reduce` and `amplify` remain in the structured policy passed to the model;
 * the deterministic layer does not invent unsupported numeric weights.
 *
 * @param {Array<{body: string}>} packs Loaded pattern packs.
 * @param {{frontmatter: object|null}|null} documentType Loaded document type.
 * @param {string} lang Active language code.
 * @returns {Array<{body: string}>} Packs with suppressed sections removed.
 */
export function applyDocumentTypePatternPolicy(packs, documentType, lang) {
  const overrides = documentType?.frontmatter?.['pattern-overrides']?.[lang];
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
