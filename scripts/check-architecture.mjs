#!/usr/bin/env node

// AST-backed import-boundary checker.
//
// This checker deliberately builds a graph from JavaScript syntax instead of
// grepping source text.  The graph includes static imports, re-exports, and
// literal dynamic imports.  A non-literal dynamic import is reported as an
// unresolved edge: silently treating it as safe would make the graph
// incomplete.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..');

/**
 * Source trees that participate in the product graph.  Research scripts are
 * intentionally not scanned: a runtime edge to one is still resolved and
 * rejected, while their own research-only dynamic loaders cannot obscure a
 * product edge.
 */
export const SOURCE_ROOTS = Object.freeze(['src', 'api', 'bin', 'playground']);

/**
 * Package manifests whose declared `bin` entries are published product
 * entrypoints.  This is intentionally an explicit list: scanning every
 * `scripts/` file would pull unsupported research tooling into the product
 * graph, while omitting a listed package bin would leave a runtime boundary
 * unchecked.
 */
export const PUBLISHED_BIN_PACKAGES = Object.freeze([
  Object.freeze({ manifest: 'package.json', packageName: 'patina-cli' }),
  Object.freeze({ manifest: 'packages/patina-humanizer/package.json', packageName: 'patina-humanizer' }),
]);

/**
 * These modules are deterministic, browser-safe or otherwise neutral shared
 * infrastructure.  They are documentation for the classifier, not a
 * whitelist of graph edges: every edge is still read from the AST.
 */
export const SAFE_SHARED_MODULES = Object.freeze([
  'src/edit-controls.js',
  'src/errors.js',
  'src/logger.js',
  'src/model-defaults.js',
  'src/web-rewrite-contract.js',
  'src/personas/gates.js',
  'scripts/prose-score.mjs',
]);

/**
 * Small, reviewed cross-boundary exceptions.  The checker does not infer
 * exceptions from comments or names; each entry names the exact source edge
 * and its reason.
 */
export const AUDITED_EXCEPTIONS = Object.freeze([
  {
    rule: 'features-no-model-network',
    from: 'src/features/lexicon.js',
    target: 'node:fs',
    reason: 'Reads bundled lexicon data; no network, subprocess, or model call.',
  },
  {
    rule: 'features-no-model-network',
    from: 'src/features/lexicon.js',
    target: 'node:path',
    reason: 'Resolves the bundled lexicon path deterministically.',
  },
  {
    rule: 'features-no-model-network',
    from: 'src/features/structural-model-loader.js',
    target: 'node:fs',
    reason: 'Reads an explicitly configured local structural classifier artifact.',
  },
  {
    rule: 'features-no-model-network',
    from: 'src/features/structural-model-loader.js',
    target: 'node:path',
    reason: 'Resolves a local structural classifier artifact.',
  },
  {
    rule: 'features-no-model-network',
    from: 'src/features/structural-model-loader.js',
    target: 'node:os',
    reason: 'Uses the local home directory only for an explicit model-path fallback.',
  },
  {
    rule: 'browser-no-server-secret',
    from: 'playground/chatgpt.js',
    target: 'src/web-rewrite-contract.js',
    reason: 'Browser consumes the browser-safe request/response contract constants.',
  },
  {
    rule: 'browser-no-server-secret',
    from: 'playground/preferences.js',
    target: 'src/web-rewrite-contract.js',
    reason: 'Browser preferences validate against the shared browser-safe contract.',
  },
  {
    rule: 'browser-no-server-secret',
    from: 'playground/rewrite-client.js',
    target: 'src/web-rewrite-contract.js',
    reason: 'Browser stream framing uses the shared browser-safe contract.',
  },
  {
    rule: 'browser-no-server-secret',
    from: 'playground/edit-review.js',
    target: 'src/edit-controls.js',
    reason: 'Browser edit review uses deterministic, browser-safe text edits.',
  },
  {
    rule: 'browser-no-server-secret',
    from: 'playground/protected-input.js',
    target: 'src/edit-controls.js',
    reason: 'Browser protected-span handling uses deterministic text utilities.',
  },
  {
    rule: 'runtime-no-research',
    from: 'src/inspection.js',
    target: 'scripts/prose-score.mjs',
    reason: 'Inspection reuses the deterministic prose scorer, not research code.',
  },
]);

