import { listBackendNames } from '../backends/index.js';
import { inputError } from '../errors.js';
import { basename } from 'node:path';

// Options that consume the next token as their value. Drives --name=value
// expansion and the --suffix flag-collision backstop (#440).
const VALUE_OPTIONS = new Set([
  '--lang', '--profile', '--tone', '--voice-sample', '--format', '--exit-on',
  '--suffix', '--outdir', '--model', '--api-key-file', '--base-url',
  '--backend', '--timeout-ms', '--max-concurrency', '--max-retries',
  '--max-failures', '--max-failure-rate', '--provider', '--config',
]);

// Boolean switches. Used to reject `--quiet=1`-style values explicitly and to
// catch a flag name swallowed as another option's value.
const FLAG_OPTIONS = new Set([
  '--help', '-h', '--version', '-v', '--preview', '--ocr',
  '--serve', '--diff', '--no-color', '--audit', '--score', '--quiet',
  '--ouroboros', '--batch', '--in-place', '--allow-private-base-url',
  '--stop-on-retryable-storm', '--no-stop-on-retryable-storm',
  '--list-backends', '--allow-insecure-base-url', '--no-interactive',
]);

// Expand `--name=value` into two tokens for known value-taking options and
// reject `=value` on boolean switches. Tokens after a `--` end-of-options
// separator pass through untouched so dash-prefixed file names stay usable.
function expandArgs(args) {
  const expanded = [];
  let afterSeparator = false;
  for (const token of args) {
    if (afterSeparator || token === '--') {
      if (token === '--') afterSeparator = true;
      expanded.push(token);
      continue;
    }
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    if (eq > 2) {
      const name = token.slice(0, eq);
      if (VALUE_OPTIONS.has(name)) {
        expanded.push(name, token.slice(eq + 1));
        continue;
      }
      if (FLAG_OPTIONS.has(name)) {
        throw inputError(
          `${name} does not take a value`,
          `Received "${token}", but ${name} is an on/off switch.`,
          `Pass ${name} by itself.`
        );
      }
      // Unknown --x=y falls through to the unknown-option error below.
    }
    expanded.push(token);
  }
  return expanded;
}

