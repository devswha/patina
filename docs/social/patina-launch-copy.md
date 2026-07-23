---
title: patina launch — EN channel drafts
category: Launch
target_url: https://patina.vibetip.help
created: 2026-07-23
notes:
  - No Pro checkout links or price CTAs until the Lemon Squeezy store review clears. CTA is the free playground plus GitHub.
  - Benchmark numbers are the fixed-fixture regression gate from docs/benchmarks/latest.md. Never phrase them as generalization claims.
  - The fabricated "30%" story is a real floor_failed event observed on the live free tier on 2026-07-23. Tell it exactly as it happened.
  - Post the Korean channels first (see patina-launch-korean-first.md), then HN once early feedback is folded in.
---

## Show HN

Title: Show HN: Patina – open-source AI-writing humanizer that rejects its own output when it fabricates

Body:

I got tired of hand-deleting the same AI tells from drafts: "isn't just X, it's Y", "in today's fast-paced world", the three-bullet paragraph. So I built a tool that does it, for Korean, English, Chinese, and Japanese. About 160 patterns total.

Two design choices set it apart from the usual humanizer:

Detection is deterministic and LLM-free. Sentence-length variance (burstiness), lexical diversity (MATTR), AI-lexicon density, plus Korean-specific diagnostics. Same input, same verdict, every time, with per-paragraph reasons you can audit.

Rewrites are gated on meaning. Every rewrite gets a meaning-preservation score against semantic anchors (claims, numbers, polarity, causation) and a fidelity score. Below the floor, the output is rejected, not shown. During a live smoke test the backing model invented a "cuts task time by about 30%" statistic that was nowhere in the source. The gate caught it and threw the rewrite away. A tool built to remove AI packaging should not add AI fabrication.

It is explicitly not a detector bypass. The ethics doc draws that line, and the scoring is designed for auditability, not evasion.

Free browser playground (no signup), a CLI via npx patina-cli, and the whole pattern catalog, scoring spec, and benchmark corpus are in the repo.

Playground: https://patina.vibetip.help
Repo: https://github.com/devswha/patina

The failure mode I most want reports on: false positives, human-written text flagged as AI. Labeled counterexamples go straight into the regression corpus.

## Reddit (r/artificial, writing subs)

Title: I built an open-source tool that removes AI phrasing from text, and it refuses to output a rewrite that changes your claims

Body:

Patina detects AI-sounding patterns (about 160 across Korean, English, Chinese, Japanese) and rewrites them in plain human phrasing. The part I care most about: it scores every rewrite for meaning preservation, and if the rewrite altered a claim, a number, or a causal link, it rejects the output instead of showing it.

That gate fired in live testing. The model slipped a fabricated "30% time savings" stat into a rewrite; the pipeline scored it, failed it, and discarded it.

Detection itself runs without any LLM, so it is deterministic and auditable. You can see exactly which paragraph tripped which signal. It is not an AI-detector bypass and does not try to be; there is an ethics doc in the repo about that.

Free in the browser, no signup: https://patina.vibetip.help
Source: https://github.com/devswha/patina

## X (EN) — thread

1/
AI drafts all share the same tells.
"isn't just X, it's Y." "In today's fast-paced world." Three bullets per paragraph.

I built an open-source tool that strips them, in KO, EN, ZH, JA.
Free in the browser, no signup: https://patina.vibetip.help

2/
The interesting part isn't the rewriting. It's the refusal.

Every rewrite is scored for meaning preservation. In live testing the model fabricated a "30% time savings" stat. The gate failed it and threw the output away.

Your words change. Your claims don't.

3/
Detection is deterministic, no LLM involved: burstiness, lexical diversity, AI-lexicon density, per-paragraph reasons.

Catalog, scoring spec, and benchmarks are all public:
https://github.com/devswha/patina

Best way to contribute: send me human-written text it wrongly flags.
