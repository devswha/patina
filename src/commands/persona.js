import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import yaml from 'js-yaml';

import { getRepoRoot } from '../config.js';
import { inputError } from '../errors.js';
import { createLogger } from '../logger.js';
import { loadFile, splitFrontmatter } from '../loader.js';
import { validatePersona, PERSONA_SCHEMA_ID, MIN_MPS_FLOOR, MIN_FIDELITY_FLOOR, PERSONA_DEPTHS } from '../personas/schema.js';
import { listPersonas, loadPersona, resolvePersonaPath, safePersonaPath } from '../personas/loader.js';
import { extractPersonaFeatureVector } from '../features/persona-match.js';
import { selectBackendChain, invokeBackendChain } from '../backends/index.js';

const SUPPORTED_LANGS = Object.freeze(['ko', 'en', 'zh', 'ja']);
const PERSONA_ID_RE = /^[a-z0-9][a-z0-9-]*$/;


function round(value, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assertPersonaId(id) {
  if (!PERSONA_ID_RE.test(String(id ?? ''))) {
    throw inputError(
      `invalid persona id: ${JSON.stringify(id)}`,
      'A persona id must match /^[a-z0-9][a-z0-9-]*$/ (lowercase letters, digits, hyphens).',
      'Use an id like my-voice or founder-casual.'
    );
  }
}

function assertLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) {
    throw inputError(
      `unsupported --lang ${lang}`,
      `Personas support: ${SUPPORTED_LANGS.join(', ')}.`,
      'Pass a supported --lang.'
    );
  }
}

// Extract the first balanced JSON object from an LLM response.
function parseFirstJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start === -1) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* keep shrinking */ }
  }
  return null;
}

function shortStringArray(value, max = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, max);
}

function normalizeDepth(value) {
  const depth = String(value ?? 'style-only').trim();
  return PERSONA_DEPTHS.includes(depth) ? depth : 'style-only';
}

// Assemble the raw (snake_case) persona frontmatter that validatePersona expects.
// Only whitelisted voice fields are ever read from LLM output, so gate-weakening
// keys can never leak into a generated persona.
function buildFrontmatter({ id, lang, name, depth, register, prefer = [], avoid = [], moves = [], avoidMoves = [], targetFeatures = {} }) {
  const preferWords = shortStringArray(prefer);
  const avoidWords = shortStringArray(avoid);
  const explMoves = shortStringArray(moves);
  const explAvoid = shortStringArray(avoidMoves);
  const hasRegister = typeof register === 'string' && register.trim();
  return {
    schema: PERSONA_SCHEMA_ID,
    id,
    name: (typeof name === 'string' && name.trim()) ? name.trim() : id,
    lang,
    source: 'learned',
    depth: normalizeDepth(depth),
    persona_depth_directive: {
      content_scope: 'emphasis-and-coverage-only',
      mps_advisory: false,
      fidelity_advisory: false,
    },
    mps: { enforce: true, floor: MIN_MPS_FLOOR },
    fidelity: { enforce: true, floor: MIN_FIDELITY_FLOOR },
    blocks: {
      preferred_words: {
        active: preferWords.length > 0 || avoidWords.length > 0,
        allow: preferWords,
        avoid: avoidWords,
        density: { target_per_1000_tokens: 0, max_per_paragraph: 0 },
      },
      preferred_metaphors: {
        active: false,
        allow: [],
        forbid_new_facts: true,
        max_new_metaphors_per_500_chars: 0,
      },
      explanation_habits: {
        active: explMoves.length > 0 || explAvoid.length > 0,
        moves: explMoves,
        avoid: explAvoid,
      },
      sentence_structure: {
        active: Boolean(hasRegister),
        register: hasRegister ? register.trim() : null,
      },
      worldview: { active: false },
    },
    target_features: targetFeatures && typeof targetFeatures === 'object' ? targetFeatures : {},
  };
}

