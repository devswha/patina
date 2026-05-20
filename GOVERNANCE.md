# Governance

Patina uses lightweight maintainer governance until the contributor base grows.

## Decision model

- Routine docs, tests, examples, and small CLI fixes can be merged after one maintainer review or an equivalent verified maintainer run.
- Pattern, scoring, benchmark, installer, provider, and release changes need explicit maintainer approval.
- Changes that affect the core skill pipeline should explain the meaning-preservation impact and include before/after examples when practical.

## Change-proposal flow

1. Open an issue first for pattern, scoring, benchmark, installer, provider, or release changes.
2. Include the risk class: user-visible behavior, benchmark claim, security/install path, or docs-only.
3. Link verification evidence in the PR: tests, benchmark report, screenshots, or manual command output.
4. Prefer follow-up issues over expanding a PR after review starts.

## Close criteria

An issue can be closed when the linked PR is merged and the issue's acceptance criteria are met, or when the maintainer records why the request is duplicate, out of scope, not reproducible, or intentionally deferred. Partial fixes should leave a comment naming the remaining work.

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
- `ecosystem` — package, dataset, marketplace, or third-party surface work
- `integration` — editor, GitHub Action, pre-commit, or app integration
- `distribution` — npm, Docker, releases, install channels
- `governance` — maintainer process, labels, community health
- `discussion` — design or research thread before implementation

## Safety notes

- Do not position patina as an AI-detector bypass tool. The accepted framing is auditable editing with meaning-preservation checks.
- Do not include private user text in issues, fixtures, or benchmarks unless the contributor has explicit redistribution rights.
- Prefer small, reversible changes over broad rewrites.
