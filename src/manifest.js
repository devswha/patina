// Reproducibility manifest writer — captures enough metadata about a run
// to reproduce it later (config hash, prompt hash, selected patterns,
// provider/model, package version, results). Schema is versioned so
// callers and tooling can detect breaking shape changes.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Current reproducibility manifest schema version.
 *
 * @type {string}
 * @example
 * const version = MANIFEST_SCHEMA_VERSION; // '2'
 */
export const MANIFEST_SCHEMA_VERSION = '2';

/**
 * Hash a string or JSON-serializable value with SHA-256.
 *
 * @param {unknown} input Value to hash; nullish values return null.
 * @returns {string|null} sha256-prefixed digest or null.
 * @throws {TypeError} When a non-string value cannot be JSON-serialized.
 * @example
 * const hash = hashSha256('prompt');
 */
export function hashSha256(input) {
  if (input == null) return null;
  const data = typeof input === 'string' ? input : JSON.stringify(input);
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

// Build the manifest body. Caller passes the already-resolved run state;
// this function is pure (no I/O) so it's easy to unit-test.
/**
 * Build a pure reproducibility manifest object for one patina run.
 *
 * @param {object} options Resolved run metadata.
 * @param {string} options.patinaVersion Package version.
 * @param {string} options.mode Output mode.
 * @param {string} options.lang Language code.
 * @param {string} options.profile Profile name.
 * @param {string} [options.provider] Provider preset name.
 * @param {string} [options.backend] Backend name.
 * @param {string} [options.model] Model id.
 * @param {string} [options.configPath] Config file path.
 * @param {object} [options.config] Effective config.
 * @param {object[]} [options.patterns] Loaded pattern packs.
 * @param {object[]} [options.results] Manifest result entries.
 * @param {string} options.startedAt ISO start timestamp.
 * @param {string} [options.finishedAt] ISO finish timestamp.
 * @param {number|null} [options.temperature] Sampling temperature.
 * @param {number|string|null} [options.seed] Model seed.
 * @returns {object} Manifest body ready to serialize.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const manifest = buildManifest({ patinaVersion: '3.11.0', mode: 'rewrite', lang: 'en', profile: 'default', startedAt: new Date().toISOString() });
 */
export function buildManifest({
  patinaVersion,
  mode,
  lang,
  profile,
  provider,
  backend,
  model,
  configPath,
  config,
  patterns,
  results,
  startedAt,
  finishedAt = new Date().toISOString(),
  temperature = null,
  seed = null,
}) {
  return {
    manifestVersion: MANIFEST_SCHEMA_VERSION,
    patina: patinaVersion,
    startedAt,
    finishedAt,
    mode,
    lang,
    profile,
    provider: provider ?? null,
    backend: backend ?? null,
    model: model ?? null,
    temperature,
    seed,
    configPath: configPath ?? null,
    configHash: hashSha256(config),
    patterns: (patterns ?? []).map((p) => p.frontmatter?.pack || p.file),
    results: results ?? [],
  };
}

// Add one input/output pair's hash + ref to the running results array.
// Mutates the input array for convenience.
/**
 * Append one input/output result entry to an existing manifest results array.
 *
 * @param {object[]} results Mutable manifest results array.
 * @param {object} entry Result metadata.
 * @param {string} entry.inputPath Original input path.
 * @param {string} entry.prompt Prompt text.
 * @param {string} entry.outputRef Output file or stream reference.
 * @param {string} entry.response Model response text.
 * @param {number|null} [entry.tokensIn] Input token count.
 * @param {number|null} [entry.tokensOut] Output token count.
 * @param {number|null} [entry.temperature] Sampling temperature.
 * @param {number|string|null} [entry.seed] Model seed.
 * @param {number|null} [entry.cost] Estimated cost.
 * @param {object} [entry.scores] Score payload.
 * @param {object[]} [entry.iterationLog] Ouroboros iteration log.
 * @param {object[]} [entry.calls] Provider call metadata.
 * @returns {object[]} The same results array after mutation.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * appendResult(results, { inputPath: 'in.md', prompt: 'p', outputRef: 'out.md', response: 'r' });
 */
export function appendResult(
  results,
  {
    inputPath,
    prompt,
    outputRef,
    response,
    tokensIn = null,
    tokensOut = null,
    temperature = null,
    seed = null,
    cost = null,
    scores,
    iterationLog,
    calls,
  }
) {
  const entry = {
    input: inputPath,
    promptHash: hashSha256(prompt),
    responseHash: hashSha256(response),
    output: outputRef,
    tokensIn,
    tokensOut,
    temperature,
    seed,
    cost,
  };
  if (scores) entry.scores = scores;
  if (iterationLog) entry.iterationLog = iterationLog;
  if (calls) entry.calls = calls;
  results.push(entry);
  return results;
}

/**
 * Read and normalize a manifest JSON file.
 *
 * @param {string} path Manifest JSON path.
 * @returns {object} Normalized manifest.
 * @throws {Error} When JSON is invalid, unreadable, or schema is unsupported.
 * @example
 * const manifest = readManifest('runs/latest/manifest.json');
 */
export function readManifest(path) {
  return normalizeManifest(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Normalize supported manifest schema versions to stable result shapes.
 *
 * @param {object} manifest Manifest object to normalize.
 * @returns {object} Manifest with normalized results.
 * @throws {Error} When manifest is not an object or schema version is unsupported.
 * @example
 * const normalized = normalizeManifest({ manifestVersion: '1', results: [] });
 */
export function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be a JSON object');
  }

  const version = String(manifest.manifestVersion ?? '1');
  if (version === MANIFEST_SCHEMA_VERSION) {
    return {
      ...manifest,
      results: normalizeV2Results(manifest.results),
    };
  }

  if (version === '1') {
    return {
      ...manifest,
      manifestVersion: '1',
      temperature: manifest.temperature ?? null,
      seed: manifest.seed ?? null,
      results: normalizeV1Results(manifest.results),
    };
  }

  throw new Error(`Unsupported manifest schema version: ${version}`);
}

function normalizeV1Results(results) {
  return (results ?? []).map((entry) => ({
    input: entry.input ?? null,
    promptHash: entry.promptHash ?? null,
    responseHash: entry.responseHash ?? null,
    output: entry.output ?? null,
    tokensIn: entry.tokensIn ?? null,
    tokensOut: entry.tokensOut ?? null,
    temperature: entry.temperature ?? null,
    seed: entry.seed ?? null,
    cost: entry.cost ?? null,
    ...(entry.scores ? { scores: entry.scores } : {}),
    ...(entry.iterationLog ? { iterationLog: entry.iterationLog } : {}),
    ...(entry.calls ? { calls: entry.calls } : {}),
  }));
}

function normalizeV2Results(results) {
  return (results ?? []).map((entry) => ({
    ...entry,
    responseHash: entry.responseHash ?? null,
    tokensIn: entry.tokensIn ?? null,
    tokensOut: entry.tokensOut ?? null,
    temperature: entry.temperature ?? null,
    seed: entry.seed ?? null,
    cost: entry.cost ?? null,
    calls: entry.calls ?? [],
  }));
}

/**
 * Write manifest.json and optional output files into a run directory.
 *
 * @param {string} dir Destination directory.
 * @param {object} manifest Manifest object to serialize.
 * @param {Array<{name: string, content: string}>} [outputs=[]] Extra files to write beside manifest.json.
 * @returns {string} Path to the written manifest.json.
 * @throws {Error} When the directory or files cannot be written.
 * @example
 * const path = writeManifest('runs/latest', manifest, [{ name: 'output.md', content: 'Done' }]);
 */
export function writeManifest(dir, manifest, outputs = []) {
  mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  for (const { name, content } of outputs) {
    writeFileSync(resolve(dir, name), content);
  }
  return manifestPath;
}