// Deterministic, LLM-free measurable anchors from a writing sample. Only
// language-agnostic features are used so this is safe for ko/en/zh/ja alike.
function deterministicTargetsFromSample(sampleText, { lang, repoRoot }) {
  const fv = extractPersonaFeatureVector(sampleText, { lang, repoRoot });
  const targets = {};
  const add = (name, value, tolerance, weight = 0.1) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      targets[name] = { target: round(value), tolerance, weight };
    }
  };
  add('sentence_opener_diversity', fv.sentence_opener_diversity, 0.2);
  add('burstiness_cv', fv.burstiness_cv, 0.15);
  add('comma_per_sentence', fv.comma_per_sentence, 0.5);
  add('mattr', fv.mattr, 0.1);
  return targets;
}

function buildVoicePrompt({ kind, text, lang }) {
  const label = kind === 'sample' ? 'WRITING SAMPLE' : 'VOICE DESCRIPTION';
  return [
    'You are configuring a reusable writing-voice persona for a text humanizer.',
    `Extract ONLY voice/style traits from the ${label.toLowerCase()} below — never facts, claims, or topic.`,
    `The target rewrite language is ${lang}. Keep prefer/avoid items in that language.`,
    '',
    'Output STRICT JSON and nothing else, with exactly these keys:',
    '{',
    '  "name": "<= 6 word human label for this voice",',
    '  "depth": "style-only" | "content",',
    '  "register": "one short phrase, e.g. casual / professional / warm-professional",',
    '  "prefer": ["words or short phrases this voice favors"],',
    '  "avoid": ["words or short phrases this voice avoids"],',
    '  "explanation_moves": ["how this voice explains things"],',
    '  "explanation_avoid": ["explanation habits this voice avoids"]',
    '}',
    '',
    'Rules: prefer "style-only" unless the input explicitly asks to reweight emphasis/coverage.',
    'Each array <= 12 short items. Emit no keys other than those listed. No prose outside the JSON.',
    '',
    `${label}:`,
    '<<<',
    String(text ?? '').slice(0, 8000),
    '>>>',
  ].join('\n');
}

async function deriveVoiceViaLLM({ kind, text, lang, callLLM }) {
  const prompt = buildVoicePrompt({ kind, text, lang });
  const raw = await callLLM({ prompt });
  const parsed = parseFirstJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw inputError(
      'could not derive a persona from the input',
      'The backend did not return parseable JSON for the voice traits.',
      'Retry, use a clearer --describe, or fall back to `--template` and edit the file.'
    );
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    depth: parsed.depth,
    register: typeof parsed.register === 'string' ? parsed.register : undefined,
    prefer: shortStringArray(parsed.prefer),
    avoid: shortStringArray(parsed.avoid),
    moves: shortStringArray(parsed.explanation_moves),
    avoidMoves: shortStringArray(parsed.explanation_avoid),
  };
}

function makeCallLLM({ backends } = {}) {
  const chain = backends ?? selectBackendChain({ name: process.env.PATINA_BACKEND || null });
  const resolved = Array.isArray(chain) ? chain : chain?.backends;
  if (!resolved || resolved.length === 0) {
    throw inputError(
      'no backend available for persona authoring',
      'Sample/describe authoring needs an LLM backend to extract voice traits.',
      'Pass --backend <codex-cli|claude-cli|gemini-cli|kimi-cli|openai-http>, set PATINA_BACKEND, or use `--template`.'
    );
  }
  return ({ prompt, signal, timeout }) => invokeBackendChain({ backends: resolved, prompt, signal, timeout, maxConcurrency: 1, maxRetries: 1 });
}

function writePersonaFile({ repoRoot, lang, id, frontmatter, force }) {
  const dir = resolve(repoRoot, 'custom', 'personas', lang);
  const path = resolve(dir, `${id}.md`);
  if (!path.startsWith(dir + '/')) {
    throw inputError(`persona path escaped its library: ${id}`, `${path} is outside ${dir}.`, 'Use a plain id with no path separators.');
  }
  if (existsSync(path) && !force) {
    throw inputError(
      `persona already exists: ${id}`,
      `${path} already exists.`,
      'Choose another id, edit the file directly, or pass --force to overwrite.'
    );
  }
  mkdirSync(dir, { recursive: true });
  const body = `\n# ${frontmatter.name}\n\nCustom persona authored via \`patina persona new\`. The YAML frontmatter above is the single source of truth; this body is docs-only and is never sent to the model.\n`;
  const content = `---\n${yaml.dump(frontmatter, { lineWidth: -1, noRefs: true })}---\n${body}`;
  writeFileSync(path, content, 'utf8');
  return path;
}

