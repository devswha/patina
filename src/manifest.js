// Reproducibility manifest writer — captures enough metadata about a run
// to reproduce it later (config hash, prompt hash, selected patterns,
// provider/model, package version, results). Schema is versioned so
// callers and tooling can detect breaking shape changes.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const MANIFEST_SCHEMA_VERSION = '2';

export function hashSha256(input) {
  if (input == null) return null;
  const data = typeof input === 'string' ? input : JSON.stringify(input);
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

// Build the manifest body. Caller passes the already-resolved run state;
// this function is pure (no I/O) so it's easy to unit-test.
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

export function readManifest(path) {
  return normalizeManifest(JSON.parse(readFileSync(path, 'utf8')));
}

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

export function writeManifest(dir, manifest, outputs = []) {
  mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  for (const { name, content } of outputs) {
    writeFileSync(resolve(dir, name), content);
  }
  return manifestPath;
}
