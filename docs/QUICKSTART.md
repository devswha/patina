# Quickstart

This guide is a practical first-run path for patina. The transcripts below are representative terminal sessions: exact wording may vary slightly depending on your backend, authentication state, and local configuration.

## What patina does

patina rewrites AI-sounding prose into plainer text while trying to keep the original meaning intact. It can also audit text, score how AI-like it is, show a diff of the changes, or run the iterative `ouroboros` loop for repeated refinement.

Supported languages are Korean, English, Chinese, and Japanese.

## Prerequisites

You need Node.js 18 or newer for the standalone CLI.

If you want the free local backend path, install and sign in to the Codex CLI first. Otherwise, use an API key with an HTTP-compatible backend.

## Install patina

### Option 1: Install as a skill or local workspace copy

Run the installer from a shell:

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

Representative transcript:

```text
Installing for Claude Code...
Cloning patina...
Claude Code: /patina and /patina-max ready

Installing for Codex CLI...
Codex: /patina and /patina-max linked to ~/.codex/skills

patina installation complete!
```

The installer links patina into:

- Claude Code as `/patina` and `/patina-max`
- Codex CLI as `/patina` and `/patina-max`
- Cursor as a rules file
- OpenCode / Sisyphus as a skill directory

### Option 2: Use it as a standalone CLI

```bash
git clone https://github.com/devswha/patina.git
cd patina
npm install
npm link
```

Then verify the command is available:

```bash
patina --version
```

Representative transcript:

```text
patina 3.10.0
```

## First run

### 1) Ask the CLI for help

```bash
patina --help
```

Representative transcript:

```text
patina — AI text humanizer CLI

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
```

### 2) Check backend availability

```bash
patina auth status
patina --list-backends
patina --list-providers
```

These commands help you answer three questions quickly:

- Is `codex-cli` installed and authenticated?
- Which backend will patina use by default?
- Which provider presets and API keys are available?

### 3) Rewrite a file

Create a small test file:

```bash
cat > input.txt <<'EOF'
AI coding tools represent a transformative leap forward in productivity.
EOF
```

Run patina on it:

```bash
patina --lang en input.txt
```

Representative transcript:

```text
AI coding tools are useful for the boring parts: test stubs, config files, small refactors.
They do not fix a messy codebase, but they can save time when someone still checks the output.
```

## Common ways to use it

### Rewrite with a different tone

```bash
patina --lang en --tone narrative input.txt
```

Use `--tone auto` if you want patina to pick the best-fit tone for the text:

```bash
patina --lang en --tone auto input.txt
```

### Inspect the rewrite instead of changing it

```bash
patina --lang en --audit input.txt
patina --lang en --score input.txt
patina --lang en --diff input.txt
```

Use these when you want to see what patina thinks is suspicious before accepting the rewrite.

### Process multiple files

```bash
patina --batch docs/*.md --lang en --outdir out
```

Write back into the original files with `--in-place`:

```bash
patina --batch docs/*.md --lang en --in-place
```

Use a suffix when you want side-by-side output files:

```bash
patina --batch docs/*.md --lang en --suffix .patina
```

### Use stdin instead of a file

If you do not pass a file, patina reads from standard input:

```bash
printf 'This solution delivers transformative value across the organization.' | patina --lang en
```

Representative transcript:

```text
This solution is useful, but only if someone still checks the output.
```

## Backends and authentication

patina supports two broad execution paths:

1. `codex-cli` backend, which works when the Codex CLI is installed and logged in.
2. OpenAI-compatible HTTP backends, which use an API key.

If you already use one of the provider presets, set the matching environment variable and pass `--provider`:

```bash
export GEMINI_API_KEY="..."
patina --provider gemini --lang en input.txt
```

Other useful presets are `groq`, `together`, and `openai`.

If you need to point at a custom endpoint:

```bash
export PATINA_API_KEY="..."
patina --base-url https://example.com/v1 --model gpt-4o --lang en input.txt
```

If your environment is locked down, prefer `--api-key-file` over putting secrets on the command line:

```bash
patina --api-key-file ~/.config/patina/api-key.txt --lang en input.txt
```

## Configuration

patina reads `.patina.default.yaml` from the repository and lets a local `.patina.yaml` override it.

Minimal example:

```yaml
version: "3.10.0"
language: en
profile: default
output: rewrite
tone: auto
```

Useful settings to know about:

- `language`: `ko`, `en`, `zh`, or `ja`
- `profile`: tone presets such as `blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, and `marketing`
- `tone`: `casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, or `auto`
- `skip-patterns`: skip selected pattern packs
- `max-models`: control MAX mode model selection
- `ouroboros`: enable the iterative self-improvement loop

CLI flags override configuration for a single run.

## How the command behaves

The default mode is rewrite. You can also switch to audit, score, diff, or ouroboros.

```bash
patina --lang en input.txt          # rewrite
patina --lang en --audit input.txt  # detection only
patina --lang en --score input.txt  # score only
patina --lang en --diff input.txt   # show pattern-level changes
patina --lang en --ouroboros input.txt
```

For a quick mental model, the pipeline is:

1. Load the language patterns and profile.
2. Build a prompt from the input text.
3. Send it through the selected backend.
4. Format the result as rewrite, audit, score, diff, or ouroboros output.

## Troubleshooting

- If `patina` says no input was provided, either pass a file path or pipe text into stdin.
- If you see an authentication error, run `patina auth status` and confirm the backend you expect is actually available.
- If you want to use the free local path, make sure `codex` is installed and logged in, then run `patina --backend codex-cli ...`.
- If you use an HTTP backend, keep secrets in environment variables or `--api-key-file` rather than the shell history.

## Next step

After your first rewrite works, read [AUTHENTICATION.md](AUTHENTICATION.md) for backend setup and [EXAMPLES.md](EXAMPLES.md) for before/after samples.
