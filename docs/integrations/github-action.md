# GitHub Action

Patina's standalone Action repository is [`devswha/patina-action`](https://github.com/devswha/patina-action). It runs pull request prose review without a live model call, leaves a sticky comment with file-level hotspot scores, and can fail above an optional score threshold.

> The Action defaults to `patina-cli@latest`, so the `@v1` tag should be cut after the npm publish in #203. Until then, pre-release workflows can use `@main` with `patina-package: github:devswha/patina`.

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
      - uses: devswha/patina-action@main # replace with @v1 after npm publish + action tag
        with:
          patina-package: github:devswha/patina # remove after patina-cli@latest is on npm
          report-threshold: 30
          lang: auto
          comment: true
```

Once `patina-cli` is on npm and `devswha/patina-action@v1` is tagged, the stable form is:

```yaml
- uses: actions/checkout@v6
- uses: devswha/patina-action@v1
  with:
    score-threshold: 30
    comment: true
```

## Inputs

| Input | Default | Meaning |
|---|---:|---|
| `github-token` | `${{ github.token }}` | Token for changed-file detection and comments. |
| `files` | changed PR Markdown | Optional newline/comma/JSON file list; overrides paths-filter. |
| `lang` | `auto` | `auto`, `ko`, `en`, `zh`, or `ja`. |
| `score-threshold` | unset | If set, fail when any file score is above this percentage. |
| `report-threshold` | `30` | Advisory report gate when `score-threshold` is unset. |
| `max-files` | `50` | Maximum Markdown files to score. |
| `comment` | `true` | Create/update a sticky PR comment. |
| `patina-package` | `patina-cli@latest` | npm package spec used by `npx`. |

## What it measures

The Action uses `dorny/paths-filter@v4` to find changed Markdown files, runs Patina's deterministic `patina-score` command through `npx`, and updates a sticky comment with `peter-evans/create-or-update-comment@v5`. Read the table as a review queue. Open the highest row, check the surrounding paragraph, and decide whether the prose actually needs editing for your audience. It reports **editing hotspots**, not proof that text was AI-written.