const MODEL_NETWORK_BUILTINS = new Set([
  'node:child_process',
  'node:cluster',
  'node:dgram',
  'node:dns',
  'node:dns/promises',
  'node:http',
  'node:http2',
  'node:https',
  'node:net',
  'node:tls',
  'node:worker_threads',
]);

const MODEL_NETWORK_PACKAGES = new Set([
  '@anthropic-ai/sdk',
  '@openai/api',
  'anthropic',
  'axios',
  'node-fetch',
  'openai',
  'undici',
]);

const MODEL_NETWORK_MODULES = Object.freeze([
  'src/anthropic-native.js',
  'src/api.js',
  'src/prompt-builder.js',
  'src/scoring.js',
  'src/streaming-api.js',
  'src/verify.js',
  'src/web-rewrite.js',
  'src/web-rewrite-stream.js',
  'src/rewrite-handler.js',
  'src/backends/',
  'src/providers.js',
]);

const SERVER_SECRET_MODULES = Object.freeze([
  ...MODEL_NETWORK_MODULES,
  'src/auth.js',
  'src/config.js',
  'src/entitlement.js',
  'src/entitlement-polar.js',
  'src/funnel-analytics.js',
  'src/pack-handler.js',
  'src/polar-webhook.js',
  'src/quota-reservation.js',
  'src/rate-limit.js',
  'src/security.js',
  'src/web-config.js',
  'src/web-observability.js',
  'api/',
]);

const RESEARCH_MODULES = Object.freeze([
  'scripts/iterative-rewrite-baseline.mjs',
  'scripts/research/',
  'tests/quality/',
]);

const MODULE_EXTENSIONS = new Set(['.js', '.mjs']);
const LOCAL_SPECIFIER_RE = /^(?:\.{1,2}(?:\/|$)|\/)/;
const BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function relativePath(root, filePath) {
  return normalizePath(relative(root, filePath));
}

function isWithinRoot(root, filePath) {
  const rel = relative(root, filePath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('/'));
}

function pathMatches(relativePathValue, patterns) {
  return patterns.some((pattern) => pattern.endsWith('/')
    ? relativePathValue.startsWith(pattern)
    : relativePathValue === pattern);
}

function packageName(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

function isLocalSpecifier(specifier) {
  return LOCAL_SPECIFIER_RE.test(specifier);
}

function isBuiltinSpecifier(specifier) {
  return BUILTIN_MODULES.has(specifier);
}

function isModelNetworkBuiltin(specifier) {
  if (!isBuiltinSpecifier(specifier)) return false;
  const nodeSpecifier = specifier.startsWith('node:') ? specifier : `node:${specifier}`;
  return MODEL_NETWORK_BUILTINS.has(nodeSpecifier);
}

/**
 * Read the declared package binaries that are part of the published product
 * graph.  Missing manifests are ignored for source-only fixture roots, but a
 * present known manifest with malformed or incomplete `bin` metadata produces
 * a diagnostic that fails the architecture check.
 *
 * @param {string} root Repository or fixture root.
 * @returns {{entries: Array<{manifest: string, packageName: string, binName: string, path: string}>, diagnostics: Array<object>}}
 */
export function readPublishedEntrypoints(root = REPO_ROOT) {
  const absoluteRoot = resolve(root);
  const entries = [];
  const diagnostics = [];

  for (const knownPackage of PUBLISHED_BIN_PACKAGES) {
    const manifestPath = resolve(absoluteRoot, knownPackage.manifest);
    const manifestDirectory = dirname(manifestPath);
    if (!existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      diagnostics.push({
        type: 'published-bin-metadata-error',
        path: knownPackage.manifest,
        message: `Could not parse published package metadata: ${error.message}`,
      });
      continue;
    }

    if (manifest?.name !== knownPackage.packageName) {
      diagnostics.push({
        type: 'published-bin-metadata-error',
        path: knownPackage.manifest,
        message: `Expected package name ${knownPackage.packageName}, got ${manifest?.name ?? 'missing name'}.`,
      });
    }

    const rawBin = manifest?.bin;
    const binEntries = typeof rawBin === 'string'
      ? [[knownPackage.packageName, rawBin]]
      : rawBin && typeof rawBin === 'object' && !Array.isArray(rawBin)
        ? Object.entries(rawBin)
        : [];
    if (binEntries.length === 0) {
      diagnostics.push({
        type: 'published-bin-metadata-error',
        path: knownPackage.manifest,
        message: 'Known published package does not declare a bin entry.',
      });
      continue;
    }

    for (const [binName, rawPath] of binEntries) {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        diagnostics.push({
          type: 'published-bin-metadata-error',
          path: knownPackage.manifest,
          binName,
          message: 'Published bin path must be a non-empty string.',
        });
        continue;
      }
      const declaredPath = normalizePath(rawPath.trim());
      const resolved = resolve(manifestDirectory, declaredPath);
      if (!isWithinRoot(absoluteRoot, resolved) || declaredPath.startsWith('/')) {
        diagnostics.push({
          type: 'published-bin-metadata-error',
          path: knownPackage.manifest,
          binName,
          specifier: rawPath,
          message: 'Published bin path must remain inside the repository root.',
        });
        continue;
      }
      entries.push({
        manifest: knownPackage.manifest,
        packageName: knownPackage.packageName,
        binName,
        path: relativePath(absoluteRoot, resolved),
      });
    }
  }

  return { entries, diagnostics };
}

