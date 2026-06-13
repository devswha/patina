# patina playground

Static, audit-only web playground for `patina.vibetip.help`.

- No build step.
- No runtime server.
- No LLM rewrite or key proxying.
- Deterministic browser-side scoring for `ko`, `en`, `zh`, and `ja`.
- Vercel Web Analytics page-view telemetry for traffic counts; pasted text is not sent.
- Shared deterministic detectors are imported directly from browser-pure `src/features/*.js` modules; serve/deploy the repository root so `/src/features/…` paths are available.

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
