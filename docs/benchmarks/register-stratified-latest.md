# Rebaseline Manifest Summary

- Generated at: 2026-05-21T15:02:19.436Z
- Input: `artifacts/rebaseline-2025/human-controls.public.jsonl`
- Records: 25
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 25 |
| en | 0 |
| zh | 0 |
| ja | 0 |

### By class

| value | n |
|---|---:|
| ai-like | 0 |
| natural-human | 25 |
| lightly-edited-ai | 0 |
| heavily-edited-ai | 0 |

### By register

| value | n |
|---|---:|
| blog | 5 |
| academic-summary | 5 |
| product-doc | 5 |
| chat-update | 5 |
| technical-how-to | 5 |

### By model family

| value | n |
|---|---:|
| gpt-family | 0 |
| claude-family | 0 |
| gemini-family | 0 |
| open-weight | 0 |
| human-reference | 25 |

## Protocol matrix

- Populated language × class × register cells: 5/80
- Cells meeting 25+ samples: 0
- Empty cells: 75
- Underfilled populated cells: 5

| cell | n |
|---|---:|
| ko × natural-human × blog | 5 |
| ko × natural-human × academic-summary | 5 |
| ko × natural-human × product-doc | 5 |
| ko × natural-human × chat-update | 5 |
| ko × natural-human × technical-how-to | 5 |

## Public performance claim gate

Public performance claim: **BLOCKED**

| blocker |
|---|
| positive corpus has 0/2 languages with n≥100 |
| positive corpus has 0/3 generator families with n≥100 |
| natural/human corpus has 0/2 languages with n≥100 |

| claim-gate count | value |
|---|---:|
| qualified positive cells (language × generator family, n≥100) | 0 |
| qualified natural-language cells (language, n≥100) | 0 |
| outcome rows with expected/predicted labels | 25 |

## Outcome metrics

| metric | value |
|---|---:|
| accuracy | 96.0% |
| accuracy CI | 80.5%–99.3% |
| precision | 0.0% |
| recall | 0.0% |
| F1 | 0.000 |
| false positive rate | 4.0% |
| false negative rate | 0.0% |
| TP/FP/FN/TN | 0/1/0/24 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 5 | 20.0% | 0.0% | 0/1/0/4 |
| academic-summary | 5 | 0.0% | 0.0% | 0/0/0/5 |
| product-doc | 5 | 0.0% | 0.0% | 0/0/0/5 |
| chat-update | 5 | 0.0% | 0.0% | 0/0/0/5 |
| technical-how-to | 5 | 0.0% | 0.0% | 0/0/0/5 |
