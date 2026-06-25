# Web Playground

The hosted playground is the lowest-friction way to try patina before installing anything:

```text
https://patina.vibetip.help/
```

It is a full-page, ChatGPT-style chat that **rewrites** AI-sounding text into
something more natural for `ko`, `en`, `zh`, and `ja`. The browser posts to a
same-origin `/api/rewrite` serverless function that runs the real patina pipeline
and streams the humanized rewrite back; the first turn is a one-shot rewrite and
follow-up messages are conversational refines that re-edit the previous draft.

The rewrite preserves the underlying claim, numbers, polarity, and causation —
it is auditable, not a black-box rewriter. The server is **no-store** (it never
logs or persists request text, prompts, output, or keys), the free tier is
**fail-closed** rate limited, and BYOK keys are same-origin only (the browser
never talks directly to a provider in v1).

## Source files

- App shell: [`playground/index.html`](../../playground/index.html)
- Styles: [`playground/chatgpt.css`](../../playground/chatgpt.css)
- Controller: [`playground/chatgpt.js`](../../playground/chatgpt.js)
- Streaming client: [`playground/rewrite-client.js`](../../playground/rewrite-client.js)
- Contract (single source of truth): [`src/web-rewrite-contract.js`](../../src/web-rewrite-contract.js)
- Serverless handler: [`api/rewrite.js`](../../api/rewrite.js)
- Vercel routes: [`vercel.json`](../../vercel.json)
- OG image: [`assets/social/patina-og.svg`](../../assets/social/patina-og.svg)

## Deploy notes

Deploy the repository root on Vercel so the root `vercel.json` can rewrite `/` to
the chat entry while keeping the chat module graph and brand/social assets
reachable. The rewrite function bundle must include `patterns/**`, `profiles/**`,
`core/**`, `lexicon/**`, and `.patina.default.yaml`, and the free tier needs
`PATINA_FREE_API_KEY` plus `KV_REST_API_URL` / `KV_REST_API_TOKEN` for the
fail-closed quota.

After a production deploy, verify the custom domain points at the latest
deployment and not an older manual alias:

```bash
vercel --prod --yes --scope team_66lsrwOyA36bLnIH2eoEXqry
vercel alias set <latest-patina-*.vercel.app> patina.vibetip.help --scope team_66lsrwOyA36bLnIH2eoEXqry
vercel inspect https://patina.vibetip.help --scope team_66lsrwOyA36bLnIH2eoEXqry
```
