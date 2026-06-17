# Demo assets

The README hero now uses the preview surface, not terminal recordings. Keep the main asset visually product-first: an actual page, stable layout, inline diff, jump chips, view toggles, and the score chip.

Current assets:

- `patina-preview-en.gif` — README hero animation used by English, Korean, Chinese, and Japanese READMEs.
  - source: a styled local HTML page with Notion-template-pack prose.
  - generated with: `node bin/patina.js --preview --lang en --tone marketing --backend codex-cli <sample>.html`
  - captured views: Rewritten → Diff → Original → Both → Diff.
  - expected visual contract: page layout stays fixed; prose blocks are numbered; the bar shows `4 OF 5 BLOCKS REWRITTEN` and `SCORE 60 → 0`; Diff view uses red strikethrough removals and green insertions.
  - size target: keep the GIF under 10 MB so GitHub renders it reliably; current target is under 1 MB.

Shared requirements:

- use a real `--preview` output page, not a hand-drawn mock
- keep headings, CTA, and layout visible in the first viewport
- keep animation slow enough to read the toggle labels
- avoid animated SVG for GitHub README motion because sanitization can strip animation
- after changing assets or README image references, run `npm run check:no-private-assets` and `npm run test:unit -- tests/unit/assets.test.js`

## Regeneration outline

1. Create a local HTML page with AI-sounding prose and clear product-page layout.
2. Run:

```bash
node bin/patina.js --preview --lang en --tone marketing --backend codex-cli /tmp/patina-preview-sample.html
```

3. Open the saved preview HTML from stderr.
4. Capture the first viewport in the four view states: Rewritten, Original, Both, Diff.
5. Assemble a compact GIF from those captures.

The checked-in asset was rendered at 960×617 with five frames and a 128-color palette.