function parsePersonaNewArgs(args) {
  const opts = { id: null, lang: 'ko', mode: null, sampleFile: null, describe: null, backend: process.env.PATINA_BACKEND || null, force: false, interactive: undefined, help: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--lang' || arg === '--language') opts.lang = args[++i];
    else if (arg === '--template') opts.mode = 'template';
    else if (arg === '--from-sample') { opts.mode = 'sample'; opts.sampleFile = args[++i]; }
    else if (arg === '--describe') { opts.mode = 'describe'; opts.describe = args[++i]; }
    else if (arg === '--backend') opts.backend = args[++i];
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-interactive') opts.interactive = false;
    else if (!arg.startsWith('-') && opts.id === null) opts.id = arg;
    else throw inputError(`unknown persona new argument: ${arg}`, 'Unrecognized flag or extra positional.', 'See `patina persona new --help`.');
  }
  return opts;
}

// Minimal interactive wizard. `ask` is injectable for tests.
async function defaultAsk(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((res) => rl.question(question, (answer) => res(answer)));
  } finally {
    rl.close();
  }
}

async function runWizard({ id, lang, ask, callLLM, repoRoot }) {
  const modeAnswer = (await ask('Create voice from — [1] writing sample  [2] description  [3] blank template: ')).trim();
  const mode = modeAnswer === '1' ? 'sample' : modeAnswer === '2' ? 'describe' : modeAnswer === '3' ? 'template' : null;
  if (!mode) throw inputError('no authoring mode chosen', 'Expected 1, 2, or 3.', 'Rerun and pick 1, 2, or 3.');
  if (mode === 'template') return { mode, fields: templateFields(id) };
  if (mode === 'sample') {
    const file = (await ask('Path to a writing sample file: ')).trim();
    const text = readFileSync(resolve(process.cwd(), file), 'utf8');
    const fields = await deriveVoiceViaLLM({ kind: 'sample', text, lang, callLLM });
    fields.targetFeatures = deterministicTargetsFromSample(text, { lang, repoRoot });
    return { mode, fields };
  }
  const desc = (await ask('Describe the voice you want: ')).trim();
  const fields = await deriveVoiceViaLLM({ kind: 'describe', text: desc, lang, callLLM });
  return { mode, fields };
}

function templateFields(id) {
  return { name: id, depth: 'style-only', register: null, prefer: [], avoid: [], moves: [], avoidMoves: [], targetFeatures: {} };
}

/**
 * `patina persona new <id>` — author a reusable custom persona.
 *
 * @param {string[]} args CLI args after `persona new`.
 * @param {object} [deps] Injected dependencies (repoRoot, callLLM, ask, logger).
 * @returns {Promise<string>} Written persona file path.
 */
