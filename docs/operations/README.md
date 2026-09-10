# docs/operations — maintainer records

Dated records of the Pro launch: payment provider, serving engines, cost and
margin, secrets, rollback, monitoring. They are evidence and decision records
for maintainers, not user documentation; nothing under this directory is
needed to run patina. This index (written 2026-09-02) says which file is
live, which is terminal, and which must not be edited.

## Rules

- **The v6.4 preflight hold was retired on 2026-09-02** (owner decision):
  `v6.4-preflight-hold.json`, `scripts/check-v6.4-preflight-hold.mjs`,
  `scripts/check-v6.4-release-ready.mjs` and their tests were removed, so no
  file in this directory is hash-frozen any more. `pro-launch.md` and the
  `pay-*.json` evidence files are ordinary tracked records now.
- **Append-only by their own header:** `dep-prod-disabled-20260803.md` (private),
  `polar-approval-20260803.md`, `secret-manager-record-20260803.md`. Add a
  dated section; never rewrite the body.
- The retired hold still listed its nine human blockers as `evidence: null`
  even though checkout opened on 2026-08-04; the exit records that actually
  closed them are the chain below (`live-open-20260804.md` is the terminal
  node). Its last state is in git history (removed in the 2026-09-02
  retirement commit).

## Live documents (start here)

| file | role |
|---|---|
| `pro-launch.md` | sale-close / service-kill / key-rotation runbook (v6.4 framing; no longer hash-frozen) |
| `live-open-20260804.md` | terminal record: checkout enabled on production via Polar |
| `rollback-drills.md` | measured sale-close drill used by live-open |
| `dashboards/pro-launch-v1.md`, `queries/pro-launch-v1.md` | private monitor operating procedure and queries (`services/log-query/`) |
| `pro-margin-decision-20260729.md` | Pro cap = 100 rewrites/month; cited from `src/web-rewrite-contract.js` |
| `serving-engine-gemini-3.7-flash-20260813.md` | latest engine decision: 3.7-flash allowlisted opt-in, Pro pin unchanged |
| `free-tier-deepseek-flip-20260803.md` | 2026-08-03 free-tier flip to deepseek; **superseded** — owner confirmed on 2026-09-02 that the free tier serves on gemini (env `PATINA_FREE_MODEL`) |

## Evidence chains (read the last node first)

1. **Payment:** `payment-provider-reset-20260729.md` (private) (Lemon Squeezy declined)
   → `polar-application-prep.md` (private) → `polar-onboarding-steps.md` →
   `polar-integration-evidence-20260729.md` → `polar-binding-migration.md` →
   {`polar-approval-20260803.md`, `secret-manager-record-20260803.md`,
   `dep-prod-disabled-20260803.md`} → `gate-b-readiness-20260803.md` →
   `synthetic-license-20260804.md` (private) → **`live-open-20260804.md`**.
   The Lemon Squeezy-era `owner-actions-go-live.md` and
   `production-go-live-checklist.md` were TERMINAL and were removed on
   2026-09-02 (git history keeps them).
2. **Cost and margin:** `g002-collector-redesign.md` → `pay-b-cost-v1.md`
   → **`pro-margin-decision-20260729.md`**; `number-safety-failure-rate-20260730.md` (private)
  is a corrected side measurement; its failure-allowance follow-up shipped in
  8.1.3 (`pro-failure-recovery-20260904.md`).
3. **Serving engine:** `serving-engine-cost-20260725.md` →
   `register-failure-handoff-20260726.md` (research, closed 2026-07-27) →
   `serving-engine-deepseek-0731-20260803.md` (retracted) →
   **`serving-engine-deepseek-0731-correction-20260803.md`** →
   **`free-tier-deepseek-flip-20260803.md`**; `serving-engine-gemini-3.7-flash-20260813.md`
   is a self-contained branch.
4. **Secrets (names only, never values):** `secret-manager-record-20260803.md`
   → **key rotation 2026-09-04**: the owner replaced `PATINA_FREE_API_KEY` and
   `PATINA_PRO_API_KEY` (Vercel Production, Sensitive) with product-only Gemini
   keys in the dashboard; production was redeployed
   (`patina-ihkxs0l2g`, alias `patina.vibetip.help`), the free tier was
   verified by one live `/api/rewrite` call, and the pro tier by the synthetic
   monitor's next scheduled run. Research jobs use a separate local key.

## Known open loops (recorded, not resolved here)

- First healthy `OBS-ALERT-v1` receipt after live-open: no record found.
  The recurring 503 incident was repaired through the stable log-query alias
  and the Discord message envelope fix in 8.1.3. Ordinary production cron
  returned 200 on 2026-09-05. The formal eligible alert/recovery receipt still
  needs its own evidence; a successful cron status alone does not establish it.
  See `pro-monitor-endpoint-repair-20260904.md` and
  `pro-failure-recovery-20260904.md`.
- Trusted server-side rewrite failures now restore Pro request/character
  allowance once (8.1.3). This is usage allowance restoration, not a payment
  refund. Client cancellations after admission remain charged.
- Free-tier engine: resolved 2026-09-02 — owner confirmed gemini; no record
  in this directory documents the flip back from deepseek, so the env value on
  the deployment stays the source of truth.
- `secret-manager-record-20260803.md` predates 8.0.0, which removed
  `PATINA_LICENSE_PROVIDER` as a vendor selector.

## 2026-09-09 maintenance evidence (P21/P22)

