import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import yaml from 'js-yaml';
import { validateProfileName } from './security.js';

export function loadFile(path) {
  return readFileSync(path, 'utf8');
}

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

export function loadPatterns(repoRoot, lang, skipPatterns = []) {
  const patternsDir = resolve(repoRoot, 'patterns');
  const files = readdirSync(patternsDir)
    .filter((f) => f.startsWith(`${lang}-`) && f.endsWith('.md'))
    .filter((f) => {
      const packName = f.replace('.md', '');
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
    });
  }
  return packs;
}

export function loadProfile(repoRoot, profileName) {
  validateProfileName(profileName);
  const profilesDir = resolve(repoRoot, 'profiles');
  const profilePath = resolve(profilesDir, `${profileName}.md`);
  if (!profilePath.startsWith(profilesDir + sep)) {
    throw new Error(`Profile path escaped profiles/: ${profilePath}`);
  }
  const content = loadFile(profilePath);
  return splitFrontmatter(content);
}

export function loadCoreFile(repoRoot, filename) {
  const path = resolve(repoRoot, 'core', filename);
  const content = loadFile(path);
  return splitFrontmatter(content);
}

export function loadInputText(path) {
  return readFileSync(path, 'utf8');
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

export function toneToBackboneProfile(tone) {
  return TONE_BACKBONE[tone] || null;
}
