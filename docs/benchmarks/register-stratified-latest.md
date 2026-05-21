# Rebaseline Manifest Summary

- Generated at: 2026-05-21T15:40:05.166Z
- Input: `artifacts/rebaseline-2025/human-controls.public.jsonl`
- Records: 141
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 141 |
| en | 0 |
| zh | 0 |
| ja | 0 |

### By class

| value | n |
|---|---:|
| ai-like | 0 |
| natural-human | 141 |
| lightly-edited-ai | 0 |
| heavily-edited-ai | 0 |

### By register

| value | n |
|---|---:|
| blog | 40 |
| academic-summary | 16 |
| product-doc | 22 |
| chat-update | 39 |
| technical-how-to | 24 |

### By model family

| value | n |
|---|---:|
| gpt-family | 0 |
| claude-family | 0 |
| gemini-family | 0 |
| open-weight | 0 |
| human-reference | 141 |

## Protocol matrix

- Populated language × class × register cells: 5/80
- Cells meeting 25+ samples: 2
- Empty cells: 75
- Underfilled populated cells: 3

| cell | n |
|---|---:|
| ko × natural-human × academic-summary | 16 |
| ko × natural-human × product-doc | 22 |
| ko × natural-human × technical-how-to | 24 |

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
| outcome rows with expected/predicted labels | 141 |

## Outcome metrics

| metric | value |
|---|---:|
| accuracy | 83.7% |
| accuracy CI | 76.7%–88.9% |
| precision | 0.0% |
| recall | 0.0% |
| F1 | 0.000 |
| false positive rate | 16.3% |
| false negative rate | 0.0% |
| TP/FP/FN/TN | 0/23/0/118 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 40 | 20.0% | 0.0% | 0/8/0/32 |
| academic-summary | 16 | 31.3% | 0.0% | 0/5/0/11 |
| product-doc | 22 | 9.1% | 0.0% | 0/2/0/20 |
| chat-update | 39 | 0.0% | 0.0% | 0/0/0/39 |
| technical-how-to | 24 | 33.3% | 0.0% | 0/8/0/16 |