The calculation source for the low-tier monitor is
`src/pro-monitor.js#evaluateFreeTierHealth`; event collection remains the
closed aggregate observer in `src/web-observability.js`. Free/BYOK successful
events are `sampled_1_of_20` and failures are full-census events. A rate must
therefore use the sampled-success estimate (observed successes × 20) plus
full-census failures, never the raw success counter as a census denominator.
Unknown outcomes or monitor-drop counts make that rate unavailable rather than
silently treating missing data as zero; the paid monitor likewise excludes
those classifications from its known production denominator and raises
monitor blindness when they are the only aggregate evidence. The existing
15-minute/30-minute windows, coarse latency buckets, no-interpolation p95 rule,
7,200-second aggregate TTL, and aggregate-only/privacy boundary remain
unchanged. An `unknown` latency bucket is aggregate-ineligible, never a
zero-valued latency observation.

The offline recovery fixture and its no-publication boundary are documented in
[`rollback-drills.md`](rollback-drills.md). It is code evidence only: no
production incident, deployment, provider, Discord, registry, or
`OBS-ALERT-v1` receipt is claimed. The separate npm partial-registry recovery
lane is owned by
[`scripts/release-artifacts.mjs`](../../scripts/release-artifacts.mjs) and
[`tests/unit/release-artifacts.test.js`](../../tests/unit/release-artifacts.test.js),
with procedure in
[`docs/integrations/release.md`](../integrations/release.md); this web lane
does not unblock npm publication.

### P13a deployment evidence (read-only, promotion still gated)

The contract remains **approved main SHA → same-SHA preview/deployment →
application smoke → maintainer-approved promotion → retained prior deployment
rollback ID**. Read-only Vercel REST showed `productionBranch=main` and
`gitForkProtection=true`; ready deployment
`dpl_9mLY4716GsCKWrGiomn8hKxZLEzN` has source
`b9fff3e44037ea05818311b894b57ca89d0ce595`, `sourceRef=dev`, and was created
`2026-09-09T19:15:06.183+09:00`. Prior ready production
`dpl_H56Atjg5KJ7YdNPUjCPSs16exshy` has source
`d7a4741ed9f767bd22a39255e10acf159351fb7a`. The b9 SHA is a main ancestor and
both deployment/release trees are
`7cd7f924d1b2228a9692b64842b69918beaf2a21`, so the source-ref discrepancy is
not a proven content mismatch; the maintainer must reconcile the `sourceRef=dev`
exception. A public GET rendered the `8.6.0` title (basic read smoke only).
Environment metadata exposed counts `production=34` and `preview=31` with
`decrypt=false`; no values were read. Required checks/settings remain
**unknown**; account confirmation is human-blocked, and promotion/rollback are
unexecuted, unapproved, and human-blocked. The earlier
GitHub deployment `6347382527` (source
`d7a4741ed9f767bd22a39255e10acf159351fb7a`) reported success but was neither
application smoke nor Vercel account evidence.

### P01 client acceptance (2026-09-10)

`cursor-acceptance-20260910.json` supersedes the P01 `inconclusive` row in
`maintenance-delivery-20260910.json`. The real Cursor Agent CLI
(2026.09.08, Linux) loaded the always-applied project rule and resolved
`@AGENTS.md` both in the maintainer checkout and in a fresh `--depth=1` clone
of `dev` with no local files, exposed the generated `~/.cursor/rules/patina.mdc` adapter as
agent-requestable, fetched the canonical `SKILL.md` from the adapter's absolute
path, ran `bin/patina-skill.js`, refused to write output on two backend
authentication failures, and wrote the result only after a `verified` receipt
(mps 100 / fidelity 100, codex-cli). Cursor IDE desktop loading and other
operating systems remain uncovered.

### P17b backend compatibility pilot (2026-09-10)

`backend-compat-codex-20260910.json` supersedes the P17b `inconclusive` row in
`maintenance-delivery-20260910.json` for **codex-cli only**. Ten live
invocations of codex 0.153.4 (gpt-5.5, ChatGPT OAuth, no provider API key
read) verified score parsing, `--verify` retry, a 1.5 s timeout kill with
process and temp-directory cleanup, the foreign-model fallback, and the
invalid-model error path. The verdict lives in
`tests/fixtures/backend-codex-contract.json`.

`backend-compat-claude-gemini-20260910.json` (same day, after #798 removed
agent tools) adds **claude-cli 2.1.261** (7 invocations, subscription OAuth,
0 tool calls / 0 MCP references in the session log) and **openai-http over the
loopback OpenCodex proxy** with `google-antigravity/gemini-3.7-flash` (6
requests, placeholder key, no provider key). `backend-claude-contract.json`
moves from version-only to verified. Still not exercised: gemini-cli
(api-key mode would spend the product key), kimi-cli, `agy` (no adapter),
quota behavior, other operating systems.

P09 native Codex settings and any unexposed web account configuration remain
unknown; no automation is inferred from a deployment result. The recurring
maintenance owner is the repository maintainer. Repeated alerts for one
repository/channel/tier/deployment/trigger/window are deduplicated into one
incident record with a next-review date; retries are bounded and do not create
unlimited Issues. Credentials, tokens, raw logs, request text, and provider
responses are never collected in these records.

## Publishing

This directory is excluded from the npm tarball (`package.json` `files`:
`!docs/operations/**`). Records marked (private) above carried processor correspondence, operator
identities, an internal deployment URL, or raw cost figures; on 2026-09-02
they were moved to the gitignored `docs/internal/` (also
`polar-form-answers.txt`). They stay on the maintainer's disk and in git
history, and the chains above still name them so the trail stays readable.
