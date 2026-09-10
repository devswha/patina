# Hugging Face regression dataset

The export contains the 49 public suspect-zone fixtures and their repository
MIT license. It excludes private rebaseline texts and human-panel responses.
The `ai` and `natural` classes describe fixture style; they do not establish
authorship.

```bash
npm run dataset:export -- --output artifacts/hf-export
npm run dataset:publish -- --directory artifacts/hf-export \
  --repository OWNER/patina-suspect-zones
```

Publication is opt-in: add `--publish` and provide `HF_TOKEN` through the
environment. The default command validates the bundle without network access.
Use the authenticated account or an organization it can manage. The owner
namespace must be selected explicitly; the tool never silently switches accounts.

The per-file license review is
`docs/research/hf-fixture-license-review.json`. A changed or additional fixture
must be reviewed and committed before publication. The publisher verifies the
export against that reviewed source and refuses unreviewed Git history,
unmanaged target datasets, checksum changes and source downgrades.

## Provenance procedure

1. Review every fixture change in
   `docs/research/hf-fixture-license-review.json`, including its source-file
   hash, before exporting.
2. From the reviewed `main` branch, dispatch **Publish benchmark dataset** with
   `publish: false`. The workflow checks out the dispatch SHA (not a moving
   branch), exports `artifacts/hf-export`, and records that SHA in
   `source-manifest.json`. It refuses to continue if the checkout, manifest,
   and dispatch SHA differ.
3. Inspect the uploaded export and its `source-manifest.json`. Confirm
   `sourceCommit`, `sourceVersion`, `dataSha256`, `licenseSha256`,
   `licenseReviewSha256`, row counts, and file hashes against the reviewed
   source checkout. The publisher reads this same export; it does not rebuild
   from a later branch tip.
4. Configure the `hf-dataset-production` environment secret
   `HF_DATASET_WRITE_TOKEN` and variable
   `HF_DATASET_REPO=OWNER/patina-suspect-zones`, restrict the environment to
   `main`, and obtain maintainer approval. A separate dispatch with
   `publish: true` is required. The workflow verifies that the pinned source
   remains an ancestor of `origin/main` without changing the checked-out
   source.
5. After the publisher returns, verify the Hugging Face commit and every
   uploaded-file checksum. Record that remote commit together with the
   manifest; an exported folder or workflow artifact alone is not a
   publication.

## Current publication state

No Hugging Face dataset has been published or remotely verified for this
repository. The namespace and production credential are therefore not evidence
of a release, and this documentation intentionally contains no published URL.
