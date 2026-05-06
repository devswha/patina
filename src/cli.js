import { loadConfig, getRepoRoot, resolveTone } from './config.js';
import { loadPatterns, loadProfile, loadCoreFile, loadInputText, toneToBackboneProfile } from './loader.js';
import { buildPrompt } from './prompt-builder.js';
import { selectBackend, listBackends } from './backends/index.js';
import { selectProvider, resolveProviderConfig, PROVIDERS } from './providers.js';
import { validateBaseURL, applyInsecureBaseURLOptIn, applyPrivateBaseURLOptIn } from './security.js';
import { formatOutput, validateScoreWeights } from './output.js';
import { runMaxMode } from './max-mode.js';
import { runOuroboros } from './ouroboros.js';
import { buildManifest, appendResult, writeManifest } from './manifest.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';

const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(getRepoRoot(), 'package.json'), 'utf8')
).version;

export async function main(args) {
  if (args[0] === 'auth') {
    return handleAuth(args.slice(1));
  }

  const parsed = parseArgs(args);

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.version) {
    console.log(`patina ${PACKAGE_VERSION}`);
    return;
  }

  if (parsed.listBackends) {
    printBackendStatus();
    return;
  }

  if (parsed.listProviders) {
    printProviderStatus();
    return;
  }

  const provider = selectProvider(parsed.provider);
  const apiKey = resolveApiKey(parsed);
  const resolved = resolveProviderConfig({
    provider,
    apiKey,
    baseURL: parsed.baseURL,
    model: parsed.model,
  });
  applyInsecureBaseURLOptIn(parsed);
  applyPrivateBaseURLOptIn(parsed);
  validateBaseURL(resolved.baseURL);

  const configPath = parsed.config ? resolve(process.cwd(), parsed.config) : undefined;
  const config = loadConfig(configPath);
  const startedAt = new Date().toISOString();
  const manifestResults = [];
  const manifestOutputs = [];

  if (parsed.lang) config.language = parsed.lang;
  if (parsed.profile) config.profile = parsed.profile;

  const repoRoot = getRepoRoot();
  const lang = config.language || 'ko';

  // Tone resolution (v3.10): CLI --tone > config tone > null.
  // null + config.profile → profile-only mode (regression-safe; v3.9 behavior).
  // zh/ja + explicit tone → unsupported_language_fallback (warn + profile-only path).
  const toneResolution = resolveTone({ cliTone: parsed.tone, configTone: config.tone, lang });
  if (toneResolution.warning) {
    console.error(`[patina] ${toneResolution.warning}`);
  }

  // Backbone profile mapping: explicit user tone (not auto, not fallback) maps to a
  // backbone profile. CLI --profile still wins on conflict (per Phase 1 spec — backbone
  // is applied "after --profile override"). Only auto-map when user didn't specify --profile.
  let profileName = config.profile || 'default';
  if (
    !parsed.profile &&
    toneResolution.tone_source === 'user' &&
    toneResolution.tone &&
    toneResolution.tone !== 'auto'
  ) {
    const backbone = toneToBackboneProfile(toneResolution.tone);
    if (backbone) profileName = backbone;
  }

  const patterns = loadPatterns(repoRoot, lang, config['skip-patterns'] || []);
  const profile = loadProfile(repoRoot, profileName);
  const voice = loadCoreFile(repoRoot, 'voice.md');
  const scoring = loadCoreFile(repoRoot, 'scoring.md');

  const mode = parsed.diff ? 'diff'
    : parsed.audit ? 'audit'
    : parsed.score ? 'score'
    : parsed.ouroboros ? 'ouroboros'
    : 'rewrite';

  const inputTexts = await loadInputs(parsed);

  for (const { path, text } of inputTexts) {
    const prompt = buildPrompt({
      config,
      patterns,
      profile: profile.body ? profile : null,
      voice: voice.body ? voice : null,
      scoring: scoring.body ? scoring : null,
      text,
      mode,
      tone: toneResolution,
      promptMode: resolvePromptMode(
        parsed.promptMode || config['prompt-mode'] || 'strict',
        { backend: parsed.backend, model: resolved.model }
      ),
    });

    let result;

    if (parsed.models) {
      result = await runMaxMode({
        prompt,
        sourceText: text,
        models: parsed.models,
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
        config,
        patterns,
        maxConcurrency: parsed.maxConcurrency,
      });
    } else if (parsed.ouroboros) {
      result = await runOuroboros({
        config,
        patterns,
        profile: profile.body ? profile : null,
        voice: voice.body ? voice : null,
        scoring: scoring.body ? scoring : null,
        text,
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
        model: resolved.model,
      });
    } else {
      const { backend, autoSelected, reason } = selectBackend({
        name: parsed.backend,
        model: resolved.model,
      });

      if (autoSelected) {
        console.error(`[patina] Using ${backend.name} backend (${reason}). Run \`patina auth status\` for details.`);
      }

      if (backend.name === 'openai-http' && !resolved.apiKey) {
        const msg = ['No API key found. Set PATINA_API_KEY or pass --api-key.'];
        if (provider) {
          msg.push(`(--provider ${provider.name} expects ${provider.apiKeyEnv} or PATINA_API_KEY.)`);
        }
        const codex = listBackends().find((b) => b.name === 'codex-cli');
        if (codex && codex.available && codex.authenticated) {
          msg.push('Or pass `--backend codex-cli` to use the codex-cli backend (no key needed).');
        } else if (codex && codex.available && !codex.authenticated) {
          msg.push('Or run `codex login`, then pass `--backend codex-cli`.');
        } else if (codex && !codex.available) {
          msg.push('Or install `codex` from https://github.com/openai/codex and pass `--backend codex-cli`.');
        }
        throw new Error(msg.join('\n'));
      }

      result = await backend.invoke({
        prompt,
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
        model: resolved.model,
      });
    }

    let output;
    if (parsed.ouroboros) {
      const ouroborosBody = formatOuroborosOutput(result);
      output = formatOutput(ouroborosBody, mode, parsed, { tone: toneResolution });
    } else {
      output = formatOutput(result, mode, parsed, { tone: toneResolution });
    }

    // v3.11 Phase 1.3: surface weight drift between config and the score
    // table the model emitted. Warnings only — does not alter the output.
    if (mode === 'score') {
      const configWeights = config.ouroboros?.['category-weights']?.[lang] || {};
      const warnings = validateScoreWeights(output, configWeights);
      for (const w of warnings) {
        console.error(`[patina] ${w}`);
      }
    }

    if (parsed.saveRun) {
      const idx = manifestResults.length + 1;
      const outputName = `output-${idx}.txt`;
      appendResult(manifestResults, {
        inputPath: path,
        prompt,
        outputRef: { kind: 'file', name: outputName },
      });
      manifestOutputs.push({ name: outputName, content: output });
    }

    if (parsed.batch) {
      await writeBatchOutput(parsed, path, output);
    } else {
      console.log(output);
    }
  }

  if (parsed.saveRun) {
    const manifest = buildManifest({
      patinaVersion: PACKAGE_VERSION,
      mode,
      lang,
      profile: profileName,
      provider: provider?.name,
      backend: parsed.backend ?? 'openai-http',
      model: resolved.model,
      configPath: configPath ?? null,
      config,
      patterns,
      results: manifestResults,
      startedAt,
    });
    const manifestPath = writeManifest(
      resolve(process.cwd(), parsed.saveRun),
      manifest,
      manifestOutputs
    );
    console.error(`[patina] wrote manifest to ${manifestPath}`);
  }
}

