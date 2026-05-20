# Static-site Generator Stencils

These recipes wire Patina into build-time checks for Markdown sites. They are intentionally in-repo examples, not standalone npm packages.

All examples assume one of these authentication paths:

```bash
export PATINA_API_KEY=...
# or tell the example scripts to use a logged-in local CLI backend:
export PATINA_BACKEND=codex-cli
# optional: use an installed binary instead of `npx --yes patina-cli`
export PATINA_BIN=patina
```

For CI, prefer score gates over automatic rewrites:

```bash
patina --lang en --backend codex-cli --score --exit-on 30 docs/**/*.md
```

## Hugo: JSON data + shortcode

Use a small Node helper to score content and write a Hugo data file:

```bash
node examples/integrations/hugo/scripts/patina-scores.mjs content/posts data/patina-scores.json
```

Then render a badge in a template or post body:

```go-html-template
{{</* patina-score path="content/posts/launch.md" */>}}
```

Files:

- [`examples/integrations/hugo/scripts/patina-scores.mjs`](../../examples/integrations/hugo/scripts/patina-scores.mjs)
- [`examples/integrations/hugo/layouts/shortcodes/patina-score.html`](../../examples/integrations/hugo/layouts/shortcodes/patina-score.html)

## Astro: `astro:build:start` hook

Astro integrations can fail the build before pages render. The example integration scans Markdown under `src/content` and runs `patina --score --exit-on 30`.

```js
// astro.config.mjs
import patinaAudit from './examples/integrations/astro/patina-audit-integration.mjs';

export default {
  integrations: [patinaAudit({ contentDir: 'src/content', lang: 'en', threshold: 30 })],
};
```

File: [`examples/integrations/astro/patina-audit-integration.mjs`](../../examples/integrations/astro/patina-audit-integration.mjs)

## Next.js MDX: remark warning plugin

The Next.js example exports a remark plugin that scores the Markdown text during MDX compilation and emits a VFile warning when the threshold is exceeded. Teams can decide whether warnings fail CI.

```js
// next.config.mjs
import createMDX from '@next/mdx';
import patinaRemark from './examples/integrations/nextjs/remark-patina-score.mjs';

const withMDX = createMDX({
  options: {
    remarkPlugins: [[patinaRemark, { lang: 'en', threshold: 30 }]],
  },
});

export default withMDX({ pageExtensions: ['js', 'jsx', 'md', 'mdx'] });
```

File: [`examples/integrations/nextjs/remark-patina-score.mjs`](../../examples/integrations/nextjs/remark-patina-score.mjs)

## Guardrails

- Keep v1 in-repo; do not publish a package until at least one real site uses the stencil.
- Do not send private drafts to third-party backends from CI unless the project owner opted in.
- Use `--exit-on` for gating and leave rewrites as a local author action.
