# Blinded human evaluation panel plan

Status: cancelled by owner on 2026-09-08; panel not run.
Related issue: #159, closed `not_planned`.

The unexecuted design below is retained as history, not as active or deferred
work. No recruitment or ratings are scheduled. Resuming requires a new explicit
request. Cancellation supplies no human-validation evidence and changes no
deterministic scoring behavior.

## Research question

Can blinded readers tell which text is the AI-like draft and which one is the Patina rewrite, and do they prefer the rewrite without seeing meaning loss?

## Minimum pilot

- 30 paired samples;
- 5 raters per sample;
- language and register recorded for each pair;
- randomized A/B order;
- no model or tool names shown to raters;
- reviewer consent and redistribution notes stored outside public fixtures unless publishable.

## Rater task

For each pair, ask:

1. Which version reads more natural for the stated context?
2. Did either version lose a key fact, number, name, or caveat?
3. Which version would you send with light edits?
4. Free-text note, optional.

## Report shape

| metric | output |
|---|---|
| naturalness preference | Patina / original / tie counts with confidence interval |
| meaning concern | rate of reported fact/caveat loss |
| register split | results by language and register |
| rater agreement | Krippendorff's nominal alpha for preferences; interval alpha for naturalness ratings |
| exclusions | samples removed and why |

## Privacy rule

Do not commit reviewer names, private comments, or no-redistribution source text. Public reports can include aggregate counts and short examples only when the source license and reviewer consent allow it.