export async function runPersonaNew(args, deps = {}) {
  const repoRoot = deps.repoRoot ?? getRepoRoot();
  const logger = deps.logger ?? createLogger();
  const opts = parsePersonaNewArgs(args);
  if (opts.help) { printPersonaHelp(); return null; }
  if (!opts.id) throw inputError('persona new requires an id', 'Usage: patina persona new <id> [--lang ..] [--from-sample f | --describe t | --template]', 'e.g. `patina persona new my-voice --describe "warm, direct"`.');
  assertPersonaId(opts.id);
  assertLang(opts.lang);

  const interactive = opts.interactive ?? deps.interactive ?? (process.stdin.isTTY === true);
  const callLLM = deps.callLLM ?? (opts.mode === 'template' ? null : makeCallLLM({ backends: opts.backend ? selectBackendChain({ name: opts.backend }) : undefined }));

  let fields;
  if (opts.mode === 'template') {
    fields = templateFields(opts.id);
  } else if (opts.mode === 'sample') {
    const text = readFileSync(resolve(process.cwd(), opts.sampleFile), 'utf8');
    fields = await deriveVoiceViaLLM({ kind: 'sample', text, lang: opts.lang, callLLM });
    fields.targetFeatures = deterministicTargetsFromSample(text, { lang: opts.lang, repoRoot });
  } else if (opts.mode === 'describe') {
    fields = await deriveVoiceViaLLM({ kind: 'describe', text: opts.describe, lang: opts.lang, callLLM });
  } else if (interactive) {
    const ask = deps.ask ?? defaultAsk;
    const wizardLLM = deps.callLLM ?? makeCallLLM({ backends: opts.backend ? selectBackendChain({ name: opts.backend }) : undefined });
    ({ fields } = await runWizard({ id: opts.id, lang: opts.lang, ask, callLLM: wizardLLM, repoRoot }));
  } else {
    throw inputError(
      'persona new needs an input mode',
      'No --from-sample/--describe/--template given and no interactive terminal.',
      'Pass one of --from-sample <file>, --describe "<text>", or --template.'
    );
  }

  const frontmatter = buildFrontmatter({ id: opts.id, lang: opts.lang, ...fields });
  // Safety gate: the generated frontmatter must pass the persona schema
  // (FORBIDDEN_KEYS rejected, floors clamped) before it is ever written.
  validatePersona(frontmatter, { id: opts.id, lang: opts.lang });
  const path = writePersonaFile({ repoRoot, lang: opts.lang, id: opts.id, frontmatter, force: opts.force });
  logger.info?.('persona.created', { message: `[patina] created persona '${opts.id}' (${opts.lang}) → ${path}\n  use it: patina --lang ${opts.lang} --persona ${opts.id} <file>` });
  return path;
}

/**
 * `patina persona list` — list built-in and custom personas per language.
 *
 * @param {string[]} args CLI args after `persona list`.
 * @param {object} [deps] Injected dependencies (repoRoot, logger).
 * @returns {object} Listing keyed by language.
 */
export function runPersonaList(args, deps = {}) {
  const repoRoot = deps.repoRoot ?? getRepoRoot();
  let lang = null;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--lang' || args[i] === '--language') lang = args[++i];
    else if (args[i] === '--format' && args[i + 1] === 'json') { json = true; i += 1; }
  }
  const langs = lang ? [lang] : SUPPORTED_LANGS;
  const result = {};
  for (const l of langs) {
    assertLang(l);
    const builtinDir = resolve(repoRoot, 'personas', l);
    const customDir = resolve(repoRoot, 'custom', 'personas', l);
    const all = listPersonas(repoRoot, l);
    const customIds = new Set(existsSync(customDir) ? all.filter((id) => existsSync(resolve(customDir, `${id}.md`))) : []);
    const builtinIds = existsSync(builtinDir) ? all.filter((id) => existsSync(resolve(builtinDir, `${id}.md`))) : [];
    result[l] = {
      builtin: builtinIds,
      custom: all.filter((id) => customIds.has(id) && !builtinIds.includes(id)),
    };
  }
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const lines = [];
  for (const [l, groups] of Object.entries(result)) {
    lines.push(`${l}:`);
    lines.push(`  built-in: ${groups.builtin.join(', ') || '(none)'}`);
    lines.push(`  custom:   ${groups.custom.join(', ') || '(none)'}`);
  }
  console.log(lines.join('\n'));
  return result;
}

/**
 * `patina persona show <id>` — print a normalized persona (never the body).
 *
 * @param {string[]} args CLI args after `persona show`.
 * @param {object} [deps] Injected dependencies (repoRoot).
 * @returns {object} Normalized persona object.
 */
