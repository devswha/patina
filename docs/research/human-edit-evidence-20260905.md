# Human-edit dataset evidence, 2026-09-05

Three primary dataset releases were checked for #643 and the edited-AI intake.
**No pairs were admitted.** CoAuthor and MixSet lack a verified dataset reuse
grant in the materials inspected. SynthBio has an explicit grant, but its
released JSON does not supply the pre-edit drafts needed to form pairs.

This is a completed, bounded source audit. It adds no extraction framework,
human ratings, or CI gate. Downloaded source text remains private.

| Dataset | Human-edit evidence | Rights found | Intake decision |
| --- | --- | --- | --- |
| CoAuthor | Controlled writing study and session logs | MIT for the interface; session-data grant not verified | Not admitted |
| MixSet | Manual adaptation described by authors; paired strings released | No dataset grant found in the checked repository/card | Not admitted |
| SynthBio | Study annotators revised generated biographies | Apache-2.0 in the author data card | Not admitted: pre-edit drafts missing |

## CoAuthor

The [author paper](https://arxiv.org/html/2201.06796v2) describes qualification
and participation through Amazon Mechanical Turk. Writers could accept and
edit model suggestions. That supports a **DATASET-ATTESTED** writer role; it
does not independently verify the biological author of each logged action.

The [project website](https://coauthor.stanford.edu/) links the downloadable
session archive and the
[interface repository](https://github.com/minalee-research/coauthor-interface).
The repository identifies an MIT license. Its software license does not by
itself establish a reuse grant for the separately hosted session logs. The
paper's own license is also a separate matter.

The archive directory was inspected through bounded HTTP range reads. It lists
1,447 session-named JSONL members and one directory entry, with no separately
named license file. This is a directory inspection, not a claim to have read
every session for licensing statements. The paper reports 1,445 sessions; the
release-membership difference remains unresolved. The private evidence records
the exact byte range and its hash, not a fictitious full-archive hash.

Required next evidence: an explicit session-data reuse grant covering writer
submissions and suggestions, plus the release membership/version mapping.
No sessions were replayed into an intake.

## MixSet

The [author repository](https://github.com/Dongping-Chen/MixSet) links its
[dataset release](https://huggingface.co/datasets/ONE-Lab/MixSet). The
[paper](https://arxiv.org/html/2401.05952v2) describes manual token-level and
sentence-level adaptation of machine-generated text. This is dataset-level
attestation of the editing role. The inspected paired rows do not supply
individual editor identities, consent records or timestamped edit events.

Three files were fetched by immutable Git blob identity. Both human-adaptation
files contain 300 before/after records; the released original pool has 300
records. All 600 pairs have nonempty text on both sides. There are 564 changed
pairs and 36 unchanged pairs. These are source-file counts, not admitted data.

Exact provenance joins expose a release discrepancy:

| Check, applied separately to each 300-row edit file | Matches |
| --- | ---: |
| Same ID, original text, model label and category | 207 |
| Exact original-text hash, model label and category anywhere in original pool | 250 |
| Original text still unresolved after hash-based joining | 50 |

Joining by ID would misbind some source records. Hash-based matching resolves
250 rows per file, while the remaining 50 need a source-version explanation.
This discrepancy is not evidence that the text was fabricated. No normalization
or inferred version mapping was used to make the joins pass.

No explicit dataset reuse grant was found in the checked repository, its file
tree, or the linked dataset card and metadata. The paper's statement about
following source licenses is not itself a grant for this release. Required
next evidence: a reuse license with source/derivative scope and a version
mapping for the unmatched originals. No rows were admitted, including the
250 with exact joins.

## SynthBio

The [author paper's v2 data card](https://arxiv.org/html/2111.06467v2) specifies
**Apache-2.0** for the dataset and describes the annotators' revision task.
That dataset grant is distinct from the article's CC-BY-4.0 license.

The [released JSON](https://storage.googleapis.com/gem-benchmark/SynthBio.json)
was inspected and bound to storage generation `1638886515365769` and its
SHA-256 digest. This served version contains 2,237 records and 4,270 biography
strings. The record fields are `notable_type`, `attrs`, `serialized_attrs` and
`biographies`.

The biography values are final strings. The inspected release has no
corresponding original-draft field, revision-event field or before/after link.
Conditioning attributes are not pre-edit biography text. Multiple biographies
for one entity are not established edit versions of each other. Neither can
be used to manufacture pairs.

Required next evidence: corresponding pre-edit drafts or revision logs, with
stable pair identities and applicable reuse rights. Published whole-document
evaluations and aggregate results were not transferred to excerpts.

## Intake boundary and validation

Accepted pairs, light/heavy labels, exact-text human quality labels, and new
Patina panel ratings are all **zero**. Meaning, perceived AI polish and expected
short-form tells remain **UNKNOWN**. The author's token/sentence operation
names were not substituted for the existing
[light/heavy policy](edited-ai-intake-policy.md), which also checks edit ratio
and sentence/paragraph order. No new 30-pair, five-rater panel is supplied.

The private evidence is under `/tmp/patina-human-edit-evidence-20260905`, with
`.gitignore` containing `*` and restricted file permissions. It includes source
snapshots, verified Git blob identities, the archive directory listing and
validation results. No private source text or participant identifiers appear
in these public files. No provider received source text; parent review remains
required before any future submission.

Validation recomputes source hashes, Git blob identities, archive-member counts,
MixSet joins and SynthBio field/count checks. The report also passes the prose
gate. With three candidates exhausted and the rights/provenance gates still
unmet, this task stops here. This does not claim that the missing evidence
cannot exist elsewhere.
