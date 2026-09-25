import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { loadPatterns } from '../../src/loader.js';
import { analyzeText } from '../../src/features/index.js';
import { loadLexicon } from '../../src/features/lexicon.js';
import { scoreDeterministicSignals } from '../../src/scoring.js';

const clone = (value) => globalThis.structuredClone(value);
const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value
  : JSON.stringify(value, (_key, item) => item instanceof RegExp ? { expression: item.source, flags: item.flags } : item)).digest('hex');

// Snapshot the actual resolved inputs, including ambient CLI overrides. Public
// provenance contains hashes only.
export function createStudyInputs(repoRoot, { config: supplied, sourceVoice = false } = {}) {
  const config = clone(supplied || loadConfig(resolve(repoRoot, '.patina.default.yaml')));
  if (sourceVoice) { config.persona = null; config.register = null; }
  const patterns = {}; const lexicons = {};
  for (const language of ['en', 'ko', 'zh', 'ja']) {
    patterns[language] = loadPatterns(repoRoot, language);
    lexicons[language] = loadLexicon(language, repoRoot);
  }
  const fingerprint = { configuration: digest(config), sourceVoice,
    patterns: Object.fromEntries(Object.entries(patterns).map(([lang, value]) => [lang, digest(value)])),
    lexicons: Object.fromEntries(Object.entries(lexicons).map(([lang, value]) => [lang, digest(value)])) };
  return {
    fingerprint,
    config: () => clone(config),
    patterns: (language) => clone(patterns[language]),
    fixture(fixture) {
      const settings = clone(config); settings.language = fixture.language;
      if (fixture.documentType) settings.documentType = fixture.documentType;
      const packs = clone(patterns[fixture.language]);
      // Capture the exact analyzer result used by deterministic scoring. Only
      // its document-level hot bit leaves preparation; raw analysis stays out
      // of the public scorer row.
      let analysis = null;
      const deterministicScore = scoreDeterministicSignals({ text: fixture.text, config: settings, patterns: packs, repoRoot,
        analyzer: (text, options) => {
          analysis = analyzeText(text, { ...options, lexicon: options.lexicon ?? clone(lexicons[fixture.language]) });
          return analysis;
        } });
      return { config: settings, patterns: packs, deterministicScore,
        analyzerHot: typeof analysis?.hot === 'boolean' ? analysis.hot : null };
    },
  };
}
