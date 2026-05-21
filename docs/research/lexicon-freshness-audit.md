# Lexicon freshness audit

Status: metadata audit complete; per-entry remine still blocked.
Related issue: #160.

Patina lexicons are detection hypotheses. They should not be described as fresh model-era evidence unless each entry has a corpus source and a false-positive check.

## Current frontmatter status

| file | entries | current snapshot status | action |
|---|---:|---|---|
| `lexicon/ai-ko.md` | 102 | `partial` | keep; rerun against 2026 KO controls before threshold changes |
| `lexicon/ai-en.md` | 108 | `needs-re-mine` | remine with 2025+ paired corpus before adding claims |
| `lexicon/ai-zh.md` | 60 | `needs-external-calibration` | calibrate before broad claims |
| `lexicon/ai-ja.md` | 60 | `needs-external-calibration` | calibrate before broad claims |

This means the shipped lexicons can stay as conservative editing signals, but only Korean has partial corpus notes. English, Chinese, and Japanese should not be called 2025+ validated yet.

## Per-entry remine gate

A refreshed entry needs:

```yaml
added: YYYY-MM-DD
source: <snapshot id or manifest path>
last_validated: YYYY-MM-DD
lift: <hot/cold document-frequency ratio>
```

Promotion floor from `process/pattern-freshness.md`:

- ≥4× hot-vs-cold document-frequency lift;
- cold document-frequency ≤5%, unless the entry is register-scoped;
- no severe false positives in matched controls;
- no private text checked into the repo.

## Next action

Wait for the 2026 paired corpus from #155/#157. Then run a per-entry document-frequency report and update only entries that pass the gate. Do not invent provenance for legacy entries.
