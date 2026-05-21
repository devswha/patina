# Demo assets

`patina-demo.gif` is the README hero animation for issue #306.

Current fixture:

- source: `examples/short/marketing-launch.md`
- expected rewrite: `examples/short/marketing-launch-rewritten.md`
- verification: `node scripts/precommit-score.mjs examples/short/marketing-launch-rewritten.md` must stay under the 30% gate
- size target: GIF under 10 MB so GitHub renders it reliably

Preferred re-recording workflow for a live terminal capture:

```bash
# 1) Record a real terminal session using the checked-in short fixture.
asciinema rec /tmp/patina-demo.cast

# In the recording, run:
cat examples/short/marketing-launch.md
patina --lang ko --tone marketing examples/short/marketing-launch.md
patina-score examples/short/marketing-launch-rewritten.md

# 2) Render to a GitHub-safe GIF. Do not use animated SVG for README motion.
agg /tmp/patina-demo.cast assets/demo/patina-demo.gif \
  --cols 82 --rows 24 \
  --font-family "Noto Sans Mono CJK KR"

# 3) Keep the asset small and verify the rewritten fixture still passes.
ls -lh assets/demo/patina-demo.gif
node scripts/precommit-score.mjs examples/short/marketing-launch-rewritten.md
```

If `agg` output is too large, compress with `gifsicle -O3` or re-record a shorter cast.
