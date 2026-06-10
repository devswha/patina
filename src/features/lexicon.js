// AI-lexicon loading per core/stylometry.md §16.
// Loads the markdown lexicon at lexicon/ai-{lang}.md. Custom lexicons under
// custom/lexicon/ take precedence when present.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLexiconBody } from './lexicon-core.js';

export {
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
  parseLexiconBody,
  phraseToRegex,
  computeDensity,
  classifyLexiconHot,
  resolveMinHotMatches,
} from './lexicon-core.js';

export function loadLexicon(lang, repoRoot) {
  const candidates = [
    resolve(repoRoot, 'custom', 'lexicon', `ai-${lang}.md`),
    resolve(repoRoot, 'lexicon', `ai-${lang}.md`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8');
      const body = raw.replace(/^---[\s\S]*?---\s*/, '');
      return { lang, path, ...parseLexiconBody(body) };
    }
  }
  return { lang, path: null, strict: [], phrases: [] };
}
