# Non-npm status, 2026-09-08

Scope: the approved non-npm remaining work. npm publishing, npm tags and
releases, production deployments, real purchases, synthetic alert messages
and support messages are excluded. This record publishes aggregate and
status facts only: no tokens, no customer data, no private drafts and no raw
hashes of removed private objects.

Later research decision, 2026-09-08: the owner cancelled #159 and #643 and both
were closed `not_planned`. This supersedes their earlier deferral; the recorded
pre-merge inventories below remain historical observations.

## Evidence-based ideal state

- The four root READMEs, `docs/integrations/editors.md`, `docs/ROADMAP.md`
  and `docs/operations/remaining-work-20260905.md` classify every ecosystem
  item as active, retired, deferred or externally unverified, and no retired
  integration is presented as an active product.
- `docs/integrations/editors.md` stays at its existing address as a short
  historical record, so inbound links keep resolving.
- The Aside integration and the core skills/CLI stay documented as active.
- The npm publication gap stays explicit: source/web 8.5.1, npm 8.3.0.
- Research records show the KO GPT-family miss review and Study 4 complete,
  with the previously deferred human evaluation (#159) and human-labeled
  short-form corpus (#643) cancelled, not pending.
- The recorded pre-merge issue inventory listed #772 (CLI-first skill execution)
  as the active open item, #207/#284 as retired and closed, and #159/#643 as deferred.

## Decision points

1. **Editor clients retired (owner decision).** The VS Code extension,
   Obsidian plugin and Gmail browser-extension preview are retired. The
   local client repositories were deleted; the remote repositories were left
   unchanged and were verified public and unarchived on 2026-09-08. A short
   historical page replaces the installation guide so existing inbound links
   do not break.
2. **Community packs.** The starter repository
   `devswha/patina-community-packs` is archived (verified 2026-09-08) and its
   local copy deleted. The optional community-pattern CLI commands were
   removed in source commit 31ae86e, which preserves built-in/custom pattern
   loading and licensed Pro `patina pack` delivery.
3. **#207 and #284 are closed.** Both were classified retired/not planned
   and were closed as not planned on 2026-09-08, at 06:29:20Z and 06:29:21Z,
   without comments.
4. **#159 and #643 are cancelled.** The owner cancelled both studies on
   2026-09-08 and the issues were closed `not_planned`. Their human acceptance
   criteria remain unmet; retained diagnostics are not human labels. Neither
   study is queued for resumption without a new explicit request.
5. **Research completion stands.** The KO GPT-family miss review and Study 4
   are complete per the September 7 ledger; Study 4 supported promotion in
   neither language. Records must not regress to claiming active unfinished
   research.
6. **#772 source implementation is present.** This non-npm change includes
   the CLI-first helper, installer runtime checks and default skill routing.
   At the September 8 pre-acceptance/pre-merge checkpoint, existing targeted
   tests had passed; real CLI/agent acceptance and final PR review/integration
   gates were still pending. The issue was open pending integration; no final
   PR merge, deployment or npm release had happened in this change at that
   checkpoint. See #772, its associated PR and CI for later acceptance and
   integration evidence.

## Current operations evidence

- **Monitor receipts.** A bounded September 8 log query (`vercel logs
  --environment production --since 24h --limit 100 --query /api/pro-monitor
  --json --no-follow`) exited 0 and returned 100 rows at the limit, all
  HTTP 200 for `/api/pro-monitor`, earliest 2026-09-07T18:00:46.082Z, latest
  2026-09-08T06:15:46.094Z, with zero receipt-schema markers among them. The
  September 7 check had returned 12 monitor requests, all 200, between
  04:45:46 and 07:30:46 UTC. Returned rows are log observations only: not
  proof of complete retention, an eligible `OBS-ALERT-v1` receipt or any
  sales total. Eligibility requires a real-path triggered alert with its
  recovery record.
- **`/api/pro-monitor` is not read-only.** The endpoint accepts GET only
  (`api/pro-monitor.js` returns 405 otherwise), but a single GET can run
  synthetic `/api/rewrite` probes for the pro and free tiers and post Discord
  alert or recovery messages. It must not be used as a casual status check.
- **Vercel access boundary (checked 2026-09-08).** `vercel whoami` succeeds
  through the existing CLI login, and `vercel env ls production` shows the
  observability, cron and Polar variable names exist as Sensitive/Hidden
  production entries. Their values stay inaccessible locally: no
  `CRON_SECRET`, observability REST URL/token, log-query token or Polar
  access/org/product credential value is present in this environment, and
  `gh secret list` returns only `NPM_TOKEN`, which belongs to the excluded
  npm stream. Log metadata access and secret value access are different
  capabilities; the first works here, the second does not.
- **Webhook logs.** A bounded September 8 webhook-log query since
  2026-08-04T00:00:00Z with the same 100-row limit exited 0 and returned 0
  rows. Retention and completeness are unknown, so this is not evidence of
  zero sales. Daily funnel counters expire after 35 days and hold counts,
  not payment amounts (`api/polar-webhook.js`). No production monitor
  request or webhook replay was executed by these checks.
- **npm gap.** Both npm packages serve 8.3.0 (verified 2026-09-08) while the
  source/web release is 8.5.1. September 7 checks: release run `33956693238`
  failed at `patina-cli@8.3.1` publication with E404 after verification
  passed; run `33983046367` skipped npm; local npm authentication returned
  401. Usable publishing authorization is unverified.
- **GitHub cache removal.** No support submission receipt and no
  removed-object identifiers have been identified. Unverified.
- **Issue inventory (recorded pre-merge check, 2026-09-08).** The full open inventory was
  five issues: #772 (CLI-first skill execution, active), #643 and #159
  (deferred human criteria), and #207/#284 (retired editor clients). #207
  and #284 were closed as not planned on 2026-09-08, at 06:29:20Z and
  06:29:21Z. #772, #643 and #159 were still open at that check; this is not
  a live issue count. See #772, its associated PR and CI for later integration evidence.

## Exact unresolved prerequisites

1. **Eligible `OBS-ALERT-v1` alert/recovery receipt.** The production
   credential names exist as Sensitive/Hidden Vercel entries, but their
   values are inaccessible from this environment (`CRON_SECRET`,
   observability REST URL/token, log-query token), so the durable
   warning/recovery records still cannot be read here. Eligibility requires
   a real-path triggered alert with its recovery; ordinary 200 monitor
   responses and log-row observations do not qualify.
2. **Paid conversion verification.** Requires Polar authorization (access
   token, org, product) or provider-confirmed aggregates; none is available.
   Unverified is not zero sales.
3. **GitHub cache removal.** Requires the support ticket receipt and the
   removed-object identifiers; neither is recorded.
4. **#772 acceptance and integration.** Source implementation is present in
   this non-npm change. At the September 8 pre-acceptance/pre-merge checkpoint,
   existing targeted tests had passed; real CLI/agent acceptance and final PR
   review/integration gates were pending, not the source implementation itself.
   The issue was open; no final PR merge, deployment or npm release had happened
   in this change at that checkpoint. See #772, its associated PR and CI for
   later acceptance and integration evidence.
5. **npm publication.** Requires restored npm authorization; excluded from
   this stream.
