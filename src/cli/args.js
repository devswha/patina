import { listBackendNames } from '../backends/index.js';
import { DEFAULT_BEST_MODELS } from '../model-defaults.js';
import { inputError } from '../errors.js';
import { basename } from 'node:path';

// Options that consume the next token as their value. Drives --name=value
// expansion and the --suffix flag-collision backstop (#440).
const VALUE_OPTIONS = new Set([
  '--lang', '--document-type', '--register', '--persona', '--jargon', '--format', '--exit-on',
  '--profile', '--tone', '--formality',
  '--suffix', '--outdir', '--model', '--api-key-file', '--base-url',
  '--backend', '--timeout-ms', '--max-concurrency', '--max-retries',
  '--max-failures', '--max-failure-rate', '--provider', '--config', '--config-snapshot',
]);

// Boolean switches. Used to reject `--quiet=1`-style values explicitly and to
// catch a flag name swallowed as another option's value.
const FLAG_OPTIONS = new Set([
  '--help', '-h', '--version', '-v',
  '--diff', '--no-color', '--audit', '--score', '--offline', '--quiet',
  '--batch', '--in-place', '--allow-private-base-url',
  '--stop-on-retryable-storm', '--no-stop-on-retryable-storm',
  '--list-backends', '--allow-insecure-base-url', '--no-interactive',
  '--rewrite-headings', '--verify',
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
      case '--document-type':
        parsed.documentType = readOptionValue(args, i, arg);
        i++;
        break;
      case '--profile':
        throw inputError(
          '--profile was removed in v7',
          'Document classification is now the document-type axis.',
          'Use --document-type <name>.'
        );
      case '--tone':
      case '--formality':
        throw inputError(
          `${arg} was removed in v7`,
          'The casual/professional axis is now named register.',
          'Use --register casual|professional.'
        );
      case '--register': {
        const value = readOptionValue(args, i, arg);
        i++;
        parsed.register = parseTransformValue(
          value,
          arg,
          ['casual', 'professional'],
          'Omit --register to preserve the source register.'
        );
        break;
      }
      case '--persona':
        parsed.persona = readOptionValue(args, i, arg);
        i++;
        break;
      case '--jargon': {
        const value = readOptionValue(args, i, arg);
        i++;
        parsed.jargon = parseTransformValue(value, arg, ['keep', 'explain', 'remove'],
          'keep = copy Latin-letter tech/API/task/exam names as-is (default), explain = keep those terms and add a first-mention gloss, remove = replace jargon for a general audience.');
        break;
      }
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
      case '--offline':
        parsed.offline = true;
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
      case '--verify':
        parsed.verify = true;
        break;
      case '--batch':
        parsed.batch = true;
        break;
      case '--in-place':
        parsed.inPlace = true;
        break;
      case '--rewrite-headings':
        // #473: by default rewrite preserves Markdown ATX heading lines as
        // structure; this opts back into rewording/adding/removing them.
        parsed.rewriteHeadings = true;
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
      case '--config-snapshot':
        parsed.configSnapshot = readOptionValue(args, i, arg);
        if (!parsed.configSnapshot.trim()) {
          throw inputError('--config-snapshot requires a non-empty path',
            'The internal snapshot option must name a captured configuration file.',
            'Use --config for ordinary config overrides.');
        }
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

  if (parsed.configSnapshot !== undefined && parsed.config !== undefined) {
    throw inputError(
      '--config-snapshot and --config cannot be combined',
      'An execution snapshot must not be merged with other config files.',
      'Use --config for ordinary overlays, or only --config-snapshot for a captured configuration.'
    );
  }
  return parsed;
}

// The output modes are mutually exclusive (SKILL.md). Without this guard, a
// combination like `--audit --score` resolves to 'audit' and silently skips the
// score gate (exit 0 always).
export function validateModeExclusivity(parsed) {
  const active = ['diff', 'audit', 'score'].filter((m) => parsed[m]);
  if (active.length > 1) {
    throw inputError(
      `--${active[0]} and --${active[1]} cannot be combined`,
      'The diff / audit / score output modes are mutually exclusive.',
      `Pick one of --diff, --audit, or --score.`
    );
  }
}

export function validateOfflineScoreRequest(parsed) {
  if (!parsed.offline) return;
  if (!parsed.score) {
    throw inputError(
      '--offline requires --score',
      'Offline mode runs only the deterministic scoring layer; it is not a rewrite, audit, or diff backend.',
      'Run `patina --score --offline <file>`.',
    );
  }
  if (parsed.stopOnRetryableStorm !== undefined) {
    const flag = parsed.stopOnRetryableStorm
      ? '--stop-on-retryable-storm'
      : '--no-stop-on-retryable-storm';
    throw inputError(
      `${flag} cannot be combined with --offline`,
      '--offline performs no backend calls, so retry-storm controls cannot affect the run.',
      `Drop ${flag}, or drop --offline to use LLM-backed scoring.`,
    );
  }
  const backendOptions = [
    ['backend', '--backend'],
    ['provider', '--provider'],
    ['model', '--model'],
    ['apiKeyFile', '--api-key-file'],
    ['baseURL', '--base-url'],
    ['timeoutMs', '--timeout-ms'],
    ['maxConcurrency', '--max-concurrency'],
    ['maxRetries', '--max-retries'],
    ['allowInsecureBaseURL', '--allow-insecure-base-url'],
    ['allowPrivateBaseURL', '--allow-private-base-url'],
    ['listBackends', '--list-backends'],
  ];
  for (const [key, flag] of backendOptions) {
    if (parsed[key] !== undefined && parsed[key] !== false) {
      throw inputError(
        `${flag} cannot be combined with --offline`,
        '--offline performs no backend call, so backend, model, credential, and request options do not apply.',
        `Drop ${flag}, or drop --offline to use LLM-backed scoring.`,
      );
    }
  }
}

// Shared parser for --jargon/--register: exactly one value from the allowed set.
const TRANSFORM_OPTION_NOUNS = { '--jargon': 'jargon policy', '--register': 'register' };

function parseTransformValue(value, option, valid, hint) {
  const token = String(value ?? '').trim();
  if (token.length === 0) {
    throw inputError(`${option} expects a value`, `Valid values are: ${valid.join(', ')}.`, hint);
  }
  if (token.includes(',')) {
    throw inputError(
      `${option} takes one value`,
      `Received "${token}"; comma-separated lists are not supported.`,
      `Pick one of: ${valid.join(', ')}.`
    );
  }
  if (!valid.includes(token)) {
    throw inputError(
      `unknown ${TRANSFORM_OPTION_NOUNS[option] ?? 'value'} ${token}`,
      `Valid values are: ${valid.join(', ')}.`,
      hint
    );
  }
  return token;
}

// --jargon and --register alter rewritten prose. Score/audit/diff inspect the
// source as-is, so reject these controls instead of silently ignoring them.
export function validateTransformRequest(parsed) {
  const jargonActive = Boolean(parsed.jargon) && parsed.jargon !== 'keep';
  const registerActive = Boolean(parsed.register);
  if (!jargonActive && !registerActive) return;
  const flag = jargonActive && registerActive
    ? '--jargon/--register'
    : jargonActive ? '--jargon' : '--register';
  const blocked = [
    ['score', '--score', 'does not rewrite text'],
    ['audit', '--audit', 'does not rewrite text'],
    ['diff', '--diff', 'documents pattern-based edits, not free transformations'],
  ];
  for (const [key, name, why] of blocked) {
    if (parsed[key]) {
      throw inputError(
        `${flag} cannot be combined with ${name}`,
        `${flag} changes how text is rewritten; ${name} ${why}.`,
        `Run a plain rewrite instead, e.g. \`patina ${flag} <value> draft.md\`.`
      );
    }
  }
}

export function validatePersonaRequest(parsed) {
  if (!parsed.persona) return;
  const persona = '--persona';
  const blockedModes = [
    ['score', '--score', 'score reads text as-is and does not run the rewrite persona harness'],
    ['audit', '--audit', 'audit reports detections on the original text'],
    ['diff', '--diff', 'diff is a pattern-report surface, not the persona rewrite harness'],
  ];
  for (const [key, flag, why] of blockedModes) {
    if (parsed[key]) {
      throw inputError(
        `${persona} cannot be combined with ${flag}`,
        `${flag} ${why}. A persona applies to rewrite mode only.`,
        'Run a rewrite, e.g. `patina --persona natural-ko draft.md`, or drop --persona.'
      );
    }
  }
}

// --verify folds the meaning-floor check into rewrite mode (score MPS/fidelity,
// one conservative retry, fail-closed). It is a rewrite modifier, not a mode, so
// it is rejected alongside non-rewrite modes and the meaning-loosening depths.
export function validateVerifyRequest(parsed) {
  if (!parsed.verify) return;
  const blocked = [
    ['score', '--score'],
    ['audit', '--audit'],
    ['diff', '--diff'],
  ];
  for (const [key, flag] of blocked) {
    if (parsed[key]) {
      throw inputError(
        `--verify cannot be combined with ${flag}`,
        '--verify is a rewrite-mode meaning check; it does not apply to non-rewrite modes.',
        'Run `patina --verify <file>` for a verified rewrite, or drop --verify.'
      );
    }
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

// Subcommand parsers (persona, pack): consume the value after a value-taking
// flag, returning [value, nextIndex]. A missing value or a following flag is an
// input error, not a silent `undefined`.
export function takeValue(args, i, flag) {
  const v = args[i + 1];
  if (v === undefined || v.startsWith('-')) {
    throw inputError(`${flag} requires a value`, `Missing value after ${flag}.`, `Pass ${flag} <value>.`);
  }
  return [v, i + 1];
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
  const models = DEFAULT_BEST_MODELS;
  console.log(`patina — AI text humanizer CLI

Usage: patina [command] [options] [file...]

COMMANDS
  patina inspect [file]   Offline JSON score and source-aligned editing diagnostics
  patina doctor [--json]  Check Node, backends, and auth setup
  patina auth status      Show backend availability and authentication status
  patina auth login       Print per-backend authentication instructions
  patina auth login <backend> [--yes]
                         Launch a backend login flow after confirmation
  patina persona new <id>  Author a reusable custom voice persona (from a writing
                          sample, a description, or a blank template)
  patina persona list      List built-in and custom personas per language
  patina persona show <id> Print normalized Persona voice metadata
  patina persona edit <id> Copy-on-edit a Persona into custom/personas/
  patina persona rm <id>   Remove a custom Persona (built-ins are protected)
  patina pack list         List licensed pro packs (needs PATINA_LICENSE_KEY)
  patina pack install <id> Install a pro pack into custom/

MODES
  --diff                  Show changes pattern by pattern
  --no-color              Disable ANSI colors in --diff output
  --audit                 Detect patterns only (no rewrite)
  --score                 Output AI-likeness score (0-100)
  --exit-on <n>           With --score, exit 3 when overall score > n
  --offline               With --score, skip all backends and report deterministic
                          signals only; LLM-judged categories are unavailable
  --verify                Rewrite, then verify global meaning/fidelity floors with
                          one conservative retry; exit 4 if no candidate passes

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

DOCUMENT & VOICE
  --lang <code>           Language: ko, en, zh, ja (default: ko)
  --document-type <name>  Document policy: default, blog, academic, technical,
                          formal, resume, personal-statement, project-writeup,
                          social, email, legal, medical, marketing,
                          narrative, instructional, casual-conversation,
                          code-comment, commit-message, release-notes, namuwiki
  --persona <name>        Optional reusable voice for rewrite. Omit it to
                          preserve the source voice. Incompatible with
                          score/audit/diff
  --register <name>       Explicit casual or professional register. Omit it
                          to preserve the source register.
  --jargon <policy>       Technical-term policy (rewrite only):
                          keep (default) = copy Latin-letter tech/API/task
                          names as-is, explain = keep English + first-mention
                          gloss, remove = replace jargon for a general audience
  --rewrite-headings      Allow rewording/adding/removing Markdown headings.
                          By default ATX heading lines (## ...) are preserved
                          verbatim as structure so the TOC and #anchors survive

MODEL & AUTH
  --model <id>            Single model ID. Defaults use the strongest
                          documented model per backend: openai/codex ${models.codexCli},
                          ${models.claudeCli}, ${models.geminiCli},
                          ${models.kimiCli}, agy ${models.agyCli}.
  --api-key-file <path>   Read API key from file (recommended)
  --base-url <url>        API base URL (or PATINA_API_BASE env)
  --backend <name[,name]> Backend or explicit fallback chain:
                          ${backendChoices} (default: openai-http)
  --list-backends         List backends, selectors, default models, and auth status
  --timeout-ms <n>        Per-request/backend timeout in milliseconds
  --max-concurrency <n>   Cross-process backend cap (safe defaults per backend)
  --max-retries <n>       Retry budget per backend (local CLIs default to 0)
  --provider <name>       Provider preset: openai, gemini, groq, kimi, moonshot, together,
                          minimax, minimax-cn
ADVANCED
  --config <path>         Layer explicit config after defaults and .patina.yaml
  --allow-insecure-base-url  Permit plaintext http:// to non-localhost endpoints
  --allow-private-base-url   Permit private/IMDS base URLs
  -h, --help              Show this help message
  -v, --version           Show version

EXAMPLES
  echo "This is a draft." | patina --lang en --backend codex-cli
  patina --score --exit-on 30 --format json draft.md
  patina --score --offline --exit-on 30 --format json draft.md
  patina doctor --json

ENVIRONMENT
  PATINA_API_KEY, PATINA_API_KEY_FILE, PATINA_API_BASE, PATINA_MODEL
  OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY,
  KIMI_API_KEY, MOONSHOT_API_KEY, MINIMAX_API_KEY

EXIT CODES
  0 success · 1 runtime/backend · 2 input/usage · 3 score gate exceeded · 4 verify floor / dropped number · 130 interrupted

LLM-backed modes require an API key or a logged-in local CLI backend. Use
--score --offline for deterministic scoring with no backend call.
`);
}
