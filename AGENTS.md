# Repository development rules

This is Patina's public development entrypoint. It governs repository changes,
not product behavior, product prompts, or personal agent configuration. Keep
product instructions in `SKILL.md`, `core/`, and the relevant source contract;
do not copy them into this file.

## Start here

1. Check `git status --short --branch` and identify the branch, base, and files
   already changed by another session.
2. Read this file and any applicable scoped rules before editing. Treat
   unexpected changes as another contributor's work.
3. Read the relevant source, tests, and canonical documentation before choosing
   an implementation. Work only within the requested acceptance criteria.
4. State the intended verification profile and any unavailable checks before
   relying on their result.

## Scope and safe changes

- Branch feature work from the current `dev`; use one branch and worktree per
  session. Follow [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for branch, PR, review,
  merge, and release operations.
- Do not reset, stash, overwrite, or force-push another session's changes. Do
  not edit shared configuration, credentials, processes, ports, or output
  directories outside the assigned worktree without explicit ownership.
- Keep a PR to one understandable behavior, contract, or responsibility change.
  Include its regression test and required documentation; separate unrelated
  cleanup, generated output, and version bumps.
- Preserve public CLI, API, configuration, installation, and package contracts.
  Call intentional changes or retirements out with compatibility handling and
  rollback notes.
- Do not change scoring thresholds, rewrite prompts, or research conclusions as
  incidental maintenance. Do not revive retired or cancelled work.
- Package version changes are release work: record semver impact during feature
  work, then update `package.json` and its mirrors once in the release process.

## Verification and reporting

- Select existing focused checks for the changed behavior. Deterministic
  analysis under `src/features/` stays LLM-, network-, and key-free.
- Reproduce a behavioral failure before changing an expected value. Never delete
  a failing test or skip a safety/contract check to make a change pass.
- Report each check as run, failed, cancelled, stale, or not run. Include the
  command, exit code, tested head/base or tree, and artifact path when present;
  never describe an unrun check as proof.
- A model-backed, hosted, paid, deployment, or external-service check requires
  explicit authorization and an isolated test profile. Local fixtures are not
  evidence of live-model quality or production health.

## Public repository boundary

- Tracked files are public by default. Commit only redistributable source,
  documentation, fixtures, and sanitized evidence with a clear owner and
  provenance.
- Keep credentials, tokens, private source text, raw model/review output,
  runlogs, personal profiles, and local QA/review workspaces out of Git, issues,
  telemetry, package tarballs, and public examples.
- Root `AGENTS.md` is the public development entrypoint. Nested or client-
  specific agent files remain private unless a separate public policy explicitly
  allows them; `.gitignore` is the guard, not permission to publish.
- Historical plans, research, and benchmark records remain labeled with their
  date, conditions, and source revision. Do not silently rewrite historical
  results as current claims or expose private inputs behind a summary.
- This repository grants no external publication, registry, deployment, account,
  or release rights. Maintainer approval and the documented release workflow are
  required for any external write.

## Code Review Rules

- Keep the deterministic analysis lane independent from model, network, and
  secret access; flag any new reverse dependency into rewrite or transport code.
- Flag meaning-preservation risks: changed numbers, entities, polarity,
  modality, causation, or unsupported detail in transformed output.
- Flag accepted status without the required anchor or evidence, including a
  failed, cancelled, stale, or inconclusive run presented as passed.
- Flag private text, credentials, raw prompts, or identifying execution data in
  logs, telemetry, fixtures, package contents, or public documents.
- Flag duplicated sources of truth, undocumented compatibility breaks, and
  changes that weaken rollback, cancellation cleanup, or required checks.

## Canonical references

- Contributor entrypoint and document boundaries: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Branch, PR, Issue, merge, and release policy: [`docs/WORKFLOW.md`](docs/WORKFLOW.md)
- Module responsibilities and public contracts: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Verification profiles, evidence, and QA isolation: [`docs/QA.md`](docs/QA.md)
