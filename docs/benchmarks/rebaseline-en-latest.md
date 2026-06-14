# Rebaseline Manifest Summary

- Generated at: 2026-06-14T12:20:56.313Z
- Input: `artifacts/rebaseline-2025/manifest.en.scored.public.jsonl`
- Records: 330
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 0 |
| en | 330 |
| zh | 0 |
| ja | 0 |

### By class

| value | n |
|---|---:|
| ai-like | 120 |
| natural-human | 200 |
| lightly-edited-ai | 5 |
| heavily-edited-ai | 5 |

### By register

| value | n |
|---|---:|
| blog | 126 |
| academic-summary | 126 |
| product-doc | 26 |
| chat-update | 26 |
| technical-how-to | 26 |

### By model family

| value | n |
|---|---:|
| gpt-family | 50 |
| claude-family | 40 |
| gemini-family | 40 |
| open-weight | 0 |
| human-reference | 200 |

## Protocol matrix

- Populated language × class × register cells: 17/80
- Cells meeting 25+ samples: 2
- Empty cells: 63
- Underfilled populated cells: 15

| cell | n |
|---|---:|
| en × ai-like × blog | 24 |
| en × ai-like × academic-summary | 24 |
| en × ai-like × product-doc | 24 |
| en × ai-like × chat-update | 24 |
| en × ai-like × technical-how-to | 24 |
| en × lightly-edited-ai × blog | 1 |
| en × lightly-edited-ai × academic-summary | 1 |
| en × lightly-edited-ai × product-doc | 1 |
| en × lightly-edited-ai × chat-update | 1 |
| en × lightly-edited-ai × technical-how-to | 1 |
| en × heavily-edited-ai × blog | 1 |
| en × heavily-edited-ai × academic-summary | 1 |

_3 more underfilled cells omitted._

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
| outcome rows with expected/predicted labels | 330 |

## Outcome metrics

| metric | value |
|---|---:|
| accuracy | 85.8% |
| accuracy CI | 81.6%–89.1% |
| precision | 79.0% |
| recall | 86.9% |
| recall CI | 80.1%–91.7% |
| F1 | 0.828 |
| false positive rate | 15.0% |
| false positive rate CI | 10.7%–20.6% |
| false negative rate | 13.1% |
| TP/FP/FN/TN | 113/30/17/170 |

### Catch rate by language × model family

| language | model family | n | catch rate | 95% CI | caught/missed |
|---|---|---:|---:|---:|---:|
| en | claude-family | 40 | 82.5% | 68.1%–91.3% | 33/7 |
| en | gemini-family | 40 | 90.0% | 76.9%–96.0% | 36/4 |
| en | gpt-family | 50 | 88.0% | 76.2%–94.4% | 44/6 |

### False-positive rate by language

| language | n | false-positive rate | 95% CI | FP/TN |
|---|---:|---:|---:|---:|
| en | 200 | 15.0% | 10.7%–20.6% | 30/170 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 126 | 5.0% | 11.5% | 23/5/3/95 |
| academic-summary | 126 | 25.0% | 3.8% | 25/25/1/75 |
| product-doc | 26 | 0.0% | 23.1% | 20/0/6/0 |
| chat-update | 26 | 0.0% | 15.4% | 22/0/4/0 |
| technical-how-to | 26 | 0.0% | 11.5% | 23/0/3/0 |
