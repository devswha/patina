# GitHub Action

Patina ships a composite Action for pull request prose review. No model call is required. It leaves a sticky comment with file-level hotspot scores, so docs reviewers can spot stiff or repetitive paragraphs before merge instead of finding them after publication. The check runs locally in the Action process and does not send text to a live model.

> The checked-in Action can be used from this repository immediately with `@main`. After a release tag is cut, pin to `@v1` or a full version tag.

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
      - uses: devswha/patina@main # replace with @v1 after the v1 tag exists
        with:
          gate: 30
          lang: auto
          comment: true
          fail-on-gate: false
```

## Inputs

| Input | Default | Meaning |
|---|---:|---|
| `files` | changed PR files | Optional newline/comma-separated file list. |
| `lang` | `auto` | `auto`, `ko`, `en`, `zh`, or `ja`. |
| `gate` | `30` | Maximum hot-paragraph percentage per file. |
| `max-files` | `50` | Limit for large PRs. |
| `comment` | `true` | Create/update a sticky PR comment. |
| `fail-on-gate` | `false` | Fail the check when any file exceeds `gate`. |
| `token` | `${{ github.token }}` | Token used to list PR files and write comments. |

## What it measures

The Action uses the same deterministic burstiness, MATTR, and AI-lexicon signals as the checked-in benchmark. Read the table as a review queue. Open the highest row, check the surrounding paragraph, and decide whether the prose actually needs editing for your audience. It reports **editing hotspots**, not proof that text was AI-written.
