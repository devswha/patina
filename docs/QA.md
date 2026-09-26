# QA contract

How a verification result is run, reported, and accepted. Branch and release
policy lives in [`docs/WORKFLOW.md`](WORKFLOW.md), tool details in
[`docs/HARNESS.md`](HARNESS.md), and module contracts in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md). `package.json` is the source of
truth for commands; a profile name below is a label, not a new script.
Profiles run from a source checkout. The npm package ships only the runtime,
not the test and benchmark harness.

## 1. Command profiles

Use a command that exists in `package.json`, with the arguments shown in the
record. Do not invent `npm run verify`, a generic browser command, or an
unrecorded wrapper.

A **focused run of the existing test runner** needs no new package script. For
example, `node --test tests/unit/maintenance-workflows.test.js` narrows an
existing profile. It supplements the applicable full profile and required CI
rather than replacing them, and it is recorded with its exact command and exit
code. A replacement test framework, or a wrapper that hides which runner
executed, is not allowed.

If no existing command covers the boundary you need, record that and mark the
result `inconclusive` until an approved command exists.

| Profile | Real command | Boundary |
|---|---|---|
| `unit` | `npm run test:unit` | Unit tests |
| `e2e` | `npm run test:e2e` | End-to-end tests; inspect whether transport is mocked |
| `deterministic` | `npm test` | Unit plus e2e (`node --test`) |
| `static` | `npm run lint` | Syntax, ESLint, TypeScript, configured CSpell, and AST import boundaries; spellcheck uses this checkout as its gitignore root |
| `browser-fixture` | `npm run test:browser` | Real Chromium, local fixture transport, and checked-JS browser assertions; Node 24 development profile, not live-model quality |
| `regression` | `npm run benchmark` | Fixed quality fixtures |
| `quality-report` | `npm run benchmark:report` | Existing benchmark report generation |
| `performance` | `npm run benchmark:perf` | Report-only deterministic performance measurement |
| `performance-package-size` | `npm run benchmark:perf -- --costmetrics` | Explicit report-only tarball size, cold-process CLI timing, and warm analyzer measurements; no rebaseline or latency gate |
| `dogfood` | `npm run dogfood` | Configured public-document checks |
| `release-safety` | `npm run release:check` and `npm run check:no-private-assets` | Release metadata and private-asset boundary |
| `live-model` | `npm run quality:live` | Opt-in model-backed quality; approval and budget required |

Other package scripts may fit the changed boundary (for example,
`benchmark:robustness` or `quality:adversarial-mps`).
Record the exact command and arguments rather than assuming a similarly named
script exists. `benchmark:rebaseline*` and other research commands are not
routine acceptance profiles.

## 2. Recording results

Record the repository and PR, the profile, the base and head SHA, the exact
command and arguments, the OS, Node and tool versions, the expected and actual
result, the exit code, and any artifact reference. Mark each run with one
status:

- **`passed`** — completed, and every stated expectation held.
- **`failed`** — completed, but an expectation or gate did not hold. Keep the
  failure output.
- **`inconclusive`** — could not run: a missing tool, login, budget, service,
  or artifact. It is not a pass.
- **`stale`** — the head, base, or applicable profile changed after the run.
- **`canceled`** — stopped before a valid completion. Keep partial output and
  the reason.
- **`not run`** — the profile does not apply to this change, with the reason
  recorded. An applicable profile that cannot run is `inconclusive`, never
  `not run`.

Only `passed` counts as passing. A rerun is a new record and does not erase the
first one, and a comment, rerun, or label never upgrades another status. State
limits plainly: a local fixture run proves nothing about hosted CI, another OS
or Node version, real-browser rendering, provider compatibility, production
health, or model quality that was not exercised.

## 3. Regression and safety expectations

For a behavior fix, show **regression-before-fix → fix → regression-after-fix**
with the same fixture and command:

1. Capture the pre-fix failure (or apply a controlled, documented mutation when
   the old revision cannot be checked out).
2. Apply the smallest fix and rerun the unchanged fixture and command.
3. Show the expected and actual values and exit codes.

A missing pre-fix failure is `inconclusive`, not proof that the fix works. Keep
a small set of **negative fixtures** for malformed input, wrong state,
number/negation/causality changes, missing terminal events, unsafe fallback,
and similar boundaries. A negative fixture must fail when the safety behavior
is deliberately broken and pass with the fix; the presence of a source string
is not a behavior check.

Do not **rebaseline goldens** to make a failing check pass. Do not change
snapshots, benchmark ranges, scores, or expected values together with an
implementation change unless a separately approved contract change explains
why the old expectation is wrong and keeps a record of it. Never skip, weaken,
or comment out a safety, meaning-preservation, authentication, or publication
check to get a green result. Report existing skips with their reason; a new
skip needs an approved, documented exception and stays non-passing until
restored.

