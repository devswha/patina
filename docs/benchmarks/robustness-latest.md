# Adversarial Robustness Report

Report-only measurement of how the deterministic analyzer's hot/cold decision
survives common evasion transforms. **Not a CI gate** and **not a detector-
threshold change** — a sub-100% rate is informative, not a regression.
Adversarial variants inherit their source fixture's label.

- Generated at: 2026-06-13T19:52:40.474Z
- Node: v22.17.1
- Base fixtures: 49
- Transforms: zero-width insertion, homoglyph substitution, uppercase fold, punctuation stripping, sentence repetition
- Reproduce: `npm run benchmark:robustness`
- Raw JSON: [robustness-latest.json](robustness-latest.json)

## Normalization expectations

The analyzer NFC-normalizes input. NFC does **not** strip zero-width characters
(U+200B) and does **not** fold homoglyphs (confusable Cyrillic/Greek code
points), so those transforms genuinely reach tokenization. Case folding is the
mildest tactic because the analyzer lowercases internally.

## Overall

`detection retained` = AI-labelled fixtures still flagged hot after the
transform; `clean retained` = natural-labelled fixtures still NOT flagged;
`decisions changed` = fixtures whose hot/cold decision flipped vs the
untransformed baseline.

| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |
|---|---:|---:|---:|---:|---:|
| zero-width insertion | 26 | 57.7% | 23 | 91.3% | 13 |
| homoglyph substitution | 26 | 96.2% | 23 | 100.0% | 1 |
| uppercase fold | 26 | 100.0% | 23 | 100.0% | 0 |
| punctuation stripping | 26 | 23.1% | 23 | 100.0% | 20 |
| sentence repetition | 26 | 92.3% | 23 | 95.7% | 3 |

## Per language

### en

| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |
|---|---:|---:|---:|---:|---:|
| zero-width insertion | 7 | 71.4% | 6 | 100.0% | 2 |
| homoglyph substitution | 7 | 85.7% | 6 | 100.0% | 1 |
| uppercase fold | 7 | 100.0% | 6 | 100.0% | 0 |
| punctuation stripping | 7 | 0.0% | 6 | 100.0% | 7 |
| sentence repetition | 7 | 85.7% | 6 | 83.3% | 2 |

### ja

| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |
|---|---:|---:|---:|---:|---:|
| zero-width insertion | 6 | 83.3% | 6 | 100.0% | 1 |
| homoglyph substitution | 6 | 100.0% | 6 | 100.0% | 0 |
| uppercase fold | 6 | 100.0% | 6 | 100.0% | 0 |
| punctuation stripping | 6 | 50.0% | 6 | 100.0% | 3 |
| sentence repetition | 6 | 100.0% | 6 | 100.0% | 0 |

### ko

| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |
|---|---:|---:|---:|---:|---:|
| zero-width insertion | 7 | 14.3% | 5 | 60.0% | 8 |
| homoglyph substitution | 7 | 100.0% | 5 | 100.0% | 0 |
| uppercase fold | 7 | 100.0% | 5 | 100.0% | 0 |
| punctuation stripping | 7 | 0.0% | 5 | 100.0% | 7 |
| sentence repetition | 7 | 85.7% | 5 | 100.0% | 1 |

### zh

| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |
|---|---:|---:|---:|---:|---:|
| zero-width insertion | 6 | 66.7% | 6 | 100.0% | 2 |
| homoglyph substitution | 6 | 100.0% | 6 | 100.0% | 0 |
| uppercase fold | 6 | 100.0% | 6 | 100.0% | 0 |
| punctuation stripping | 6 | 50.0% | 6 | 100.0% | 3 |
| sentence repetition | 6 | 100.0% | 6 | 100.0% | 0 |
