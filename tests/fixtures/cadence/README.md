# Cadence promotion fixture (EN)

`en-cadence-50.jsonl` is the 50-document evaluation manifest that
`process/pattern-freshness.md` requires before the #879 short-form cadence
signal can be promoted.

- **25 hot** documents where the signal is expected to fire.
- **25 cold** matched control documents where it must not fire, including ten
  deliberate hard negatives: numeric range dashes, a literary dash inside quoted
  speech, single asides that carry real information, and terse-but-anchored human
  status updates. Human short-form writing is genuinely clipped, so leaving those
  out would manufacture a passing precision.
- **Two registers**: `social` and `marketing`.

## Provenance and licensing

Every document is **synthetic**, authored for this repository as part of #879.
No scraped text, no private drafts, no third-party content, and no real personal
data — so the manifest is redistributable with the repo, which is the condition
`process/pattern-freshness.md` sets for a checked-in fixture.

Each row carries a `why` field recording what the document was designed to
exercise, so a later reader can tell an intentional hard negative from an
accident.

## Scoring

```bash
npm run benchmark:cadence-fixture           # human-readable
npm run benchmark:cadence-fixture -- --json # machine-readable
```

The harness (`scripts/cadence-fixture-eval.mjs`) is measurement only: it imports
the shipped detector, mutates nothing, and calls no model or network.
