# Comparison: patina and other humanizer/paraphraser tools

This page is factual positioning, not a claim that patina “wins.” Pricing and product limits change often, so verify vendor pages before making a purchase decision.

Sources checked on 2026-05-20: [QuillBot Premium](https://quillbot.com/premium), [QuillBot pricing help](https://help.quillbot.com/hc/en-us/articles/36491424881943-What-is-the-price-of-QuillBot-Premium), [Undetectable pricing](https://undetectable.com/pricing), [Humbot pricing](https://humbot.ai/pricing), and [`blader/humanizer`](https://github.com/blader/humanizer/blob/main/README.md). Closest open-source skill checked on 2026-06-14: [`epoko77-ai/im-not-ai`](https://github.com/epoko77-ai/im-not-ai).

| Tool | Pricing model | Language coverage | Auditability | Meaning preservation | Self-hostable / OSS | Best fit |
|---|---|---|---|---|---|---|
| patina | MIT open source; local CLI/skill; paid only if you choose a paid model backend | KO, EN, ZH, JA pattern packs | Pattern-level audit, diff, score, benchmark fixtures | MPS/fidelity checks and rollback in documented flows | Yes | Maintainers and writers who want reviewable editing logic |
| QuillBot | Free tier plus Premium subscription; pricing is regional on the official page | Broad writing suite; official page advertises paraphrasing in many languages | Product UI oriented; not repo-auditable | Humanizer/tone tools, but no public pattern/MPS spec | No | General writing assistance and paraphrasing suite |
| Undetectable AI | Commercial plans; checked page listed Basic/Premium/Ultimate monthly tiers | English-first marketing; verify current plan details | Detector/humanizer product; not repo-auditable | Detector-facing rewrite; no public MPS spec | No | Users specifically shopping for detector/humanizer SaaS |
| Humbot | Commercial monthly/yearly plans and API access; checked page lists word-credit limits | Web/API humanizer positioning; verify current plan details | SaaS/API; not repo-auditable | No public MPS-style spec found in the checked docs | No | API-oriented humanizer workflow |
| blader/humanizer | Open-source skill repository | Skill prompt based; check repo for current language scope | Prompt text is inspectable | Prompt-guided; no checked-in benchmark/MPS schema comparable to patina | Yes | Lightweight prompt-skill humanization |
| epoko77-ai/im-not-ai | MIT open source; Claude Code / Codex skill; paid only via your own model backend | Korean only (KO) | Severity-tagged span detection (S1/S2/S3) + A–D grade; no checked-in numeric benchmark corpus | 13-item fidelity audit + naturalness review and change-rate caps (strict mode) | Yes | Korean writers wanting a Claude Code humanize skill with a multi-agent strict pipeline |

## Closest open-source skill: epoko77-ai/im-not-ai

[`epoko77-ai/im-not-ai`](https://github.com/epoko77-ai/im-not-ai) is the most directly comparable project — a popular MIT-licensed Claude Code / Codex skill that humanizes Korean AI writing. The two make different bets, so it is worth being explicit about where each is stronger.

**Where im-not-ai is stronger:**

- Korean-first depth: a translation-studies-grounded taxonomy (10 categories, 40+ sub-patterns) with severity tiers and an academic citation trail.
- A multi-agent *strict* pipeline (detector → rewriter → fidelity auditor → naturalness reviewer) plus a single-call *fast* mode, native to Claude Code subagents.
- Distribution and adoption: plugin-marketplace install and a large community.

**Where patina is stronger:**

- Four languages (KO/EN/ZH/JA), not Korean only.
- A deterministic, LLM-free analysis engine (`src/features/*`) that runs identically in the CLI and the playground's server-side path, so audit/score are reproducible without a model call.
- A published numeric benchmark layer (precision/recall/F1, low-FPR TPR@1%/5%FPR, ROC/PR, robustness) over labeled fixtures, plus a documented MPS/fidelity rollback contract.
- Three surfaces: agent skill, standalone npm CLI (`patina-cli`), and a browser playground with server-side rewrite + scoring.

In short: im-not-ai optimizes for Korean-specialist humanization depth as a Claude Code skill; patina optimizes for multilingual, auditable, reproducible detection and rewrite across skill, CLI, and browser. They are complementary references more than direct substitutes.

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
