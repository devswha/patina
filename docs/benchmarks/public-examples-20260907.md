# Public example preservation checks — 2026-09-07

The existing `scoreMPS` and `scoreFidelity` functions checked twelve authored pairs,
three in each language; every pair scored 100 on both axes and passed the
numeric-token checks. These fixed examples were rated by a model, without a human
panel or a production rewrite benchmark.

The check made 24 calls through the logged-in Codex CLI, requesting
`openai/gpt-6-astra` and `xhigh` reasoning. Input and output hashes identify the
tested text; the record does not attest upstream model identity, and the
illustrative cards display no scores.

| Language | Pairs | Passed | MPS | Fidelity |
|---|---:|---:|---:|---:|
| ko | 3 | 3 | 100 | 100 |
| en | 3 | 3 | 100 | 100 |
| zh | 3 | 3 | 100 | 100 |
| ja | 3 | 3 | 100 | 100 |

Full ratings and hashes: [JSON](public-examples-20260907.json). The shared source pairs live in `playground/examples/{ko,en,zh,ja}.js` and appear in [the demo gallery](../DEMO.md).

Model judges can miss details. These checks support the editorial audit, whose
criteria also cover conditions, uncertainty, attribution and negation, but do not
establish reader preference. Editing a pair invalidates its recorded hash binding.

The common voice and skill illustrations were checked separately: six pairs passed MPS 100 and fidelity 91.7–100 in 12 model calls.