function parseArgs(args) {
  const parsed = {
    files: [],
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
        parsed.lang = args[++i];
        break;
      case '--profile':
        parsed.profile = args[++i];
        break;
      case '--tone': {
        const t = args[++i];
        if (t === undefined) {
          throw new Error(`--tone requires a value. Valid tones: casual, professional, academic, narrative, marketing, instructional, auto`);
        }
        const valid = ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional', 'auto'];
        if (!valid.includes(t)) {
          throw new Error(`Unknown tone '${t}'. Valid tones: ${valid.join(', ')}`);
        }
        parsed.tone = t;
        break;
      }
      case '--diff':
        parsed.diff = true;
        break;
      case '--audit':
        parsed.audit = true;
        break;
      case '--score':
        parsed.score = true;
        break;
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
        parsed.suffix = args[++i];
        break;
      case '--outdir':
        parsed.outdir = args[++i];
        break;
      case '--models':
        parsed.models = args[++i].split(',').map((m) => m.trim());
        break;
      case '--max-concurrency': {
        const n = Number(args[++i]);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--max-concurrency expects a non-negative integer, got ${args[i]}`);
        }
        parsed.maxConcurrency = n;
        break;
      }
      case '--model':
        parsed.model = args[++i];
        break;
      case '--api-key':
        parsed.apiKey = args[++i];
        break;
      case '--api-key-file':
        parsed.apiKeyFile = args[++i];
        break;
      case '--allow-private-base-url':
        parsed.allowPrivateBaseURL = true;
        break;
      case '--base-url':
        parsed.baseURL = args[++i];
        break;
      case '--backend':
        parsed.backend = args[++i];
        break;
      case '--list-backends':
        parsed.listBackends = true;
        break;
      case '--provider':
        parsed.provider = args[++i];
        break;
      case '--list-providers':
        parsed.listProviders = true;
        break;
      case '--allow-insecure-base-url':
        parsed.allowInsecureBaseURL = true;
        break;
      case '--config':
        parsed.config = args[++i];
        break;
      case '--save-run':
        parsed.saveRun = args[++i];
        break;
      case '--prompt-mode': {
        const m = args[++i];
        if (!m || !['strict', 'minimal', 'auto'].includes(m)) {
          throw new Error(`--prompt-mode expects 'strict' | 'minimal' | 'auto', got ${m}`);
        }
        parsed.promptMode = m;
        break;
      }
      default:
        if (!arg.startsWith('-')) {
          parsed.files.push(arg);
        }
        break;
    }
  }

  return parsed;
}

// Resolve the API key, preferring file-based sources to keep the secret out
// of argv and shell history (CWE-214). Precedence: --api-key-file >
// PATINA_API_KEY_FILE > --api-key (with deprecation warning) > parsed.apiKey
// passed through to provider config (env var path stays in providers.js).
// v3.11: case-05 found that prompt-mode preference is per-backend.
// auto resolves to strict for codex-cli/claude (instruction-rich) and
// minimal for gemini (voice-rich, over-constrained by long prompts).
// Explicit strict/minimal pass through unchanged.
export function resolvePromptMode(mode, { backend, model }) {
  if (mode !== 'auto') return mode;
  const backendStr = (backend || '').toLowerCase();
  const modelStr = (model || '').toLowerCase();
  if (backendStr.includes('gemini') || modelStr.includes('gemini')) return 'minimal';
  if (modelStr.includes('claude')) return 'strict';
  // Default for codex-cli, openai-http with gpt-* models, and anything we
  // can't classify — strict is the conservative choice (full pattern packs).
  return 'strict';
}

function resolveApiKey(parsed) {
  const filePath = parsed.apiKeyFile || process.env.PATINA_API_KEY_FILE;
  if (filePath) {
    let contents;
    try {
      contents = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read --api-key-file ${filePath}: ${err.message}`);
    }
    const key = contents.replace(/[\r\n]+$/, '').trim();
    if (!key) {
      throw new Error(`API key file ${filePath} is empty`);
    }
    if (parsed.apiKey) {
      console.error('[patina] both --api-key-file and --api-key were provided; using --api-key-file');
    }
    return key;
  }
  if (parsed.apiKey) {
    console.error(
      '[patina] warning: --api-key exposes the secret in shell history and `ps` output.\n' +
      '         Prefer PATINA_API_KEY env var, --api-key-file <path>, or PATINA_API_KEY_FILE.'
    );
    return parsed.apiKey;
  }
  return undefined;
}

