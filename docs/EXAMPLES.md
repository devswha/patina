# Before/After Gallery

patina is easiest to understand with examples: the claims stay, the AI packaging goes.

## English: inflated product copy

**Before**

> AI coding tools represent a transformative leap forward in the software development lifecycle, enabling teams to streamline workflows, enhance collaboration, and unlock unprecedented levels of productivity across the organization.

**After**

> AI coding tools are useful for the boring parts: test stubs, config files, small refactors. They do not fix a messy codebase, but they can save time when someone still checks the output.

**Patterns removed**: inflated stakes, corporate abstractions, three-part benefit stack.

## Korean: benefit stacking

**Before**

> 본 솔루션은 사용자의 업무 효율성을 극대화하고, 생산성 향상을 도모하며, 더 나은 협업 경험을 제공하는 혁신적인 도구입니다.

**After**

> 이 도구는 반복 작업을 줄여준다. 문서 정리, 초안 작성, 간단한 협업 흐름처럼 사람이 굳이 매번 손으로 할 필요 없는 일에 잘 맞는다.

**Patterns removed**: `혁신적인`, `도모`, abstract benefit stacking, stiff noun-heavy phrasing.

## English: vague balance

**Before**

> While there are challenges to consider, it is important to recognize that this technology has the potential to create meaningful value when implemented thoughtfully.

**After**

> The tool is useful, but only if someone checks the output. Without tests or review, it just makes wrong answers arrive faster.

**Patterns removed**: generic caveat, vague upside, empty balance.

## Technical: architecture claims

**Before**

> This architecture provides a robust and scalable foundation for future enhancements, ensuring that teams can effectively adapt to evolving requirements while maintaining operational excellence.

**After**

> The architecture leaves room for new backends without touching the CLI entry point. That is the useful part. The tradeoff is more config surface, so the defaults need to stay boring and safe.

**Patterns removed**: `robust and scalable foundation`, future-proofing claims, operational-excellence filler.

## What patina is checking

- Did the rewrite remove AI-writing patterns?
- Did the rewrite keep the original claims?
- Did the rewrite introduce anything that was not in the source?
- Can the change be inspected through `--audit`, `--diff`, or `--score`?

The goal is editing quality, not detector evasion. AI detectors are noisy; patina treats the score as a rough signal and the diff as the useful artifact.