export function runPersonaShow(args, deps = {}) {
  const repoRoot = deps.repoRoot ?? getRepoRoot();
  let id = null;
  let lang = 'ko';
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--lang' || arg === '--language') lang = args[++i];
    else if (arg === '--json') json = true;
    else if (arg === '--format' && args[i + 1] === 'json') { json = true; i += 1; }
    else if (!arg.startsWith('-') && id === null) id = arg;
    else throw inputError(`unknown persona show argument: ${arg}`, 'Unrecognized flag or extra positional.', 'See `patina persona --help`.');
  }
  if (!id) throw inputError('persona show requires an id', 'Usage: patina persona show <id> [--lang ..] [--json]', 'e.g. `patina persona show natural-ko`.');
  assertLang(lang);
  assertPersonaId(id);
  // loadPersona returns the normalized, frontmatter-derived object only — the
  // Markdown body is docs-only and is never included, so it cannot leak here.
  const persona = loadPersona(repoRoot, lang, id);
  if (json) {
    console.log(JSON.stringify(persona, null, 2));
    return persona;
  }
  const path = resolvePersonaPath(repoRoot, lang, id);
  const source = path.startsWith(resolve(repoRoot, 'custom', 'personas') + '/') ? 'custom' : 'library';
  const activeBlocks = Object.entries(persona.blocks || {})
    .filter(([, block]) => block && block.active)
    .map(([name]) => name);
  const targetKeys = Object.keys(persona.targetFeatures || {});
  const lines = [
    `id:              ${persona.id}`,
    `name:            ${persona.name}`,
    `lang:            ${persona.lang}`,
    `depth:           ${persona.depth}`,
    `mps:             floor ${persona.mps.floor} (enforce: ${persona.mps.enforce})`,
    `fidelity:        floor ${persona.fidelity.floor} (enforce: ${persona.fidelity.enforce})`,
    `active blocks:   ${activeBlocks.join(', ') || '(none)'}`,
    `target_features: ${targetKeys.join(', ') || '(none)'}`,
    `path:            ${path}`,
    `source:          ${source}`,
  ];
  console.log(lines.join('\n'));
  return persona;
}

/**
 * `patina persona rm <id>` — remove a custom persona. Built-in library seeds
 * and the meaning-preserving `preserve` default can never be removed.
 *
 * @param {string[]} args CLI args after `persona rm`.
 * @param {object} [deps] Injected dependencies (repoRoot, ask, logger).
 * @returns {Promise<string|null>} Removed path, or null if aborted.
 */
export async function runPersonaRm(args, deps = {}) {
  const repoRoot = deps.repoRoot ?? getRepoRoot();
  const logger = deps.logger ?? createLogger();
  let id = null;
  let lang = 'ko';
  let force = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--lang' || arg === '--language') lang = args[++i];
    else if (arg === '--force') force = true;
    else if (!arg.startsWith('-') && id === null) id = arg;
    else throw inputError(`unknown persona rm argument: ${arg}`, 'Unrecognized flag or extra positional.', 'See `patina persona --help`.');
  }
  if (!id) throw inputError('persona rm requires an id', 'Usage: patina persona rm <id> [--lang ..] [--force]', 'e.g. `patina persona rm my-voice`.');
  assertLang(lang);
  assertPersonaId(id);
  if (id === 'preserve') {
    throw inputError(
      'the preserve persona cannot be removed',
      'preserve is the meaning-preserving default and must always be available.',
      'Leave preserve in place; author a different custom persona instead.'
    );
  }
  // Reuse the loader's path-containment guard for both candidate paths.
  const customPath = safePersonaPath(resolve(repoRoot, 'custom', 'personas', lang), id);
  const libraryPath = safePersonaPath(resolve(repoRoot, 'personas', lang), id);
  const customExists = existsSync(customPath);
  const libraryExists = existsSync(libraryPath);
  if (!customExists && libraryExists) {
    throw inputError(
      'built-in personas cannot be removed',
      `${libraryPath} is a built-in library persona.`,
      `Shadow it with a custom persona (patina persona edit ${id}) or edit the library file directly.`
    );
  }
  if (!customExists) {
    throw inputError(
      `persona not found: ${id}`,
      `No custom persona at ${customPath}.`,
      `Run \`patina persona list --lang ${lang}\` to see available personas.`
    );
  }
  if (!force) {
    const ask = deps.ask ?? defaultAsk;
    const answer = String(await ask(`Remove custom persona '${id}' (${lang}) at ${customPath}? [y/N] `) ?? '').trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      logger.info?.('persona.rm.aborted', { message: `[patina] aborted: custom persona '${id}' was not removed` });
      return null;
    }
  }
  unlinkSync(customPath);
  logger.info?.('persona.removed', { message: `[patina] removed custom persona '${id}' (${lang}) → ${customPath}` });
  return customPath;
}

