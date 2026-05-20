# Docs Platform RFC

Status: investigation only; no docs-site implementation in this issue.
Sources checked: 2026-05-20 UTC.

Patina currently ships flat Markdown plus generated API/pattern reference pages. That remains the lowest-maintenance option for the next release. A docs site becomes worthwhile when search, localized navigation, or versioned release docs become more valuable than keeping every document directly browsable in GitHub.

## Options compared

| Option | i18n | Search | Versioning | Deployment effort | Notes |
|---|---|---|---|---|---|
| Docusaurus | Strong built-in locale workflow and translated docs routes | Built-in local search options and hosted search integrations | Built-in docs versioning | Medium: React app, sidebars, build pipeline, deploy to Pages/Vercel/Netlify | Best if Patina wants versioned docs and a conventional OSS docs portal. |
| Astro Starlight | Strong i18n routing for content collections | Built-in Pagefind search in the Starlight docs stack | No first-class versioned-docs workflow comparable to Docusaurus; can model versions as content sections | Medium-low: Astro app plus content migration | Best fit if Patina wants a lightweight multilingual docs site with modern content authoring and fewer React conventions. |
| MkDocs + Material | Mature Markdown docs, search, navigation, and language customization; i18n usually needs plugin/workflow choices | Built-in client search through MkDocs/Material | Usually handled with `mike` or deploy aliases | Medium: Python toolchain plus theme/plugin choices | Good for Python-heavy teams; less natural for this Node-first repo. |
| GitHub Pages with current Markdown | No routed i18n beyond separate files | GitHub search only; no site search UX | Tags/branches only, no docs-version UX | Low: already works | Best current default. Keeps maintenance near zero but does not solve navigation/search. |

## Source links

- Docusaurus docs: https://docusaurus.io/docs
- Docusaurus i18n: https://docusaurus.io/docs/i18n/introduction
- Docusaurus versioning: https://docusaurus.io/docs/versioning
- Astro Starlight docs: https://starlight.astro.build/
- Starlight i18n: https://starlight.astro.build/guides/i18n/
- Starlight search: https://starlight.astro.build/guides/search/
- MkDocs: https://www.mkdocs.org/
- Material for MkDocs: https://squidfunk.github.io/mkdocs-material/
- Material search: https://squidfunk.github.io/mkdocs-material/setup/setting-up-site-search/
- `mike` MkDocs versioning: https://github.com/jimporter/mike
- GitHub Pages: https://docs.github.com/pages

## Recommendation

Do **not** migrate immediately. Keep GitHub-rendered Markdown until one of these triggers is true:

1. search becomes a recurring support problem;
2. localized docs need language-specific navigation rather than separate `README_*` files;
3. a release process requires versioned docs for multiple supported CLI versions.

When a site is justified, start with **Astro Starlight** unless versioned docs are the primary requirement. Starlight is the best fit for Patina's current content shape: Markdown-first, multilingual, and lightweight. Choose **Docusaurus** instead if versioning becomes mandatory before the migration starts.

## Effort estimate

| Phase | Estimate | Work |
|---|---:|---|
| RFC acceptance + URL plan | 0.5 day | Pick `/docs` vs custom domain, define canonical source of truth, decide whether README remains the landing page. |
| Minimal Starlight proof of concept | 1-2 days | Add app scaffold, import 8-12 key docs, configure i18n nav/search, deploy preview. |
| Full migration | 3-5 days | Move docs into site collections, preserve links/anchors, add redirects, wire CI build, update README links. |
| Versioned docs with Docusaurus | 4-7 days | Same as above plus sidebar/version policy and release tagging workflow. |

## Non-goals

- No docs-site dependency is added by this RFC.
- No README or existing Markdown page is moved.
- No custom domain, Pages workflow, or search index is created here.
