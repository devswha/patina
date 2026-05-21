# Rebaseline Manifest Summary

- Generated at: 2026-05-21T08:43:41.934Z
- Input: `tests/quality/rebaseline-manifest.example.jsonl`
- Records: 5
- Protocol target: 25 samples per language × class × register cell
- Public claim target: 100 samples per claim cell, 2+ languages, 3+ generator families

## Validation

Validation: **PASS**

## Coverage snapshot

### By language

| value | n |
|---|---:|
| ko | 1 |
| en | 2 |
| zh | 1 |
| ja | 1 |

### By class

| value | n |
|---|---:|
| ai-like | 2 |
| natural-human | 1 |
| lightly-edited-ai | 1 |
| heavily-edited-ai | 1 |

### By register

| value | n |
|---|---:|
| blog | 1 |
| academic-summary | 1 |
| product-doc | 1 |
| chat-update | 1 |
| technical-how-to | 1 |

### By model family

| value | n |
|---|---:|
| gpt-family | 1 |
| claude-family | 1 |
| gemini-family | 1 |
| open-weight | 1 |
| human-reference | 1 |

## Protocol matrix

- Populated language × class × register cells: 5/80
- Cells meeting 25+ samples: 0
- Empty cells: 75
- Underfilled populated cells: 5

| cell | n |
|---|---:|
| ko × natural-human × product-doc | 1 |
| en × ai-like × blog | 1 |
| en × ai-like × chat-update | 1 |
| zh × heavily-edited-ai × academic-summary | 1 |
| ja × lightly-edited-ai × technical-how-to | 1 |

## Public performance claim gate

Public performance claim: **BLOCKED**

- positive corpus has 0/2 languages with n≥100
- positive corpus has 0/3 generator families with n≥100
- natural/human corpus has 0/2 languages with n≥100
- expected_hot and predicted_hot outcome rows are incomplete; run a scored report before README claims

Qualified positive cells (language × generator family, n≥100): 0
Qualified natural-language cells (language, n≥100): 0
Outcome rows with expected/predicted labels: 0

## Outcome metrics

No complete `expected_hot` + `predicted_hot` outcome rows yet. This manifest is corpus metadata, not a benchmark claim.
