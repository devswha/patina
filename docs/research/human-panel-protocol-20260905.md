# Human panel execution contract

Status: preparation tooling; no actual participants or ratings collected.
This supplements `human-eval-panel.md` and does not bypass the reviewed edited-AI
intake prerequisite in the research backlog.

Prepare at least 30 distinct source passages and five participant packets. The
planned pilot uses 15 English and 15 Korean sources, with five fluent, independent
raters per pair. Packets show only A/B text, language and neutral context. Model,
tool, score and original-side metadata remain in a private control file. A/B
orientation is balanced within each packet and shuffled independently from item
order. Packet hashes bind the displayed texts and private unblinding map.
Unchanged outputs remain eligible controls; do not remove them to inflate gains.

Raters give naturalness ratings from 0–4 for both versions, a naturalness
preference, a meaning concern, a send-with-light-edits preference and an optional
private note. They may abstain when unable to assess the language/context. No
answers are preselected. The offline form has no network or browser-storage path;
draft/final JSON files are downloaded locally and returned to the coordinator.

The coordinator records separate human-identity, consent and language verification
in the private roster, with evidence hashes. These are coordinator attestations,
not automated proof that a person is human. Preparation creates unassigned
packets and marks every roster entry unverified. Model-generated ratings cannot
replace people; unverified responses yield no human metrics. At least five
qualified ratings are required for every pair.

Primary agreement is Krippendorff's nominal alpha over original/rewrite/tie
preferences. Interval alpha over 0–4 naturalness is reported separately with its
equal-spacing assumption. Coincidences use within-unit weights `1/(m-1)` and
pooled pairable ratings for expected disagreement. Constant ratings or insufficient
variation yield an undefined coefficient (`null`), not an invented perfect score.

The primary score/naturalness association is Spearman correlation between each
version's frozen Patina score and its mean human naturalness rating. Record the
scorer/model/config definition before collecting responses. Deterministic signal
scores have their own correlation and are never pooled with LLM scores.
Missing primary score observations leave the study incomplete.

Preference and correlation confidence intervals resample source pairs, retaining
all raters and both versions together, using 2,000 fixed-seed bootstrap draws.
Raw vote counts, language/register slices, abstentions and exclusions are reported.
Safe score reduction is signed and reported only for pairs where every qualified
rater reports no meaning concern; uncertainty prevents a safe-gain claim.

Commands:

```sh
node scripts/research/human-panel.mjs prepare --input PAIRS.private.json \
  --output NEW_PRIVATE_DIRECTORY --raters 5 \
  --score-definition 'Recorded scorer, model, source/config hashes and collection date'
node scripts/research/human-panel.mjs analyze --control control.private.json \
  --roster roster.private.json --responses RESPONSES.private.json \
  --output NEW_REPORT.json
```

Keep all packet/control/roster/raw response files private. Public reports exclude
text, names and free notes. Do not present synthetic unit-test participants or
the UI test as a completed panel. The statistics follow the standard
Krippendorff coincidence formulation; the repository's prior research analysis
and the primary reference implementation at `grrrr/krippendorff-alpha` provide
independent comparison points. No external implementation dependency is added.

The preparation selection was frozen at 22 EN/KO live-quality sources, followed by
four unused AI-style fixture IDs per language. These are curated style controls,
not claims of actual AI authorship. Astra supplies the paired outputs and GPT-5.5
the fixed primary score; deterministic signals stay separate. Existing audited
Astra outputs are reused, including unsafe or unchanged cases. Missing outputs
and scores stop preparation rather than selecting more favorable replacements.
The collector's private records preserve call receipts and leave source-sharing
review false until the actual materials have been reviewed. No human panel has
been launched by producing those files.
