# Patina Subagents — Optional Multi-Agent Strict Flow

This document describes the three Claude Code plugin subagents bundled with patina and how they compose into an optional multi-agent strict flow.

## Overview

The default `/patina` skill and ordinary `/patina --strict` return verified CLI output, without host-agent rewriting or polishing. A failed CLI run is reported, never silently replaced with an inline rewrite. The host-agent multi-pass flow described here requires explicit `/patina --instruction-only --strict` (SKILL.md). Its subagents are **additive** — they provide parallel, independent analysis lanes within that opt-in flow, not CLI verification.

All three subagents are **read-only analysis agents**. None of them rewrites text. They produce reports and verdicts that the main skill (or Claude acting as orchestrator) uses to decide whether to accept, retry, or roll back a rewrite.

## The Three Subagents

### patina-detector

Runs the full detection pass on the **input text before any rewrite**. Loads all applicable pattern packs from `patterns/`, computes burstiness CV and MATTR per `core/stylometry.md`, applies AI-lexicon density checks, and runs Korean diagnostic signals for `ko` inputs. Emits a paragraph/span-level findings report with severity ratings per `core/scoring.md`.

Use when: you need a pre-rewrite audit log, want to verify which patterns were actually detected, or need the detection report as evidence in an output.

### patina-fidelity-auditor

Given the ORIGINAL and REWRITE texts, audits meaning preservation against all four fidelity criteria defined in `core/scoring.md` §§9-14: claims preserved, no fabrication, audience/register match, and length ratio. Also checks MPS-level semantic anchors: numbers, polarity, causation, named entities, and direct quotes. Returns a PASS or NEEDS-ROLLBACK verdict with the fidelity score and offending spans identified.

The verification floor applies here: fidelity_score ≥ `verification.fidelity-floor` (default: 70) is required for PASS.

Use when: you need an auditable record that the rewrite did not alter facts, or when fidelity is critical for academic, technical, medical, or legal Document Types.

### patina-naturalness-reviewer

Re-runs detection on the **rewrite text** to check for residual AI tells. Computes a residual AI-likeness score per `core/scoring.md`, flags over-editing (changes to paragraphs that had no detected patterns), and checks for genre or register drift. Assigns an A–D quality grade:

| Grade | Meaning |
|-------|---------|
| A | Residual score ≤ 30, no over-editing — accept |
| B | Residual score 31–50 or minor over-editing — acceptable, optional polish |
| C | Residual score 51–70 or moderate over-editing — retry recommended |
| D | Residual score > 70 or genre/register violation — rollback required |

Use when: you want quality assurance on the rewrite before delivering it, or when the strict flow needs an independent grade signal.

## Strict Flow: Composition

The three subagents compose into the following sequential flow:

```
INPUT TEXT
    │
    ▼
patina-detector ─────────────────── findings report (patterns + suspect zones)
    │
    ▼
/patina --instruction-only --strict rewrite (SKILL.md stages 5a/5b/5c)
    │
    ├──► patina-fidelity-auditor ── PASS / NEEDS-ROLLBACK + offending spans
    │
    └──► patina-naturalness-reviewer ── grade A/B/C/D + residual tells
    │
    ▼
Decision
  ├── fidelity PASS + grade A or B → ACCEPT rewrite
  ├── fidelity PASS + grade C → RETRY rewrite (one more pass)
  └── fidelity NEEDS-ROLLBACK or grade D → ROLLBACK to original
```

The fidelity auditor and naturalness reviewer run in parallel after the rewrite is produced. Both verdicts are required before accepting the rewrite. A NEEDS-ROLLBACK from the fidelity auditor overrides a grade A from the naturalness reviewer — meaning preservation always takes priority.

This flow is entirely optional. The standard `/patina` skill functions without these subagents. They add a structured audit trail and an explicit accept/retry/rollback gate.

## Automatic delegation from `--instruction-only --strict`

The explicit `/patina --instruction-only --strict` mode (defined in `SKILL.md`) wires this flow automatically. When the patina plugin is installed and these subagents are available, `--instruction-only --strict` delegates its read-only analysis passes via the `Task` tool — P1 to `patina-detector`, P3 to `patina-fidelity-auditor`, P4 to `patina-naturalness-reviewer` — while the main skill keeps orchestration, the rewrite (P2), and the accept/retry/rollback gate (P5). When the subagents are not available (Codex CLI, Cursor, OpenCode, or a non-plugin install), `--instruction-only --strict` runs the same passes inline in a single agent. Both modes use identical floors and gate logic; delegation only adds context isolation. This inline fallback exists only within the explicit instruction-only flow, never as a fallback for the default CLI route or ordinary `--strict`. Instruction-only output is labeled "instruction-only; CLI not run; no CLI verification" outside the prose and carries no CLI receipt.

