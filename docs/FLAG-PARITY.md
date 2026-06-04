# CLI / Skill Flag Parity

Basis: local checkout `2e1fc04` plus `node bin/patina.js --help`, `SKILL.md`, and `patina-max/SKILL.md` reviewed on 2026-05-20. This table separates the standalone CLI surface from the prompt-based `/patina` and `/patina-max` skill surfaces; a missing check is not always a bug when the flag is backend-, auth-, or CLI-automation-only.

| Flag / command | Standalone CLI | `/patina` (`SKILL.md`) | `/patina-max` | Notes |
|---|:---:|:---:|:---:|---|
| *(default rewrite)* | ✓ | ✓ | ✓ | CLI and `/patina` rewrite one candidate; `/patina-max` chooses the best candidate across models. |
| `--diff` | ✓ | ✓ | — | Single-candidate pattern-by-pattern diff. |
| `--audit` | ✓ | ✓ | — | Detection-only mode. |
| `--score` | ✓ | ✓ | internal | MAX scores candidates internally rather than exposing score mode. |
| `--gate <n>` | ✓ | — | — | CLI score-gate alias; automation-only. |
| `--exit-on <n>` | ✓ | — | — | Preferred CLI score-gate spelling for CI. |
| `--ouroboros` | ✓ | ✓ | documented compatible | `/patina-max` can feed its winner into the existing convergence loop when used with `/patina` behavior. |
| `--format <markdown\|text\|json>` | ✓ | — | — | CLI output-envelope feature. |
| `--json` | ✓ | — | — | CLI alias for `--format json`; `patina doctor --json` also exists. |
| `--quiet` | ✓ | — | — | CLI stderr log suppression for scripts. |
| `--json-logs` | ✓ | — | — | CLI structured stderr logs for automation. |
| `--batch` | ✓ | ✓ | — | Multi-file CLI/skill rewrite flow. |
| `--in-place` | ✓ | ✓ | — | Batch-only write mode. |
| `--suffix <ext>` | ✓ | ✓ | — | Batch-only alternate output naming. |
| `--outdir <dir>` | ✓ | ✓ | — | Batch-only output directory. |
| `--save-run <dir>` | ✓ | — | — | CLI reproducibility manifest and outputs. |
| `--no-interactive` | ✓ | — | — | CLI input safety for non-TTY automation. |
| `--lang <code>` | ✓ | ✓ | ✓ | `ko`, `en`, `zh`, `ja`. |
| `--profile <name>` | ✓ | ✓ | ✓ | Profile override. |
| `--tone <name>` | ✓ | ✓ | — | `/patina-max` inherits profile/pattern behavior but does not expose tone parsing directly. |
| `--model <id>` | ✓ | — | — | CLI single-backend model selection. |
| `--models <list>` | ✓ | — | ✓ | CLI MAX mode and `/patina-max` model fanout. |
| `--max-concurrency <n>` | ✓ | — | — | CLI HTTP MAX fanout cap; `/patina-max` uses tmux/direct dispatch instead. |
| `--api-key-file <path>` | ✓ | — | — | CLI auth. |
| `--base-url <url>` | ✓ | — | — | CLI provider/backend config. |
| `--backend <name[,name]>` | ✓ | — | — | CLI backend selection and explicit fallback chains (`openai-http`, `codex-cli`, `claude-cli`, `gemini-cli`). |
| `--list-backends` | ✓ | — | — | CLI diagnostics. |
| `--provider <name>` | ✓ | — | — | CLI provider preset. |
| `--list-providers` | ✓ | — | — | CLI diagnostics. |
| `--config <path>` | ✓ | — | — | CLI config override. |
| `--prompt-mode <strict\|minimal\|auto>` | ✓ | ✓ | — | User-visible v3.11 prompt loading control. |
| `--variants <n>` | ✓ | ✓ | — | User-visible v3.11 rewrite variants; not supported with CLI MAX mode. |
| `--allow-insecure-base-url` | ✓ | — | — | CLI network safety override. |
| `--allow-private-base-url` | ✓ | — | — | CLI SSRF/metadata-address safety override. |
| `-h`, `--help` | ✓ | — | — | CLI help. |
| `-v`, `--version` | ✓ | — | — | CLI version. |
| `patina init` | ✓ | — | — | CLI project config writer. |
| `patina doctor` | ✓ | — | — | CLI environment diagnostic. |
| `patina auth status/login` | ✓ | — | — | CLI authentication guidance. |
| `--dispatch <omc\|direct>` | — | — | ✓ | `/patina-max` dispatch selection; not a standalone CLI flag. |

## Audit notes

- `--prompt-mode` and `--variants` are the main user-facing omissions that must be visible in `SKILL.md` as well as the CLI.
- `--save-run`, `--max-concurrency`, auth/provider/base-url flags, and `doctor`/`auth` commands are CLI automation or transport controls; they do not map cleanly to prompt-only skills.
- `/patina-max` intentionally exposes only the flags needed for local multi-model dispatch: language/profile, model list, and dispatch mode.
