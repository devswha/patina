# GitHub Action

Patina's standalone Action repository is [`devswha/patina-action`](https://github.com/devswha/patina-action). It runs pull request prose review without a live model call, leaves a sticky comment with file-level hotspot scores, and can fail above an optional score threshold.

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

## README score badge

Patina can also produce a [Shields.io endpoint](https://shields.io/endpoint) JSON file from the same deterministic prose score used by the PR comment. The endpoint reports the highest scored file (`maxScore`) as an editing-hotspot percentage, not an authorship verdict.

Generate the JSON locally:

```bash
npm run badge -- README.md docs/FAQ.md > patina-badge.json
```

Payload shape:

```json
{ "schemaVersion": 1, "label": "patina", "message": "25% · human-ish", "color": "brightgreen" }
```

Use it from a README once `patina-badge.json` is published on a stable branch:

```md
[![patina](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<owner>/<repo>/<badge-branch>/patina-badge.json)](https://github.com/devswha/patina)
```

For the standalone Action, set `badge-branch` to publish `patina-badge.json` after scoring:

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

If you do not want a live score endpoint, use the static brand fallback instead:

```md
[![patina](https://raw.githubusercontent.com/devswha/patina/main/assets/brand/patina-badge.svg)](https://github.com/devswha/patina)
```

No badge mode performs per-visitor tracking; Shields reads a repository-owned JSON file or a static SVG.

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
| `badge-branch` | unset | Optional branch where the Action publishes `patina-badge.json` for Shields.io. Requires `contents: write`. |
| `patina-package` | `patina-cli@latest` | npm package spec used by `npx`. |

## What it measures

The Action uses `dorny/paths-filter@v4` to find changed Markdown files, runs Patina's deterministic `patina-score` command through `npx`, and updates a sticky comment with `peter-evans/create-or-update-comment@v5`. Read the table as a review queue. Open the highest row, check the surrounding paragraph, and decide whether the prose actually needs editing for your audience. It reports **editing hotspots**, not proof that text was AI-written.
