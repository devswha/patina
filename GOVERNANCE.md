# Governance

Patina uses lightweight maintainer governance until the contributor base grows.

## Decision model

- Routine docs, tests, examples, and small CLI fixes can be merged after one maintainer review or an equivalent verified maintainer run.
- Pattern, scoring, benchmark, installer, provider, and release changes need explicit maintainer approval.
- Changes that affect the core skill pipeline should explain the meaning-preservation impact and include before/after examples when practical.

## Triage labels

Suggested label groups:

- `bug` — incorrect behavior or broken documented workflow
- `enhancement` — product, CLI, integration, or distribution improvement
- `documentation` — docs-only update
- `patterns` — pattern catalog or rewrite-rule change
- `benchmark` — corpus, metrics, calibration, or quality gate work
- `research` — evaluation methodology or external comparison
- `false-positive` — human prose flagged too strongly
- `good first issue` — bounded and low-risk contributor task
- `help wanted` — useful but not on the immediate maintainer path

## Safety notes

- Do not position patina as an AI-detector bypass tool. The accepted framing is auditable editing with meaning-preservation checks.
- Do not include private user text in issues, fixtures, or benchmarks unless the contributor has explicit redistribution rights.
- Prefer small, reversible changes over broad rewrites.
