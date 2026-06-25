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

## Verification

```bash
node --test tests/unit/web-rewrite-contract.test.js tests/unit/web-deploy-invariants.test.js
npm run lint:syntax
```
