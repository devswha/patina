# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-05-21
- Primary product surfaces: README logo, app/repo icon, social preview image, launch posts.
- Evidence reviewed:
  - Local: `README.md`, `README_KR.md`, `README_ZH.md`, `README_JA.md`, `docs/ROADMAP.md`, `docs/BRANDING.md`, `assets/brand/patina-icon.svg`, `assets/brand/patina-logo.svg`, `assets/social/patina-og.svg`, `assets/demo/patina-demo.gif`.
  - External pattern references: Vite, Astro, Bun, Deno, Tailwind CSS, shadcn/ui README presentation patterns.

## Brand
- Personality: precise, trustworthy, editorial, slightly mysterious, developer-friendly.
- Trust signals: auditable changes, meaning preservation, benchmark visibility, clean docs.
- Avoid: detector-bypass framing, generic AI sparkles, robot/brain motifs, purple crystal/Obsidian-like trade dress, eco-leaf ambiguity, unreadable tiny text.

## Product goals
- Goals:
  - Make patina memorable at GitHub README, favicon, and social-card scale.
  - Communicate “strip AI packaging, keep meaning” through one simple copper-to-teal transformation mark.
  - Keep final production assets editable and reviewable as SVG.
- Non-goals:
  - Do not ship generated raster art as the only source asset.
  - Do not imply proof of human authorship.
- Success signals:
  - Recognizable copper-to-teal core silhouette at 32px.
  - Works on GitHub light and dark surfaces.
  - Feels like a serious open-source developer tool, not a generic AI app.

## Personas and jobs
- Primary personas: LLM-assisted writers, engineers cleaning docs, Korean/English/Chinese/Japanese content editors, maintainers evaluating writing quality.
- User jobs: detect AI-ish prose, rewrite without meaning loss, inspect what changed, trust benchmark/quality evidence.
- Key contexts of use: GitHub README landing, package pages, social shares, terminal/CLI docs.

## Information architecture
- Primary navigation: README first, docs/examples/benchmark next.
- Core routes/screens: N/A; current project is CLI/skill/docs-first.
- Content hierarchy: logo/tagline → demo → trust metrics → quick start.

## Design principles
- Principle 1: One iconic transformation mark beats explanatory document details; prefer flat geometry over rendered texture.
- Principle 2: Editorial trust first; visual drama should support credibility, not overpower it.
- Tradeoffs: expressive color is useful for social preview, but the icon must stay flat, simple, and silhouette-first.

## Visual language
- Color: dark slate/near-black base, oxidized copper, verdigris green, warm cream text/meaning core; keep the production mark to a small flat palette.
- Typography: system sans for README SVG lockup; no text inside app icon candidates.
- Spacing/layout rhythm: centered hero, generous padding, compact badges/links below.
- Shape/radius/elevation: rounded app tile, bold copper-to-teal pure mark, no shadows, no bevels, no pseudo-3D depth.
- Motion: the README hero can use `assets/demo/patina-demo.gif` to show AI packaging being removed from a real fixture; avoid animated SVG for GitHub README motion because sanitization can strip animation.
- Imagery/iconography: copper becoming patina teal around a warm preserved-meaning core. Avoid text-line clutter, document-card literalism, 3D realism, gradients, glow, texture, and bevel language in final SVG assets.

## Components
- Existing components to reuse: `assets/brand/*.svg`, `assets/social/*.svg`, `assets/demo/patina-demo.gif`.
- New/changed components: optional AI concept references under `.omx/artifacts/visual-ralph/` before SVG reconstruction; production assets remain hand-authored SVG.
- Variants and states: square pure-mark icon, horizontal logo lockup, social preview.
- Token/component ownership: brand assets stay under `assets/brand/`; social cards under `assets/social/`; README demo recordings under `assets/demo/`. Re-render demo GIFs with asciinema + `agg`, keep them under 10 MB, and verify the shown rewrite with `node scripts/precommit-score.mjs examples/short/marketing-launch-rewritten.md`.

## Accessibility
- Target standard: readable on GitHub light/dark backgrounds and package pages.
- Keyboard/focus behavior: N/A for static assets.
- Contrast/readability: logo lockup requires dark card/backplate or high-contrast text.
- Screen-reader semantics: SVGs should keep `role="img"`, `<title>`, and `<desc>`.
- Reduced motion and sensory considerations: no flashing or motion in static assets.

### Static SVG checklist

- Standalone brand/social SVGs use `role="img"` plus `<title>` and `<desc>` (or an explicit `aria-label` for decorative exceptions).
- README logo uses the canonical `assets/brand/patina-logo.svg`; avoid duplicate byte-identical README variants.
- SVG text relies on system fallback fonts because GitHub does not load web fonts inside `<img>` SVGs.
- The logo lockup should be checked at README width (`width="440"`) and the icon at 32px before release.

## Responsive behavior
- Supported breakpoints/devices: README desktop/mobile, favicon-scale icon, 1200x630 social preview.
- Layout adaptations: icon must stand alone; wordmark can be omitted at small sizes.
- Touch/hover differences: N/A.

## Interaction states
- Loading: N/A.
- Empty: N/A.
- Error: N/A.
- Success: N/A.
- Disabled: N/A.
- Offline/slow network: SVG should be lightweight enough for README/package use.

## Content voice
- Tone: direct, auditable, non-hype.
- Terminology: “AI packaging,” “meaning preservation,” “audit/diff/score.”
- Microcopy rules: avoid “undetectable,” “bypass,” or “human proof.”

## Implementation constraints
- Framework/styling system: repo-native SVG/Markdown; no new runtime dependencies.
- Design-token constraints: use explicit solid SVG fills; keep palette small and gradient-free for production logo assets.
- Performance constraints: SVG should stay reasonably small and reviewable.
- Compatibility constraints: relative links must work on GitHub and npm package pages.
- Test/screenshot expectations: XML parse SVGs; `git diff --check`; `npm pack --dry-run` when package file list changes.

## Open questions
- [ ] Whether to add raster exports/favicons after final SVG approval / owner: maintainer / impact: launch polish.
