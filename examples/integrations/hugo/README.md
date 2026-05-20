# Hugo Patina score shortcode

Run from the repository root of a Hugo site:

```bash
node examples/integrations/hugo/scripts/patina-scores.mjs content/posts data/patina-scores.json
```

By default the script runs `npx --yes patina-cli`. Set `PATINA_BIN=patina` to use an installed binary.

Copy `layouts/shortcodes/patina-score.html` into the Hugo site, then use:

```go-html-template
{{</* patina-score path="content/posts/my-post.md" */>}}
```
