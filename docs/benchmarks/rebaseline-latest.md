# Rebaseline Manifest Summary

- Generated at: 2026-09-15T16:59:56.169Z
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
| accuracy | 73.6% |
| accuracy CI | 70.5%–76.6% |
| precision | 94.9% |
| recall | 68.5% |
| recall CI | 64.7%–72.1% |
| F1 | 0.796 |
| false positive rate | 11.0% |
| false positive rate CI | 7.4%–16.1% |
| false negative rate | 31.5% |
| TP/FP/FN/TN | 411/22/189/178 |

### Catch rate by language × model family

| language | model family | n | catch rate | 95% CI | caught/missed |
|---|---|---:|---:|---:|---:|
| en | claude-family | 100 | 74.0% | 64.6%–81.6% | 74/26 |
| en | gemini-family | 100 | 80.0% | 71.1%–86.7% | 80/20 |
| en | gpt-family | 100 | 77.0% | 67.8%–84.2% | 77/23 |
| ko | claude-family | 100 | 67.0% | 57.3%–75.4% | 67/33 |
| ko | gemini-family | 100 | 61.0% | 51.2%–70.0% | 61/39 |
| ko | gpt-family | 100 | 52.0% | 42.3%–61.5% | 52/48 |

### False-positive rate by language

| language | n | false-positive rate | 95% CI | FP/TN |
|---|---:|---:|---:|---:|
| en | 100 | 4.0% | 1.6%–9.8% | 4/96 |
| ko | 100 | 18.0% | 11.7%–26.7% | 18/82 |

### By register

| register | n | FP rate | FN rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|
| blog | 190 | 5.7% | 40.0% | 72/4/48/66 |
| academic-summary | 190 | 14.3% | 21.7% | 94/10/26/60 |
| product-doc | 140 | 10.0% | 21.7% | 94/2/26/18 |
| chat-update | 140 | 0.0% | 49.2% | 61/0/59/20 |
| technical-how-to | 140 | 30.0% | 25.0% | 90/6/30/14 |
