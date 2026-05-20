# Web Playground

The hosted playground is the lowest-friction way to try patina before installing anything:

```text
https://patina.vibetip.help/
```

It is intentionally audit-only. The page runs deterministic string operations in the browser and shows:

- a 0-100 editing-hotspot score;
- paragraph-level burstiness, MATTR, and lexicon signals;
- a suspect-zone diff that highlights review zones and lexicon hits;
- an **Open in CLI** command that copies the pasted input plus `npx patina-cli --score` / `--audit` commands.

It does not rewrite text, call an LLM, or proxy user API keys.

## Source files

- App shell: [`playground/index.html`](../../playground/index.html)
- Browser analyzer: [`playground/analyzer.js`](../../playground/analyzer.js)
- DOM wiring: [`playground/app.js`](../../playground/app.js)
- Generated lexicons: [`playground/data/lexicons.js`](../../playground/data/lexicons.js)
- Vercel routes: [`vercel.json`](../../vercel.json)
- OG image: [`assets/social/patina-og.svg`](../../assets/social/patina-og.svg)

## Refreshing lexicon data

When `lexicon/ai-*.md` changes, regenerate and check the browser bundle:

```bash
npm run playground:data
node scripts/generate-playground-data.mjs --check
```

## Deploy notes

Deploy the repository root on Vercel so the root `vercel.json` can rewrite `/` to the playground while keeping brand and social assets under `/assets/`.
