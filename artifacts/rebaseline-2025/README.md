# Rebaseline 2025 local workspace

This directory is the local/private work area for the 2025+ rebaseline corpus.
It is intentionally ignored by default so vendor text, licensed corpora, and
review notes do not slip into the public repository.

Tracked files in this folder are scaffolding only:

- `.gitignore` keeps collected rows local unless explicitly allowlisted.
- `intake.example.jsonl` is a tiny repo-owned fixture for smoke testing the
  intake helper. It is not benchmark evidence.
- `prompts.template.jsonl` contains repo-owned Korean prompt anchors for the
  pilot. Copy rows into a local prompt/run sheet before generation.
- `intake.local.example.jsonl` is a 25-row Korean pilot skeleton. It validates
  as metadata only; replace placeholder hashes locally before using it as
  evidence.
- `sources.ko-public.jsonl` is a source inventory for collecting larger Korean
  public-web human controls into ignored private files. It stores URLs and
  license notes only, not page text.
- `human-controls.public.jsonl` is a 141-row Korean web human-control candidate
  manifest. It contains source metadata and `sha256` digests only; the raw
  extracts stay in ignored `private/` intake files. It is a provenance smoke
  check, not benchmark evidence or a public performance claim.

## Local intake flow

Create a local file such as `intake.local.jsonl` with one JSON object per row.
Rows use the schema from `docs/research/2025-rebaseline-plan.md`.

```bash
npm run benchmark:rebaseline:intake -- \
  --input artifacts/rebaseline-2025/intake.local.jsonl \
  --public-output artifacts/rebaseline-2025/manifest.public.jsonl \
  --private-output artifacts/rebaseline-2025/private/generations.private.jsonl \
  --require-source-review

node scripts/rebaseline-summary.mjs \
  --input artifacts/rebaseline-2025/manifest.public.jsonl \
  --json
```

The intake helper computes missing `text_hash` values. If a row carries `text`
but `redistribution` is `metadata-only`, `private`, `no-redistribution`,
`hash-only`, or an unrecognized value, the public manifest keeps only metadata
and the hash. The full text is written to the private output path.
`--require-source-review` fails any non-public row that lacks `source_review`
or `reviewer_notes`; use it before sharing a pilot report.

To smoke-check the tracked 25-row skeleton:

```bash
npm run benchmark:rebaseline:intake -- \
  --input artifacts/rebaseline-2025/intake.local.example.jsonl \
  --dry-run \
  --require-source-review
```

To validate the tracked web human-control candidates:

```bash
node scripts/rebaseline-summary.mjs \
  --input artifacts/rebaseline-2025/human-controls.public.jsonl \
  --json
```

To collect more Korean public-web candidates into the private workspace:

```bash
npm run benchmark:rebaseline:web -- \
  --input artifacts/rebaseline-2025/sources.ko-public.jsonl \
  --output artifacts/rebaseline-2025/private/web-human-controls.generated.private.jsonl \
  --target-per-register 50 \
  --max-per-source 10 \
  --collected-at 2026-05-22
```

This script deliberately writes raw text only under `private/`. The repository
uses MIT for its own code and documentation, but that license does not relicense
third-party web pages. Keep web extracts hash-only unless the exact row has a
redistribution review that permits publishing the text.

To refresh their deterministic score/outcome fields from a private raw-text
intake file:

```bash
npm run benchmark:rebaseline:score -- \
  --input artifacts/rebaseline-2025/private/web-human-controls.generated.private.jsonl \
  --output artifacts/rebaseline-2025/human-controls.public.jsonl \
  --scored-at 2026-05-22
```

## What can be committed

Do commit:

- source inventory and protocols under `docs/research/`
- hash-only candidate manifests that pass strict provenance review
- sanitized reports under `docs/benchmarks/` after review
- repo-owned examples with `redistribution: "repo-ok"`

Do not commit:

- raw KatFish/Modu/learner-corpus text until the license review explicitly says
  redistribution is allowed
- vendor-generated samples copied from a UI if the provider terms do not allow
  redistribution
- human reviewer notes containing private names, accounts, or unpublished text
