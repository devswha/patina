// Reproducibility manifest writer — captures enough metadata about a run
// to reproduce it later (config hash, prompt hash, selected patterns,
// provider/model, package version, results). Schema is versioned so
// callers and tooling can detect breaking shape changes.

import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const MANIFEST_SCHEMA_VERSION = '1';

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
    configPath: configPath ?? null,
    configHash: hashSha256(config),
    patterns: (patterns ?? []).map((p) => p.frontmatter?.pack || p.file),
    results: results ?? [],
  };
}

// Add one input/output pair's hash + ref to the running results array.
// Mutates the input array for convenience.
export function appendResult(results, { inputPath, prompt, outputRef }) {
  results.push({
    input: inputPath,
    promptHash: hashSha256(prompt),
    output: outputRef,
  });
  return results;
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
