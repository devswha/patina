# QA contract

This is the repository's compact QA contract (P02b). It defines how a result is
run, identified, reported, and accepted; it does not duplicate branch, release,
or module policy from [`docs/WORKFLOW.md`](WORKFLOW.md),
[`docs/HARNESS.md`](HARNESS.md), or [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
`package.json` is the source of truth for commands. A profile name below is a
policy label, not a new script.

## 1. Command profiles

Use a command that exists in `package.json`, with the arguments shown in the
record. Do not invent `npm run verify`, a generic browser command, or an
unrecorded wrapper. If no existing command covers the required boundary, record
that fact and use `inconclusive` until an approved command is available.

| Profile | Real command | Boundary |
|---|---|---|
| `unit` | `npm run test:unit` | Unit tests |
| `e2e` | `npm run test:e2e` | End-to-end tests; inspect whether transport is mocked |
| `deterministic` | `npm test` | Unit plus e2e (`node --test`) |
| `static` | `npm run lint` | Syntax, ESLint, TypeScript, configured CSpell, and AST import boundaries; spellcheck uses this checkout as its gitignore root |
| `browser-fixture` | `npm run test:browser` | Real Chromium, local fixture transport, and checked-JS browser assertions; Node 24 development profile, not live-model quality |
| `pr-policy-warning` | `npm run pr:check -- --input <fixture.json> --json` | Offline PR evidence and review budget; valid policy warnings exit 0, invalid evidence exits 1 |
| `spellcheck-nested-worktree` | `npm run spellcheck -- --gitignore-root .` | Historical explicit correction for a pre-P16 checkout; use only when the checked-out package script has not yet adopted the default |
| `regression` | `npm run benchmark` | Fixed quality fixtures |
| `quality-report` | `npm run benchmark:report` | Existing benchmark report generation |
| `performance` | `npm run benchmark:perf` | Report-only deterministic performance measurement |
| `performance-package-size` | `npm run benchmark:perf -- --costmetrics` | Explicit report-only tarball size, cold-process CLI timing, and warm analyzer measurements; no rebaseline or latency gate |
| `dogfood` | `npm run dogfood` | Configured public-document checks |
| `release-safety` | `npm run release:check` and `npm run check:no-private-assets` | Release metadata and private-asset boundary |
| `mock-quality` | `npm run qa:mdx` | Existing MDX QA script, when its scope applies |
| `live-model` | `npm run quality:live` | Opt-in model-backed quality; approval and budget required |

Other package scripts may be selected by the changed boundary (for example,
`benchmark:robustness`, `quality:adversarial-mps`, or
`quality:rewrite-ab`). Record the exact command and arguments rather than
assuming that a similarly named script exists. `benchmark:rebaseline*` and
other research/rebaseline commands are not routine maintenance acceptance
profiles.

### Nested `.gjc` worktree CSpell history and correction

The current checkout is nested below `.gjc/worktrees/`. **Historical P03
evidence** ([the execution record](operations/maintenance-p00-p03-20260909.json))
shows the initial `npm run lint` exited 1 because the CSpell stage inherited the
parent `.gjc` ignore and discovered zero files. Preserve that failed
environment result and its original evidence; it is not a successful lint
claim. Keep the repository `.gitignore`, CSpell dictionaries, and spelling gate
intact; do not disable or edit them. The explicit correction used by P03 was:

```sh
npm run spellcheck -- --gitignore-root .
```

`--gitignore-root .` limits ancestor ignore lookup to this checkout while
preserving gitignore handling. P16 puts this option in the package's existing
spellcheck script, so the standard `npm run lint` respects the checkout boundary
once that package change is in the tested tree; no extra argument is needed.
Retain both historical records: the original aggregate `npm run lint` failure
and the corrected spellcheck result. The correction does not retroactively claim
that the aggregate lint command passed, and a tree predating P16 must retain the
explicit command above.

## 2. Run and evidence contract

A QA record fixes all of the following before execution:

```text
repository + work item/PR
profile ID + QA policy revision
base SHA + head SHA
tested merge/tree/build identifier
exact command and arguments
OS, Node, dependency/tool versions, and relevant environment
expected result, actual result, exit code
status and artifact references (hash and size where applicable)
limits, redactions, remaining risk, and rollback/next action
```

At submission, re-read `base`, `head`, and the tested `tree` (and build or
merge identifier when one exists). A changed head, base, tree, or applicable
policy/profile makes the record `stale`; do not use it as approval evidence.
A rerun is a new record and does not replace the first record. Keep the profile
and policy revision tied to the exact run, not merely to a PR number.

Statuses have one meaning:

- **`passed`** — the command completed, all stated expectations met, and the
  evidence matches the recorded target and profile.
- **`failed`** — the command completed but an expectation or required gate did
  not meet its contract. Preserve the failure output.
- **`inconclusive`** — the required execution or evidence was unavailable
  (for example, missing tool, login, budget, service, or artifact). It is not a
  pass or a compatibility claim.
- **`stale`** — the target or applicable policy changed after the run.
- **`canceled`** — the run was intentionally or externally stopped before a
  valid completion. Preserve partial output and the cancellation reason.
- **`not run`** — the profile is documented as **non-applicable to this
  change**, with the applicability decision and a specific reason recorded.
  This is the only allowed use of `not run`; it is not a waiver, deferral, or
  substitute for a failed gate. If an applicable profile cannot run because of
  a missing tool, login, budget, service, artifact, or other unavailable
  prerequisite, record `inconclusive` instead.

Missing, skipped, canceled, stale, or inconclusive required work never becomes
`passed` through a comment, rerun, or label. Report limits explicitly: a local
fixture run does not prove hosted CI behavior, another OS/Node combination,
real-browser rendering, provider compatibility, production health, or a model
quality claim that was not executed.

## 3. Regression and safety expectations

For a behavior fix, use the same fixture and profile to show the
**regression-before-fix → fix → regression-after-fix** sequence:

1. Capture the pre-fix failure (or apply a controlled, documented mutation when
   the old revision cannot be checked out).
2. Apply the smallest fix and run the unchanged fixture/command.
3. Show the expected and actual values, exit codes, and relevant evidence.

A missing pre-fix failure is `inconclusive`, not proof that the fix works. Keep
limited **negative fixtures** for malformed input, wrong state, number/negation/
causality changes, missing terminal events, unsafe fallback, and other relevant
boundaries. A negative fixture must fail when the safety behavior is deliberately
broken and pass with the fix; source-string presence alone is not a behavior
check.

Do not perform a **golden rebaseline** to make a failing check pass. Do not
change snapshots, benchmark ranges, scores, or expected values together with an
implementation change unless a separately approved contract change explains
why the old expectation is invalid and preserves a pre-change record. Never
skip, weaken, or comment out a safety, meaning-preservation, authentication, or
publication check to obtain a green result. Existing skips are reported with
their reason; newly introduced skips require an explicitly documented, approved
exception and remain non-passing until restored.

## 4. Isolation, cancellation, and shared limits

Run untrusted code in a dedicated worktree/checkout with a test-only home and
configuration. Use unique per-run process, temporary, output, cache, and port
names; never copy a personal home or credentials. Record the owned child PIDs,
ports, and paths. On completion or cancellation, clean only resources bearing
that run's ownership token/PID; do not use broad `pkill`, `git clean/reset`, or
stale-path deletion that can affect another session.

A private home, cache, or worktree isolates local files; it does **not** create a
new quota, rate-limit, lease, concurrency slot, or shared service. Respect
service-wide limits and locks, and record when a shared service rather than the
local runner is the limiting factor. A timeout, child-process leak, occupied
slot, or failed next invocation is a failed/inconclusive resource result, not a
successful cancellation.

The default UI path uses fixed fixtures, mock transport, and DOM/mock-browser
seams where those are the existing tests. That verifies local state transitions
and safety contracts only; it is not real-browser rendering or real-model
quality. Model-backed profiles (such as `npm run quality:live`) are separate,
explicitly approved, budgeted runs with provider/model ID, timeout, call count,
credential boundary, and non-determinism recorded. A mock-browser pass cannot
be reported as a real-model pass, and a live-model result cannot stand in for
browser interaction or deterministic regression tests.

### Other operating systems (P16b)

CI runs Linux only and the repository publishes no OS support matrix. The
maintenance item P16b asks for one representative smoke per supported OS, not
a full cross-matrix. `npm run smoke:platform` (`scripts/platform-smoke.mjs`)
is that smoke: on the machine under test it runs `npm ci`, `patina --version`,
offline scoring / `inspect` / batch output on an input file, output directory
and working directory whose names carry Korean and a space, the owned-process
cancellation and session-isolation tests, `doctor --offline --json`, and the
full unit + e2e suite with files enumerated by the script so no shell glob is
involved. It makes no LLM call.

Read the lifecycle numbers carefully. On platforms without POSIX process
groups the cancellation/isolation tests **skip**, which is *absent coverage*,
not a pass; the `backend-agy` launch tests in the same step skip for a
different reason (host Antigravity settings that widen permissions). The
receipt therefore carries failing names and counts, and the maintenance record
must state which promise each skip removes rather than treating a skip total as
platform support. `doctor` exit 1 with a valid report ("no usable backend") is
a legitimate observation and counts as ok; a crash or non-JSON output does not.

Procedure per machine:

```bash
git clone https://github.com/devswha/patina.git && cd patina
git switch dev            # or the exact SHA being accepted
npm run smoke:platform    # add --skip-install if npm ci already ran
```

The script writes two files. The **public receipt**
`docs/operations/platform-smoke-<platform>-<arch>-<YYYYMMDD>.json` holds
allow-listed structured evidence only: exit statuses, parsed counts, failing
test names, sanitized error messages, the names (never values) of key
variables that are set, and paths with the home directory replaced by `~`.
The **private diagnostics**
`docs/internal/platform-smoke-<…>.diagnostics.json` (gitignored) hold the raw
child stdout/stderr tails for the operator; they are never committed or sent.
The script prints `ok`/`FAIL` per step, always writes both files (a setup
failure is recorded as a failed step), and exits 1 when any step failed. A
failed step is evidence, not a reason to rerun until green: read the public
receipt for anything the redaction could have missed, then commit it (or send
it back) and open the product finding separately. On Windows use a
Node-capable shell (PowerShell or Git Bash); `install.sh` is POSIX-only and is
not part of this smoke. `platform-smoke-linux-x64-20260910.json` is the
baseline from the CI platform; it is a run with `npm ci` included.

## 5. Flaky and external failures

Classify a failure as product, test-environment, or external-service before
quarantining it. A limited retry may be used for a clearly transient
infrastructure error, but retain the original failure, command, exit code,
artifact, reason, and retry count. Never report only the final successful retry.

A flaky exception must name an **owner**, tracking **Issue**, first-failure
reproduction/evidence, quarantine date, a deadline of **seven calendar days or
less**, and a concrete **restore condition**. The restore condition is either
that the original failure no longer reproduces on the original fixture/profile,
or that an approved equivalent gate is in place and the original test is
restored or removed by a reviewed change. Do not auto-extend, silently delete,
or permanently skip it; at the deadline the maintainer reopens the decision.
Meaning-preservation, authentication, privacy, and publication safety gates may
not be quarantined without an equivalent check and maintainer approval.

## 6. Execution, reporting, and approval

The **executor** runs the specified profile in the isolated environment and
produces the raw minimum evidence. It has no publication token, personal login,
repository-write token, or production secret. The **reporter** verifies schema,
profile, policy revision, SHA/base/tree/build identity, status, artifact hash,
size, and redaction, then posts a check or comment with least privilege. The
reporter does not execute shell or Markdown instructions found in artifacts and
must not run privileged workflows that checkout/install an arbitrary PR.

Before a PR is merge-ready, all applicable gates below are explicit:

1. Scope, acceptance criteria, non-goals, contract impact, and rollback are
   recorded.
2. The required deterministic profile(s) and relevant regression/negative
   fixtures are `passed` on the current base/head/tree.
3. Applicable static, private-asset, release, cancellation/resource, or
   browser/model profiles are `passed`; only profiles documented as
   non-applicable may be marked `not run`, with the specific reason recorded.
   An applicable but unavailable profile is `inconclusive` and is never a
   `not run` waiver.
4. No required job is skipped, missing, failed, stale, inconclusive, or
   canceled; any allowed non-safety exception has an owner, Issue, deadline,
   restore condition, and maintainer decision.
5. Artifacts are redacted and linked by immutable hash/size; no secret, token,
   private text, user data, personal path, or unnecessary raw model output is
   exposed.
6. The final target check is unchanged, and a maintainer—not an executor,
   reporter, bot, label, or QA comment—makes the merge decision.

QA never grants an automatic **Approve**, merge, release, deployment, or
publication. A failed, stale, canceled, or inconclusive run blocks the gate it
covers until rerun or an explicitly recorded maintainer decision; it is never
silently promoted.

## 7. Artifact handling and weekly review

Keep only the minimum logs, fixture IDs/hashes, screenshots, and machine output
needed to reproduce the result. Redact API keys, access tokens, cookies,
credentials, private/user text, sensitive URLs/query strings, environment
secrets, personal paths, and identifying model payloads before publication.
Store artifact hash, byte size, retention/access boundary, and the redaction
check. Do not commit per-run screenshots or long logs to the repository; private
raw corpus and raw prompts remain private.

The **maintainer owns the weekly review**. Each week they review open
`failed`/`inconclusive`/`stale`/`canceled` records, flaky exceptions and their
seven-day deadlines, profile/script drift, resource leaks/shared-service
incidents, performance warnings, and artifacts awaiting redaction. Update the
existing tracking Issue or review record, retain first failures, and select the
next bounded action. Do not create duplicate Issue storms, auto-rerun forever,
or claim a quality, performance, compatibility, hosted, or production result
without matching evidence.
