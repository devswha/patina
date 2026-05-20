# Branding

Patina's production brand assets are hand-authored SVGs so maintainers can review, diff, and recreate them without a design-tool dependency.

## Canonical assets

| Asset | Path | Use |
|---|---|---|
| Logo lockup | [`assets/brand/patina-logo.svg`](../assets/brand/patina-logo.svg) | README hero, package pages, docs landing pages |
| App icon | [`assets/brand/patina-icon.svg`](../assets/brand/patina-icon.svg) | Favicon/app tile/avatar contexts |
| Social preview | [`assets/social/patina-og.svg`](../assets/social/patina-og.svg) | Open Graph / social card export source |
| Before/after card | [`assets/social/patina-before-after.svg`](../assets/social/patina-before-after.svg) | Launch posts and docs examples |

`patina-logo.svg` is the single canonical horizontal logo. Do not reintroduce README-only duplicates unless the variant is visibly different and documented here.

## Accessibility checklist

- Keep `role="img"` on standalone SVG assets.
- Include `<title>` and `<desc>`, or an `aria-label` when a tiny decorative asset cannot carry children.
- Keep the square icon recognizable at 32px.
- Keep the logo on a dark backplate so it works on GitHub light and dark themes.
- Use system font fallbacks in SVG text; GitHub does not load external web fonts inside `<img>` SVGs.

## Open Graph setup for a future docs site

Markdown on GitHub cannot set Open Graph tags. If patina gets a docs site, use the checked-in social SVG or a generated PNG export and add:

```html
<meta property="og:title" content="patina — Strip the AI packaging. Keep the meaning.">
<meta property="og:description" content="Auditable AI-prose cleanup for KO, EN, ZH, and JA with meaning-preservation checks.">
<meta property="og:type" content="website">
<meta property="og:image" content="https://patina.dev/patina-og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://patina.dev/patina-og.png">
```

Export note: many social crawlers handle PNG more reliably than SVG, so keep the SVG as source and publish a PNG derivative from CI or the docs-site build.
