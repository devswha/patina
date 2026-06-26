# Cookbook

Practical recipes for plugging patina into existing writing and CI workflows. Each recipe is self-contained — copy, adapt, run.

For the full flag list see `patina --help` and [`CLI.md`](CLI.md). For tone / profile background see [`README.md`](../README.md#modes).

---

## 1. Batch-score a Hugo content folder

You have a Hugo site with many drafts under `content/posts/`. You want a quick AI-likeness scan over the whole folder before publishing.

```bash
# from your Hugo project root
patina --lang en --score --batch content/posts/*.md
```

`--batch` treats every positional arg as an input file, so any glob your shell expands works. `--score` per file prints `overall` plus the category breakdown.

For a stricter sweep that flags anything above 30/100, fail the run instead of just printing:

```bash
patina --lang en --score --exit-on 30 --batch content/posts/*.md
```

When any file's `overall` exceeds the gate, patina exits with code `3` ([`CLI.md`](CLI.md) §Exit codes), which is perfect for a pre-publish check.

---

## 2. GitHub Actions integration (minimal workflow YAML)

Run patina as a non-blocking quality check on every PR that touches markdown.

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: |
          git clone --depth 1 https://github.com/devswha/patina.git /tmp/patina
          cd /tmp/patina && npm install --omit=dev && npm link
      - name: Score changed markdown
        run: |
          changed=$(git diff --name-only origin/${{ github.base_ref }}...HEAD -- '*.md')
          [ -z "$changed" ] && echo "no markdown changes" && exit 0
          patina --lang en --score --exit-on 30 --batch $changed
        env:
          # pick one backend that has a token in repo secrets
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Drop `--exit-on` while you calibrate the threshold for your project. Swap `GEMINI_API_KEY` for whichever backend you have (`claude` / `codex` / `gemini`) — see [`AUTHENTICATION.md`](AUTHENTICATION.md) for the full list.

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
  - en:7    # AI vocabulary words — too aggressive for legal prose
```

`skip-patterns` is a list key that merges additively across default / global / project configs, so the project-level skip doesn't lose the defaults.

---

## 5. Create a custom profile (copy `blog.md`, edit voice-overrides)

When the built-in 12 profiles don't match your house style, fork the closest one:

```bash
cp profiles/blog.md profiles/my-newsletter.md
```

Edit the frontmatter — at minimum change `profile:`, then tune `voice-overrides` and `pattern-overrides` to match the voice you want:

```yaml
---
profile: my-newsletter            # must match the filename without .md
name: Internal newsletter profile
version: 1.0.0
scope: weekly engineering newsletter
voice-overrides:
  first-person: amplify           # we sign every post
  opinions: amplify               # opinionated framing is the point
  humor: allow                    # dry humor ok
  messiness: reduce               # cleaner than personal blog
pattern-overrides:
  en:
    14: suppress                  # bold is allowed for scannable sections
    7:  amplify                   # AI-vocab cleanup stays strict
---
```

Then opt-in per run:

```bash
patina --lang en --profile my-newsletter post.md
```

Voice-override values are `amplify` / `allow` / `reduce` / `suppress`; pattern IDs and their meanings are in [`PATTERNS.md`](PATTERNS.md).

> **What actually runs:** a `pattern-overrides` entry set to **`suppress`** is applied deterministically — patina drops that pattern from the rewrite / audit / score prompt for the profile's language, so the model never flags it (e.g. `legal` suppresses Korean passive-voice #27). `reduce` / `amplify` are **advisory** for now: they document intent and are reinforced by the profile's prose body, but the engine does not yet adjust their weight.

---

## 6. Pre-commit hook wrapper *(optional)*

Block commits that introduce too-AI-sounding markdown. Drop this into `.git/hooks/pre-commit` (or wire it up through `pre-commit`/`husky` if you already use them):

```bash
#!/usr/bin/env bash
set -euo pipefail
changed=$(git diff --cached --name-only --diff-filter=ACM -- '*.md')
[ -z "$changed" ] && exit 0
patina --lang en --score --exit-on 30 --batch $changed
```

`--exit-on` returns exit code `3` when any file's `overall` exceeds the threshold, which the shell treats as failure and aborts the commit. To bypass once (e.g. you intentionally want hype copy), commit with `--no-verify`.

---

## Where to go next

- Tone reference: [`README.md`](../README.md#tones)
- Free-tier setup (no API key): [`AUTHENTICATION.md`](AUTHENTICATION.md)
- MPS and other terms: [`GLOSSARY.md`](GLOSSARY.md)
- Adding patterns or false-positive triage: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