export function parseArgs(rawArgs) {
  const parsed = {
    files: [],
    format: 'markdown',
  };
  const args = expandArgs(rawArgs);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      // End-of-options separator: everything after it is a file path, even
      // when it starts with '-' (#440).
      parsed.files.push(...args.slice(i + 1));
      break;
    }
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--version':
      case '-v':
        parsed.version = true;
        break;
      case '--lang':
        parsed.lang = readOptionValue(args, i, arg);
        i++;
        break;
      case '--profile':
        parsed.profile = readOptionValue(args, i, arg);
        i++;
        break;
      case '--tone': {
        const t = readOptionValue(args, i, arg);
        i++;
        parsed.tone = parseTransformList(t, arg,
          ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'],
          'Use `--tone auto` to let patina infer tone from the text. Comma-separate tones with --preview to compare variants.');
        break;
      }
      case '--voice-sample':
        parsed.voiceSample = readOptionValue(args, i, arg);
        i++;
        break;
      case '--restyle': {
        const value = readOptionValue(args, i, arg);
        i++;
        parsed.restyle = parseTransformList(value, arg, ['sentence', 'voice', 'content'],
          'sentence = AI-pattern cleanup only (default), voice = full voice/register transformation, content = content-level re-planning. Comma-separate values with --preview to compare variants.');
        break;
      }
      case '--jargon': {
        const value = readOptionValue(args, i, arg);
        i++;
        parsed.jargon = parseTransformList(value, arg, ['keep', 'explain', 'remove'],
          'keep = leave technical terms (default), explain = add plain-language glosses, remove = replace jargon for a general audience. Comma-separate values with --preview to compare variants.');
        break;
      }
      case '--preview':
        parsed.preview = true;
        break;
      case '--ocr':
        parsed.ocr = true;
        break;
      case '--serve':
        parsed.serve = true;
        break;
      case '--diff':
        parsed.diff = true;
        break;
      case '--no-color':
        parsed.noColor = true;
        break;
      case '--audit':
        parsed.audit = true;
        break;
      case '--score':
        parsed.score = true;
        break;
      case '--format': {
        const value = readOptionValue(args, i, arg);
        i++;
        if (!['json', 'text', 'markdown'].includes(value)) {
          throw inputError(
            '--format expects json, text, or markdown',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `--format json`, `--format text`, or `--format markdown`.'
          );
        }
        parsed.format = value;
        break;
      }
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--exit-on': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        const n = numericOptionValue(value);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw inputError(
            '--exit-on expects a number from 0 to 100',
            `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
            'Use `patina --score --exit-on 30 <file>` for CI gates.'
          );
        }
        parsed.gate = n;
        break;
      }
      case '--ouroboros':
        parsed.ouroboros = true;
        break;
      case '--batch':
        parsed.batch = true;
        break;
      case '--in-place':
        parsed.inPlace = true;
        break;
      case '--suffix': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        // allowFlagLike keeps `-humanized` usable, but a KNOWN flag name here
        // means the value was omitted and the next option got swallowed
        // (`--suffix --batch` would silently disable batch mode, #440).
        if (VALUE_OPTIONS.has(value) || FLAG_OPTIONS.has(value) || value === '--') {
          throw inputError(
            '--suffix requires a value',
            `"${value}" is a patina flag, so the suffix value was probably omitted.`,
            'Use `patina --batch --suffix -humanized <files>` (the suffix may start with "-").'
          );
        }
        parsed.suffix = value;
        break;
      }
      case '--outdir':
        parsed.outdir = readOptionValue(args, i, arg);
        i++;
        break;
      case '--model':
        parsed.model = readOptionValue(args, i, arg);
        i++;
        break;
      case '--api-key-file':
        parsed.apiKeyFile = readOptionValue(args, i, arg);
        i++;
        break;
      case '--allow-private-base-url':
        parsed.allowPrivateBaseURL = true;
        break;
      case '--base-url':
        parsed.baseURL = readOptionValue(args, i, arg);
        i++;
        break;
      case '--backend':
        parsed.backend = readOptionValue(args, i, arg);
        i++;
        break;
      case '--timeout-ms': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.timeoutMs = parsePositiveIntegerOption(value, arg);
        break;
      }
      case '--max-concurrency': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxConcurrency = parsePositiveIntegerOption(value, arg);
        break;
      }
      case '--max-retries': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxRetries = parseNonNegativeIntegerOption(value, arg);
        break;
      }
      case '--max-failures': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxFailures = parsePositiveIntegerOption(value, arg);
        break;
      }
      case '--max-failure-rate': {
        const value = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        parsed.maxFailureRate = parseFailureRateOption(value, arg);
        break;
      }
      case '--stop-on-retryable-storm':
        parsed.stopOnRetryableStorm = true;
        break;
      case '--no-stop-on-retryable-storm':
        // Storm stopping is ON by default in batch mode; this is the only
        // way to turn it off (#440 — the positive flag alone was a no-op
        // presented as opt-in).
        parsed.stopOnRetryableStorm = false;
        break;
      case '--list-backends':
        parsed.listBackends = true;
        break;
      case '--provider':
        parsed.provider = readOptionValue(args, i, arg);
        i++;
        break;
      case '--allow-insecure-base-url':
        parsed.allowInsecureBaseURL = true;
        break;
      case '--config':
        parsed.config = readOptionValue(args, i, arg);
        i++;
        break;
      case '--no-interactive':
        parsed.noInteractive = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          parsed.files.push(arg);
        } else {
          throw inputError(
            `unknown option ${arg}`,
            'patina does not recognize this CLI flag.',
            'Run `patina --help` to see supported options.'
          );
        }
        break;
    }
  }

  return parsed;
}

// The output modes are mutually exclusive (SKILL.md). Without this guard, a
// combination like `--audit --score` resolves to 'audit' and silently skips the
// score gate (exit 0 always), and `--score --ouroboros` throws deep in the gate.
export function validateModeExclusivity(parsed) {
  const active = ['diff', 'audit', 'score', 'ouroboros'].filter((m) => parsed[m]);
  if (active.length > 1) {
    throw inputError(
      `--${active[0]} and --${active[1]} cannot be combined`,
      'The diff / audit / score / ouroboros output modes are mutually exclusive.',
      `Pick one of --diff, --audit, --score, or --ouroboros.`
    );
  }
}

// Shared parser for --restyle/--jargon/--tone: a single value, or a
// comma-separated list of values for --preview variant comparison. Tokens are
// validated individually and deduped preserving order; the normalized joined
// string is stored so downstream code has one canonical shape.
const TRANSFORM_OPTION_NOUNS = { '--restyle': 'restyle depth', '--jargon': 'jargon policy', '--tone': 'tone' };

function parseTransformList(value, option, valid, hint) {
  const tokens = String(value ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw inputError(`${option} expects a value`, `Valid values are: ${valid.join(', ')}.`, hint);
  }
  const seen = [];
  for (const token of tokens) {
    if (!valid.includes(token)) {
      throw inputError(
        `unknown ${TRANSFORM_OPTION_NOUNS[option] ?? 'value'} ${token}`,
        `Valid values are: ${valid.join(', ')}.`,
        hint
      );
    }
    if (!seen.includes(token)) seen.push(token);
  }
  return seen.join(',');
}

function splitTransformValues(value, fallback) {
  return String(value ?? fallback).split(',').map((t) => t.trim()).filter(Boolean);
}

// Expand --restyle/--jargon/--tone into the rewrite variants a run executes.
// A single combination is the normal one-call path; multiple combinations
// (comma lists) become --preview compare variants, one rewrite call each.
// Tone joins the cross product so "voice in casual" and "voice in marketing"
// are directly comparable; tone appears in the label only when it varies.
// The cross product is capped: every variant is a full LLM call.
export const MAX_TRANSFORM_VARIANTS = 4;

export function buildTransformVariants(parsed) {
  const restyles = splitTransformValues(parsed.restyle, 'sentence');
  const jargons = splitTransformValues(parsed.jargon, 'keep');
  const tones = splitTransformValues(parsed.tone, '');
  const toneList = tones.length > 0 ? tones : [null];
  const multiTone = toneList.length > 1;
  const variants = [];
  for (const restyle of restyles) {
    for (const jargon of jargons) {
      for (const tone of toneList) {
        const parts = [];
        if (restyle !== 'sentence') parts.push(restyle);
        if (jargon !== 'keep') parts.push(jargon);
        let label = parts.join('+');
        if (multiTone) label = label ? `${label}·${tone}` : tone;
        variants.push({ restyle, jargon, tone, label: label || 'cleanup' });
      }
    }
  }
  if (variants.length > MAX_TRANSFORM_VARIANTS) {
    throw inputError(
      `too many transform variants (${variants.length})`,
      `--restyle × --jargon × --tone combinations are capped at ${MAX_TRANSFORM_VARIANTS}; each variant is a full rewrite call.`,
      'Drop values from one of the lists, e.g. `--restyle voice --tone casual,professional` with a single --jargon.'
    );
  }
  return variants;
}

// --restyle/--jargon opt into transformations beyond AI-pattern cleanup. They
// only apply where patina rewrites prose it owns end to end: the default
// rewrite and --preview. Score/audit/diff report on text as-is, and ouroboros
// enforces meaning-preservation floors that a content-level transformation
// would fight — reject the combination instead of silently ignoring the flag.
// Comma-list (compare) requests additionally need the preview surface: a
// plain rewrite has one stdout, and --ocr ties image findings to a single
// rewrite call, so neither can carry multiple variants.
export function validateTransformRequest(parsed) {
  const variants = buildTransformVariants(parsed);
  if (variants.length > 1) {
    if (!parsed.preview) {
      throw inputError(
        'comparing transform variants requires --preview',
        'Comma-separated --restyle/--jargon values render as toggleable variants on the preview page; a plain rewrite has a single stdout.',
        'Run `patina --preview --restyle sentence,voice <url>` or pick one value.'
      );
    }
    if (parsed.ocr) {
      throw inputError(
        '--ocr cannot be combined with transform-variant comparison',
        'OCR findings ride a single rewrite call; per-variant image cards are not supported.',
        'Drop --ocr, or compare variants without it.'
      );
    }
  }
  const restyleActive = variants.some((v) => v.restyle !== 'sentence');
  const jargonActive = variants.some((v) => v.jargon !== 'keep');
  if (!restyleActive && !jargonActive && variants.length === 1) return;
  const flag = restyleActive ? '--restyle' : jargonActive ? '--jargon' : '--tone';
  const blocked = [
    ['score', '--score', 'does not rewrite text'],
    ['audit', '--audit', 'does not rewrite text'],
    ['diff', '--diff', 'documents pattern-based edits, not free transformations'],
    ['ouroboros', '--ouroboros', 'enforces meaning-preservation floors that a transformation would fight'],
  ];
  for (const [key, name, why] of blocked) {
    if (parsed[key]) {
      throw inputError(
        `${flag} cannot be combined with ${name}`,
        `${flag} changes how text is rewritten; ${name} ${why}.`,
        `Use a plain rewrite (\`patina ${flag} ... <file>\`) or \`patina --preview ${flag} ...\` instead.`
      );
    }
  }
}

