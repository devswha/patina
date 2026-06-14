# Rebaseline Manifest Summary

- Generated at: 2026-06-14T14:07:13.107Z
- Input: `artifacts/rebaseline-2025/manifest.ko.scored.public.jsonl`
- Records: 380
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 380 |
| en | 0 |
| zh | 0 |
| ja | 0 |

### By class

| value | n |
|---|---:|
| ai-like | 120 |
| natural-human | 250 |
| lightly-edited-ai | 5 |
| heavily-edited-ai | 5 |

### By register

| value | n |
|---|---:|
| blog | 76 |
| academic-summary | 76 |
| product-doc | 76 |
| chat-update | 76 |
| technical-how-to | 76 |

### By model family

| value | n |
|---|---:|
| gpt-family | 50 |
| claude-family | 40 |
| gemini-family | 40 |
| open-weight | 0 |
| human-reference | 250 |

## Protocol matrix

- Populated language × class × register cells: 20/80
- Cells meeting 25+ samples: 5
- Empty cells: 60
- Underfilled populated cells: 15

| cell | n |
|---|---:|
| ko × ai-like × blog | 24 |
| ko × ai-like × academic-summary | 24 |
| ko × ai-like × product-doc | 24 |
| ko × ai-like × chat-update | 24 |
| ko × ai-like × technical-how-to | 24 |
| ko × lightly-edited-ai × blog | 1 |
| ko × lightly-edited-ai × academic-summary | 1 |
| ko × lightly-edited-ai × product-doc | 1 |
| ko × lightly-edited-ai × chat-update | 1 |
| ko × lightly-edited-ai × technical-how-to | 1 |
| ko × heavily-edited-ai × blog | 1 |
| ko × heavily-edited-ai × academic-summary | 1 |

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
| outcome rows with expected/predicted labels | 380 |

## Outcome metrics

| metric | value |
|---|---:|
| accuracy | 76.8% |
| accuracy CI | 72.3%–80.8% |
| precision | 68.8% |
| recall | 59.2% |
| recall CI | 50.6%–67.3% |
| F1 | 0.636 |
| false positive rate | 14.0% |
| false positive rate CI | 10.2%–18.8% |
| false negative rate | 40.8% |
| TP/FP/FN/TN | 77/35/53/215 |

### Catch rate by language × model family

| language | model family | n | catch rate | 95% CI | caught/missed |
|---|---|---:|---:|---:|---:|
| ko | claude-family | 40 | 62.5% | 47.0%–75.8% | 25/15 |
| ko | gemini-family | 40 | 67.5% | 52.0%–79.9% | 27/13 |
| ko | gpt-family | 50 | 50.0% | 36.6%–63.4% | 25/25 |

### False-positive rate by language

| language | n | false-positive rate | 95% CI | FP/TN |
|---|---:|---:|---:|---:|
| ko | 250 | 14.0% | 10.2%–18.8% | 35/215 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 76 | 20.0% | 30.8% | 18/10/8/40 |
| academic-summary | 76 | 8.0% | 30.8% | 18/4/8/46 |
| product-doc | 76 | 12.0% | 46.2% | 14/6/12/44 |
| chat-update | 76 | 2.0% | 69.2% | 8/1/18/49 |
| technical-how-to | 76 | 28.0% | 26.9% | 19/14/7/36 |