async function loadInputs(parsed) {
  if (parsed.files.length === 0) {
    // No file args. If stdin is a TTY (interactive terminal), there is no input
    // to read — print help instead of hanging or sending empty text to the LLM.
    if (process.stdin.isTTY) {
      printHelp();
      console.error('\nNo input provided. Pass a file path, pipe text via stdin, or run `patina --help`.');
      process.exit(2);
    }
    const stdin = await readStdin();
    if (!stdin.trim()) {
      console.error('Error: empty input on stdin. Pipe text via stdin or pass a file path.');
      process.exit(2);
    }
    return [{ path: '-', text: stdin }];
  }

  const inputs = [];
  for (const file of parsed.files) {
    const text = loadInputText(file);
    inputs.push({ path: file, text });
  }
  return inputs;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);
  });
}

async function writeBatchOutput(parsed, inputPath, output) {
  if (inputPath === '-') {
    console.log(output);
    return;
  }

  let outPath;
  if (parsed.inPlace) {
    outPath = inputPath;
  } else if (parsed.suffix) {
    const ext = extname(inputPath);
    const base = basename(inputPath, ext);
    const dir = inputPath.slice(0, -basename(inputPath).length);
    outPath = resolve(dir, `${base}${parsed.suffix}${ext}`);
  } else if (parsed.outdir) {
    mkdirSync(parsed.outdir, { recursive: true });
    outPath = resolve(parsed.outdir, basename(inputPath));
  } else {
    console.log(output);
    return;
  }

  writeFileSync(outPath, output, 'utf8');
  console.log(`Written: ${outPath}`);
}