export function validatePreviewRequest(parsed) {
  if (parsed.ocr && !parsed.preview) {
    throw inputError(
      '--ocr requires --preview',
      'OCR scans the images of a preview page for text.',
      'Run `patina --preview --ocr <url>`.'
    );
  }
  if (!parsed.preview) return;
  if (parsed.batch) {
    throw inputError(
      '--preview does not support --batch',
      'The preview page renders one URL at a time.',
      'Run `patina --preview <url>` with a single URL.'
    );
  }
  if (parsed.diff || parsed.audit || parsed.score || parsed.ouroboros) {
    throw inputError(
      '--preview only works in rewrite mode',
      'The preview page is an additive rewrite surface, not a diff/audit/score/ouroboros mode.',
      'Use `patina --preview <url>` by itself, without --diff, --audit, --score, or --ouroboros.'
    );
  }
  if (parsed.files.length !== 1) {
    throw inputError(
      '--preview requires exactly one input',
      'Pass one http(s) URL or one local file; stdin and multiple inputs are not supported.',
      'Run `patina --preview https://example.com/article` or `patina --preview export.html`.'
    );
  }
  const input = String(parsed.files[0] || '');
  if (!/^https?:\/\//i.test(input) && !/\.html?$/i.test(input)) {
    throw inputError(
      '--preview supports http(s) URLs and local .html files only',
      `"${input}" is not an http(s) URL or a .html/.htm file.`,
      'Pass a URL or an .html file, or run `patina <file>` / `patina --diff <file>` to rewrite a markdown/text draft.'
    );
  }
}

