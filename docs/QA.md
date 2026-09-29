# Testing and verification

`package.json` lists the available commands. These profiles run from a source
checkout; the npm package contains runtime files, not the test harness.

## Commands

| Command | Coverage |
|---|---|
| `npm test` | Unit and CLI fixtures; no registry installation or live backend probes |
| `npm run test:unit` | Unit tests |
| `npm run test:e2e` | CLI and integration-style fixtures under `tests/e2e/` |
| `npm run lint` | Syntax, ESLint, TypeScript, CSpell, and AST architecture checks |
| `npm run test:browser` | Real Chromium with local transport fixtures; Node 24 development profile |
| `npm run test:release-install` | Public-registry installation of local root and alias tarballs |
| `npm run benchmark` | Fixed quality fixtures |
| `npm run benchmark:report` | Benchmark report generation |
| `npm run benchmark:compare` | Detector comparison report generation |
| `npm run benchmark:perf` | Deterministic timing report |
| `npm run benchmark:perf -- --costmetrics` | Tarball size, cold CLI timing, and warm analyzer measurements |
| `npm run dogfood` | Configured public-document checks |
| `npm run release:check` | Release metadata and retired-concept checks |
| `npm run check:no-private-assets` | Tracked and packaged path checks |
| `npm run quality:live` | Model-backed quality; uses configured credentials and provider quota |

A focused test can be run directly, for example:

```bash
node --test tests/unit/verify.test.js
```

Choose or add checks that answer the question raised by the change. Fixtures,
reproductions, benchmarks, browser sessions, and live services provide different
kinds of evidence. A local fixture result describes that fixture; hosted CI,
model quality, and production health have their own observations.

## Test environment

CI installs dependencies before running the profiles. The browser job installs
Chromium; the release-install job accesses the public npm registry. Backend
listing tests inject status probes, authentication tests use synthetic files,
and Antigravity launch tests use temporary homes.

Separate homes, caches, temporary directories, and dynamic ports are useful
for tests that interact with local configuration or processes. Existing helpers
under `tests/helpers/` and the nearby test files provide examples.

The Redis quota regression uses `PATINA_TEST_REDIS_SERVER` and
`PATINA_TEST_REDIS_CLI`. It skips when these executables are absent. CI's quality
job installs them and checks that the regression executed with zero skips.

## Results and diagnostics

Useful result summaries identify the command, tested revision, outcome, and
any relevant skips or environmental limitations. A failure can come from the
product, test fixture, environment, or service; its cause determines the next
step. Reproduction cases and before/after results help explain behavioral fixes.

The private-asset gate covers paths such as `.env`, `.env.*`, keys, credentials,
`docs/internal/`, and client-specific agent files. Root `AGENTS.md` and the
sanitized root `.env.example` are tracking exceptions. The gate checks paths,
not file contents. Local diagnostics belong in ignored output directories;
shared evidence can use synthetic text and summaries without credentials.

## Platform smoke

CI currently runs Linux. `npm run smoke:platform` exercises the local platform:
installation, CLI version, offline scoring, inspect/batch file handling,
process cancellation and isolation, offline doctor, and unit/e2e tests.
It makes no model call.

```bash
npm run smoke:platform
# If dependencies are already installed:
npm run smoke:platform -- --skip-install
```

The script writes a structured receipt to
`docs/operations/platform-smoke-<platform>-<arch>-<YYYYMMDD>.json` and raw
diagnostics to ignored `docs/internal/`. The receipt includes exit statuses,
test counts, failing names, and sanitized paths. On Windows, cancellation tests
and fake Antigravity launch fixtures have POSIX-related skips. A doctor report
with no usable backend is distinct from a crash or malformed output.

Windows runs use a Node-capable shell such as PowerShell or Git Bash.
`install.sh` is POSIX-only. Further tooling details are in [HARNESS.md](HARNESS.md).
