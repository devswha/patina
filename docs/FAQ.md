# FAQ

New to the vocabulary? Start with the [Glossary](GLOSSARY.md) for short
definitions of MPS, fidelity, burstiness, MATTR, modes, and other recurring
terms.

## Is patina an AI detector bypass tool?

No. patina is an editing and audit tool.

AI detectors are noisy, and patina does not treat any score as proof that a text was written by a human or by AI. The useful artifacts are the audit, the diff, and the meaning-preservation checks: what changed, why it changed, and whether the original claims survived.

## What does "Strip the AI packaging" mean?

Many model outputs use the same surface habits: inflated stakes, vague balance, benefit stacking, corporate abstractions, metronomic paragraph rhythm, and filler transitions. patina looks for those patterns and rewrites the affected passages into plainer prose.

The goal is not to make a text deceptive. The goal is to remove generic model voice while keeping the actual message intact.

## How does patina preserve meaning?

Meaning preservation is global; Document Type, Persona, and Register cannot
lower its thresholds. Every CLI rewrite runs a deterministic dropped-number
guard. `--verify` adds model-scored MPS/fidelity floors and one conservative
retry; the agent skill's `--strict` flow adds its documented retry/rollback
gates.

## What is MPS?

MPS means Meaning Preservation Score. It is a rewrite-side safety signal that estimates how many extracted anchors survived the edit.

A high MPS does not mean the prose is perfect. It means the rewrite did not obviously drop or flip the claims patina was tracking.

## What does the AI-likeness score mean?

The score is a rough editing signal from 0 to 100. Lower is less AI-sounding.

It is not a truth machine. Default `--score` combines an LLM judgment with
deterministic signals and can vary between model runs. `--score --offline`
reports only reproducible local signals. Treat the range and highlighted
patterns as more important than an exact number.

## How accurate is it?

Current calibration (2026-05-22) reports 67.3% editing-hotspot catch [63.5-71.0%] across GPT-5.5, Claude Sonnet 4.6, and Gemini 2.5 Pro CLI samples (n=600, Korean+English). Human-control false positives are 16.0% [11.6-21.7%] (n=200). See [2026-rebaseline.md](research/2026-rebaseline.md) for per-language/model cells.

False positives are expected, especially for encyclopedic, corporate, academic, or heavily edited prose. patina is meant to help edit suspicious passages, not to accuse a writer.

See the [False-positive Gallery](FALSE-POSITIVES.md) for safe examples of registers that should be treated as editing hints rather than authorship accusations.

See [ETHICS.md](ETHICS.md) for the intended-use position statement.

## Does it work without an API key?

Yes. `--score --offline` and the `patina-score` precommit gate need no backend.
LLM-backed modes can use a logged-in local Codex, Claude, Gemini, or Kimi CLI
instead of an API key. See [Authentication](AUTHENTICATION.md).

## Does patina send my text anywhere?

CLI deterministic analysis stays local. LLM-backed CLI modes send text only to
the backend you select, which may be a local CLI, local/self-hosted endpoint, or
remote API.

The hosted playground sends rewrite and scoring requests to patina's server.
Free requests use the server provider; BYOK credentials are forwarded for that
request and are not stored or logged; Pro uses a Polar license key
validated server-side. The browser never calls an LLM provider directly.

## Does it only work in Claude Code?

No. patina runs as a skill for Claude Code, Codex CLI, Cursor, OpenCode, and Gemini CLI, and it also works as a standalone Node.js CLI.

## Which languages are supported?

Korean, English, Chinese, and Japanese are supported. Pattern packs are auto-discovered by language prefix, so new languages can be added by contributing new pattern files.

## Do Document Type, Persona, and Register overlap?

No. Document Type controls genre, purpose, structural conventions, and pattern
policy. Persona v2 is an optional reusable voice fingerprint; omission preserves
the source voice. Register controls only `casual` or `professional` delivery;
omission preserves the source register. Meaning floors and verification are
global and independent of all three axes.

## What should contributors start with?

The easiest contributions are small, evidence-backed examples: a before/after pair, a false positive case, a missing AI-writing pattern, or a language-specific phrase that keeps appearing in model output.

Good pattern contributions should include both a failing example and a successful rewrite.

## How do I submit a pattern?

Follow [CONTRIBUTING.md](../CONTRIBUTING.md). That file is the how-to. Open a [pattern proposal](https://github.com/devswha/patina/issues/new?template=pattern_proposal.yml) ([`.github/ISSUE_TEMPLATE/pattern_proposal.yml`](../.github/ISSUE_TEMPLATE/pattern_proposal.yml)), then add the pack from the template in `patterns/{lang}-*.md`.