// --serve only makes sense alongside --preview; guard it on its own.
export function validateServeRequest(parsed) {
  if (parsed.serve && !parsed.preview) {
    throw inputError(
      '--serve requires --preview',
      '--serve replaces the local window opener for the generated page.',
      'Run `patina --preview --serve <url-or-file>`.'
    );
  }
}

// Output routing flags are batch-only and mutually exclusive. Without this,
// `patina --in-place draft.md` silently prints to stdout (never overwriting),
// combined destinations apply hidden precedence, and --outdir can collapse
// distinct inputs onto one output file (#440).
export function validateOutputRouting(parsed) {
  const destinations = [
    parsed.inPlace ? '--in-place' : null,
    parsed.suffix !== undefined ? '--suffix' : null,
    parsed.outdir !== undefined ? '--outdir' : null,
  ].filter(Boolean);
  if (destinations.length === 0) return;
  if (!parsed.batch) {
    throw inputError(
      `${destinations[0]} requires --batch`,
      'Output routing flags only apply to batch mode; without --batch the result goes to stdout.',
      `Run \`patina --batch ${destinations[0]}${destinations[0] === '--in-place' ? '' : ' <value>'} <files>\`.`
    );
  }
  if (destinations.length > 1) {
    throw inputError(
      `${destinations[0]} and ${destinations[1]} cannot be combined`,
      'Each batch run writes to exactly one destination; combining them would silently pick one.',
      'Pick one of --in-place, --suffix, or --outdir.'
    );
  }
  // An empty value (e.g. `--suffix=` or `--outdir=`) passes the
  // `!== undefined` destination check above but is falsy, so writeBatchOutput
  // would silently fall through to stdout (#504). Reject it here so the
  // validator's "present" guarantee matches writeBatchOutput's truthiness gate.
  if (parsed.suffix === '') {
    throw inputError(
      '--suffix requires a non-empty value',
      'An empty --suffix= would leave the filename unchanged and silently print to stdout instead of writing files.',
      'Pass a suffix like --suffix .patina (writes draft.patina.md).'
    );
  }
  if (parsed.outdir === '') {
    throw inputError(
      '--outdir requires a non-empty value',
      'An empty --outdir= would silently print to stdout instead of writing files.',
      'Pass a directory like --outdir out/.'
    );
  }
  if (parsed.outdir !== undefined) {
    const seen = new Map();
    for (const file of parsed.files) {
      const base = basename(file);
      const prior = seen.get(base);
      if (prior !== undefined && prior !== file) {
        throw inputError(
          `--outdir would overwrite ${base}`,
          `Both "${prior}" and "${file}" map to the same output file in ${parsed.outdir}.`,
          'Rename the inputs, or use --suffix / --in-place to keep outputs beside their sources.'
        );
      }
      seen.set(base, file);
    }
  }
}

