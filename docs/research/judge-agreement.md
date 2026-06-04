# Cross-judge agreement plan

Status: CLI shortcut removed during surface simplification; full matrix blocked on evaluator budget.
Related issue: #158.

A score is more useful when the judge is not from the same model family as the suspected generator. Patina no longer exposes a per-run CLI warning for this; cross-family independence belongs in an explicit evaluation matrix rather than everyday score UX.

## Full matrix gate

The full issue is still open until a report covers:

- 3 generator families × 3 judge families × 30 samples;
- shared prompts and fixed sample ids;
- pairwise agreement table;
- Krippendorff alpha or Cohen/Fleiss kappa where the labels support it;
- a note when a judge is evaluating its own family.

## Matrix template

| sample set | generator | judge | n | hot agree | hot disagree | agreement |
|---|---|---|---:|---:|---:|---:|
| pending | pending | pending | 0 | 0 | 0 | n/a |

Do not fill this table with synthetic numbers. Use it only after the manifest and judge outputs exist.
