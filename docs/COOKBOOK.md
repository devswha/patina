# Cookbook

Practical recipes for plugging patina into existing writing and CI workflows. Each recipe is self-contained — copy, adapt, run.

For the full flag list see `patina --help` and [`CLI.md`](CLI.md). For Document Type, Persona, and Register see [`README.md`](../README.md#three-independent-axes).

---

## 1. Batch-score a Hugo content folder

You have a Hugo site with many drafts under `content/posts/`. You want a quick AI-likeness scan over the whole folder before publishing.

```bash
# from your Hugo project root
patina --lang en --score --offline --batch content/posts/*.md
```

`--batch` treats every positional arg as an input file, so any glob your shell expands works. `--offline` makes this a reproducible local check with no backend. Omit it when you want the LLM-judged categories reconciled with the same deterministic signals.

For a stricter sweep that flags anything above 30/100, fail the run instead of just printing:

```bash
patina --lang en --score --offline --exit-on 30 --batch content/posts/*.md
```

When any file's `overall` exceeds the gate, patina exits with code `3` ([`CLI.md`](CLI.md) §Exit codes), which is perfect for a pre-publish check.

---

## 2. GitHub Actions integration

### Standalone Action

[`devswha/patina-action`](https://github.com/devswha/patina-action) reviews PR prose without a live model call, leaves a sticky comment with file-level hotspot scores, and can fail above an optional threshold.

```yaml
name: Patina prose score

on:
  pull_request:
    paths:
      - '**/*.md'
      - '**/*.mdx'

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  patina:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: devswha/patina-action@v1
        with:
          score-threshold: 30
          lang: auto
          comment: true
```

| Input | Default | Meaning |
|---|---:|---|
| `github-token` | `${{ github.token }}` | Token for changed-file detection and comments. |
| `files` | changed PR Markdown | Optional newline/comma/JSON file list; overrides paths-filter. |
| `lang` | `auto` | `auto`, `ko`, `en`, `zh`, or `ja`. |
| `score-threshold` | unset | If set, fail when any file score is above this percentage. |
| `report-threshold` | `30` | Advisory report gate when `score-threshold` is unset. |
| `max-files` | `50` | Maximum Markdown files to score. |
| `comment` | `true` | Create/update a sticky PR comment. |
| `badge-branch` | unset | Optional branch where the Action publishes `patina-badge.json` for Shields.io. Requires `contents: write`. |
| `patina-package` | `patina-cli@latest` | npm package spec used by `npx`. |

The Action finds changed Markdown files with `dorny/paths-filter@v4`, runs patina's deterministic `patina-score` command through `npx`, and updates a sticky comment with `peter-evans/create-or-update-comment@v5`. Read the table as a review queue: open the highest row, check the surrounding paragraph, and decide whether the prose needs editing for your audience. It reports **editing hotspots**, not proof that text was AI-written.

### README score badge

The Action's `patina-badge.json` is a [Shields.io endpoint](https://shields.io/endpoint) file built from the same deterministic prose score. It reports the highest scored file (`maxScore`) as an editing-hotspot percentage, not an authorship verdict.

```json
{ "schemaVersion": 1, "label": "patina", "message": "25% · human-ish", "color": "brightgreen" }
```

Once `patina-badge.json` is published on a stable branch, reference it from a README:

```md
[![patina](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<owner>/<repo>/<badge-branch>/patina-badge.json)](https://github.com/devswha/patina)
```

The standalone Action publishes the file after scoring when you set `badge-branch` (this needs `contents: write`):

```yaml
permissions:
  contents: write
  pull-requests: read
  issues: write

steps:
  - uses: actions/checkout@v6
  - uses: devswha/patina-action@v1
    with:
      badge-branch: patina-badge
```

Without a live endpoint, use the static brand badge instead:

```md
[![patina](https://raw.githubusercontent.com/devswha/patina/main/assets/brand/patina-badge.svg)](https://github.com/devswha/patina)
```

No badge mode tracks visitors; Shields reads a repository-owned JSON file or a static SVG.

### Self-built workflow

Run patina from a source checkout as a non-blocking quality check on every PR that touches markdown.

```yaml
# .github/workflows/patina.yml
name: Patina score
on:
  pull_request:
    paths: ["**/*.md"]

jobs:
  score:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - run: |
          git clone --depth 1 https://github.com/devswha/patina.git /tmp/patina
          cd /tmp/patina && npm install --omit=dev && npm link
      - name: Score changed markdown
        run: |
          changed=$(git diff --name-only origin/${{ github.base_ref }}...HEAD -- '*.md')
          [ -z "$changed" ] && echo "no markdown changes" && exit 0
          patina --lang en --score --offline --exit-on 30 --batch $changed
```

Drop `--exit-on` while you calibrate the threshold for your project. Remove `--offline` and configure a backend only if the workflow needs LLM-judged categories; see [`AUTHENTICATION.md`](AUTHENTICATION.md).

---

## 3. Compare Claude vs Gemini output manually

When you want to compare how two backends rewrite the same paragraph, run them side by side and diff the outputs directly:

```bash
patina --lang en --backend claude-cli draft.md > /tmp/claude.txt
patina --lang en --backend gemini-cli draft.md > /tmp/gemini.txt
diff /tmp/claude.txt /tmp/gemini.txt
```

This keeps the comparison explicit: you can read both rewrites, inspect which one preserves your meaning better, and keep whichever voice you prefer.

---

## 4. Investigate a false positive with `--diff --audit`

A sentence got rewritten when you wanted it preserved. To see exactly which pattern fired, run audit and diff against the same input:

```bash
patina --lang en --audit draft.md          # which patterns the scanner thinks fired
patina --lang en --diff draft.md           # pattern-by-pattern before/after
```

Cross-reference the firing pattern IDs against [`PATTERNS.md`](PATTERNS.md). If a pattern is consistently mis-firing on your domain (e.g. legal boilerplate that legitimately uses "fundamentally"), add it to `skip-patterns` in your config:

```yaml
# .patina.yaml
skip-patterns:
  - en-language    # drop the whole pack (pack file name without .md)
```

`skip-patterns` takes **pack names**, not pattern numbers, and merges additively across default / global / project configs. To suppress a single pattern (for example en #7) keep the pack and use a Document Type `pattern-overrides:` entry (`en: 7: suppress`), as in recipe 5.

---

## 5. Create a custom Document Type policy

Document Type owns genre, purpose, structural conventions, and pattern policy.
Persona and Register remain independent. In a source checkout or managed patina
installation, start from the nearest built-in policy:

```bash
cp document-types/blog.md document-types/my-newsletter.md
```

Change the frontmatter id so it matches the filename, define the document
conventions, then tune `pattern-overrides`:

```yaml
---
document-type: my-newsletter
name: Internal newsletter
version: 1.0.0
scope: weekly engineering newsletter
purpose: summarize shipped engineering work and the next actions
audience:
  - engineers and internal stakeholders
structure:
  - lead with shipped changes, then impact, risks, and explicit next actions
style:
  - use concrete component names and evidence
avoid:
  - inventing delivery dates, owners, metrics, or commitments
pattern-overrides:
  en:
    14: suppress
    7: amplify
---
```

Then opt in per run:

```bash
patina --lang en --document-type my-newsletter post.md
```

`suppress` is enforced deterministically by removing that pattern from the
prompt. `reduce` and `amplify` currently document policy intent but do not change
a runtime weight. For a project-local exclusion that does not require a custom
Document Type file, use `skip-patterns` in `.patina.yaml`.

---

## 6. Pre-commit hook wrapper *(optional)*

Block commits that introduce too-AI-sounding markdown. Drop this into `.git/hooks/pre-commit` (or wire it up through `pre-commit`/`husky` if you already use them):

```bash
#!/usr/bin/env bash
set -euo pipefail
changed=$(git diff --cached --name-only --diff-filter=ACM -- '*.md')
[ -z "$changed" ] && exit 0
patina --lang en --score --offline --exit-on 30 --batch $changed
```

`--exit-on` returns exit code `3` when any file's `overall` exceeds the threshold, which the shell treats as failure and aborts the commit. To bypass once (e.g. you intentionally want hype copy), commit with `--no-verify`.

---

## 7. Run patina against a local model (Ollama)

patina's `openai-http` backend works with any OpenAI-compatible server, so a local
Ollama instance plugs in without code changes:

```bash
PATINA_API_KEY=ollama patina --lang ko \
  --backend openai-http --base-url http://localhost:11434/v1 \
  --model gemma3:12b-it-qat --verify --timeout-ms 900000 draft.md
```

`PATINA_API_KEY` can be any non-empty string — Ollama ignores it, but the HTTP
backend requires one.

Three pitfalls, all observed in practice:

1. **Context size.** patina's rewrite prompt (pattern digests + Document Type +
   voice guidance) can exceed a small local model's default context. Newer
   Ollama versions fail loudly (`exceed_context_size_error`); older versions may
   silently truncate the prompt, which degrades rewrite quality. Start the
   server with `OLLAMA_CONTEXT_LENGTH=24576` (or higher) before testing.
2. **`--verify` is not optional for small local models.** A 12B model will happily
   round `38%` to "nearly 40%" and drop the survey year while producing an
   otherwise fluent rewrite. `--verify` runs the MPS/fidelity floors plus the
   deterministic numbers-preserved guard and fails closed to the original when the
   rewrite mangles facts. Cloud-scale models rarely trip these floors; local
   12B-class models do.
3. **Broken GGUFs exist.** If the output is a stream of `<unused12><unused7>…`
   tokens, the model artifact itself is corrupt (bad quant/merge or tokenizer
   mismatch) — no patina flag will fix it. Verify with a bare one-line prompt
   against the server before blaming the pipeline.

Set `--timeout-ms` generously: a 12B model on an 8 GB GPU takes minutes per rewrite
at full prompt length, not seconds. When the per-attempt budget exceeds 300s, the
HTTP backend automatically switches to SSE streaming so Node's undici
`headersTimeout` cannot kill a slow local generation mid-flight (#576). Judge
candidates with the deterministic score (`patina --score --offline` on the
rewrite output), not vibes — and compare against a cloud backend baseline on the same input.

---

## Where to go next

- Axis reference: [`README.md`](../README.md#three-independent-axes)
- Backend setup: [`AUTHENTICATION.md`](AUTHENTICATION.md)
- MPS and other terms: [`GLOSSARY.md`](GLOSSARY.md)
- Adding patterns or false-positive triage: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
