# Demo assets

The English README hero now uses the web playground surface; the CLI `--preview` animation stays as the secondary demo and the non-English README hero. Keep every asset product-first: a real UI, stable layout, readable scores, no hand-drawn mocks.

Current assets:

- `patina-playground-en.gif` — README (English) hero animation showing the web playground flow.
  - source: the real playground UI (English) served by `node scripts/dev-server.mjs` with a real LLM backend (`PATINA_DEV_LLM_*`, `PATINA_DEV_LLM_SCORE=real`) — real rewrite, real MPS/fidelity scoring, real deterministic AI-signal drop.
  - captured frames: typed sample on the landing → streaming rewrite (×2) → result with MPS/Fidelity badges → result with the AI-signal (hot-paragraph ratio 100 → 0) and length disclosures expanded.
  - expected visual contract: English UI ("Make it sound human"), Free mode nav, the 30-templates fact preserved in the rewrite, MPS 100 / Fidelity 75 badges, hot-paragraph ratio 100 → 0.
  - rendered at 1640px wide, 5 frames, 256-color shared palette; keep under 1 MB.
- `patina-playground-en.png` — expanded-result still used where PNG is required.
- `patina-preview-en.gif` — CLI `--preview` animation, linked from the README demo section and used by the Korean, Chinese, and Japanese READMEs.
  - source: a styled local HTML page with Notion-template-pack prose.
  - generated with: `node bin/patina.js --preview --lang en --tone marketing --backend codex-cli <sample>.html`
  - captured views: Rewritten → Diff → Original → Both → Diff.
  - expected visual contract: page layout stays fixed; prose blocks are numbered; the bar shows `4 OF 5 BLOCKS REWRITTEN` and `SCORE 60 → 0`; Diff view uses red strikethrough removals and green insertions.
  - size target: keep the GIF under 10 MB so GitHub renders it reliably; current target is under 1 MB.
- `patina-preview-en.png` — first-frame still used for directory submission previews that require PNG.

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
