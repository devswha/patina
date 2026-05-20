# Share-card SVGs

`patina --card <path>` writes a 1200×630 SVG card with:

- the original snippet (`Before`),
- the cleaned rewrite (`After`),
- AI-likeness score,
- meaning-preservation score (MPS),
- the transparent patina brand mark.

Use it for launch posts, README demos, issue comments, and future playground share buttons.

```bash
printf 'AI 티 나는 문장입니다. 의미는 유지해야 합니다.' \
  | patina --lang ko --card /tmp/patina-card.svg
```

For iterative runs, the card reuses the existing Ouroboros final score and MPS:

```bash
patina --lang en --ouroboros --card /tmp/patina-card.svg draft.md
```

For MAX runs, the card uses the winning candidate's `aiScore` and `mps`:

```bash
patina --lang en --models gpt-4o,claude --card /tmp/patina-card.svg draft.md
```

Plain rewrite mode does not otherwise expose a score object, so `--card` asks the existing AI-score and MPS evaluators after the rewrite to fill the two pills. That keeps the card honest without adding a second scoring implementation.

## Privacy and text handling

- Before/after snippets are truncated to roughly 280 code points and then line-wrapped.
- XML-sensitive characters are escaped before rendering.
- Long source text is not embedded in full in the SVG.
- The font stack is system-only and includes CJK fallbacks; there is no webfont dependency.

## Raster output

PNG export is intentionally out of scope for v1 because it would require a renderer dependency such as `sharp`, `resvg`, or a browser runtime. Platforms that need PNG can rasterize the SVG externally, for example with their existing design pipeline or CI image tooling.
