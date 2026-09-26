# Demo assets

The READMEs now use illustrative pairs in each language; see `docs/DEMO.md` for
the current examples and share cards. The older recordings below retain their
original pixels and score labels, so they cannot verify the current illustrative
examples or the latest release.

Recorded assets:

- `patina-demo-live-en.gif` — former English README hero: a production-hosted capture from patina.vibetip.help.
  - source: live screen recording of the deployed hosted playground (not a local dev server / CLI capture) — real server-side rewrite and live MPS/fidelity scoring.
  - captured flow: English typing on the landing → server-side rewrite → result with MPS 100 / Fidelity 75 badges (real service).
  - specs: 960px wide, 12fps, ~685KB, ~25s.
- `patina-playground-en.gif` — former hero animation for the localized READMEs; also used by the English README before the live capture above.
  - source: the real playground UI (English) served by `node scripts/dev-server.mjs` with a real LLM backend (`PATINA_DEV_LLM_*`, `PATINA_DEV_LLM_SCORE=real`) — real rewrite, real MPS/fidelity scoring, real deterministic AI-signal drop.
  - captured frames: typed sample on the landing → streaming rewrite (×2) → result with MPS/Fidelity badges → result with the AI-signal (hot-paragraph ratio 100 → 0) and length disclosures expanded.
  - expected visual contract: English UI ("Make it sound human"), Free mode nav, the 30-templates fact preserved in the rewrite, MPS 100 / Fidelity 75 badges, hot-paragraph ratio 100 → 0.
  - rendered at 1640px wide, 5 frames, 256-color shared palette; keep under 1 MB.
- `patina-playground-en.png` — expanded-result still used where PNG is required.
- `patina-preview-en.png` — still of the historical CLI `--preview` page (Rewritten view), used for directory submissions that require a PNG.
  - source: a styled local HTML page with Notion-template-pack prose.
  - generated with: `node bin/patina.js --preview --lang en --document-type marketing --backend codex-cli <sample>.html`
  - visual contract: prose blocks are numbered; the bar shows `4 OF 5 BLOCKS REWRITTEN` and `SCORE 60 → 0`.

Requirements for new runtime recordings:

- use a real `--preview` output page, not a hand-drawn mock
- keep headings, CTA, and layout visible in the first viewport
- keep animation slow enough to read the toggle labels
- avoid animated SVG for GitHub README motion because sanitization can strip animation
- after changing assets or README image references, run `npm run check:no-private-assets` and `npm run test:unit -- tests/unit/assets.test.js`

Illustrative cards must identify themselves as examples and use the text of their source
pairs. Their explanatory text carries no invented scores and must not be
described as a captured model result.

## Regeneration outline

1. Create a local HTML page with AI-sounding prose and clear product-page layout.
2. Run:

```bash
node bin/patina.js --preview --lang en --document-type marketing --backend codex-cli /tmp/patina-preview-sample.html
```

3. Open the saved preview HTML from stderr.
4. Capture the first viewport in the four view states: Rewritten, Original, Both, Diff.
5. Assemble a compact GIF from those captures.

The checked-in still is 960×617.
