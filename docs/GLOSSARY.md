# Glossary

Short definitions for recurring patina terms. Each entry links to the
deeper reference where the term is used in context.

## AI-likeness

A 0-100 editing signal for how strongly a text matches patina's AI-writing
patterns. Lower means less AI-sounding; it is not proof of authorship. See
[the scoring overview](../core/scoring.md#ai-likeness-scoring-algorithm) and
[the FAQ](FAQ.md#what-does-the-ai-likeness-score-mean).

## Audit mode

The mode that detects and reports AI-writing patterns without rewriting the
text. Use it when you want to inspect what patina would flag before changing
anything. See the [mode table](../README.md#modes) and [examples guide](EXAMPLES.md).

## Burstiness

The variation in sentence length inside a paragraph, measured with coefficient
of variation. Very uniform sentence lengths are one signal that a paragraph may
need closer inspection. See [Stylometry](../core/stylometry.md#4-burstiness-metric).

## Diff mode

The mode that shows changes pattern by pattern, making the edit auditable
instead of a black-box paraphrase. See the [mode table](../README.md#modes)
and [examples checklist](EXAMPLES.md#what-patina-is-checking).

## Fidelity

A meaning-accuracy score comparing original text with the output. Higher is
better: it checks whether claims, facts, tone, and length stayed faithful. See
[Fidelity Scoring](../core/scoring.md#9-fidelity-scoring--overview).

## Meaning preservation

The safety goal that rewritten text should keep the original claims, polarity,
causal links, numbers, and other high-risk details. See
[the FAQ](FAQ.md#how-does-patina-preserve-meaning) and
[MPS overview](../core/scoring.md#14-mps-meaning-preservation-score--overview).

## MATTR

Moving Average Type-Token Ratio, a lexical-diversity metric that reduces the
length bias of simple TTR. Patina uses it as one stylometry signal, with known
language limitations. See [Stylometry](../core/stylometry.md#5-ttr-via-mattr).

## Mode

A CLI output path such as rewrite, verify, audit, score, or diff. Modes
control whether patina edits text, verifies meaning preservation, reports
findings, or scores text. See the [mode table](../README.md#modes).

## MPS

Meaning Preservation Score. MPS checks whether extracted semantic anchors
survive the rewrite pipeline and whether polarity is preserved. See
[the FAQ](FAQ.md#what-is-mps) and
[MPS scoring](../core/scoring.md#16-mps-scoring-formula).

## Ouroboros loop

An iterative rewrite loop that keeps trying to lower AI-likeness while obeying
meaning-preservation gates. The standalone CLI replaced it with `--verify`
(rewrite + meaning-floor retry); the loop still lives in the `/patina` skill
and the `quality:rewrite-ab` research baseline. See
[Ouroboros Termination](../core/scoring.md#ouroboros-termination).

## Pattern

A named AI-writing signal with a fire condition, exclusion condition, problem
description, and before/after example. Patterns are the unit patina audits and
rewrites against. See [PATTERNS.md](PATTERNS.md).

## Pattern pack

A language and category file such as `patterns/en-style.md` or
`patterns/ko-content.md`. Packs group related patterns and provide counts used
by scoring. See [PATTERNS.md](PATTERNS.md#language-specific-patterns).

## Profile

A voice preset that can amplify, reduce, or suppress specific patterns for a
use case such as blog, academic, technical, or legal writing. See
[profile override adjustments](../core/scoring.md#5-profile-override-adjustments).

## Rewrite mode

The default mode that removes matched AI-writing patterns while checking that
meaning survived the edit. See the [Quick Start](../README.md#quick-start) and
[MPS integration points](../core/scoring.md#17-mps-integration-points).

## Score mode

The mode that returns a 0-100 AI-likeness score with category breakdowns and,
when original text is available, fidelity and MPS signals. See
[Score Interpretation](../core/scoring.md#7-score-interpretation).

## Semantic anchor

A meaning unit extracted before rewriting, such as a claim, negation, number,
causal link, quantifier, or polarity marker. Anchors are later verified by MPS.
See [MPS Anchor Verification Criteria](../core/scoring.md#15-mps-anchor-verification-criteria).

## Suspect zone

A paragraph or sentence group marked for closer inspection by stylometry,
usually because burstiness, MATTR, or lexicon signals fired. See
[the stylometry delivery format](../core/stylometry.md#9-llm-delivery-format).

## Tone

A named voice axis, such as casual, professional, academic, narrative,
marketing, instructional, or auto. Tone is applied on top of pattern rewriting.
See [Tones](../README.md#tones).

## Viral hook

A score-only pattern class for SNS and marketing signals such as shock numbers,
clickbait closes, source-skipping authority claims, short-sentence stacking,
and hyperbolic engagement language. See
[Score-only viral hooks](PATTERNS.md#score-only-viral-hooks-v3110).
