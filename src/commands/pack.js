// `patina pack` — install licensed pro packs into custom/.
//
// The client half of src/pack-handler.js. A pro license (Lemon Squeezy key,
// the same one the hosted rewrite API takes) is presented as a Bearer token;
// the server resolves it and streams pack content that is not part of the
// public repo or the npm tarball. Installed packs land in custom/, which every
// loader already prefers over the built-in directories and which is gitignored.
//
// Subcommands:
//   patina pack list                      available + installed state
//   patina pack install <id...> | --all   download, verify sha256, write
//
// License resolution order: --license <key> > PATINA_LICENSE_KEY env >
// `license-key:` in .patina.yaml. Endpoint: --url > PATINA_PACKS_URL env >
// `packs-url:` in config > the hosted default.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { getRepoRoot, loadConfig } from '../config.js';
import { inputError, runtimeError } from '../errors.js';


export const DEFAULT_PACKS_URL = 'https://patina.vibetip.help/api/packs';
const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const KNOWN_KINDS = new Set(['pattern', 'persona', 'lexicon']);

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function takeValue(args, i, flag) {
  const v = args[i + 1];
  if (v === undefined || v.startsWith('-')) {
    throw inputError(`${flag} requires a value`, `Missing value after ${flag}.`, `Pass ${flag} <value>.`);
  }
  return [v, i + 1];
}

function parsePackArgs(args) {
  const parsed = { sub: null, ids: [], all: false, json: false, force: false, url: null, license: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!parsed.sub && !arg.startsWith('-')) { parsed.sub = arg; continue; }
    if (arg === '--all') parsed.all = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--url') { const [v, ni] = takeValue(args, i, arg); parsed.url = v; i = ni; }
    else if (arg === '--license') { const [v, ni] = takeValue(args, i, arg); parsed.license = v; i = ni; }
    else if (arg.startsWith('-')) {
      throw inputError(`unknown pack option ${arg}`, 'Supported: --all, --json, --force, --url <url>, --license <key>.', 'Run `patina pack` for usage.');
    } else {
      parsed.ids.push(arg);
    }
  }
  return parsed;
}

function resolveSettings(parsed) {
  let config = {};
  try {
    config = loadConfig() || {};
  } catch { /* pack commands must work without a valid config file */ }
  const url = parsed.url || process.env.PATINA_PACKS_URL || config['packs-url'] || DEFAULT_PACKS_URL;
  const license = parsed.license || process.env.PATINA_LICENSE_KEY || config['license-key'] || null;
  return { url, license };
}

async function apiGet(url, license, { fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { authorization: `Bearer ${license}` } });
  } catch (err) {
    throw runtimeError('pack server unreachable', String(err?.message ?? err), 'Check your network or --url.');
  }
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON error body */ }
  if (response.ok) return body;

  const reason = body?.reason || `HTTP ${response.status}`;
  if (response.status === 401) {
    throw inputError('a pro license is required', 'The pack server did not receive a license.', 'Set PATINA_LICENSE_KEY (or `license-key:` in .patina.yaml) to your patina Pro license key.');
  }
  if (response.status === 403) {
    throw inputError('license rejected', `The pack server rejected this license (${reason}).`, 'Check the key, or its status in your Lemon Squeezy receipt email.');
  }
  if (response.status === 429) {
    throw runtimeError('pack download limit reached', `Daily cap hit (${reason}).`, 'Try again tomorrow (UTC) or raise the cap server-side.');
  }
  throw runtimeError('pack server unavailable', `The pack server answered ${response.status} (${reason}).`, 'Try again in a few minutes.');
}

/**
 * Destination for one pack. Filenames come from the server-validated pack id
 * (never a client- or manifest-supplied path), then are containment-checked.
 */
function destinationFor(pack, repoRoot) {
  if (!PACK_ID_RE.test(pack.id)) throw runtimeError('invalid pack id from server', `id: ${JSON.stringify(pack.id)}`, 'Report this; the manifest is malformed.');
  if (!KNOWN_KINDS.has(pack.kind)) throw runtimeError(`unknown pack kind '${pack.kind}'`, 'This CLI version does not know how to install it.', 'Update patina and retry.');

  let dir;
  let file;
  if (pack.kind === 'pattern') {
    // loadPatterns discovers `{lang}-*.md`; pack ids are lang-prefixed by
    // convention so the id doubles as the filename.
    if (!pack.id.startsWith(`${pack.lang}-`)) {
      throw runtimeError('pack id/lang mismatch', `Pattern pack id '${pack.id}' must start with '${pack.lang}-' to be discoverable.`, 'Report this; the manifest is malformed.');
    }
    dir = resolve(repoRoot, 'custom', 'patterns');
    file = `${pack.id}.md`;
  } else if (pack.kind === 'persona') {
    dir = resolve(repoRoot, 'custom', 'personas', pack.lang);
    file = `${pack.id}.md`;
  } else {
    // The lexicon loader reads exactly custom/lexicon/ai-{lang}.md.
    dir = resolve(repoRoot, 'custom', 'lexicon');
    file = `ai-${pack.lang}.md`;
  }
  const path = resolve(dir, file);
  if (!path.startsWith(resolve(repoRoot, 'custom') + sep)) {
    throw runtimeError('pack destination escaped custom/', `id: ${pack.id}`, 'Report this; refusing to write.');
  }
  return { dir, path, file };
}