function readOptionValue(args, index, option, { allowFlagLike = false } = {}) {
  const value = args[index + 1];
  if (value === undefined || (!allowFlagLike && value.startsWith('-'))) {
    throw inputError(
      `${option} requires a value`,
      'The option was provided without the value it needs.',
      `Run \`patina --help\` to see the expected ${option} syntax.`
    );
  }
  return value;
}

// Number('') === 0 and Number('  ') === 0, so a shell-quoting mistake like
// `--max-retries ""` would silently become 0 (#440). Blank values are NaN.
function numericOptionValue(value) {
  if (value === undefined || String(value).trim() === '') return NaN;
  return Number(value);
}

function parsePositiveIntegerOption(value, option) {
  const n = numericOptionValue(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw inputError(
      `${option} expects a positive integer`,
      `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
      `Use ${option} 1 or another whole number greater than zero.`
    );
  }
  return n;
}

function parseNonNegativeIntegerOption(value, option) {
  const n = numericOptionValue(value);
  if (!Number.isInteger(n) || n < 0) {
    throw inputError(
      `${option} expects a non-negative integer`,
      `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
      `Use ${option} 0 to disable retries, or another whole number.`
    );
  }
  return n;
}

function parseFailureRateOption(value, option) {
  const n = numericOptionValue(value);
  if (!Number.isFinite(n) || n < 0) {
    throw inputError(
      `${option} expects a ratio or percent`,
      `Received ${value === undefined ? 'no value' : `"${value}"`}.`,
      `Use ${option} 0.25 for 25%, or ${option} 25.`
    );
  }
  const ratio = n > 1 ? n / 100 : n;
  if (ratio > 1) {
    throw inputError(
      `${option} expects a value from 0 to 1 or 0 to 100`,
      `Received "${value}".`,
      `Use ${option} 0.25 for 25%, or ${option} 25.`
    );
  }
  // A value in the open (1, 2) interval is ambiguous: it is too big to be a
  // ratio (>1) so it is read as a percent, but a tiny one (1.5 -> 1.5% -> 0.015)
  // almost certainly is not what the user meant (#508 G4). Stay backward
  // compatible (no throw) but surface the interpretation so the mistake is
  // visible instead of silent.
  if (n > 1 && n < 2) {
    process.stderr.write(`[patina] --max-failure-rate ${value} read as ${n}% (ratio ${ratio}). Use a value <=1 for a ratio (0.015 = 1.5%) or >=2 for a clear percent.\n`);
  }
  return ratio;
}

