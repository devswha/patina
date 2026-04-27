import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

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
  const profilePath = resolve(repoRoot, 'profiles', `${profileName}.md`);
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
