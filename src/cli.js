import { loadConfig, getRepoRoot } from './config.js';
import { loadPatterns, loadProfile, loadCoreFile, loadInputText } from './loader.js';
import { buildPrompt } from './prompt-builder.js';
import { callLLM, callLLMMultiple } from './api.js';
import { formatOutput } from './output.js';
import { runMaxMode } from './max-mode.js';
import { runOuroboros } from './ouroboros.js';
import { writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';

export async function main(args) {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.version) {
    console.log('patina 3.3.0');
    return;
  }

  const config = loadConfig();

  if (parsed.lang) config.language = parsed.lang;
  if (parsed.profile) config.profile = parsed.profile;

  const repoRoot = getRepoRoot();
  const lang = config.language || 'ko';
  const profileName = config.profile || 'default';

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
    });

    let result;

    if (parsed.models) {
      result = await runMaxMode({
        prompt,
        models: parsed.models,
        apiKey: parsed.apiKey || process.env.PATINA_API_KEY,
        baseURL: parsed.baseURL || process.env.PATINA_API_BASE || 'https://api.openai.com/v1',
        config,
        patterns,
      });
    } else if (parsed.ouroboros) {
      const model = parsed.model || process.env.PATINA_MODEL || 'gpt-4o';
      result = await runOuroboros({
        config,
        patterns,
        profile: profile.body ? profile : null,
        voice: voice.body ? voice : null,
        scoring: scoring.body ? scoring : null,
        text,
        apiKey: parsed.apiKey || process.env.PATINA_API_KEY,
        baseURL: parsed.baseURL || process.env.PATINA_API_BASE || 'https://api.openai.com/v1',
        model,
      });
    } else {
      const model = parsed.model || process.env.PATINA_MODEL || 'gpt-4o';
      result = await callLLM({
        prompt,
        apiKey: parsed.apiKey || process.env.PATINA_API_KEY,
        baseURL: parsed.baseURL || process.env.PATINA_API_BASE || 'https://api.openai.com/v1',
        model,
      });
    }

    let output;
    if (parsed.ouroboros) {
      output = formatOuroborosOutput(result);
    } else {
      output = formatOutput(result, mode, parsed);
    }

    if (parsed.batch) {
      await writeBatchOutput(parsed, path, output);
    } else {
      console.log(output);
    }
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
      case '--model':
        parsed.model = args[++i];
        break;
      case '--api-key':
        parsed.apiKey = args[++i];
        break;
      case '--base-url':
        parsed.baseURL = args[++i];
        break;
      case '--dispatch':
        parsed.dispatch = args[++i];
        break;
      default:
        if (!arg.startsWith('-')) {
          parsed.files.push(arg);
        }
        break;
    }
  }

  return parsed;
}

async function loadInputs(parsed) {
  if (parsed.files.length === 0) {
    const stdin = await readStdin();
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
                       social, email, legal, medical, marketing
  --diff               Show changes pattern by pattern
  --audit              Detect patterns only (no rewrite)
  --score              Output AI-likeness score (0-100)
  --ouroboros          Iterative self-improvement loop
  --batch              Process multiple files
  --in-place           Overwrite original files (with --batch)
  --suffix <ext>       Save as {name}{ext}{extname}
  --outdir <dir>       Save results to directory
  --models <list>      MAX mode: comma-separated model list
  --model <id>         Single model ID (default: gpt-4o)
  --api-key <key>      API key (or PATINA_API_KEY env)
  --base-url <url>     API base URL (or PATINA_API_BASE env)
  --dispatch <mode>    MAX dispatch: omc, direct, api

Environment Variables:
  PATINA_API_KEY       API authentication key
  PATINA_API_BASE      API base URL (default: https://api.openai.com/v1)
  PATINA_MODEL         Default model ID
`);
}