/**
 * Recursively collect JavaScript modules from the configured source roots.
 *
 * @param {string} root Repository or fixture root.
 * @param {string[]} [roots=SOURCE_ROOTS] Relative source roots to scan.
 * @returns {string[]} Absolute module paths in stable order.
 */
export function collectModuleFiles(root = REPO_ROOT, roots = SOURCE_ROOTS) {
  const absoluteRoot = resolve(root);
  const files = [];

  function visit(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
      const filePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && MODULE_EXTENSIONS.has(extname(entry.name))) {
        files.push(filePath);
      }
    }
  }

  for (const sourceRoot of roots) {
    const directory = resolve(absoluteRoot, sourceRoot);
    if (existsSync(directory) && statSync(directory).isDirectory()) visit(directory);
    else if (existsSync(directory) && statSync(directory).isFile() && MODULE_EXTENSIONS.has(extname(directory))) {
      files.push(directory);
    }
  }

  // Published package bins are explicit graph roots even when they live
  // outside SOURCE_ROOTS (for example scripts/precommit-score.mjs and the
  // patina-humanizer alias bin).  Only those declared paths are added; the
  // rest of scripts/ remains out of scope.
  for (const entry of readPublishedEntrypoints(absoluteRoot).entries) {
    const filePath = resolve(absoluteRoot, entry.path);
    if (existsSync(filePath) && statSync(filePath).isFile() && MODULE_EXTENSIONS.has(extname(filePath))) {
      files.push(filePath);
    }
  }

  return files.filter((filePath, index, all) => all.indexOf(filePath) === index);
}

/**
 * Parse imports and re-exports from one JavaScript module.
 *
 * @param {string} source JavaScript source.
 * @param {{filePath?: string}} [options]
 * @returns {{imports: Array<{specifier: string, kind: string, line: number, column: number}>, unresolvedDynamic: Array<{kind: string, line: number, column: number}>}}
 */
export function parseModuleImports(source, { filePath = '<module>' } = {}) {
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    loc: true,
    range: true,
  });
  const imports = [];
  const unresolvedDynamic = [];

  function addImport(node, kind, sourceNode) {
    const specifier = sourceNode?.type === 'Literal' && typeof sourceNode.value === 'string'
      ? sourceNode.value
      : null;
    if (specifier === null) {
      unresolvedDynamic.push({
        kind,
        line: node.loc?.start.line ?? 0,
        column: node.loc?.start.column ?? 0,
      });
      return;
    }
    imports.push({
      specifier,
      kind,
      line: node.loc?.start.line ?? 0,
      column: node.loc?.start.column ?? 0,
    });
  }

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration') addImport(node, 'import', node.source);
    else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      if (node.source) addImport(node, 're-export', node.source);
    } else if (node.type === 'ImportExpression') {
      addImport(node, 'dynamic-import', node.source);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  }

  try {
    visit(ast);
  } catch (error) {
    error.message = `${filePath}: ${error.message}`;
    throw error;
  }
  return { imports, unresolvedDynamic };
}