## CLI-first compatibility evidence

The normal `/patina` and `/patina --strict` routes remain CLI-first: a failed CLI
run is an error, never an inline rewrite or a silent fallback. The optional
instruction-only route above is the only host-agent analysis path.

`tests/fixtures/backend-claude-contract.json` was a **version-only /
unverified** record of `claude --version` (`2.1.261`) on 2026-09-09; on
2026-09-10 it became a **real-invocation / verified** record for that same
version (`claude-sonnet-4-6`, subscription OAuth, `--tools ""
--strict-mcp-config`) with per-scenario evidence in
`docs/operations/backend-compat-claude-gemini-20260910.json`. The same receipt
verifies the `openai-http` backend against the loopback OpenCodex proxy route
`google-antigravity/gemini-3.7-flash`; that is transport evidence for the HTTP
backend, not `gemini-cli` evidence. Neither fixture contains credentials,
prompts, model responses, or raw CLI output. The evidence must stay separate
from these runtime distinctions:

- **Output parsing:** `claude-cli` captures `-p` stdout; Patina's output layer
  removes optional `[BODY]`/`[SELF_AUDIT]` scaffolding and returns the body. A
  version response does not exercise that parser.
- **Errors and cancellation:** non-zero exits, signal termination, spawn
  failures, `AbortError`, and local timeout errors are reported as failures.
  Cancellation/timeout tests also require the owned child, invocation
  directory, and concurrency slot to be gone before a later call succeeds.
- **Authentication and quota:** the Claude credential-file check is not an
  invocation check. Account authentication or quota failures are external
  runtime outcomes and must not be promoted to compatibility or rewrite
  success by a version-only record.
- **Timeout:** the adapter's bounded child-process timer is distinct from
  caller cancellation and from account quota. The fixture does not verify any
  of these paths.

`tests/fixtures/backend-codex-contract.json` is the first **real-invocation /
verified** record: codex `0.153.4` on Linux with `gpt-5.5` over a ChatGPT OAuth
session, exercised on 2026-09-10 through `--score`, `--verify`, a live
`--timeout-ms` kill, the foreign-model fallback, and an invalid in-family model
(per-scenario evidence in `docs/operations/backend-compat-codex-20260910.json`).
It verifies output parsing, error reporting, authentication path, and timeout
cleanup for that version only; quota behavior, other versions, other models,
and other operating systems remain unverified, and the record still contains
no credentials, prompts, responses, or raw CLI output.

The lifecycle/session fixtures use POSIX executables, owned process-group
probes, and `/proc` state where available (a zombie is not running). They
verify that an independent-stdio worker dies with its leader while an
unrelated process group survives. They are skipped on unsupported operating
systems and make no Windows coverage claim. On platforms without portable
process-group signalling, cancellation still closes Patina's parent-owned
stdio pipes before settling; descendants that inherited those pipes are not
claimed to be killed.
The two-session check gives both processes one shared temporary slot root, so
separate HOME/config/output isolation cannot bypass the global backend cap.

## Advisory Metadata Rule

Korean `translationese` and `koPostEditese.v1` signals are **advisory only** across the entire pipeline, including inside all three subagents. These signals must never influence the AI-likeness score, fidelity score, quality grade, verification outcome, or any authorship verdict. They appear in report output labeled as advisory and non-scoring.

## Claude Code Plugin Auto-Discovery

Patina ships an `agents/` directory in the plugin root. Claude Code discovers agent files automatically by scanning `agents/*.md` at plugin load time. Each file's YAML frontmatter declares the agent's `name`, `description`, `model`, and `tools` allowlist.

To use the subagents:
1. Install the patina plugin in Claude Code.
2. Claude will auto-discover `agents/patina-detector.md`, `agents/patina-fidelity-auditor.md`, and `agents/patina-naturalness-reviewer.md`.
3. Reference them by name in your prompts, or let Claude invoke them automatically based on their `description` fields.

The subagents are tool-limited to `Read`, `Grep`, and `Glob` (detector and reviewer) or `Read` only (fidelity auditor). They do not use hooks, MCP servers, or elevated permission modes.
