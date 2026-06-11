import { listBackendNames } from '../backends/index.js';
import { inputError } from '../errors.js';

export function parseArgs(args) {
  const parsed = {
    files: [],
    format: 'markdown',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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
        const valid = ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'];
        if (!valid.includes(t)) {
          throw inputError(
            `unknown tone ${t}`,
            `Valid tones are: ${valid.join(', ')}.`,
            'Use `--tone auto` to let patina infer tone from the text.'
          );
        }
        parsed.tone = t;
        break;
      }
      case '--voice-sample':
        parsed.voiceSample = readOptionValue(args, i, arg);
        i++;
        break;
      case '--browser':
        parsed.browser = true;
        break;
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
        const n = Number(value);
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
      case '--suffix':
        parsed.suffix = readOptionValue(args, i, arg, { allowFlagLike: true });
        i++;
        break;
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
      'Run `patina --preview https://example.com/article` or `patina --preview draft.md`.'
    );
  }
  const input = String(parsed.files[0] || '');
  if (!/^https?:\/\//i.test(input) && !/\.(html?|md|markdown|txt)$/i.test(input)) {
    throw inputError(
      '--preview supports http(s) URLs, .html, .md, and .txt input',
      `"${input}" has an unsupported extension for in-place preview.`,
      'Convert the file to HTML/markdown/plain text, or run plain `patina <file>` for a rewrite without the preview page.'
    );
  }
}

// --browser is mapped onto --preview before validation (deprecated alias),
// so --serve is the only flag left that needs its own guard.
export function validateServeRequest(parsed) {
  if (parsed.serve && !parsed.preview) {
    throw inputError(
      '--serve requires --preview',
      '--serve replaces the local window opener for the generated page.',
      'Run `patina --preview --serve <url-or-file>`.'
    );
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

function parsePositiveIntegerOption(value, option) {
  const n = Number(value);
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
  const n = Number(value);
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
  const n = Number(value);
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
  --preview               Rewrite one http(s) URL in place on a snapshot of the page, or one
                          local file as an in-place reading document (adds one explanation call)
  --browser               Deprecated alias for --preview (removed in 5.0)
  --ocr                   With --preview (URL/.html): extract text inside page images via an
                          image-capable local CLI (claude/gemini/codex) and include it in
                          detection — one extra backend call per image
  --serve                 With --preview: serve the page at a token URL on 127.0.0.1
                          instead of opening a window (headless/SSH; stops after 10 idle minutes)

OUTPUT & BATCH
  --format <fmt>          Stdout format: markdown (default), text, json
  --quiet                 Suppress patina status/warning logs on stderr
  --batch                 Process multiple files
  --in-place              Overwrite original files (with --batch)
  --suffix <ext>          Save as {name}{ext}{extname}
  --outdir <dir>          Save results to directory
  --max-failures <n>      Stop batch after n failed files
  --max-failure-rate <r>  Stop batch when failure ratio exceeds r (0.25 or 25)
  --stop-on-retryable-storm
                          Stop batch after repeated 429/timeouts/empty local-CLI exits
  --no-interactive        Do not wait for TTY stdin; exit 2 when no input is given

LANGUAGE & PROFILE
  --lang <code>           Language: ko, en, zh, ja (default: ko)
  --profile <name>        Profile: default, blog, academic, technical, formal,
                          social, email, legal, medical, marketing,
                          narrative, instructional, casual-conversation,
                          code-comment, commit-message, release-notes, namuwiki
  --tone <name>           Tone: casual, professional, academic, narrative,
                          marketing, instructional, auto. Resolution:
                          --tone > config tone > config profile.
  --voice-sample <path>   Use 1-3 user paragraphs as style-only voice anchors

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
