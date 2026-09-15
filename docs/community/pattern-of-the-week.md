# Pattern of the week

A short walkthrough of one existing pattern, using the examples already in
the tree. This is not a new rule and not a score change.

## Week of 2026-09-14 — Pattern 1, 과도한 중요성 부여 (`ko-content`)

The tell is stacking historic-scale language on an ordinary product event.
The trap is the same words when the event really is historic.

### Rewrite this

From [`examples/01-success-01.md`](../../examples/01-success-01.md): an app
update that “opened a new horizon”, marked a “turning point”, and would
“remain a milestone”. The edit keeps the claim (payments and UX changed;
fintech shifted) and drops the epoch language. It does not invent metrics.

### Leave this alone

From [`examples/01-failure-01.md`](../../examples/01-failure-01.md): Hunminjeongeum
in 1446, with a UNESCO listing in 1997. “Turning point” and “milestone” are
proportionate. Firing pattern 1 here is a false positive.

## Week of 2026-09-21 — Pattern 2, Undue Emphasis on Notability/Media (`en-content`)

The tell is acclaim with no source: “garnered significant attention”, “widely
recognized”, “attracted widespread interest” stacked on a subject that names no
outlet, reviewer, or figure. The trap is the same words when the coverage is
real and simply not cited in the passage.

### Rewrite this

From [`examples/en-02-success-01.md`](../../examples/en-02-success-01.md): a
bakery whose sourdough is “widely recognized as some of the finest in the
state”, and whose opening “attracted widespread interest”. The edit shortens
the three recognition claims and keeps the owner's attribution to her
grandmother's recipes. It does not invent a reviewer, a publication, or a
sales figure; the recognition claims stay unsourced after the edit.

### Leave this alone

From [`examples/en-02-failure-01.md`](../../examples/en-02-failure-01.md): a
researcher cited “over 3,000 times according to Google Scholar”, featured in a
named issue of a named journal, and listed by a named committee. The
references are specific, so pattern 2 must not fire. The funding-rank sentence
at the end is left as the unsourced claim it is; the pattern edits attention
claims, it does not fact-check them.

## How to add the next one

1. Open a [pattern proposal](https://github.com/devswha/patina/issues/new?template=pattern_proposal.yml) or a [false-positive](https://github.com/devswha/patina/issues/new?template=false_positive.yml) report.
2. Follow [CONTRIBUTING.md](../../CONTRIBUTING.md). Include a success rewrite and a case that must not fire.
3. Edit the pack in `patterns/{lang}-*.md`. Do not bump the package version in the same PR.

Starter issues use the `good first issue` and `patterns` labels.
