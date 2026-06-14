// Browser-pure AI-lexicon parsing and density helpers per core/stylometry.md §16.

export const DEFAULT_LEXICON_DENSITY_THRESHOLD = 3.0;
export const DEFAULT_LEXICON_MIN_HOT_MATCHES = {
  default: 1,
  ko: 2,
  zh: 2,
  ja: 2,
};

// Parses the two well-known sections out of a lexicon markdown file.
// Returns { strict: string[], phrases: string[] }.
export function parseLexiconBody(body, { skipUnderscore = false } = {}) {
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
      if (entry && (!skipUnderscore || !entry.startsWith('_'))) {
        (mode === 'strict' ? strict : phrases).push(entry);
      }
    }
  }
  return { strict, phrases };
}

// Phrases may include `~` as a wildcard standing in for up to 40 chars.
// Inter-word whitespace becomes `\s+` and the wildcard becomes `[\s\S]{0,40}`
// so a phrase hard-wrapped across a single newline inside a paragraph (which
// only blank lines split) still matches instead of silently undercounting.
export function phraseToRegex(phrase) {
  const escaped = phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  const withWildcard = escaped.replace(/~/g, '[\\s\\S]{0,40}');
  return new RegExp(withWildcard);
}

// Whole-word match for a multi-token non-CJK strict entry (contains a space,
// hyphen, or apostrophe). Anchored on Unicode letter/digit boundaries so it
// cannot hit inside a larger token, and whitespace tolerates soft line wraps.
function strictEntryRegex(lowerEntry) {
  const escaped = lowerEntry
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
}

// Per-lexicon regex caches keyed by the lexicon object identity. Phrase and
// strict-entry regexes depend only on the lexicon's entry text, never on the
// paragraph under test, so they are compiled once per (lexicon, entry) pair
// and reused across every computeDensity() call. WeakMaps keep the cache OFF
// the lexicon object — Object.keys(lexicon) and JSON.stringify(lexicon) are
// unchanged, and a lexicon's cache is garbage-collected with it. The compiled
// regexes are non-global and non-sticky (no /g or /y flags), so repeated
// .test() calls carry no lastIndex state and are safe to share. Entries are
// keyed by string, so any later-added phrase/entry is compiled lazily.
const phraseRegexCache = new WeakMap();
const strictEntryRegexCache = new WeakMap();

function memoizedRegex(cache, lexicon, key, build) {
  let byKey = cache.get(lexicon);
  if (!byKey) {
    byKey = new Map();
    cache.set(lexicon, byKey);
  }
  let regex = byKey.get(key);
  if (!regex) {
    regex = build(key);
    byKey.set(key, regex);
  }
  return regex;
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
  // mean `자리매김`, `可以说`, or `まとめると` may not survive as whole tokens, so
  // CJK keeps bare substring matching. A non-CJK strict entry that is not a
  // single whole token (it carries a space/hyphen/apostrophe, so tokenization
  // split or edge-stripped it) falls back to a whole-word boundary-anchored
  // match — never bare substring, which would hit inside a larger token and
  // break the documented whole-word contract (lexicon/ai-en.md).
  const cjkSubstring = ['ko', 'zh', 'ja'].includes(lexicon.lang);
  for (const entry of lexicon.strict) {
    const lowerEntry = entry.toLowerCase();
    if (tokenSet.has(lowerEntry)) {
      hits.push(entry);
      continue;
    }
    const isMultiToken = /[^\p{L}\p{N}]/u.test(lowerEntry);
    if (cjkSubstring) {
      if (lowerText.includes(lowerEntry)) hits.push(entry);
    } else if (isMultiToken && memoizedRegex(strictEntryRegexCache, lexicon, lowerEntry, strictEntryRegex).test(lowerText)) {
      hits.push(entry);
    }
  }
  for (const phrase of lexicon.phrases) {
    if (memoizedRegex(phraseRegexCache, lexicon, phrase, phraseToRegex).test(lowerText)) hits.push(phrase);
  }

  const density = tokens.length > 0 ? (hits.length / tokens.length) * 1000 : 0;
  return { matches: hits.length, density, hits };
}

/**
 * @param {{ matches?: number, density?: number }} [lexiconStats]
 * @param {{ lang?: string, densityThreshold?: number, minHotMatches?: (number|Record<string, number>) }} [options]
 */
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

export function resolveMinHotMatches(lang, minHotMatches) {
  if (typeof minHotMatches === 'number' && Number.isFinite(minHotMatches)) {
    return Math.max(1, minHotMatches);
  }
  const normalized = typeof lang === 'string' ? lang.toLowerCase() : 'default';
  const value = minHotMatches?.[normalized] ?? minHotMatches?.default;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 1;
}