function resolveImportPath(root, fromPath, specifier) {
  if (!isLocalSpecifier(specifier)) return null;
  const base = specifier.startsWith('/')
    ? [resolve(root, `.${specifier}`), resolve(root, 'playground', `.${specifier}`)]
    : [resolve(dirname(fromPath), specifier)];
  const candidates = [];
  for (const candidate of base) {
    candidates.push(candidate);
    if (!extname(candidate)) {
      candidates.push(`${candidate}.js`, `${candidate}.mjs`, resolve(candidate, 'index.js'), resolve(candidate, 'index.mjs'));
    }
  }
  return candidates.find((candidate) => isWithinRoot(root, candidate) && existsSync(candidate) && statSync(candidate).isFile()) || null;
}

function isScannableModule(filePath) {
  return MODULE_EXTENSIONS.has(extname(filePath));
}

/**
 * Expand graph roots through local imports without traversing into research
 * modules.  A published entrypoint may use a small helper next to itself in
 * scripts/ or a package bin; those helpers must be parsed to expose a
 * transitive research edge.  Research files remain terminal targets and are
 * never bulk-scanned.
 *
 * @param {string} root Repository or fixture root.
 * @param {string[]} initialFiles Absolute initial graph roots.
 * @returns {string[]} Absolute graph files, including reachable non-research helpers.
 */
function expandReachableModules(root, initialFiles) {
  const absoluteRoot = resolve(root);
  const files = [];
  const seen = new Set();
  const queue = [...initialFiles];

  while (queue.length) {
    const filePath = resolve(queue.shift());
    if (seen.has(filePath) || !isWithinRoot(absoluteRoot, filePath) || !isScannableModule(filePath)) continue;
    seen.add(filePath);
    files.push(filePath);

    let source;
    try {
      source = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = parseModuleImports(source, { filePath: relativePath(absoluteRoot, filePath) });
    } catch {
      continue;
    }
    for (const imported of parsed.imports) {
      if (!isLocalSpecifier(imported.specifier)) continue;
      const target = resolveImportPath(absoluteRoot, filePath, imported.specifier);
      if (!target || pathMatches(relativePath(absoluteRoot, target), RESEARCH_MODULES)) continue;
      if (!seen.has(target)) queue.push(target);
    }
  }

  return files;
}

function auditedException(rule, from, target) {
  return AUDITED_EXCEPTIONS.some((entry) => entry.rule === rule && entry.from === from && entry.target === target);
}

/**
 * Build a syntax-derived local import graph.
 *
 * @param {{root?: string, files?: string[], roots?: string[]}} [options]
 * @returns {{root: string, modules: string[], edges: Array<object>, diagnostics: Array<object>, publishedEntrypoints: Array<object>}}
 */