async function listPacks({ url, license, json, out, repoRoot, fetchImpl }) {
  const manifest = await apiGet(url, license, { fetchImpl });
  const packs = Array.isArray(manifest?.packs) ? manifest.packs : [];
  const rows = packs.map((p) => {
    let installed = false;
    try { installed = existsSync(destinationFor(p, repoRoot).path); } catch { /* unknown kind on old CLI */ }
    return { ...p, installed };
  });
  if (json) {
    out(JSON.stringify({ packs: rows }, null, 2));
    return;
  }
  if (!rows.length) {
    out('No packs published yet.');
    return;
  }
  out('id                              kind      lang  version   installed');
  for (const p of rows) {
    out(`${p.id.padEnd(32)}${String(p.kind).padEnd(10)}${String(p.lang).padEnd(6)}${String(p.version).padEnd(10)}${p.installed ? 'yes' : '-'}`);
  }
}

async function installPacks({ ids, all, force, url, license, json, out, repoRoot, fetchImpl }) {
  const manifest = await apiGet(url, license, { fetchImpl });
  const available = Array.isArray(manifest?.packs) ? manifest.packs : [];
  const wanted = all ? available.map((p) => p.id) : ids;
  if (!wanted.length) {
    throw inputError('nothing to install', 'Pass one or more pack ids, or --all.', 'Run `patina pack list` to see what is available.');
  }

  const results = [];
  for (const id of wanted) {
    if (!available.some((p) => p.id === id)) {
      throw inputError(`unknown pack '${id}'`, 'It is not in the server manifest.', 'Run `patina pack list` for available ids.');
    }
    const pack = await apiGet(`${url}?id=${encodeURIComponent(id)}`, license, { fetchImpl });
    if (typeof pack?.content !== 'string' || !pack.content.trim()) {
      throw runtimeError(`pack '${id}' arrived empty`, 'The server returned no content.', 'Try again; report if it persists.');
    }
    // End-to-end integrity: what we write is what the manifest promised.
    const digest = sha256(pack.content);
    if (digest !== pack.sha256) {
      throw runtimeError(`pack '${id}' failed integrity check`, `sha256 ${digest} != manifest ${pack.sha256}.`, 'Retry; a mid-publish read can cause this once.');
    }
    const dest = destinationFor(pack, repoRoot);
    if (existsSync(dest.path) && !force && pack.kind === 'lexicon') {
      // ai-{lang}.md is a fixed filename the user may already maintain by hand;
      // never clobber it silently.
      throw inputError(`custom lexicon already exists (${dest.file})`, 'Installing this pack would overwrite your custom lexicon.', 'Re-run with --force to overwrite, or merge manually.');
    }
    mkdirSync(dest.dir, { recursive: true });
    writeFileSync(dest.path, pack.content);
    results.push({ id, version: pack.version, path: dest.path });
    if (!json) out(`installed ${id}@${pack.version} -> ${dest.path}`);
  }
  if (json) out(JSON.stringify({ installed: results }, null, 2));
}

function printPackHelp(out) {
  out(`patina pack — licensed pro pack manager

Usage:
  patina pack list [--json]
  patina pack install <id...> [--force] [--json]
  patina pack install --all [--force]

Options:
  --url <url>        pack server (default ${DEFAULT_PACKS_URL})
  --license <key>    pro license key (prefer PATINA_LICENSE_KEY or 'license-key:' in .patina.yaml)
  --force            overwrite an existing custom lexicon
  --json             machine-readable output

Packs install into custom/ (gitignored) and are picked up automatically:
patterns into custom/patterns/, personas into custom/personas/<lang>/,
lexicons as custom/lexicon/ai-<lang>.md.`);
}

/**
 * Entry point for `patina pack …`.
 * @param {string[]} args CLI arguments after the `pack` literal.
 * @param {{fetchImpl?: typeof globalThis.fetch, repoRoot?: string}} [deps] test injection
 */
export async function runPack(args, { fetchImpl = globalThis.fetch, repoRoot = getRepoRoot() } = {}) {
  const parsed = parsePackArgs(args);
  const out = (s) => console.log(s);

  if (!parsed.sub || parsed.sub === 'help') {
    printPackHelp(out);
    return;
  }
  if (!['list', 'install'].includes(parsed.sub)) {
    throw inputError(`unknown pack subcommand '${parsed.sub}'`, 'Supported: list, install.', 'Run `patina pack` for usage.');
  }

  const { url, license } = resolveSettings(parsed);
  if (!license) {
    throw inputError(
      'a pro license is required',
      'patina pack needs your patina Pro license key.',
      'Set PATINA_LICENSE_KEY, add `license-key:` to .patina.yaml, or pass --license <key>.'
    );
  }

  const ctx = { ...parsed, url, license, out, repoRoot, fetchImpl };
  if (parsed.sub === 'list') return listPacks(ctx);
  return installPacks(ctx);
}