function parsePersonaEditArgs(args) {
  const opts = { id: null, lang: 'ko', mode: null, sampleFile: null, describe: null, name: null, backend: process.env.PATINA_BACKEND || null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--lang' || arg === '--language') opts.lang = args[++i];
    else if (arg === '--from-sample') { opts.mode = 'sample'; opts.sampleFile = args[++i]; }
    else if (arg === '--describe') { opts.mode = 'describe'; opts.describe = args[++i]; }
    else if (arg === '--name') { opts.mode = 'name'; opts.name = args[++i]; }
    else if (arg === '--backend') opts.backend = args[++i];
    else if (!arg.startsWith('-') && opts.id === null) opts.id = arg;
    else throw inputError(`unknown persona edit argument: ${arg}`, 'Unrecognized flag or extra positional.', 'See `patina persona --help`.');
  }
  return opts;
}

/**
 * `patina persona edit <id>` — copy-on-edit a persona into custom/personas.
 * Editing a built-in persona COPIES it into custom (a shadow), leaving the
 * library file intact. Every write passes the persona safety gate.
 *
 * @param {string[]} args CLI args after `persona edit`.
 * @param {object} [deps] Injected dependencies (repoRoot, callLLM, logger).
 * @returns {Promise<string>} Written persona file path (under custom/personas).
 */
export async function runPersonaEdit(args, deps = {}) {
  const repoRoot = deps.repoRoot ?? getRepoRoot();
  const logger = deps.logger ?? createLogger();
  const opts = parsePersonaEditArgs(args);
  if (!opts.id) throw inputError('persona edit requires an id', 'Usage: patina persona edit <id> [--lang ..] [--from-sample f | --describe t | --name "<new name>"]', 'e.g. `patina persona edit natural-ko --name "My natural KO"`.');
  assertLang(opts.lang);
  assertPersonaId(opts.id);
  if (!opts.mode) {
    throw inputError(
      'persona edit needs an edit input',
      'No edit flag given.',
      'Pass one of --from-sample <file>, --describe "<text>", or --name "<new name>".'
    );
  }
  // Existence guard (custom-first); throws a clear not-found error if missing.
  loadPersona(repoRoot, opts.lang, opts.id);

  // --name is a lossless rename: preserve the full original frontmatter and
  // override only the name, so non-whitelisted blocks (preferred_metaphors,
  // extended sentence_structure targets) are NOT dropped. Re-derivation modes
  // (--from-sample/--describe) intentionally rebuild the voice like `new`.
  if (opts.mode === 'name') {
    const sourcePath = resolvePersonaPath(repoRoot, opts.lang, opts.id);
    const { frontmatter: raw } = splitFrontmatter(loadFile(sourcePath));
    raw.name = opts.name;
    // Shadow copy is now an authored custom persona; mark provenance accordingly
    // while preserving every voice block losslessly.
    raw.source = 'learned';
    validatePersona(raw, { id: opts.id, lang: opts.lang });
    const path = writePersonaFile({ repoRoot, lang: opts.lang, id: opts.id, frontmatter: raw, force: true });
    logger.info?.('persona.edited', { message: `[patina] edited persona '${opts.id}' (${opts.lang}) → ${path}` });
    return path;
  }

  let fields;
  if (opts.mode === 'sample') {
    const callLLM = deps.callLLM ?? makeCallLLM({ backends: opts.backend ? selectBackendChain({ name: opts.backend }) : undefined });
    const text = readFileSync(resolve(process.cwd(), opts.sampleFile), 'utf8');
    fields = await deriveVoiceViaLLM({ kind: 'sample', text, lang: opts.lang, callLLM });
    fields.targetFeatures = deterministicTargetsFromSample(text, { lang: opts.lang, repoRoot });
  } else {
    const callLLM = deps.callLLM ?? makeCallLLM({ backends: opts.backend ? selectBackendChain({ name: opts.backend }) : undefined });
    fields = await deriveVoiceViaLLM({ kind: 'describe', text: opts.describe, lang: opts.lang, callLLM });
  }

  const frontmatter = buildFrontmatter({ id: opts.id, lang: opts.lang, ...fields });
  // Safety gate: the rebuilt frontmatter must pass the persona schema (floors
  // clamped, FORBIDDEN_KEYS rejected) before it is ever written.
  validatePersona(frontmatter, { id: opts.id, lang: opts.lang });
  // Always writes into custom/personas/<lang>/, so editing a library persona
  // copies it into custom (shadow) and preserves the library file.
  const path = writePersonaFile({ repoRoot, lang: opts.lang, id: opts.id, frontmatter, force: true });
  logger.info?.('persona.edited', { message: `[patina] edited persona '${opts.id}' (${opts.lang}) → ${path}` });
  return path;
}

