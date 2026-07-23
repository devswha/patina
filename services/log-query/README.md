# patina-log-query

External aggregate-only log-query service for the private Pro monitor
(`api/pro-monitor.js`). Deployed as a **separate Vercel project** so the
monitored app and its log-derived health signal never share a deployment.
It returns only the four exact closed integer counts from
`docs/operations/queries/pro-launch-v1.md` — never raw Vercel logs.

## Endpoints

- `POST /api/ingest` — Vercel log-drain receiver. Verifies the drain HMAC-SHA1
  signature (`x-vercel-signature`), extracts only complete nine-field
  `patina.web.v1` envelopes (canonical field order, closed dimensions) from
  delivered log messages, and commits every counter increment in ONE atomic
  EVAL (`patina:logq:v1:{channel}:{tier}:{quarter}:{outcome}`, TTL 7200s) in
  the service's own Upstash store. Fail-closed: a malformed delivery is `400`
  and a store failure is `503` (the drain redelivers); a delivery is never
  acknowledged after a lost or partial write. Raw log content is never
  stored, logged, or echoed.
- `GET /api/query?channel=production&tier=pro&window=15m&aggregate_only=true`
  — monitor query endpoint (Bearer auth). `window=15m` answers exactly
  `{numberSafety, entitlementNonOk, entitlementTotal}`; `window=30m` answers
  exactly `{monitorDrop}`. The whole window is read in one MGET snapshot and
  every persisted value must be a canonical non-negative safe integer; store
  failure or a malformed counter returns `503`, never a fabricated zero.

Count semantics: `numberSafety` = `number_safety_failed`; `entitlementNonOk` =
`entitlement_denied` + `entitlement_unavailable`; `entitlementTotal` = every
terminal request outcome (all outcomes except `monitor_drop`); `monitorDrop` =
`monitor_drop` only. Window buckets follow the monitor's strictly-after
bucket-end rule.

## Environment (this service's Vercel project, server-only)

- `LOGQ_REST_API_URL` / `LOGQ_REST_API_TOKEN` — dedicated Upstash REST store
  (never the patina quota/admission KV or the strict observability store).
- `LOGQ_DRAIN_SECRET` — custom secret configured on the Vercel log drain;
  ingest rejects unsigned or mis-signed deliveries.
- `LOGQ_VERCEL_VERIFY` — the team endpoint verification code from Vercel's
  `GET /v1/verify-endpoint`; returned in the `x-vercel-verify` response header
  so drain-endpoint verification succeeds. Request header values are never
  echoed, and without this variable there is no pre-authentication response
  path.
- `LOGQ_QUERY_TOKEN` — bearer token the monitor sends; mirrors the patina
  production `PATINA_VERCEL_LOG_QUERY_TOKEN` value.

## Wiring (patina production)

Set `PATINA_VERCEL_LOG_QUERY_URL` to the exact deployed
`https://<project>.vercel.app/api/query` URL, pin its lowercase-hex SHA-256 in
`PATINA_VERCEL_LOG_QUERY_URL_SHA256`, and set
`PATINA_VERCEL_LOG_QUERY_TOKEN=LOGQ_QUERY_TOKEN`. Create the team log drain
(sources `lambda`, format `json`, the patina project only) pointing at
`/api/ingest` with `LOGQ_DRAIN_SECRET` as its custom secret.

Tests live in `tests/unit/log-query-service.test.js` and pin the response
shapes to the monitor's `parseAggregate` contract.
