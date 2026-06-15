# Patina Subagents — Optional Multi-Agent Strict Flow

This document describes the three Claude Code plugin subagents bundled with patina and how they compose into an optional multi-agent strict flow.

## Overview

The standard `/patina` skill operates as a single-pass LLM-orchestrated pipeline (SKILL.md). The subagents described here are **additive** — they extend that pipeline with parallel, independent analysis lanes. Nothing about the core skill changes; the subagents can be invoked alongside it.

All three subagents are **read-only analysis agents**. None of them rewrites text. They produce reports and verdicts that the main skill (or Claude acting as orchestrator) uses to decide whether to accept, retry, or roll back a rewrite.

## The Three Subagents

### patina-detector

Runs the full detection pass on the **input text before any rewrite**. Loads all applicable pattern packs from `patterns/`, computes burstiness CV and MATTR per `core/stylometry.md`, applies AI-lexicon density checks, and runs Korean diagnostic signals for `ko` inputs. Emits a paragraph/span-level findings report with severity ratings per `core/scoring.md`.

Use when: you need a pre-rewrite audit log, want to verify which patterns were actually detected, or need the detection report as evidence in an output.

### patina-fidelity-auditor

Given the ORIGINAL and REWRITE texts, audits meaning preservation against all four fidelity criteria defined in `core/scoring.md` §§9-14: claims preserved, no fabrication, tone match, and length ratio. Also checks MPS-level semantic anchors: numbers, polarity, causation, named entities, and direct quotes. Returns a PASS or NEEDS-ROLLBACK verdict with the fidelity score and offending spans identified.

The ouroboros floor applies here: fidelity_score ≥ 70 is required for PASS.

Use when: you need an auditable record that the rewrite did not alter facts, or when fidelity is critical (academic, technical, medical, legal profiles).

### patina-naturalness-reviewer

Re-runs detection on the **rewrite text** to check for residual AI tells. Computes a residual AI-likeness score per `core/scoring.md`, flags over-editing (changes to paragraphs that had no detected patterns), and checks for genre or register drift. Assigns an A–D quality grade:

| Grade | Meaning |
|-------|---------|
| A | Residual score ≤ 30, no over-editing — accept |
| B | Residual score 31–50 or minor over-editing — acceptable, optional polish |
| C | Residual score 51–70 or moderate over-editing — retry recommended |
| D | Residual score > 70 or genre/register violation — rollback required |

Use when: you want quality assurance on the rewrite before delivering it, or when the `--ouroboros` loop needs an independent grade signal.

## Strict Flow: Composition

The three subagents compose into the following sequential flow:

```
INPUT TEXT
    │
    ▼
patina-detector ─────────────────── findings report (patterns + suspect zones)
    │
    ▼
/patina rewrite (SKILL.md stages 5a/5b/5c)
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

## Automatic delegation from `--strict`

The `/patina --strict` mode (defined in `SKILL.md`) wires this flow automatically. When the patina plugin is installed and these subagents are available, `--strict` delegates its read-only analysis passes via the `Task` tool — P1 to `patina-detector`, P3 to `patina-fidelity-auditor`, P4 to `patina-naturalness-reviewer` — while the main skill keeps orchestration, the rewrite (P2), and the accept/retry/rollback gate (P5). When the subagents are not available (Codex CLI, Cursor, OpenCode, or a non-plugin install), `--strict` runs the same passes inline in a single agent. Both modes use identical floors and gate logic; delegation only adds context isolation.

## Advisory Metadata Rule

Korean `translationese` and `koPostEditese.v1` signals are **advisory only** across the entire pipeline, including inside all three subagents. These signals must never influence the AI-likeness score, fidelity score, quality grade, ouroboros termination, or any authorship verdict. They appear in report output labeled as advisory and non-scoring.

## Claude Code Plugin Auto-Discovery

Patina ships an `agents/` directory in the plugin root. Claude Code discovers agent files automatically by scanning `agents/*.md` at plugin load time. Each file's YAML frontmatter declares the agent's `name`, `description`, `model`, and `tools` allowlist.

To use the subagents:
1. Install the patina plugin in Claude Code.
2. Claude will auto-discover `agents/patina-detector.md`, `agents/patina-fidelity-auditor.md`, and `agents/patina-naturalness-reviewer.md`.
3. Reference them by name in your prompts, or let Claude invoke them automatically based on their `description` fields.

The subagents are tool-limited to `Read`, `Grep`, and `Glob` (detector and reviewer) or `Read` only (fidelity auditor). They do not use hooks, MCP servers, or elevated permission modes.
