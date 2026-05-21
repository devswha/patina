# Rebaseline Manifest Summary

- Generated at: 2026-05-21T18:13:21.576Z
- Input: `artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl`
- Records: 800
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 400 |
| en | 400 |
| zh | 0 |
| ja | 0 |

### By class

| value | n |
|---|---:|
| ai-like | 600 |
| natural-human | 200 |
| lightly-edited-ai | 0 |
| heavily-edited-ai | 0 |

### By register

| value | n |
|---|---:|
| blog | 190 |
| academic-summary | 190 |
| product-doc | 140 |
| chat-update | 140 |
| technical-how-to | 140 |

### By model family

| value | n |
|---|---:|
| gpt-family | 200 |
| claude-family | 200 |
| gemini-family | 200 |
| open-weight | 0 |
| human-reference | 200 |

## Protocol matrix

- Populated language × class × register cells: 17/80
- Cells meeting 25+ samples: 12
- Empty cells: 63
- Underfilled populated cells: 5

| cell | n |
|---|---:|
| ko × natural-human × blog | 20 |
| ko × natural-human × academic-summary | 20 |
| ko × natural-human × product-doc | 20 |
| ko × natural-human × chat-update | 20 |
| ko × natural-human × technical-how-to | 20 |

## Public performance claim gate

Public performance claim: **READY**

Gate conditions met by this manifest.

| claim-gate count | value |
|---|---:|
| qualified positive cells (language × generator family, n≥100) | 6 |
| qualified natural-language cells (language, n≥100) | 2 |
| outcome rows with expected/predicted labels | 800 |

## Outcome metrics

| metric | value |
|---|---:|
| accuracy | 71.5% |
| accuracy CI | 68.3%–74.5% |
| precision | 92.7% |
| recall | 67.3% |
| recall CI | 63.5%–71.0% |
| F1 | 0.780 |
| false positive rate | 16.0% |
| false positive rate CI | 11.6%–21.7% |
| false negative rate | 32.7% |
| TP/FP/FN/TN | 404/32/196/168 |

### Catch rate by language × model family

| language | model family | n | catch rate | 95% CI | caught/missed |
|---|---|---:|---:|---:|---:|
| en | claude-family | 100 | 74.0% | 64.6%–81.6% | 74/26 |
| en | gemini-family | 100 | 79.0% | 70.0%–85.8% | 79/21 |
| en | gpt-family | 100 | 77.0% | 67.8%–84.2% | 77/23 |
| ko | claude-family | 100 | 68.0% | 58.3%–76.3% | 68/32 |
| ko | gemini-family | 100 | 62.0% | 52.2%–70.9% | 62/38 |
| ko | gpt-family | 100 | 44.0% | 34.7%–53.8% | 44/56 |

### False-positive rate by language

| language | n | false-positive rate | 95% CI | FP/TN |
|---|---:|---:|---:|---:|
| en | 100 | 14.0% | 8.5%–22.1% | 14/86 |
| ko | 100 | 18.0% | 11.7%–26.7% | 18/82 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 190 | 8.6% | 41.7% | 70/6/50/64 |
| academic-summary | 190 | 25.7% | 25.8% | 89/18/31/52 |
| product-doc | 140 | 10.0% | 21.7% | 94/2/26/18 |
| chat-update | 140 | 0.0% | 49.2% | 61/0/59/20 |
| technical-how-to | 140 | 30.0% | 25.0% | 90/6/30/14 |
