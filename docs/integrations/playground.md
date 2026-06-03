# Web Playground

The hosted playground is the lowest-friction way to try patina before installing anything:

```text
https://patina.vibetip.help/
```

It is intentionally audit-only. The page runs deterministic string operations in the browser and shows:

- a 0-100 editing-hotspot score;
- paragraph-level burstiness, MATTR, lexicon, and Korean rhythm diagnostic signals;
- a suspect-zone diff that highlights review zones and lexicon hits;
- an **Open in CLI** command that copies the pasted input plus `npx patina-cli --score` / `--audit` commands.

It does not rewrite text, call an LLM, proxy user API keys, or send pasted text off the page. The hosted Vercel deployment records page-view metadata with Web Analytics so maintainers can watch traffic.

## Source files

- App shell: [`playground/index.html`](../../playground/index.html)
- Browser analyzer: [`playground/analyzer.js`](../../playground/analyzer.js)
- DOM wiring: [`playground/app.js`](../../playground/app.js)
- Generated lexicons: [`playground/data/lexicons.js`](../../playground/data/lexicons.js)
- Vercel routes: [`vercel.json`](../../vercel.json)
- Analytics shim: [`playground/analytics.js`](../../playground/analytics.js)
- OG image: [`assets/social/patina-og.svg`](../../assets/social/patina-og.svg)

## Refreshing lexicon data

When `lexicon/ai-*.md` changes, regenerate and check the browser bundle:

```bash
npm run playground:data
node scripts/generate-playground-data.mjs --check
```

## Deploy notes

Deploy the repository root on Vercel so the root `vercel.json` can rewrite `/` to the playground while keeping brand and social assets under `/assets/`.

After a production deploy, verify that the custom domain points at the latest
deployment and not an older manual alias:

```bash
vercel --prod --yes --scope team_66lsrwOyA36bLnIH2eoEXqry
vercel alias set <latest-patina-*.vercel.app> patina.vibetip.help --scope team_66lsrwOyA36bLnIH2eoEXqry
vercel inspect https://patina.vibetip.help --scope team_66lsrwOyA36bLnIH2eoEXqry
```

Smoke the live deterministic payloads:

```bash
curl -fsSL https://patina.vibetip.help/docs/benchmarks/latest.json \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log(j.fixtureCount, !!j.perLanguage?.ko?.byDetector?.koDiagnostics)})"

curl -fsSL https://patina.vibetip.help/analyzer.js \
  | grep -E "DEFAULT_KO_DIAGNOSTIC_BANDS|Korean rhythm composite"
```
