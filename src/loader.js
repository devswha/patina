import { readFileSync, readdirSync } from 'node:fs';
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
 * Load language-specific pattern packs from patterns/{lang}-*.md.
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
  const files = readdirSync(patternsDir)
    .filter((f) => f.startsWith(`${lang}-`) && f.endsWith('.md'))
    .filter((f) => {
      const packName = f.slice(0, -3);
      return !skipPatterns.includes(packName);
    })
    .sort();

  const packs = [];
  for (const file of files) {
    const content = loadFile(resolve(patternsDir, file));
    const { frontmatter, body } = splitFrontmatter(content);
    packs.push({
      file,
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
 * Read user input text from disk.
 *
 * @param {string} path Input file path.
 * @returns {string} UTF-8 input text.
 * @throws {Error} When the file cannot be read.
 * @example
 * const text = loadInputText('draft.md');
 */
export function loadInputText(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Load up to three non-empty paragraphs from a voice sample file.
 *
 * @param {string} path Voice sample file path.
 * @returns {{path: string, paragraphs: string[], body: string, truncated: boolean}} Voice sample payload.
 * @throws {Error} When the file is unreadable or has no non-empty paragraphs.
 * @example
 * const sample = loadVoiceSample('voice.md');
 */
export function loadVoiceSample(path) {
  const content = loadFile(path);
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    throw inputError(
      'voice sample is empty',
      `${path} has no non-empty paragraphs.`,
      'Provide a --voice-sample file with at least one paragraph of the target writing style.'
    );
  }

  const selected = paragraphs.slice(0, 3);
  return {
    path,
    paragraphs: selected,
    body: selected.join('\n\n'),
    truncated: paragraphs.length > selected.length,
  };
}

// Tone → backbone profile mapping (v3.10, mirrors SKILL.md Phase 1).
// Returns the *primary* backbone profile name for a resolved tone.
// Multi-profile tones (e.g. professional → email + formal + legal + medical)
// expose only the primary here; secondary profiles are documented in SKILL.md
// and respected via legal/medical fidelity-floor enforcement at Phase 5b.
const TONE_BACKBONE = {
  casual: 'blog',                 // primary; social is a secondary backbone
  professional: 'email',          // primary; formal/legal/medical secondary
  academic: 'academic',           // primary; technical secondary
  narrative: 'narrative',
  marketing: 'marketing',
  instructional: 'instructional',
};

/**
 * Map a resolved named tone to its primary backbone profile.
 *
 * @param {string} tone Tone name.
 * @returns {string|null} Profile name, or null when no mapping exists.
 * @example
 * const profile = toneToBackboneProfile('casual'); // blog
 */
export function toneToBackboneProfile(tone) {
  return TONE_BACKBONE[tone] || null;
}