export function printPersonaHelp() {
  console.log([
    'Usage: patina persona <command>',
    '',
    'COMMANDS',
    '  new <id>     Author a reusable custom persona (saved to custom/personas/<lang>/<id>.md)',
    '  list         List built-in and custom personas',
    '  show <id>    Print a persona\'s normalized config (never the docs body)',
    '  rm <id>      Remove a custom persona (built-ins and preserve are protected)',
    '  edit <id>    Copy-on-edit a persona into custom/personas/<lang>/',
    '',
    'persona new options',
    '  --lang <code>        ko | en | zh | ja (default: ko)',
    '  --from-sample <file> Derive the voice from a writing sample (LLM + deterministic analysis)',
    '  --describe "<text>"  Derive the voice from a natural-language description (LLM)',
    '  --template           Write a blank editable template (no LLM)',
    '  --backend <name>     Backend for sample/describe authoring',
    '  --force              Overwrite an existing custom persona',
    '  --no-interactive     Fail instead of prompting when no mode flag is given',
    '  (no mode flag + a terminal) launches an interactive wizard',
    '',
    'persona list options',
    '  --lang <code>        Restrict to one language',
    '  --format json        Machine-readable output',
    '',
    'persona show options',
    '  --lang <code>        Persona language (default: ko)',
    '  --json               Emit the normalized persona as JSON',
    '',
    'persona rm options',
    '  --lang <code>        Persona language (default: ko)',
    '  --force              Skip the interactive confirm',
    '',
    'persona edit options',
    '  --lang <code>        Persona language (default: ko)',
    '  --from-sample <file> Re-derive the voice from a writing sample (LLM + deterministic analysis)',
    '  --describe "<text>"  Re-derive the voice from a natural-language description (LLM)',
    '  --name "<new name>"  Keep the derived voice but rename the persona',
    '  --backend <name>     Backend for sample/describe re-derivation',
  ].join('\n'));
}

/**
 * Dispatch `patina persona <sub>`.
 *
 * @param {string[]} args CLI args after `persona`.
 * @param {object} [deps] Injected dependencies.
 * @returns {Promise<unknown>} Subcommand result.
 */
export async function runPersona(args, deps = {}) {
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') { printPersonaHelp(); return null; }
  if (sub === 'new') return runPersonaNew(args.slice(1), deps);
  if (sub === 'list') return runPersonaList(args.slice(1), deps);
  if (sub === 'show') return runPersonaShow(args.slice(1), deps);
  if (sub === 'rm') return runPersonaRm(args.slice(1), deps);
  if (sub === 'edit') return runPersonaEdit(args.slice(1), deps);
  throw inputError(
    `unknown persona subcommand: ${sub}`,
    'Supported subcommands: new, list, show, rm, edit.',
    'Run `patina persona --help`.'
  );
}
