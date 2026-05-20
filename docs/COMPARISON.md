# Comparison: patina and other humanizer/paraphraser tools

This page is factual positioning, not a claim that patina “wins.” Pricing and product limits change often, so verify vendor pages before making a purchase decision.

Sources checked on 2026-05-20: [QuillBot Premium](https://quillbot.com/premium), [QuillBot pricing help](https://help.quillbot.com/hc/en-us/articles/36491424881943-What-is-the-price-of-QuillBot-Premium), [Undetectable pricing](https://undetectable.com/pricing), [Humbot pricing](https://humbot.ai/pricing), and [`blader/humanizer`](https://github.com/blader/humanizer/blob/main/README.md).

| Tool | Pricing model | Language coverage | Auditability | Meaning preservation | Self-hostable / OSS | Best fit |
|---|---|---|---|---|---|---|
| patina | MIT open source; local CLI/skill; paid only if you choose a paid model backend | KO, EN, ZH, JA pattern packs | Pattern-level audit, diff, score, benchmark fixtures | MPS/fidelity checks and rollback in documented flows | Yes | Maintainers and writers who want reviewable editing logic |
| QuillBot | Free tier plus Premium subscription; pricing is regional on the official page | Broad writing suite; official page advertises paraphrasing in many languages | Product UI oriented; not repo-auditable | Humanizer/tone tools, but no public pattern/MPS spec | No | General writing assistance and paraphrasing suite |
| Undetectable AI | Commercial plans; checked page listed Basic/Premium/Ultimate monthly tiers | English-first marketing; verify current plan details | Detector/humanizer product; not repo-auditable | Detector-facing rewrite; no public MPS spec | No | Users specifically shopping for detector/humanizer SaaS |
| Humbot | Commercial monthly/yearly plans and API access; checked page lists word-credit limits | Web/API humanizer positioning; verify current plan details | SaaS/API; not repo-auditable | No public MPS-style spec found in the checked docs | No | API-oriented humanizer workflow |
| blader/humanizer | Open-source skill repository | Skill prompt based; check repo for current language scope | Prompt text is inspectable | Prompt-guided; no checked-in benchmark/MPS schema comparable to patina | Yes | Lightweight prompt-skill humanization |

## Reproducible comparison recipe

A fair benchmark should avoid sending private text to third-party tools. Use 10 redistributable paragraphs from `tests/fixtures/suspect-zones/**`, run each tool with default settings, then record:

1. Input fixture id and expected class.
2. Tool name/version/date.
3. Output text hash, not the full output if licensing/privacy is unclear.
4. Patina score/audit on the output.
5. Manual meaning-preservation notes for numbers, negation, causation, and named entities.

The checked-in benchmark currently covers patina's deterministic suspect-zone analyzer only. Third-party output capture is left out until fixture redistribution and tool terms are reviewed.

## Offline comparison harness

Patina now ships an offline harness for this recipe:

```bash
npm run benchmark:compare
node scripts/detector-comparison.mjs --input tests/quality/detectors.manual.example.json
```

The default report lives at [`docs/benchmarks/detector-comparison.md`](benchmarks/detector-comparison.md) and includes only Patina's in-tree deterministic analyzer. Third-party rows must be entered manually from redistributable fixtures, with the collection date and visible plan/version notes. The harness does not scrape vendor sites, call detector APIs, or send private text out of the repository.

Treat any comparison row as time-stamped evidence for a small corpus, not as a universal claim that one tool "beats" another.
