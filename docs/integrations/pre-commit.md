# Pre-commit integrations

Use these recipes when you want Patina to flag AI-sounding prose before Markdown changes land in a docs or blog repository.

The hook is **score-only**: it never rewrites files during commit. It uses Patina's deterministic stylometry/lexicon layer, so it does not need an API key and it does not claim authorship provenance.

## pre-commit framework

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/devswha/patina
    rev: main # replace with a release tag after v1 is cut
    hooks:
      - id: patina-score
        args: [--score-threshold, "30", --lang, auto]
```

Run it locally:

```bash
pre-commit run patina-score --all-files
```

## Husky + lint-staged

```bash
npm install --save-dev husky lint-staged patina-cli
npx husky init
```

```jsonc
// package.json
{
  "lint-staged": {
    "*.{md,mdx}": "patina-score --score-threshold 30 --lang auto"
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

## Lefthook

Install the package in the repository first:

```bash
npm install --save-dev patina-cli
```

```yaml
# lefthook.yml
pre-commit:
  commands:
    patina-score:
      glob: "*.{md,mdx}"
      run: npx patina-score --score-threshold 30 --lang auto {staged_files}
```

A repo-local Lefthook command if this repository is vendored or checked out:

```yaml
pre-commit:
  commands:
    patina-score:
      glob: "*.{md,mdx}"
      run: node scripts/precommit-score.mjs --score-threshold 30 --lang auto {staged_files}
```

## Tuning

- `--score-threshold 30` means fail when more than 30% of prose paragraphs in a file trip a hot signal.
- `--lang auto` infers language from filename and Unicode ranges; pass `ko`, `en`, `zh`, or `ja` when a repo is single-language.
- Use this as a discussion prompt, not as an accusation. See [ETHICS.md](../ETHICS.md).