export function buildImportGraph({ root = REPO_ROOT, files, roots = SOURCE_ROOTS } = {}) {
  const absoluteRoot = resolve(root);
  const published = readPublishedEntrypoints(absoluteRoot);
  const initialFiles = (files || collectModuleFiles(absoluteRoot, roots))
    .map((filePath) => resolve(absoluteRoot, filePath));
  const moduleFiles = expandReachableModules(absoluteRoot, initialFiles);
  const modules = moduleFiles
    .filter((filePath, index, all) => all.indexOf(filePath) === index)
    .map((filePath) => relativePath(absoluteRoot, filePath))
    .sort();
  const moduleSet = new Set(modules);
  const edges = [];
  const diagnostics = [...published.diagnostics];

  for (const entry of published.entries) {
    if (!isScannableModule(entry.path)) {
      diagnostics.push({
        type: 'published-entrypoint-omitted',
        path: entry.path,
        manifest: entry.manifest,
        binName: entry.binName,
        message: 'Published bin path is not a JavaScript module and cannot be checked by the AST graph.',
      });
    } else if (!moduleSet.has(entry.path)) {
      diagnostics.push({
        type: 'published-entrypoint-omitted',
        path: entry.path,
        manifest: entry.manifest,
        binName: entry.binName,
        message: 'Declared published bin was not included in the architecture graph.',
      });
    }
  }

  for (const relativeFrom of modules) {
    const fromPath = resolve(absoluteRoot, relativeFrom);
    let source;
    try {
      source = readFileSync(fromPath, 'utf8');
    } catch (error) {
      diagnostics.push({
        type: 'read-error',
        path: relativeFrom,
        message: error.message,
      });
      continue;
    }

    let parsed;
    try {
      parsed = parseModuleImports(source, { filePath: relativeFrom });
    } catch (error) {
      diagnostics.push({
        type: 'parse-error',
        path: relativeFrom,
        message: error.message,
      });
      continue;
    }

    for (const dynamic of parsed.unresolvedDynamic) {
      diagnostics.push({
        type: 'unresolved-dynamic-import',
        path: relativeFrom,
        kind: dynamic.kind,
        line: dynamic.line,
        column: dynamic.column,
        message: 'Dynamic import path is not a string literal; the boundary graph cannot resolve it.',
      });
    }

    for (const imported of parsed.imports) {
      const resolvedTarget = resolveImportPath(absoluteRoot, fromPath, imported.specifier);
      const target = resolvedTarget ? relativePath(absoluteRoot, resolvedTarget) : null;
      const local = isLocalSpecifier(imported.specifier);
      if (local && !resolvedTarget) {
        diagnostics.push({
          type: 'unresolved-import',
          path: relativeFrom,
          specifier: imported.specifier,
          kind: imported.kind,
          line: imported.line,
          column: imported.column,
          message: 'Relative import does not resolve to a file under the repository root.',
        });
      }
      edges.push({
        from: relativeFrom,
        to: target,
        specifier: imported.specifier,
        kind: imported.kind,
        line: imported.line,
        column: imported.column,
        local,
        scanned: target ? moduleSet.has(target) : false,
      });
    }
  }

  return {
    root: absoluteRoot,
    modules,
    edges,
    diagnostics,
    publishedEntrypoints: published.entries,
  };
}

/**
 * Classify a module or external specifier for reporting and documentation.
 *
 * @param {string|null} value Repository-relative module path or specifier.
 * @returns {string} Classification label.
 */
export function classifyModule(value) {
  if (!value) return 'unresolved';
  if (isModelNetworkBuiltin(value) || MODEL_NETWORK_PACKAGES.has(packageName(value))) return 'model-network';
  if (pathMatches(value, RESEARCH_MODULES)) return 'research';
  if (pathMatches(value, MODEL_NETWORK_MODULES)) return 'model-network';
  if (pathMatches(value, SERVER_SECRET_MODULES)) return 'server-secret';
  if (value.startsWith('src/features/')) return 'deterministic-feature';
  if (SAFE_SHARED_MODULES.includes(value)) return 'safe-shared';
  if (value.startsWith('playground/')) return 'browser';
  if (value.startsWith('src/') || value.startsWith('api/') || value.startsWith('bin/')) return 'runtime';
  return 'external';
}

function edgeTarget(edge) {
  return edge.to || edge.specifier;
}

function isModelNetworkTarget(edge) {
  if (!edge.to) return isModelNetworkBuiltin(edge.specifier)
    || MODEL_NETWORK_PACKAGES.has(packageName(edge.specifier));
  return pathMatches(edge.to, MODEL_NETWORK_MODULES);
}

function isServerSecretTarget(edge) {
  if (!edge.to) return isBuiltinSpecifier(edge.specifier);
  return pathMatches(edge.to, SERVER_SECRET_MODULES);
}

function isResearchTarget(edge) {
  return Boolean(edge.to && pathMatches(edge.to, RESEARCH_MODULES));
}