## 4. Isolation, cancellation, and shared limits

Run untrusted code in a dedicated worktree or checkout with a test-only home and
configuration. Use unique per-run process, temp, output, cache, and port names,
and never copy a personal home or credentials. Record the child PIDs, ports,
and paths the run owns. On completion or cancellation, clean only resources
carrying that run's ownership token or PID; do not use broad `pkill`,
`git clean`/`reset`, or stale-path deletion that could hit another session.

A private home, cache, or worktree isolates local files. It does **not** create
a new quota, rate limit, lease, concurrency slot, or service. Respect
service-wide limits and locks, and note when a shared service rather than the
local runner was the bottleneck. Run at most one expensive QA job at a time;
queue it or report it unavailable rather than claiming a pass. A timeout,
child-process leak, occupied slot, or failed next invocation is a failed or
inconclusive resource result, not a successful cancellation.

The default UI path uses fixed fixtures, mock transport, and DOM/mock-browser
seams. That verifies local state transitions and safety contracts only, not
real-browser rendering or real-model quality. Model-backed profiles (such as
`npm run quality:live`) are separately approved, budgeted runs that record the
provider and model ID, timeout, call count, credential boundary, and
non-determinism. A mock-browser pass is never reported as a real-model pass,
and a live-model result cannot stand in for browser interaction or
deterministic regression tests.

### Other operating systems

CI runs Linux only, and the repository publishes no OS support matrix.
`npm run smoke:platform` (`scripts/platform-smoke.mjs`) is the per-OS smoke: on
the machine under test it runs `npm ci`, `patina --version`, offline scoring /
`inspect` / batch output on an input file, output directory and working
directory whose names carry Korean and a space, the owned-process cancellation
and session-isolation tests, `doctor --offline --json`, and the full unit + e2e
suite with files enumerated by the script so no shell glob is involved. It
makes no LLM call.

Read the lifecycle numbers carefully. On platforms without POSIX process
groups the cancellation/isolation tests **skip**, which is *absent coverage*,
not a pass; the `backend-agy` launch tests in the same step skip for a
different reason (host Antigravity settings that widen permissions). The
receipt therefore carries failing names and counts, and whoever reads it must
state which promise each skip removes rather than treating a skip total as
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
receipt for anything the redaction could have missed, then share it and open
the product finding separately. On Windows use a Node-capable shell
(PowerShell or Git Bash); `install.sh` is POSIX-only and is not part of this
smoke.

## 5. Flaky and external failures

Classify a failure as product, test-environment, or external-service before
quarantining it. A limited retry is fine for a clearly transient
infrastructure error, but keep the original failure, command, exit code,
artifact, reason, and retry count. Never report only the final successful
retry.

A flaky exception names an **owner**, a tracking **Issue**, the first-failure
evidence, the quarantine date, a deadline **seven calendar days or less** away,
and a concrete **restore condition**: either the original failure no longer
reproduces on the original fixture and profile, or an approved equivalent gate
is in place and the original test is restored or removed by a reviewed change.
Do not auto-extend, silently delete, or permanently skip it; at the deadline
the maintainer reopens the decision. Meaning-preservation, authentication,
privacy, and publication safety gates may not be quarantined without an
equivalent check and maintainer approval.

## 6. Merge readiness

Before a PR is merge-ready:

1. Scope, acceptance criteria, non-goals, contract impact, and rollback are
   written down.
2. The required deterministic profiles and the relevant regression and negative
   fixtures are `passed` on the current head.
3. Every other applicable profile (static, private-asset, release,
   cancellation/resource, browser, model) is `passed`, or `not run` with the
   reason it does not apply.
4. No required job is failed, stale, inconclusive, or canceled, unless an
   allowed non-safety exception has an owner, Issue, deadline, restore
   condition, and maintainer decision.
5. Artifacts are redacted: no secret, token, private text, user data, personal
   path, or unnecessary raw model output.

The maintainer makes the merge decision. QA never grants an automatic approval,
merge, release, deployment, or publication, and a failed, stale, canceled, or
inconclusive run blocks the gate it covers until it is rerun or the maintainer
records a decision.

## 7. Artifacts

Keep only the logs, fixture IDs or hashes, screenshots, and machine output
needed to reproduce a result. Before publishing, redact API keys, access
tokens, cookies, credentials, private or user text, sensitive URLs and query
strings, environment secrets, personal paths, and identifying model payloads.
Record the artifact hash, byte size, and access boundary. Do not commit per-run
screenshots or long logs; private raw corpus and raw prompts stay private.
