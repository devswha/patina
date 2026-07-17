# patina-log-query

External aggregate-only log-query service for the private Pro monitor
(`api/pro-monitor.js`). Deployed as a **separate Vercel project** so the
monitored app and its log-derived health signal never share a deployment.
It returns only the four exact closed integer counts from
`docs/operations/queries/pro-launch-v1.md` — never raw Vercel logs.

## Endpoints

- `POST /api/ingest` — Vercel log-drain receiver. Echoes the `x-vercel-verify`
  challenge, verifies the drain HMAC-SHA1 signature (`x-vercel-signature`),
  extracts closed `patina.web.v1` events from delivered log messages, and
  atomically increments `patina:logq:v1:{channel}:{tier}:{quarter}:{outcome}`
  counters (TTL 7200s) in the service's own Upstash store. Raw log content is
  never stored, logged, or echoed.
- `GET /api/query?channel=production&tier=pro&window=15m&aggregate_only=true`
  — monitor query endpoint (Bearer auth). `window=15m` answers exactly
  `{numberSafety, entitlementNonOk, entitlementTotal}`; `window=30m` answers
  exactly `{monitorDrop}`. Counter-store failure returns `503`, never zeroes.

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
