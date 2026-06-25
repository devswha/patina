# patina playground

Web playground for `patina.vibetip.help`. Two modes share one page:

## Audit-only mode (default, offline, deterministic)

- No build step.
- No runtime server.
- No LLM rewrite or key proxying.
- Deterministic browser-side scoring for `ko`, `en`, `zh`, and `ja`.
- Vercel Web Analytics page-view telemetry for traffic counts; pasted text is not sent.
- Shared deterministic detectors are imported directly from browser-pure `src/features/*.js` modules; serve/deploy the repository root so `/src/features/…` paths are available.

This mode never reaches the network for analysis and is preserved as a regression
guard (`tests/unit/playground.test.js` pins the browser-pure module graph).

## Rewrite mode (contract)

Rewrite mode runs the real patina pipeline server-side and streams a humanized
rewrite back to the browser. Its contract is the single source of truth in
`src/web-rewrite-contract.js` (shared by the serverless handler, the web runner,
the browser client, and the tests) and is enforced by
`tests/unit/web-rewrite-contract.test.js` and
`tests/unit/web-deploy-invariants.test.js`.

Deployment + security invariants (pinned before the handler ships):

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
  score) fails closed with a warning and rollback/retry.

## Local preview

The static entry (`index.html`) loads `/app.js`, `/styles.css`, and `/analytics.js`
via root-absolute paths that resolve through the `vercel.json` rewrites
(`/app.js` → `/playground/app.js`). A plain static server rooted at the repo
serves the page at `/playground/` where those `/app.js` URLs 404, so use a
rewrite-aware dev server:

```bash
npx vercel dev
```

Then open the URL it prints (the root route rewrites to the playground entry). A
plain `npx http-server .` will render the page shell but not its JS/CSS.

## Parity with the CLI

The playground hot-paragraph ratio is intentionally a *superset* of the CLI's
deterministic `--score`: it adds playground-only formatting tells (em dash /
bold / emoji overuse) and per-paragraph markup leakage that canonical
`analyzeText` omits (the CLI adds the optional structural classifier instead).
So the playground can mark more paragraphs hot than `npx patina-cli --score` for
the same text; shared signals (stylometry, lexicon, the leakage floor) stay
pinned in parity by `tests/unit/playground.test.js`.

## Data refresh

The browser bundle is generated from the checked-in markdown lexicons:

```bash
npm run playground:data
node scripts/generate-playground-data.mjs --check
```

Commit both lexicon markdown changes and `playground/data/lexicons.js` together.

## Vercel wiring

Deploy the repository root with the `vercel.json` in this repo. The root route rewrites `/` to the clean `/playground` static entry and keeps `/assets/social/patina-og.svg` available for OG cards.

Production domain:

```text
patina.vibetip.help
```

DNS should point at Vercel, e.g. `A patina -> 76.76.21.21` or the CNAME Vercel shows for the project.

Web Analytics is enabled with `playground/analytics.js` plus Vercel's same-origin
`/_vercel/insights/script.js`, so the CSP keeps `script-src 'self'` and does not
need inline-script relaxation.

## Verification

```bash
node --test tests/unit/playground.test.js
npm run lint:syntax
```
