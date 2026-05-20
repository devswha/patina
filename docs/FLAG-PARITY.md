# Flag Parity

This audit compares the standalone CLI help in `src/cli.js`, the main Claude/Codex skill in `SKILL.md`, and the MAX skill in `patina-max/SKILL.md`.

Legend: `✓` means the surface documents the flag or subcommand as an explicit user-facing option. `✗` means it is absent from that surface.

| Flag / command | CLI | `SKILL.md` | `patina-max/SKILL.md` | Notes |
|---|---:|---:|---:|---|
| `-h`, `--help` | ✓ | ✗ | ✗ | CLI help only. |
| `-v`, `--version` | ✓ | ✗ | ✗ | CLI help only. |
| `--lang <code>` | ✓ | ✓ | ✓ | Shared language selector. |
| `--profile <name>` | ✓ | ✓ | ✓ | Shared profile selector. |
| `--tone <name>` | ✓ | ✓ | ✗ | Main rewrite skill only. |
| `--diff` | ✓ | ✓ | ✗ | Main rewrite skill only. |
| `--audit` | ✓ | ✓ | ✗ | Main rewrite skill only. |
| `--score` | ✓ | ✓ | ✗ | MAX skill scores internally, but does not expose `--score` as an argument. |
| `--gate <n>` | ✓ | ✗ | ✗ | CLI-only score gate. |
| `--ouroboros` | ✓ | ✓ | ✗ | MAX skill mentions re-running strong results, but does not list this as a setup option. |
| `--batch` | ✓ | ✓ | ✗ | Main rewrite skill only. |
| `--in-place` | ✓ | ✓ | ✗ | Batch output option. |
| `--suffix <ext>` | ✓ | ✓ | ✗ | Batch output option. |
| `--outdir <dir>` | ✓ | ✓ | ✗ | Batch output option. |
| `--save-run <dir>` | ✓ | ✗ | ✗ | CLI reproducibility output. |
| `--models <list>` | ✓ | ✗ | ✓ | CLI MAX mode and MAX skill. |
| `--max-concurrency <n>` | ✓ | ✗ | ✗ | CLI MAX-mode concurrency cap. |
| `--variants <n>` | ✓ | ✓ | ✗ | CLI rewrite mode and main skill. Not supported with `--models` / MAX mode. |
| `--model <id>` | ✓ | ✗ | ✗ | Single backend model ID. |
| `--api-key <key>` | ✓ | ✗ | ✗ | Deprecated CLI auth flag; prefer env/file. |
| `--api-key-file <path>` | ✓ | ✗ | ✗ | CLI auth flag. |
| `--base-url <url>` | ✓ | ✗ | ✗ | CLI HTTP backend configuration. |
| `--backend <name>` | ✓ | ✗ | ✗ | CLI backend selector. |
| `--list-backends` | ✓ | ✗ | ✗ | CLI auth/debug output. |
| `--provider <name>` | ✓ | ✗ | ✗ | CLI provider preset selector. |
| `--list-providers` | ✓ | ✗ | ✗ | CLI provider debug output. |
| `--allow-insecure-base-url` | ✓ | ✗ | ✗ | CLI security opt-in for plaintext non-localhost HTTP. |
| `--allow-private-base-url` | ✓ | ✗ | ✗ | CLI security opt-in for private / IMDS base URLs. |
| `--config <path>` | ✓ | ✗ | ✗ | CLI config override. |
| `--prompt-mode <m>` | ✓ | ✓ | ✗ | CLI rewrite mode and main skill. |
| `--dispatch <mode>` | ✗ | ✗ | ✓ | MAX skill dispatch mode (`omc`, `direct`, `api` documented in the skill). |
| `patina auth status` | ✓ | ✗ | ✗ | CLI subcommand. |
| `patina auth login` | ✓ | ✗ | ✗ | CLI subcommand. |

## User-visible gaps

- `SKILL.md` now documents `--variants <n>` and `--prompt-mode <strict|minimal|auto>` because those change normal rewrite behavior.
- `SKILL.md` still intentionally omits lower-level CLI-only operational flags such as `--api-key-file`, `--base-url`, `--provider`, and private URL opt-ins. Those are better covered by `patina --help` and the CLI/auth docs.
- `patina-max/SKILL.md` is a separate orchestration skill. It should not advertise `--variants` unless MAX mode grows support for variants; the CLI currently rejects `--models` with `--variants > 1`.
