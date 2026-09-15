# Remaining work and model evaluation

Owner request received 2026-09-05 KST: finish the remaining issues and compare
models across providers. Gemini experiments must use the existing OpenCodex
proxy, with no Gemini API key. This request resumes the parked ecosystem work.

Completion requires implementation, the issue's acceptance evidence, independent
review, the full test/lint gate, and integration into `dev`. Human ratings,
publication, live operation, and model results require their own direct evidence.
An implementation alone does not close those requirements.

Research disposition updated 2026-09-08: the owner cancelled the previously
deferred #159 human panel and #643 human-labeled short-form corpus. Both are
closed `not_planned`, not pending work or completed studies. Existing evidence
is retained; resuming either study requires a new explicit request.

The earlier status check was 2026-09-07. The
[September 6 scope decision](https://github.com/devswha/patina/issues/643#issuecomment-5559803306)
defers human evaluation and work requiring owner time. Human acceptance criteria
stay unmet; they are not active recruitment or annotation tasks.

## Work ledger

| Item | Required evidence | State |
|---|---|---|
| Pro monitor 503 | Diagnose production aggregate/log adapters; verified healthy monitor and recovery receipt | Discord envelope fix shipped in 8.1.3; ordinary cron returned 200; eligible alert/recovery receipt still pending |
| Failed rewrite allowance | Bounded, idempotent recovery of charged requests/characters; concurrency and storage-failure tests | Shipped in 8.1.3 (#726, #728–729); independent review, real Redis and full gates passed |
| Model comparison | Available-model inventory, fixed protocol, repeated live runs, cross-family judges, per-provider recommendations | Six-finalist confirmation and qualified guide published September 5; Kimi and other unconfirmed routes retain the guide's limits |
| #412 live scorer benchmark | Run `src/scoring.js` against real fixture/rebaseline texts; distributions by pattern pack, recorded model/usage/errors | Complete: 930/931 valid fixture observations plus 85/85 separate rebaseline observations; issue closed September 5 |
| #643 short-form corpus | Real human/AI sources, human labels, all requested slices and counterfactual pairs, FNR/exact-zero gates | Cancelled by owner September 8; closed `not_planned`. Human acceptance remains unmet; existing automation and diagnostics are retained as evidence, not a remaining task |
| #159 human evaluation | 30 randomized pairs × 5 actual human raters, agreement and score/rating association | Cancelled by owner September 8; closed `not_planned`. The panel was not run and is no longer queued |
| #206 VS Code | Separate repository; status score, diagnostics, selection rewrite with diff confirmation, settings, editor verification | Complete: 1.1.0 VSIX and editor guide available; issue closed. Client retired September 8; local repository deleted, remote repository left unchanged |
| #207 Obsidian | Separate repository; note score/audit, selection rewrite, settings/status bar, directory submission | 1.0.0 release and actual host/backend checks complete; client retired September 8 (local repository deleted, remote left unchanged). Community directory submission classified not planned; issue closed as not planned on September 8 (06:29:20Z) |
| #211 community packs | Starter-pack repository/schema, install/list/remove CLI, documentation and untrusted-pack tests | Complete in 8.2.0; issue closed. Starter repository archived and local copy deleted September 8; optional community-pattern CLI commands removed in source commit 31ae86e |
| #212 HF dataset | Fixture licensing review, published dataset/card, release upload workflow, links | Export/licensing tools complete; public upload unverified. Issue closed as not planned on September 5, not as a completed publication |
| #284 browser extension | Separate MV3 repository; Gmail badge, local-only scoring, parity/network checks, bundled lexicons, integration docs | Preview released; client retired September 8 (local repository deleted, remote left unchanged). Signed-in Gmail acceptance, store publication, Notion and LinkedIn classified not planned; issue closed as not planned on September 8 (06:29:21Z) |
| Kimi text isolation | Zero-tool/subagent profile, private metadata, cleanup and live admission | Merged into dev (#731); full tests/lint and independent review passed |
| Branch synchronization | Merge `main` history into `dev`, preserve research commits, delete merged work branches | September 7 baseline: main and dev both at 38423d3; source/web 8.4.0, npm 8.3.0 while publication is on hold |
| Public benchmark/docs | Current reports, accurate versions/statuses, source-linked public claims | September 5 scorer/rewrite reports are published; this ledger and the roadmap now distinguish completed, unverified and deferred work |
| GitHub cache removal | Confirm support submission/reply and inaccessible removed objects | Unverified; no support receipt or removed-object identifiers recorded as of September 8 |
| Paid conversion | Polar checkout already live (2026-08-04). Later “first paid sale” count was optional evidence, not a missing payment system | Closed `not_planned` 2026-09-14. Empty logs are still not a sales total; do not treat that gap as unfinished Polar work |

### September 7 read-only operations check

- Production logs returned 12 monitor requests, all HTTP 200, between 04:45:46
  and 07:30:46 UTC. The durable warning/recovery records could not be read:
  their credentials are sensitive Vercel values unavailable to the local check.
  A successful response is not an eligible `OBS-ALERT-v1` receipt.
- The available webhook-log query returned no rows from August 4 onward, but
  log retention and completeness are unknown. No usable Polar authorization
  was available to confirm paid-order counts, amounts or a first-paid date.
  This result does not establish zero sales. Daily funnel counters expire after
  35 days and contain counts, not payment amounts (`api/polar-webhook.js`).
- Both npm packages still serve 8.3.0. Release run `33956693238` failed at
  `patina-cli@8.3.1` publication with E404 after verification passed. Run
  `33983046367` passed verification and GHCR publication but skipped npm.
  September 7 read-only authentication checks returned 401 for the local npm
  token/session. Usable publishing authorization must be restored before
  publication resumes; expiry, revocation and token equivalence are unverified.

No payment, synthetic alert, message, credential change or publication was
performed by this check.

## September 8 editor-client retirement and documentation reconciliation

Owner decision: the first-party VS Code extension, Obsidian plugin and Gmail
browser-extension preview are retired. The local client repositories were
deleted; the remote repositories `devswha/patina-vscode`,
`devswha/patina-obsidian` and `devswha/patina-extension` were left unchanged
and were verified public and unarchived on September 8. Releases published
before retirement remain as they were. No Marketplace, Obsidian Community
directory or Chrome Web Store listing was ever claimed, so retirement
requires no takedown.

The community starter-pack repository `devswha/patina-community-packs` was
verified archived on September 8, and its local copy was deleted. Removal of
the optional community-pattern CLI commands landed in source commit 31ae86e,
which preserves built-in/custom loading and licensed Pro `patina pack`
delivery.

`docs/integrations/editors.md` is now a short historical record instead of an
installation guide, so existing inbound links keep resolving without
advertising active products. The four root READMEs, the roadmap and this
ledger were reconciled to classify each item as active, retired, deferred or
externally unverified. Current operational status and the exact unresolved
prerequisites are recorded in
[non-npm-status-20260908.md](non-npm-status-20260908.md).

## Operational evidence

- PR #723 merged safe monitor diagnostics and restored `main` ancestry in `dev`.
- PR #724 prepared 8.1.2; PR #725 merged `dev` into `main`. Tag `v8.1.2`
  triggered successful release run `33924994410`; both npm packages and the
  hosted version badge were verified at 8.1.2.
- The main branch's required check still named `test (18.0.0)`. Replaced it
  with the actual minimum-supported `test (18.1.0)`, retaining strict mode,
  all other required checks, and their GitHub Actions app binding. No admin
  merge bypass was used.
- Earlier model pilot results were rejected after measurement defects were found.
  The corrected [confirmation report](../research/model-rewrite-confirmation-20260905.md)
  and [model guide](../research/model-guide-20260905.md) record the later results
  and remaining route, judging and billing limits. They do not change defaults.
- Kimi Code has preliminary results, not a completed confirmation recommendation.
  Human ratings and manual rights review are deferred under the September 6
  scope decision. Hugging Face publication remains unverified; its issue was
  closed as not planned.

The September 7 GitHub query returned four open issues and missed #772
(created September 7): the full open inventory was five, with #772
(CLI-first skill execution) the active item, #159/#643 deferred and
#207/#284 retired. On September 8, #207 and #284 were closed as not planned
(06:29:20Z and 06:29:21Z); #772, #159 and #643 were still open at the
recorded pre-merge check, not a live issue count. Provider
comparison limits and operational follow-ups are separate from that count. A
closed issue does not by itself prove external publication. #772 source
implementation is present in this non-npm change (helper, installer runtime
checks and default skill routing). At the September 8 pre-acceptance/pre-merge
checkpoint, existing targeted tests had passed; real CLI/agent acceptance and
final PR review/integration gates were pending, separate from source
implementation. #772 was open pending integration; no final PR merge,
deployment or npm release had happened in this change at that checkpoint.
See #772, its associated PR and CI for later acceptance and integration evidence.

## September 6 automated short-form evidence

The [collection receipt](https://github.com/devswha/patina/issues/643#issuecomment-5559793246)
records 12/12 completed generation calls, 11 unique outputs and three retained
numeric-proxy failures. The
[diagnostic receipt](https://github.com/devswha/patina/issues/643#issuecomment-5560031158)
records eight valid observations on six unique curated/derived texts, all with
unknown labels. Exact zeros were 2/8; analyzer/final disagreement at the
descriptive cutoff of 30 was 3/8. Dash-minus-comma final deltas were +1.43 in
both social and default pairs. These are model diagnostics, not corpus error
rates or isolated causal punctuation effects. All eight rows replayed without
additional provider calls.

That receipt records 2,176 tests passed, two skipped, lint passed, analyzer
49/49 and scorer 8/8. Those are September 6 results, not a fresh test run by
this status update. The associated runner changes preserve hashes, explicit
document types and unknown labels; they do not establish the human evidence
requested by #643. The remaining study was cancelled September 8.

## Research sequence carried forward

KO GPT-family miss review and Study 4 are complete. Study 4 did not support
promotion in either language. The historical registered sequence below is
retained for context, not as an execution queue. The September 8 decision
cancelled #159 and #643; it does not authorize other research or waive any
evidence requirements:

1. Edited-AI policy/schema and corpus.
2. Human evaluation (#159; cancelled September 8).
3. Bounded deterministic merge/split and seam-only infill (H-4a).
4. Selective Korean treatment.
5. Independent meaning-proxy calibration and metamorphic checks.
6. Korean register/lexicon calibration with cold controls.
7. ZH/JA corpus expansion with source and redistribution review.

Research findings do not change the production prompt, detector, or model
defaults without their registered promotion evidence. The core skill pipeline
remains outside this implementation request.

## Execution boundaries

- Preserve the original checkout and uncommitted scorer work. Each active
  implementation/review session uses its own worktree and bot branch from dev.
- API credentials remain outside tracked artifacts and tool output.
- Never replace missing human labels with model labels or fabricated sources.
- Treat unavailable provider models and failed runs as measured missingness;
  do not silently substitute a model or transport.
- Gemini requests are restricted to the loopback OpenCodex endpoint and an
  explicit `google-antigravity/` model ID. Direct Gemini API fallback is forbidden.

## September 14 P22 observation

Append-only status from dest SHA `a9b2c64` (P17b #809 merged). This section
does not rewrite the September 5–8 facts above.

- Open issues queried 2026-09-14: #810 (new web `documentSignals` gap),
  #807 (item 1 libuv teardown abort still open; item 2 closed by #808),
  #783 (tracking; remains open).
- Open PRs: none.
- npm `patina-cli` / `patina-humanizer` still 8.3.0 (`npm view`, no login).
  Source remains 8.6.0. Publication hold preserved; no tag or token restore.
- P17b is closed by #809. P08/P10/P19b stay conditional-deferred.
  P12b/P21b stay unverified for a real registry or production drill.
  Cursor desktop rule loading stays inconclusive
  (`cursor-acceptance-20260910.json` covered Agent CLI only).
- No `OBS-ALERT-v1` receipt and no paid-conversion evidence were obtained
  on September 5/7. Those rows stay historical. On 2026-09-14 the owner
  dropped both the OBS-ALERT receipt and paid-conversion counting as
  remaining work (`not_planned`). Polar checkout itself has been live
  since 2026-08-04.

Receipt: [maintenance-p22-20260914.json](maintenance-p22-20260914.json).
P04 first-ten window: [maintenance-p04-observation-20260914.json](maintenance-p04-observation-20260914.json).

## September 15 session observation

Append-only status from `origin/dev` SHA `4140f8d` (H-RHETORIC default #828
merged). This section does not rewrite the facts above.

- #829 fixed in source: PR #831 (`bot/fix-829-claude-cli-macos-auth`, head
  `0bb7700`) — claude-cli macOS Keychain auth detection + patina-skill
  symlink entrypoint, with regression tests. Open, CI pending, not merged.
- PR #830 (pattern-of-the-week #2) approved after independent verification
  against the tree. Not merged: the Vercel status context fails on the
  GitHub authorization gate (not a build/test failure); the green-CI rule
  in docs/WORKFLOW.md applies until the authorization is granted or an
  exception is recorded.
- H-RHETORIC confirmation-experiment decision recorded: PR #832
  (`docs/research/2026-09-15-rhetoric-confirmation-decision.md`). The §7.B
  pilot will run, gated on the pre-flight quota/budget check PLAN §7.B
  requires. Environment fact: five authenticated CLI backends, no default
  HTTP API key (`node bin/patina.js doctor`, 2026-09-15, exit 0).
- **npm authorization recovery attempted and blocked.** `npm whoami` →
  401 Unauthorized (2026-09-15; log under `~/.npm/_logs/`). The local
  `~/.npmrc` holds one `_authToken` line (existence checked by count only;
  the value was not read or printed). GitHub secret `NPM_TOKEN` exists
  (metadata updated 2026-06-07; value unreadable and validity unverified).
  Registry still serves 8.3.0 for both packages; source is 8.6.0. Restoring
  publication authorization requires the owner to mint a new npm access
  token (publish scope on `patina-cli` and `patina-humanizer`) or run
  `npm login` interactively, then update `~/.npmrc` and the `NPM_TOKEN`
  secret. Credential creation is outside agent authority.
- P12b stays unverified and is now explicitly blocked on the npm token
  above: a real registry publication / queue-contention / partial-publish
  drill cannot run without it. P21b stays local-fixture-only.
- No npm login, token rotation, secret update, tag, or publication was
  performed by this session.

### npm authorization restored (owner `npm login`, 2026-09-15)

The owner ran `npm login` after the observation above. Follow-up checks:

- `npm whoami` → `devswha`, exit 0. `npm access list packages` shows the
  account holds read-write on `patina-cli` and `patina-humanizer`.
- `npm run release:check` on `dev` @ `4140f8d` → exit 0: release metadata
  agrees on 8.6.0; retired-concept scan clean (13 allowed historical hits,
  0 forbidden current hits).
- `node scripts/release-artifacts.mjs --source-sha 4140f8d... --version 8.6.0`
  (default dry-run: pack, hash, verify, local install-smoke of the root and
  alias tarballs) → exit 0, artifacts verified under `.release-artifacts/`.
- Real-registry state unchanged: both packages still serve 8.3.0; no tag,
  publish, or dist-tag change was made. The dry-run exercises auth, the
  artifact path and local install smoke; it does **not** exercise an actual
  registry publish, queue contention, or partial-publish recovery, so P12b
  stays "real-drill unverified" until the 8.6.0 release itself runs through
  `.github/workflows/release.yml` (concurrency group
  `patina-release-publication`, `cancel-in-progress: false`, GitHub Release
  created only after npm publish succeeds).
- The GitHub Actions `NPM_TOKEN` secret (metadata dated 2026-06-07) was not
  rotated by this session; its equality with the now-working local token is
  unverified. If CI publish fails with 401 on the next release run, the
  owner should refresh the secret with the current token.
- Next owner decision: whether to cut the 8.6.0 release (release PR
  `dev` → `main` + `v8.6.0` tag per docs/WORKFLOW.md). That release run is
  also the P12b real drill.

## September 15 release 8.7.0 — P12b real drill outcome

Append-only. Supersedes the "next owner decision" line above: the owner
approved the release, cut as **8.7.0** (main was already 8.6.0 source/web).

- Release prep #834 (version-bearing files 8.6.0 → 8.7.0, CHANGELOG entry,
  availability text; `release:check`, `check:no-private-assets`, lint, full
  `npm test` 2494 pass / 0 fail, and an artifacts dry-run all exit 0) merged
  to `dev`. Release PR #835 (`dev` → `main`, 63+1 already-reviewed PRs
  listed) merged with a merge commit at `b508c92` after a green full matrix.
- Tag `v8.7.0` pushed; release run `34923908763`: verify + authorize-source
  success, **npm job failed**, ghcr skipped (input off), github-release
  correctly skipped because npm failed.
- Failure: `E403` on the first publish (`patina-cli`): "Two-factor
  authentication or granular access token with bypass 2fa enabled is
  required". `npm profile get` shows `two-factor auth: auth-and-writes`, so
  the web-login session token (which this session had placed into the
  `NPM_TOKEN` secret) cannot publish from CI. A provenance statement was
  signed to the transparency log before the 403; **no package version was
  published** — both packages still serve 8.3.0 (`npm view`, 2026-09-15).
  No partial-publish state exists, so no registry recovery was needed.
- P12b assessment: the real drill exercised authorization, tarball
  verification, provenance signing, serialization (single run; no
  contention occurred), and the failure gate (GitHub Release withheld on
  npm failure — verified correct). Actual publish success, queue
  contention, and partial-publish recovery remain unexercised.
- Remediation (owner action, one of):
  1. Create an npm **granular access token** with publish on `patina-cli` +
     `patina-humanizer` and 2FA-bypass for automation, then update the
     `NPM_TOKEN` secret and rerun the failed jobs
     (`gh run rerun 34923908763 --failed`); the publish script's
     already-published check makes the retry safe. Note npm has announced
     restrictions on bypass-2FA tokens (npm notice in the run log).
  2. Or configure **npm Trusted Publishing (OIDC)** for this repo +
     `release.yml` on both packages (the workflow already carries
     `id-token: write` and signs provenance) and drop the token dependency.
  3. Or publish locally with OTP via
     `node scripts/release-artifacts.mjs --publish --source-sha b508c92… --version 8.7.0`
     from the `v8.7.0` tag checkout (interactive OTP; outside agent reach).
- `main` was merged back into `dev` (fast-forward to `b508c92`) per the
  workflow. The `v8.7.0` tag stays; the npm gap (registry 8.3.0 vs source
  8.7.0) is once again explicit.

## September 15 — 8.7.0 published via OIDC trusted publishing

Append-only. Resolves the E403 blocker recorded above.

- The owner configured npm Trusted Publishing for both packages
  (`devswha/patina` + `release.yml`, direct `npm publish` allowed). Workflow
  switch landed via #840 (drop `NODE_AUTH_TOKEN`/`registry-url`, install
  npm `^11.5.1`) and reached `main` via #841 (`6ecd3ce`).
- Dispatch run `34926513662` (main, `publish: true`): OIDC auth and
  provenance signing succeeded. The publish step reported
  `ERR_PUBLISH_UNCONFIRMED` for `patina-cli` at 03:53:41Z, but the package
  was in fact accepted — the registry showed `patina-cli@8.7.0` at
  03:57:49Z with GitHub Actions provenance (commit `6ecd3ce`). The
  post-publish confirmation is a single immediate read and lost the race
  against registry visibility (~4 minutes).
- `gh run rerun 34926513662 --failed` then exercised the P12b
  partial-publish recovery path for real: the already-published root was
  confirmed at initial inspection and skipped; only the alias was
  published. The same confirmation race hit `patina-humanizer`
  (04:32:51Z) and it appeared on the registry minutes later, with
  `dist-tags.latest` = 8.7.0. Final state verified 2026-09-15: both
  packages serve 8.7.0, `latest` = 8.7.0 on both.
- The GitHub Release for `v8.7.0` was created manually from the CHANGELOG
  entry after both publishes were confirmed, preserving the workflow
  invariant that a release is recorded only after npm publish succeeded.
- **P12b closes.** Real-registry authorization (OIDC), tarball reuse,
  provenance, partial-publish recovery, stale-latest protection (latest
  moved only to 8.7.0), and the release-gating invariant were all exercised
  on the live registry. Queue contention was not exercised (no concurrent
  publication occurred); the `cancel-in-progress: false` serialization is
  source-verified only.
- **Follow-up gap (new):** `scripts/release-artifacts.mjs` post-publish
  confirmation performs one immediate registry read; with current registry
  visibility lag (~4 minutes) it false-fails successful publishes. It needs
  bounded polling (e.g. up to 10 minutes) before declaring
  `ERR_PUBLISH_UNCONFIRMED`. Tracked as the next small CI fix.
- The `NPM_TOKEN` secret remains stored but is now unused by the workflow;
  deletion is an owner action.
