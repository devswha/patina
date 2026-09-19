# Hosted API (Pro)

`POST https://patina.vibetip.help/api/rewrite` exposes the hosted rewrite service to both the same-origin playground and cross-origin API clients. Cross-origin requests may use `Content-Type` and `Authorization`; responses send `Access-Control-Allow-Origin: *`. Do not use credentialed CORS requests.

## Tiers and authentication

- `free`: no authentication. It uses the server key and is limited per client IP.
- `byok`: send your own `provider`, `model`, and `apiKey` in the JSON body. The key is used for that request.
- `pro`: send a Polar license key in `Authorization: Bearer <license-key>`. The Polar license key is also the API key; purchase it through the playground checkout. Do not send it in the request body.

Free, BYOK, and Pro use the same rewrite pipeline and quality gates. Paid access buys programmatic access and higher limits, not better output.

## Request

For a reviewed draft, `mode: "verify"` checks `text` against `original` without
generating a new rewrite. It uses the same authentication, input limits, quota,
number guard and meaning checks. Each verification consumes one request; Pro
also meters its submitted characters. Send `baseHash`, formatted as
`sha256:` followed by the lowercase SHA-256 digest of the original UTF-8 text.
Conversation history is not accepted in this mode. A stale hash returns `409`
with code `source_changed` before quota admission or model calls, for both
JSON and NDJSON requests. Text must be well-formed Unicode: unpaired surrogates
are rejected rather than replaced during UTF-8 hashing. Invalid input receives
`400`; an invalid generated output is refused with `output_invalid_unicode`.

Optional controls apply to the canonical original (`text` for a first request,
`original` for refinement or verification):

| Field | Contract |
|---|---|
| `protectedSpans` | Up to 20 non-overlapping `{start, end}` ranges in JavaScript UTF-16 offsets. Ranges must not split a surrogate pair. Protected literals retain their exact spelling, occurrence counts and order. |
| `includeEdits` | Boolean. On success, return `editReview` with `baseHash`, `outputHash`, `offsetEncoding: "utf-16"` and `edits: [{start, end, replacement}]`. Applying every edit reconstructs `rewrite` exactly. |
| `baseHash` | Optional source binding for rewriting; required for `verify`. |

Edits can cover several sentences when alignment is ambiguous. Selecting only
some edits creates a new draft: previous scores and receipts do not verify it.
Submit that exact draft with `mode: "verify"` before treating it as approved.
Its successful response binds fresh scores and a receipt to those exact bytes.
Protected text is checked before scoring; violations return `422` with
`protected_text_failed`, and that includes a generated output beyond the
20,000 UTF-16 unit bound when protected spans were sent. Edit review supports
up to 20,000 UTF-16 units per text; when a verified output exceeds that bound
and no protected spans were sent, the response still succeeds and simply omits
`editReview`, because the review is a convenience and the verified rewrite is
not. Source text and protected literals are not added to analytics or
persisted by these controls.

Set `Content-Type: application/json` and send this body:

```json
{
  "mode": "first",
  "lang": "en",
  "tier": "pro",
  "text": "This is the text to rewrite.",
  "documentType": "blog",
  "persona": "blog-essay",
  "register": "professional"
}
```

Required fields:

| Field | Values |
| --- | --- |
| `mode` | `first`, `refine`, or `verify` |
| `lang` | `ko`, `en`, `zh`, or `ja` |
| `tier` | `free`, `byok`, or `pro` |
| `text` | Non-empty string |

