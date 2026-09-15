# Rebaseline Manifest Summary

- Generated at: 2026-09-15T07:30:42.207Z
- Input: `artifacts/rebaseline-2025/human-controls.public.jsonl`
- Records: 250
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 250 |
| en | 0 |
| zh | 0 |
| ja | 0 |

### By class

| value | n |
|---|---:|
| ai-like | 0 |
| natural-human | 250 |
| lightly-edited-ai | 0 |
| heavily-edited-ai | 0 |

### By register

| value | n |
|---|---:|
| blog | 50 |
| academic-summary | 50 |
| product-doc | 50 |
| chat-update | 50 |
| technical-how-to | 50 |

### By model family

| value | n |
|---|---:|
| gpt-family | 0 |
| claude-family | 0 |
| gemini-family | 0 |
| open-weight | 0 |
| human-reference | 250 |

## Protocol matrix

- Populated language × class × register cells: 5/80
- Cells meeting 25+ samples: 5
- Empty cells: 75
- Underfilled populated cells: 0

No underfilled populated protocol cells.

## Public performance claim gate

Public performance claim: **BLOCKED**

| blocker |
|---|
| positive corpus has 0/2 languages with n≥100 |
| positive corpus has 0/3 generator families with n≥100 |
| natural/human corpus has 1/2 languages with n≥100 |

| claim-gate count | value |
|---|---:|
| qualified positive cells (language × generator family, n≥100) | 0 |
| qualified natural-language cells (language, n≥100) | 1 |
| outcome rows with expected/predicted labels | 250 |

## Outcome metrics

| metric | value |
|---|---:|
| accuracy | 83.2% |
| accuracy CI | 78.1%–87.3% |
| precision | 0.0% |
| recall | 0.0% |
| recall CI | 0.0%–0.0% |
| F1 | 0.000 |
| false positive rate | 16.8% |
| false positive rate CI | 12.7%–21.9% |
| false negative rate | 0.0% |
| TP/FP/FN/TN | 0/42/0/208 |

### Catch rate by language × model family

No positive outcome rows yet.

### False-positive rate by language

| language | n | false-positive rate | 95% CI | FP/TN |
|---|---:|---:|---:|---:|
| ko | 250 | 16.8% | 12.7%–21.9% | 42/208 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 50 | 20.0% | 0.0% | 0/10/0/40 |
| academic-summary | 50 | 14.0% | 0.0% | 0/7/0/43 |
| product-doc | 50 | 12.0% | 0.0% | 0/6/0/44 |
| chat-update | 50 | 4.0% | 0.0% | 0/2/0/48 |
| technical-how-to | 50 | 34.0% | 0.0% | 0/17/0/33 |