function startsFor(graph, prefix) {
  return graph.modules.filter((modulePath) => modulePath.startsWith(prefix));
}

function runtimeStarts(graph) {
  return [...new Set([
    ...startsFor(graph, 'src/'),
    ...startsFor(graph, 'api/'),
    ...startsFor(graph, 'bin/'),
    ...graph.publishedEntrypoints.map((entry) => entry.path),
  ])];
}

function outgoing(graph, from) {
  return graph.edges.filter((edge) => edge.from === from);
}

function boundaryViolations(graph, { rule, starts, targetPredicate }) {
  const violations = [];
  for (const start of starts) {
    const queue = [{ modulePath: start, path: [start], edgeKinds: [], seen: new Set([start]) }];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of outgoing(graph, current.modulePath)) {
        const target = edgeTarget(edge);
        if (targetPredicate(edge) && !auditedException(rule, edge.from, target)) {
          violations.push({
            rule,
            origin: start,
            target,
            path: [...current.path, target],
            edgeKinds: [...current.edgeKinds, edge.kind],
            from: edge.from,
            specifier: edge.specifier,
            line: edge.line,
            column: edge.column,
            classification: classifyModule(target),
          });
          continue;
        }
        if (!edge.to || current.seen.has(edge.to)) continue;
        const seen = new Set(current.seen);
        seen.add(edge.to);
        queue.push({
          modulePath: edge.to,
          path: [...current.path, edge.to],
          edgeKinds: [...current.edgeKinds, edge.kind],
          seen,
        });
      }
    }
  }
  return violations;
}

/**
 * Check all supported architecture boundaries.
 *
 * @param {{root?: string, files?: string[], roots?: string[]}} [options]
 * @returns {{schemaVersion: string, root: string, modules: number, edges: number, diagnostics: Array<object>, violations: Array<object>, auditedExceptions: Array<object>}}
 */
export function checkArchitecture(options = {}) {
  const graph = buildImportGraph(options);
  const violations = [
    ...boundaryViolations(graph, {
      rule: 'features-no-model-network',
      starts: startsFor(graph, 'src/features/'),
      targetPredicate: isModelNetworkTarget,
    }),
    ...boundaryViolations(graph, {
      rule: 'browser-no-server-secret',
      starts: startsFor(graph, 'playground/'),
      targetPredicate: isServerSecretTarget,
    }),
    ...boundaryViolations(graph, {
      rule: 'runtime-no-research',
      starts: runtimeStarts(graph),
      targetPredicate: isResearchTarget,
    }),
  ];

  for (const diagnostic of graph.diagnostics) {
    violations.push({
      ...diagnostic,
      rule: diagnostic.type === 'unresolved-dynamic-import' ? 'unresolved-dynamic-import' : 'graph-incomplete',
      origin: diagnostic.path,
      target: diagnostic.specifier || null,
      path: [diagnostic.path, ...(diagnostic.specifier ? [diagnostic.specifier] : [])],
      classification: 'unresolved',
    });
  }

  return {
    schemaVersion: 'architecture-boundaries.v1',
    root: graph.root,
    modules: graph.modules.length,
    edges: graph.edges.length,
    diagnostics: graph.diagnostics,
    violations,
    auditedExceptions: AUDITED_EXCEPTIONS,
  };
}

function parseCliArgs(args) {
  let root = REPO_ROOT;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--root') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error('--root requires a directory');
      root = resolve(args[++index]);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, root, json };
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { root, json, help: false };
}

function main(args = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    console.error(`Architecture boundary checker: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    console.log('Usage: node scripts/check-architecture.mjs [--root DIR] [--json]');
    return;
  }

  const result = checkArchitecture({ root: parsed.root });
  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.violations.length === 0) {
    console.log(`Architecture boundaries OK — ${result.modules} module(s), ${result.edges} edge(s), 0 violation(s).`);
  } else {
    console.error(`Architecture boundaries FAILED — ${result.violations.length} violation(s) across ${result.modules} module(s).`);
    for (const violation of result.violations) {
      console.error(`  - [${violation.rule}] ${violation.path.join(' -> ')}`);
      if (violation.message) console.error(`    ${violation.message}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