export function printHelp() {
  const backendChoices = listBackendNames().join(', ');
  console.log(`patina — AI text humanizer CLI

Usage: patina [command] [options] [file...]

COMMANDS
  patina doctor [--json]  Check Node, backends, tmux, and auth setup
  patina auth status      Show backend availability and authentication status
  patina auth login       Print per-backend authentication instructions
  patina auth login <backend> [--yes]
                         Launch a backend login flow after confirmation

MODES
  --diff                  Show changes pattern by pattern
  --no-color              Disable ANSI colors in --diff output
  --audit                 Detect patterns only (no rewrite)
  --score                 Output AI-likeness score (0-100)
  --exit-on <n>           With --score, exit 3 when overall score > n
  --ouroboros             Iterative self-improvement loop
  --preview               Rewrite one http(s) URL or local .html file in place on a snapshot
                          of the page (adds one explanation call)
  --ocr                   With --preview (URL/.html): extract text inside page images via an
                          image-capable local CLI (claude/gemini/codex) and include it in
                          detection — one extra backend call per image
  --serve                 With --preview: serve the page at a token URL on 127.0.0.1
                          instead of opening a window (headless/SSH; stops after 10 idle minutes)

OUTPUT & BATCH
  --format <fmt>          Stdout format: markdown (default), text, json
  --quiet                 Suppress patina status/warning logs on stderr
  --batch                 Process multiple files
  --in-place              Overwrite original files (requires --batch)
  --suffix <ext>          Save as {name}{ext}{extname} (requires --batch)
  --outdir <dir>          Save results to directory (requires --batch)
  --max-failures <n>      Stop batch after n failed files
  --max-failure-rate <r>  Stop batch when failure ratio exceeds r (0.25 or 25)
  --no-stop-on-retryable-storm
                          Keep going through repeated 429/timeout/temporary-exit
                          storms (storm stopping is on by default in batch mode)
  --no-interactive        Do not wait for TTY stdin; exit 2 when no input is given

LANGUAGE & PROFILE
  --lang <code>           Language: ko, en, zh, ja (default: ko)
  --profile <name>        Profile: default, blog, academic, technical, formal,
                          social, email, legal, medical, marketing,
                          narrative, instructional, casual-conversation,
                          code-comment, commit-message, release-notes, namuwiki
  --tone <name[,name]>    Tone: casual, professional, academic, narrative,
                          marketing, instructional, auto. Resolution:
                          --tone > config tone > config profile.
                          Comma list with --preview compares tones as variants
  --voice-sample <path>   Use 1-3 user paragraphs as style-only voice anchors
  --restyle <depth[,depth]>
                          Transformation depth (rewrite/--preview only):
                          sentence (default) = AI-pattern cleanup,
                          voice = rewrite everything in the target voice/register,
                          content = content-level re-planning (MPS becomes advisory).
                          Comma list with --preview compares variants in-page (max 4 combos)
  --jargon <policy[,policy]>
                          Technical-term policy (rewrite/--preview only):
                          keep (default), explain = add plain-language glosses,
                          remove = replace jargon for a general audience.
                          Comma list with --preview compares variants in-page

MODEL & AUTH
  --model <id>            Single model ID. Defaults use the strongest
                          documented model per backend: openai/codex gpt-5.5,
                          claude-sonnet-4-6, gemini-2.5-pro,
                          kimi-code/kimi-for-coding.
  --api-key-file <path>   Read API key from file (recommended)
  --base-url <url>        API base URL (or PATINA_API_BASE env)
  --backend <name[,name]> Backend or explicit fallback chain:
                          ${backendChoices} (default: openai-http)
  --list-backends         List backends, selectors, default models, and auth status
  --timeout-ms <n>        Per-request/backend timeout in milliseconds
  --max-concurrency <n>   Cross-process backend cap (safe defaults per backend)
  --max-retries <n>       Retry budget per backend (local CLIs default to 0)
  --provider <name>       Provider preset: openai, gemini, groq, kimi, moonshot, together
ADVANCED
  --config <path>         Load config from <path> instead of .patina.default.yaml
  --allow-insecure-base-url  Permit plaintext http:// to non-localhost endpoints
  --allow-private-base-url   Permit private/IMDS base URLs
  -h, --help              Show this help message
  -v, --version           Show version

EXAMPLES
  echo "This is a draft." | patina --lang en --backend codex-cli
  patina --score --exit-on 30 --format json draft.md
  patina doctor --json

ENVIRONMENT
  PATINA_API_KEY, PATINA_API_KEY_FILE, PATINA_API_BASE, PATINA_MODEL
  OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY,
  KIMI_API_KEY, MOONSHOT_API_KEY

EXIT CODES
  0 success · 1 runtime/backend · 2 input/usage · 3 score gate exceeded · 130 interrupted

If no API key is set, pass --backend codex-cli to use a logged-in codex CLI
(no key required). Auto-fallback was removed in v3.9 to keep agent-mode
backends opt-in (issue #88).
`);
}