Optional style fields are `documentType`, `persona`, and `register`; edit controls are described above. `documentType` defaults to `default`; valid values are `default`, `blog`, `academic`, `technical`, `formal`, `resume`, `personal-statement`, `project-writeup`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation`, `code-comment`, `commit-message`, `release-notes`, and `namuwiki` (`namuwiki` is Korean-only). `formal` remains proposals and official reports; resumes, cover letters, and project writeups use the split types. `register` is `casual` or `professional`. A persona must be one offered for the selected language.

For `mode: "refine"`, `original` is required and must be the original source text. `history` is optional; it is an array of `{ "role": "user" | "assistant", "content": "..." }` turns. The server retains at most 6 recent turns and 12 KiB of history text. BYOK additionally requires an allowed `provider`, `model`, and non-empty `apiKey`; free and Pro reject a body `apiKey`.

## Limits

These are the current server-enforced defaults; Pro values may be reduced or raised by deployment configuration.

| Tier | Text/original maximum | Concurrency | Request quota | Other quota |
| --- | ---: | ---: | --- | --- |
| Free | 4,000 characters | 1 | 20/day; 10/hour burst | — |
| BYOK | 20,000 characters | 2/IP | Provider account quota applies; 120/hour burst; 480/day | Admission caps bound Patina function, connection, and egress usage, not your provider cost |
| Pro | 20,000 characters | 3 | 200/day; 100/month | 50,000 characters/month |

The meaning-preservation gates require MPS and fidelity scores of at least 70.

## Responses

### Streaming (default)

When `Accept` is absent, `*/*`, or does not request JSON, the response is `200 application/x-ndjson`. Each line is one JSON object. A successful response is `start`, zero or more `delta` frames, then `done`.

```ndjson
{"type":"start"}
{"type":"delta","text":"Here is a clearer version"}
{"type":"delta","text":" of the sentence."}
{"type":"done","rewrite":"Here is a clearer version of the sentence.","mps":{"mps":96},"fidelity":{"fidelity":94},"signals":{"before":{"overall":72},"after":{"overall":18}},"diff":{"beforeChars":39,"afterChars":48},"receipt":{"schemaVersion":"patina-rewrite-receipt-v2","receiptHash":"sha256:..."}}
```

`mps`, `fidelity`, `signals`, `diff`, and `receipt` are emitted on `done`. The score values are `mps.mps` and `fidelity.fidelity`; `signals.before.overall` and `signals.after.overall` are the deterministic signal scores.

`delta` frames are **provisional display text**, not an accepted rewrite. They are emitted from the first rewrite attempt before number-safety, MPS, and fidelity gates finish. API consumers must treat only `done.rewrite` as authoritative, replace any accumulated deltas with it, and discard provisional text when the terminal frame is `error`.

A streaming terminal error is also an NDJSON frame, for example:

```ndjson
{"type":"error","code":"stream_failed","error":"upstream request failed"}
{"type":"error","code":"floor_failed","failed":["mps"],"rewrite":"...","mps":{"mps":65},"fidelity":{"fidelity":93},"signals":{"before":{"overall":72},"after":{"overall":18}},"diff":{"beforeChars":39,"afterChars":48}}
```

Other terminal stream codes are `number_safety_failed` and `scoring_failed`.

### Non-streaming JSON

Send `Accept: application/json` to buffer the same pipeline result and receive one `200 application/json` object instead of NDJSON:

```json
{
  "ok": true,
  "rewrite": "Here is a clearer version of the sentence.",
  "mps": { "mps": 96 },
  "fidelity": { "fidelity": 94 },
  "signals": { "before": { "overall": 72 }, "after": { "overall": 18 } },
  "diff": { "beforeChars": 39, "afterChars": 48 },
  "receipt": { "schemaVersion": "patina-rewrite-receipt-v2", "receiptHash": "sha256:..." }
}
```

Terminal failures in JSON mode return `{ "ok": false, "code": "...", "error": "..." }` with the runner's semantics: safety-gate refusals (`floor_failed`, `number_safety_failed`) use `422` — the text was processed and deliberately rejected to protect meaning and exact numbers — while upstream stream/scoring failures use `500`.

### Errors

Errors are JSON objects, including for JSON-mode callers:

```json
{ "error": "hourly burst exceeded" }
```

Validation errors use `400`; an over-limit `text` or refine `original` uses `413`. A missing, malformed, or duplicated Pro `Authorization` header uses `401` (`pro license required`); a well-formed license key that does not entitle uses `403` (`license not entitled`). Quota and concurrency denials use `429`; quota/entitlement infrastructure or service unavailability uses `503`. JSON-mode terminal failures use `422` (safety-gate refusal) or `500` (upstream failure) as described above.

Possible quota error strings include `daily quota exceeded`, `hourly burst exceeded`, `concurrent limit exceeded`, `monthly rewrite limit reached`, and `monthly character limit reached`. A Pro monthly-character denial additionally includes `remainingMonthlyChars` and `limitMonthlyChars`.

## Examples

Streaming Pro request:

```sh
curl --no-buffer https://patina.vibetip.help/api/rewrite \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PATINA_LICENSE_KEY" \
  --data '{"mode":"first","lang":"en","tier":"pro","text":"This is the text to rewrite."}'
```

Single JSON response:

```sh
curl https://patina.vibetip.help/api/rewrite \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PATINA_LICENSE_KEY" \
  --data '{"mode":"first","lang":"en","tier":"pro","text":"This is the text to rewrite."}'
```

Node.js streaming and JSON clients:

```js
const url = 'https://patina.vibetip.help/api/rewrite';
const body = { mode: 'first', lang: 'en', tier: 'pro', text: 'This is the text to rewrite.' };
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.PATINA_LICENSE_KEY}`,
};

const streamResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
let pending = '';
for await (const chunk of streamResponse.body.pipeThrough(new TextDecoderStream())) {
  pending += chunk;
  const lines = pending.split('\n');
  pending = lines.pop();
  for (const line of lines) console.log(JSON.parse(line));
}

const jsonResponse = await fetch(url, {
  method: 'POST', headers: { ...headers, Accept: 'application/json' }, body: JSON.stringify(body),
});
console.log(await jsonResponse.json());
```

Python JSON client:

```python
import os
import requests

response = requests.post(
    'https://patina.vibetip.help/api/rewrite',
    headers={
        'Accept': 'application/json',
        'Authorization': f"Bearer {os.environ['PATINA_LICENSE_KEY']}",
    },
    json={'mode': 'first', 'lang': 'en', 'tier': 'pro', 'text': 'This is the text to rewrite.'},
)
response.raise_for_status()
print(response.json())
```

## Versioning

This document describes the current pre-GA path, `/api/rewrite`. Before the paid API reaches general availability, Patina will expose an explicit protocol version (`/api/v1/rewrite` or an equivalent version field) so breaking changes cannot silently alter existing clients.

## Constant sources

Limits and score floors above are sourced from `src/web-rewrite-contract.js`: `TIER_LIMITS`, `CONTEXT_LIMITS`, `MPS_FLOOR`, `FIDELITY_FLOOR`, `SUPPORTED_LANGS`, `WEB_DOCUMENT_TYPES`, `WEB_REGISTERS`, and `QUOTA_REASONS`. Request validation and response behavior are implemented by `validateRewriteRequest` in that module and `api/rewrite.js`.
