# CLI / Skill Flag Parity

Basis: local checkout plus `node bin/patina.js --help` and `SKILL.md` reviewed on 2026-06-04. This table separates the standalone CLI surface from the prompt-based `/patina` skill; a missing check is not always a bug when the flag is backend-, auth-, or CLI-automation-only.

| Flag / command | Standalone CLI | `/patina` (`SKILL.md`) | Notes |
|---|:---:|:---:|---|
| *(default rewrite)* | ✓ | ✓ | Both rewrite one candidate. |
| `--diff` | ✓ | ✓ | Single-candidate pattern-by-pattern diff. |
| `--audit` | ✓ | ✓ | Detection-only mode. |
| `--score` | ✓ | ✓ | Score mode is available on both surfaces. |
| `--exit-on <n>` | ✓ | — | CLI score-gate spelling for CI. |
| `--ouroboros` | ✓ | ✓ | Iterative rewrite / score convergence loop. |
| `--format <markdown\|text\|json>` | ✓ | — | CLI output-envelope feature. |
| `--quiet` | ✓ | — | CLI stderr log suppression for scripts. |
| `--batch` | ✓ | ✓ | Multi-file CLI/skill rewrite flow. |
| `--in-place` | ✓ | ✓ | Batch-only write mode. |
| `--suffix <ext>` | ✓ | ✓ | Batch-only alternate output naming. |
| `--outdir <dir>` | ✓ | ✓ | Batch-only output directory. |
| `--no-interactive` | ✓ | — | CLI input safety for non-TTY automation. |
| `--lang <code>` | ✓ | ✓ | `ko`, `en`, `zh`, `ja`. |
| `--profile <name>` | ✓ | ✓ | Profile override. |
| `--tone <name>` | ✓ | ✓ | Shared tone surface. |
| `--model <id>` | ✓ | — | CLI single-backend model selection. |
| `--api-key-file <path>` | ✓ | — | CLI auth. |
| `--base-url <url>` | ✓ | — | CLI provider/backend config. |
| `--backend <name[,name]>` | ✓ | — | CLI backend selection and explicit fallback chains (`openai-http`, `codex-cli`, `claude-cli`, `gemini-cli`). |
| `--list-backends` | ✓ | — | CLI diagnostics with selectors and auth state. |
| `--provider <name>` | ✓ | — | CLI provider preset. |
| `--config <path>` | ✓ | — | CLI config override. |
| `--allow-insecure-base-url` | ✓ | — | CLI network safety override. |
| `--allow-private-base-url` | ✓ | — | CLI SSRF/metadata-address safety override. |
| `-h`, `--help` | ✓ | — | CLI help. |
| `-v`, `--version` | ✓ | — | CLI version. |
| `patina init` | ✓ | — | CLI project config writer. |
| `patina doctor` | ✓ | — | CLI environment diagnostic. |
| `patina auth status/login` | ✓ | — | CLI authentication guidance. |

## Audit notes

- Auth/provider/base-url flags and `doctor`/`auth` commands are CLI automation or transport controls; they do not map cleanly to prompt-only skills.
