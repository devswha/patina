# Pattern of the week

A short walkthrough of one existing pattern, using the examples already in
the tree. This is not a new rule and not a score change.

Week of 2026-09-14 — **Pattern 1, 과도한 중요성 부여** (`ko-content`).

The tell is stacking historic-scale language on an ordinary product event.
The trap is the same words when the event really is historic.

## Rewrite this

From [`examples/01-success-01.md`](../../examples/01-success-01.md): an app
update that “opened a new horizon”, marked a “turning point”, and would
“remain a milestone”. The edit keeps the claim (payments and UX changed;
fintech shifted) and drops the epoch language. It does not invent metrics.

## Leave this alone

From [`examples/01-failure-01.md`](../../examples/01-failure-01.md): Hunminjeongeum
in 1446, with a UNESCO listing in 1997. “Turning point” and “milestone” are
proportionate. Firing pattern 1 here is a false positive.

## How to add the next one

1. Open a [pattern proposal](https://github.com/devswha/patina/issues/new?template=pattern_proposal.yml) or a [false-positive](https://github.com/devswha/patina/issues/new?template=false_positive.yml) report.
2. Follow [CONTRIBUTING.md](../../CONTRIBUTING.md). Include a success rewrite and a case that must not fire.
3. Edit the pack in `patterns/{lang}-*.md`. Do not bump the package version in the same PR.

Starter issues use the `good first issue` and `patterns` labels.
