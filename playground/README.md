# patina playground

Web playground for `patina.vibetip.help`. A single full-page, ChatGPT-style chat
that **rewrites** AI-sounding text into something more natural for `ko`, `en`,
`zh`, and `ja` — preserving the claim, numbers, polarity, and causation.

## Files

- App shell: [`index.html`](index.html) — the chat page (served at `/`).
- Styles: [`chatgpt.css`](chatgpt.css).
- Controller: [`chatgpt.js`](chatgpt.js) — conversation store, streaming, safe DOM rendering.
- Streaming client: [`rewrite-client.js`](rewrite-client.js) — isomorphic NDJSON client + client-held thread (one-shot → conversational refine).
- Conversation settings: [`preferences.js`](preferences.js).
- Pro recovery, pricing, and settings copy in four languages: [`experience-copy.js`](experience-copy.js).
- Contract: [`../src/web-rewrite-contract.js`](../src/web-rewrite-contract.js) — the single source of truth shared by the serverless handler, the web runner, the browser client, and the tests.
- Vercel routes: [`../vercel.json`](../vercel.json).
- Analytics shim: [`analytics.js`](analytics.js).

## Rewrite contract + deployment invariants

The browser posts to `/api/rewrite`, which runs the real patina pipeline
server-side and streams a humanized rewrite back. Invariants (pinned by
`tests/unit/web-rewrite-contract.test.js` and
`tests/unit/web-deploy-invariants.test.js`):

- **Runtime**: Vercel Node Function at `/api/rewrite`. The function bundle MUST
  include `patterns/**`, `document-types/**`, `personas/**`, `core/**`, `lexicon/**`, and
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

## Conversation settings and Pro access

Language, document type, persona, and register belong to each conversation.
Switching conversations restores the controls and the next request's settings.
The first source can set the language automatically unless the user selected it
explicitly. Once a rewrite is accepted, that conversation keeps its original
language; changing languages requires a new chat. Persona and register are
omitted by default to preserve the source. An explicit change to either applies
to the next request in that conversation.

The playground writes nothing to browser storage. Settings live for the life of
the conversation, and a reload starts from the defaults again.

“Already purchased?” opens the Pro license controls. “Apply key” keeps the key
in memory and marks validation as pending. The first rewrite request validates
it; only an admitted stream marks the key accepted for that request. A 401 or
403 clears the rejected Pro key and offers credential recovery instead of
replaying it. A 403 does not identify the underlying subscription issue.
Monthly request, character, and processing-attempt limits have separate messages
and do not promise a reset date or offer immediate replay. See the
[Hosted API contract](../docs/HTTP-API.md) for limits and authentication.

The subscription-management link is hidden unless the public launch config
explicitly supplies a safe Polar `portalUrl`. No URL is derived from checkout.
The current launch-config generator does not emit that optional field, so the
public documentation link remains the available recovery reference.

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
| `byok` | caller's own provider key (per request) | 120/hour, 480/day per IP; provider quota also applies | caller key |
| `pro` | `Authorization: Bearer <license_key>` | per-license quota (HMAC subject) | `PATINA_PRO_API_KEY` |

**Pro tier ($9.99/mo USD)** is gated by a Polar license key. The server
validates the key against Polar's customer-portal validate endpoint
(`POST /v1/customer-portal/license-keys/validate`), caches the decision (default 5 min), and meters
per license by an HMAC subject — the **raw license key is never stored, logged,
put in a KV key, or forwarded to the runner**. Defaults: 20000 chars / 200 req
per day / 3 concurrent / 50,000 chars per month, each env-overridable.

Pro env (see `.env.example` for the full annotated list):

- `POLAR_ORGANIZATION_ID`, `POLAR_PRO_BENEFIT_ID` — required; the validate
  response must match both.
- `PATINA_PRO_API_KEY` — required in production; when unset, production fails
  closed (503) and never spends the free key on paid traffic. `PATINA_PRO_ALLOW_FREE_KEY=true`
  is an explicit escape hatch that permits the `PATINA_FREE_API_KEY` fallback in
  any posture (leave it unset in production to keep the 503; outside production
  the free-key fallback is already on).
- `PATINA_LICENSE_HMAC_SECRET` — license subject/KV-key secret (falls back to
  `PATINA_QUOTA_HMAC_SECRET`).
- `PATINA_PRO_PROVIDER` / `PATINA_PRO_MODEL` — **required in production** (a
  missing value fails pro requests closed instead of silently serving the free
  provider/model); outside production they fall back to the free provider/model.
- `PATINA_PRO_MAX_CHARS` (20000) / `PATINA_PRO_REQ_PER_DAY` (200) /
  `PATINA_PRO_MAX_CONCURRENT` (3) / `PATINA_PRO_REQ_PER_MONTH` (100, the per-license monthly rewrite cap and the
  primary margin control) / `PATINA_PRO_CHARS_PER_MONTH` (50000, a secondary
  per-license monthly total-character cap — over it returns 429
  `monthly character limit reached` with `remainingMonthlyChars`/`limitMonthlyChars`).
- `PATINA_POLAR_CACHE_TTL_MS` (300000) / `PATINA_POLAR_NEGATIVE_CACHE_TTL_MS` (60000) /
  `PATINA_POLAR_TIMEOUT_MS` (2500) / `PATINA_POLAR_VALIDATE_RPM` (10).

Validate-only means revocation propagates within the positive-cache TTL (default
5 min); a hard kill can shorten it by lowering `PATINA_POLAR_CACHE_TTL_MS`.

## Provider-confirmed purchase conversions

Polar sends `order.paid` deliveries to `/api/polar-webhook`. Configure the
server-only `POLAR_WEBHOOK_SECRET`, `POLAR_ORGANIZATION_ID`, and
`POLAR_PRO_PRODUCT_ID`, plus the dedicated
`PATINA_OBSERVABILITY_REST_API_URL` / `PATINA_OBSERVABILITY_REST_API_TOKEN`.
The endpoint verifies Polar's Standard Webhooks signature before accepting a
delivery and records only aggregate, provider-confirmed initial paid conversions
for that exact organization and product. It excludes renewals and subscription
updates; the browser cannot emit this metric.

## Verification

```bash
node --test tests/unit/web-rewrite-contract.test.js tests/unit/web-deploy-invariants.test.js
npm run lint:syntax
```

## See also

- [`AI-SLOP-TAXONOMY.md`](AI-SLOP-TAXONOMY.md) — the negative dictionary of AI-looking UI clichés that `DESIGN.md` is written against.
