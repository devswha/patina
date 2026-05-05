# FAQ

## Is patina an AI detector bypass tool?

No. patina is an editing and audit tool.

AI detectors are noisy, and patina does not treat any score as proof that a text was written by a human or by AI. The useful artifacts are the audit, the diff, and the meaning-preservation checks: what changed, why it changed, and whether the original claims survived.

## What does "Strip the AI packaging" mean?

Many model outputs use the same surface habits: inflated stakes, vague balance, benefit stacking, corporate abstractions, metronomic paragraph rhythm, and filler transitions. patina looks for those patterns and rewrites the affected passages into plainer prose.

The goal is not to make a text deceptive. The goal is to remove generic model voice while keeping the actual message intact.

## How does patina preserve meaning?

patina extracts semantic anchors before rewriting: claims, polarity, causation, numbers, negation, and other high-risk details. After each rewrite phase, it checks whether those anchors are still present and whether their polarity stayed the same.

If a rewrite weakens, deletes, or reverses an anchor, patina retries the section or rolls it back.

## What is MPS?

MPS means Meaning Preservation Score. It is a rewrite-side safety signal that estimates how many extracted anchors survived the edit.

A high MPS does not mean the prose is perfect. It means the rewrite did not obviously drop or flip the claims patina was tracking.

## What does the AI-likeness score mean?

The score is a rough editing signal from 0 to 100. Lower is less AI-sounding.

It is not a truth machine. The scoring formula is deterministic, but severity assignment can vary by roughly 8-10 points between model runs. Treat the range and the highlighted patterns as more important than the exact number.

## How accurate is it?

Current calibration reports 91% catch rate on Korean AI text and 76% on HC3 English ChatGPT samples, with 13-25% false positives on human prose depending on register.

False positives are expected, especially for encyclopedic, corporate, academic, or heavily edited prose. patina is meant to help edit suspicious passages, not to accuse a writer.

## Does it work without an API key?

Yes, if you already have the Codex CLI installed and logged in. The installer can wire patina into Codex CLI as a backend, so no separate API key is required for that path.

Other providers can be configured through the documented backend and provider settings.

## Does it only work in Claude Code?

No. patina runs as a skill for Claude Code, Codex CLI, Cursor, and OpenCode, and it also works as a standalone Node.js CLI.

## Which languages are supported?

Korean, English, Chinese, and Japanese are supported. Pattern packs are auto-discovered by language prefix, so new languages can be added by contributing new pattern files.

## Can I add my own writing style or patterns?

Yes. Use custom profiles for voice preferences and custom pattern packs for local rules. The repo keeps built-in patterns separate from user customizations.

## What should contributors start with?

The easiest contributions are small, evidence-backed examples: a before/after pair, a false positive case, a missing AI-writing pattern, or a language-specific phrase that keeps appearing in model output.

Good pattern contributions should include both a failing example and a successful rewrite.
