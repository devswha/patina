# patina playground

Web playground for `patina.vibetip.help`. A single full-page, ChatGPT-style chat
that **rewrites** AI-sounding text into something more natural for `ko`, `en`,
`zh`, and `ja` — preserving the claim, numbers, polarity, and causation.

## Files

- App shell: [`index.html`](index.html) — the chat page (served at `/`).
- Styles: [`chatgpt.css`](chatgpt.css).
- Controller: [`chatgpt.js`](chatgpt.js) — conversation store, streaming, safe DOM rendering.
- Streaming client: [`rewrite-client.js`](rewrite-client.js) — isomorphic NDJSON client + client-held thread (one-shot → conversational refine).
- Contract: [`../src/web-rewrite-contract.js`](../src/web-rewrite-contract.js) — the single source of truth shared by the serverless handler, the web runner, the browser client, and the tests.
- Vercel routes: [`../vercel.json`](../vercel.json).
- Analytics shim: [`analytics.js`](analytics.js).

## Rewrite contract + deployment invariants

The browser posts to `/api/rewrite`, which runs the real patina pipeline
server-side and streams a humanized rewrite back. Invariants (pinned by
`tests/unit/web-rewrite-contract.test.js` and
`tests/unit/web-deploy-invariants.test.js`):

- **Runtime**: Vercel Node Function at `/api/rewrite`. The function bundle MUST
  include `patterns/**`, `profiles/**`, `core/**`, `lexicon/**`, and
  `.patina.default.yaml` (`functions["api/rewrite.js"].includeFiles` in
  `vercel.json`) because the patina loader reads them from the filesystem.
- **No-store / no-persistence**: the server never logs or persists request text,
  prompts, model output, BYOK keys, or transcripts. Responses are `no-store`.
- **Fail-closed rate limiting**: the free tier is bounded by a KV + HMAC quota;
  when quota storage is missing or unavailable, requests are rejected before any
  prompt is built or provider is called (in-memory fallback is test/local only).
- **Same-origin BYOK**: BYOK keys are browser-held but transmitted per active
  request over HTTPS to the same-origin `/api/rewrite`; they are redacted from
  logs/errors and never persisted. The CSP stays `script-src 'self'` /
  `connect-src 'self'` — the browser never talks directly to a provider in v1.
- **Floors**: a rewrite below the MPS or fidelity floor (or with a missing
  score) fails closed with a warning rather than shipping a bad rewrite.

## Local preview

The static entry (`index.html`) loads `/chatgpt.css` and `/chatgpt.js` via
root-absolute paths that resolve through the `vercel.json` rewrites
(`/chatgpt.js` → `/playground/chatgpt.js`). Use a rewrite-aware dev server so
those paths resolve and `/api/rewrite` is wired:

```bash
npx vercel dev
```

Then open the URL it prints (the root route rewrites to the chat entry).

## Vercel wiring

Deploy the repository root with the `vercel.json` in this repo. The root route
rewrites `/` to the `/playground` static entry; the chat module graph
(`/chatgpt.js`, `/chatgpt.css`, `/rewrite-client.js`, and the shared
`/src/web-rewrite-contract.js`) is served from the deployed tree.

Production domain:

```text
patina.vibetip.help
```

## Tiers & environment

`/api/rewrite` serves three tiers off one contract (`src/web-rewrite-contract.js`).
All server env is set on the deployment; the browser never sees it, and every
tier fails closed (missing config / KV / HMAC secret is denied before any
provider call).

| Tier | Auth | Metering | Provider key |
|---|---|---|---|
| `free` | none | IP quota (KV + HMAC) | `PATINA_FREE_API_KEY` |
| `byok` | caller's own provider key (per request) | unmetered shared quota | caller key |
| `pro` | `Authorization: Bearer <license_key>` | per-license quota (HMAC subject) | `PATINA_PRO_API_KEY` |

**Pro tier ($9.99/mo USD)** is gated by a Lemon Squeezy license key. The server
validates the key against Lemon Squeezy's validate-only endpoint
(`POST /v1/licenses/validate`), caches the decision (default 5 min), and meters
per license by an HMAC subject — the **raw license key is never stored, logged,
put in a KV key, or forwarded to the runner**. Defaults: 20000 chars / 200 req
per day / 3 concurrent, each env-overridable.

Pro env (see `.env.example` for the full annotated list):

- `LS_STORE_ID`, `LS_PRO_VARIANT_ID` — required; the validate response `meta`
  must match. `LS_PRO_PRODUCT_ID` is an optional extra pin.
- `PATINA_PRO_API_KEY` — required in production; when unset, production fails
  closed (503) and never spends the free key on paid traffic. `PATINA_PRO_ALLOW_FREE_KEY=true`
  is an explicit escape hatch that permits the `PATINA_FREE_API_KEY` fallback in
  any posture (leave it unset in production to keep the 503; outside production
  the free-key fallback is already on).
- `PATINA_LICENSE_HMAC_SECRET` — license subject/KV-key secret (falls back to
  `PATINA_QUOTA_HMAC_SECRET`).
- `PATINA_PRO_PROVIDER` / `PATINA_PRO_MODEL` — fall back to the free provider/model.
- `PATINA_PRO_MAX_CHARS` (20000) / `PATINA_PRO_REQ_PER_DAY` (200) /
  `PATINA_PRO_MAX_CONCURRENT` (3).
- `PATINA_LS_CACHE_TTL_MS` (300000) / `PATINA_LS_NEGATIVE_CACHE_TTL_MS` (60000) /
  `PATINA_LS_TIMEOUT_MS` (2500) / `PATINA_LS_VALIDATE_RPM` (50, under LS's 60/min).

Validate-only means revocation propagates within the positive-cache TTL (default
5 min); a hard kill can shorten it by lowering `PATINA_LS_CACHE_TTL_MS`.

## Verification

```bash
node --test tests/unit/web-rewrite-contract.test.js tests/unit/web-deploy-invariants.test.js
npm run lint:syntax
```