function formatOuroborosOutput(result) {
  let output = '## Ouroboros Iteration Log\n\n';
  output += '| Iter | Before | After | Improvement | Reason |\n';
  output += '|------|--------|-------|-------------|--------|\n';

  for (const entry of result.log) {
    output += `| ${entry.iteration} | ${entry.before ?? '—'} | ${entry.after} | ${entry.improvement ?? '—'} | ${entry.reason} |\n`;
  }

  output += `\nFinal score: ${result.finalScore}/100 (±10)\n`;
  output += `Iterations: ${result.iterations}/${result.log.length > 0 ? result.log[result.log.length - 1].iteration : 0}\n`;
  output += `Reason: ${result.reason}\n\n`;
  output += '## Final Text\n\n';
  output += result.finalText.trim();
  output += '\n';

  return output;
}

function printHelp() {
  console.log(`patina — AI text humanizer CLI

Usage: patina [options] [file...]

Options:
  -h, --help           Show this help message
  -v, --version        Show version
  --lang <code>        Language: ko, en, zh, ja (default: ko)
  --profile <name>     Profile: default, blog, academic, technical, formal,
                       social, email, legal, medical, marketing,
                       narrative, instructional
  --tone <name>        Tone category: casual, professional, academic,
                       narrative, marketing, instructional, auto.
                       Resolution: --tone > config tone > config profile.
                       zh/ja with explicit tone → warns + profile-only fallback.
  --diff               Show changes pattern by pattern
  --audit              Detect patterns only (no rewrite)
  --score              Output AI-likeness score (0-100)
  --ouroboros          Iterative self-improvement loop
  --batch              Process multiple files
  --in-place           Overwrite original files (with --batch)
  --suffix <ext>       Save as {name}{ext}{extname}
  --outdir <dir>       Save results to directory
  --models <list>      MAX mode: comma-separated model list
  --max-concurrency <n>  Cap parallel MAX-mode requests (default: unlimited)
  --model <id>         Single model ID (default: gpt-4o)
  --api-key <key>      API key (DEPRECATED: leaks via ps/shell history; prefer
                       PATINA_API_KEY env or --api-key-file)
  --api-key-file <path>  Read API key from file (recommended for shared hosts)
  --base-url <url>     API base URL (or PATINA_API_BASE env)
  --backend <name>     Backend: openai-http (default), codex-cli (no API key)
  --list-backends      List available backends and their availability
  --provider <name>    Provider preset: openai, gemini, groq, together
                       (sets base-url + default model + reads <PROVIDER>_API_KEY)
  --list-providers     List provider presets and which keys are set
  --allow-insecure-base-url  Permit plaintext http:// to non-localhost endpoints
                       (also enabled by PATINA_ALLOW_INSECURE_BASE_URL=1)
  --config <path>      Load config from <path> instead of .patina.default.yaml
  --save-run <dir>     Write manifest.json + output-N.txt under <dir> after the
                       run (records version, prompt/config hashes, patterns,
                       provider/model — useful for reproducibility / audit)
  --prompt-mode <m>    Rewrite prompt mode: strict | minimal | auto.
                       strict (default): full pattern packs (~34KB).
                       minimal: compressed watch-words + casual instruction (~3KB).
                       auto: pick by backend — gemini → minimal, others → strict.
                       case-05 finding: minimal helps Gemini, hurts Claude,
                       neutral for Codex. Only affects --rewrite mode.
  --allow-private-base-url   Permit base URL pointing at private/IMDS IPs
                       (also enabled by PATINA_ALLOW_PRIVATE_BASE_URL=1).
                       Default: refuse to send the API key to RFC 1918 / link-local
                       hosts to block SSRF to cloud metadata endpoints.

Environment Variables:
  PATINA_API_KEY       API authentication key (any provider)
  PATINA_API_KEY_FILE  Path to file containing the API key (alt to PATINA_API_KEY)
  PATINA_API_BASE      API base URL (default: https://api.openai.com/v1)
  PATINA_MODEL         Default model ID
  PATINA_ALLOW_INSECURE_BASE_URL  Set to 1 to permit plain HTTP to non-loopback
  PATINA_ALLOW_PRIVATE_BASE_URL   Set to 1 to permit private/IMDS base URLs
  GEMINI_API_KEY       Used when --provider gemini
  GROQ_API_KEY         Used when --provider groq
  TOGETHER_API_KEY     Used when --provider together
  OPENAI_API_KEY       Used when --provider openai (alternative to PATINA_API_KEY)

Subcommands:
  patina auth status   Show backend availability and authentication status
  patina auth login    Print per-backend instructions for authenticating

If no API key is set, pass --backend codex-cli to use a logged-in codex CLI
(no key required). Auto-fallback was removed in v3.9 to keep agent-mode
backends opt-in (issue #88).
`);
}

