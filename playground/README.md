# patina playground

Static, audit-only web playground for `patina.vibetip.help`.

- No build step.
- No runtime server.
- No LLM rewrite or key proxying.
- Deterministic browser-side scoring for `ko`, `en`, `zh`, and `ja`.
- Vercel Web Analytics page-view telemetry for traffic counts; pasted text is not sent.
- Shared deterministic detectors are imported directly from browser-pure `src/features/*.js` modules; serve/deploy the repository root so `/src/features/…` paths are available.

## Local preview

Serve the repository root so `vercel.json`-style root paths can resolve brand and social assets:

```bash
npx http-server .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080/playground/`.

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
