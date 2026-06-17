# Demo assets

README hero animations are language-suffixed so each localized README can point
at a matching demo instead of reusing a Korean recording everywhere.

Current assets:

- `patina-demo-en.gif` — English README hero. `README_ZH.md` and `README_JA.md`
  intentionally fall back to this English terminal demo until localized ZH/JA
  recordings are worth maintaining.
  - source: `examples/short/marketing-launch-en.md`
  - expected rewrite: `examples/short/marketing-launch-en-rewritten.md`
- `patina-demo-ko.gif` — Korean README hero.
  - source: `examples/short/marketing-launch.md`
  - expected rewrite: `examples/short/marketing-launch-rewritten.md`
- Future localized demos should use the same naming pattern:
  `patina-demo-zh.gif`, `patina-demo-ja.gif`.
- `patina-preview-en.png` — README "See it on a real page" hero: a `--preview`
  page rendered in the **Diff** view (inline strikethrough/insert audit trail,
  the Rewritten/Original/Both/Diff toggle, jump-to-change dots, and the
  `SCORE 60 → 0` chip).
  - regenerate: run `patina --preview --lang en <sample>.html` (a styled local
    page with AI-sounding prose), open the saved preview HTML, switch to the
    Diff toggle, and screenshot at ~1120px wide / 2× scale.
  - size target: keep the PNG well under 1 MB so GitHub renders it inline.

Shared requirements:

- verification: each rewritten fixture should pass the 30% content gate before
  the GIF is updated
- size target: GIF under 10 MB so GitHub renders it reliably

## Deterministic fallback render

When a live terminal recorder is not available, render a small transcript GIF
from checked-in fixtures. This helper is optional and requires local Python +
Pillow only for asset regeneration; it is not a package runtime dependency.

```bash
python3 scripts/render-demo-gif.py \
  --lang en \
  --source examples/short/marketing-launch-en.md \
  --rewrite examples/short/marketing-launch-en-rewritten.md \
  --output assets/demo/patina-demo-en.gif \
  --title "patina demo — English" \
  --score-line "PASS · score 0.0% · MPS: meaning preserved"

node scripts/precommit-score.mjs examples/short/marketing-launch-en-rewritten.md
ls -lh assets/demo/patina-demo-en.gif

# Korean variant, when it needs to be regenerated:
python3 scripts/render-demo-gif.py \
  --lang ko \
  --source examples/short/marketing-launch.md \
  --rewrite examples/short/marketing-launch-rewritten.md \
  --output assets/demo/patina-demo-ko.gif \
  --title "patina demo — Korean" \
  --score-line "PASS · score under 30% · MPS: meaning preserved"

node scripts/precommit-score.mjs examples/short/marketing-launch-rewritten.md
```

## Preferred live terminal capture

Use this when `asciinema` and `agg` are installed and you want to capture a real
terminal session instead of the deterministic fallback render:

```bash
# 1) Record a real terminal session using the checked-in language fixture.
asciinema rec /tmp/patina-demo-en.cast

# In the recording, run:
cat examples/short/marketing-launch-en.md
patina --lang en --tone marketing examples/short/marketing-launch-en.md
node scripts/precommit-score.mjs examples/short/marketing-launch-en-rewritten.md

# 2) Render to a GitHub-safe GIF. Do not use animated SVG for README motion.
agg /tmp/patina-demo-en.cast assets/demo/patina-demo-en.gif \
  --cols 82 --rows 24 \
  --font-family "DejaVu Sans Mono"

# 3) Keep the asset small and verify the rewritten fixture still passes.
ls -lh assets/demo/patina-demo-en.gif
node scripts/precommit-score.mjs examples/short/marketing-launch-en-rewritten.md
```

If `agg` output is too large, compress with `gifsicle -O3` or re-record a shorter cast.