function printBackendStatus() {
  const list = listBackends();
  const rows = list.map((b) => ({
    name: b.name,
    available: b.available ? 'yes' : 'no',
    authenticated: b.authenticated ? 'yes' : 'no',
    note: b.authenticated ? '' : b.authHint,
  }));
  const widths = {
    name: Math.max('Backend'.length, ...rows.map((r) => r.name.length)),
    available: Math.max('Available'.length, ...rows.map((r) => r.available.length)),
    authenticated: Math.max('Authenticated'.length, ...rows.map((r) => r.authenticated.length)),
  };
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('Backend', widths.name)}  ${pad('Available', widths.available)}  ${pad('Authenticated', widths.authenticated)}  Notes`
  );
  console.log(
    `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.available)}  ${'-'.repeat(widths.authenticated)}  -----`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.available, widths.available)}  ${pad(r.authenticated, widths.authenticated)}  ${r.note}`
    );
  }
}

function printProviderStatus() {
  const rows = Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    free: p.freeTier ? 'yes' : 'no',
    keySet: process.env[p.apiKeyEnv] ? 'yes' : 'no',
    note: `${p.apiKeyEnv} → ${p.baseURL}`,
  }));
  const widths = {
    name: Math.max('Provider'.length, ...rows.map((r) => r.name.length)),
    free: Math.max('Free tier'.length, ...rows.map((r) => r.free.length)),
    keySet: Math.max('Key set'.length, ...rows.map((r) => r.keySet.length)),
  };
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  console.log(
    `${pad('Provider', widths.name)}  ${pad('Free tier', widths.free)}  ${pad('Key set', widths.keySet)}  Notes`
  );
  console.log(
    `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.free)}  ${'-'.repeat(widths.keySet)}  -----`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, widths.name)}  ${pad(r.free, widths.free)}  ${pad(r.keySet, widths.keySet)}  ${r.note}`
    );
  }
}

function handleAuth(subArgs) {
  const sub = subArgs[0] || 'status';
  if (sub === 'status') {
    printBackendStatus();
    return;
  }
  if (sub === 'login') {
    console.log('To authenticate a backend, follow the per-backend instructions:\n');
    for (const b of listBackends()) {
      const status = b.authenticated ? '✓ already authenticated' : '✗ not authenticated';
      console.log(`  ${b.name}: ${status}`);
      if (!b.authenticated) console.log(`    → ${b.authHint}`);
    }
    return;
  }
  console.error(`Unknown auth subcommand: ${sub}. Try \`patina auth status\` or \`patina auth login\`.`);
  process.exit(1);
}
