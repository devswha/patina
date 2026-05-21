// AI-lexicon loading and density per core/stylometry.md §16.
// Loads the markdown lexicon at lexicon/ai-{lang}.md and computes
// hits-per-1000-tokens density. Custom lexicons under custom/lexicon/
// take precedence when present.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_LEXICON_DENSITY_THRESHOLD = 2.0;
export const DEFAULT_LEXICON_MIN_HOT_MATCHES = {
  default: 1,
  ko: 2,
  zh: 2,
  ja: 2,
};

// Parses the two well-known sections out of a lexicon markdown file.
// Returns { strict: string[], phrases: string[] }.
function parseLexiconBody(body) {
  const strict = [];
  const phrases = [];
  let mode = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      const heading = line.toLowerCase();
      if (heading.includes('strict matches')) mode = 'strict';
      else if (heading.includes('multi-word phrases')) mode = 'phrases';
      else mode = null;
      continue;
    }
    if (mode && line.startsWith('- ')) {
      // Normalize to NFC so visually identical entries don't fail to match
      // tokens that arrive in a different normalization form.
      const entry = line.slice(2).trim().normalize('NFC');
      if (entry) (mode === 'strict' ? strict : phrases).push(entry);
    }
  }
  return { strict, phrases };
}

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

// Phrases may include `~` as a wildcard standing in for up to 40 chars.
function phraseToRegex(phrase) {
  const escaped = phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withWildcard = escaped.replace(/~/g, '.{0,40}');
  return new RegExp(withWildcard);
}

// Counts paragraph-level lexicon hits. Strict entries match whole-word
// (Unicode-aware boundaries via \p{L}\p{N}); phrases match as substrings
// with `~` wildcard support. Each entry counts at most once per paragraph.
export function computeDensity(paragraphText, tokens, lexicon) {
  const lowerText = paragraphText.toLowerCase();
  const hits = [];
  const tokenSet = new Set(tokens.map((t) => t.toLowerCase()));

  // §16: English strict entries match whole-word; CJK strict entries are
  // approximated by substring. Korean inflection and zh/ja character fallback
  // mean `자리매김`, `可以说`, or `まとめると` may not survive as whole tokens.
  // Punctuated entries always need substring fallback because tokenization
  // strips edge punct.
  const cjkSubstring = ['ko', 'zh', 'ja'].includes(lexicon.lang);
  for (const entry of lexicon.strict) {
    const lowerEntry = entry.toLowerCase();
    if (tokenSet.has(lowerEntry)) {
      hits.push(entry);
      continue;
    }
    const hasInternalPunct = /[^\p{L}\p{N}]/u.test(lowerEntry);
    if ((cjkSubstring || hasInternalPunct) && lowerText.includes(lowerEntry)) {
      hits.push(entry);
    }
  }
  for (const phrase of lexicon.phrases) {
    if (phraseToRegex(phrase).test(lowerText)) hits.push(phrase);
  }

  const density = tokens.length > 0 ? (hits.length / tokens.length) * 1000 : 0;
  return { matches: hits.length, density, hits };
}

export function classifyLexiconHot(
  lexiconStats,
  {
    lang,
    densityThreshold = DEFAULT_LEXICON_DENSITY_THRESHOLD,
    minHotMatches = DEFAULT_LEXICON_MIN_HOT_MATCHES,
  } = {}
) {
  const matches = lexiconStats?.matches ?? 0;
  const density = lexiconStats?.density ?? 0;
  const minMatches = resolveMinHotMatches(lang, minHotMatches);
  return matches >= minMatches && density > densityThreshold;
}

function resolveMinHotMatches(lang, minHotMatches) {
  if (typeof minHotMatches === 'number' && Number.isFinite(minHotMatches)) {
    return Math.max(1, minHotMatches);
  }
  const normalized = typeof lang === 'string' ? lang.toLowerCase() : 'default';
  const value = minHotMatches?.[normalized] ?? minHotMatches?.default;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 1;
}
