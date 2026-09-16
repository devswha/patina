---
fixture_id: en-ai-08-complete-arc
language: en
class: ai
expected_hot: false
discourse_shape: complete-prose
why_designed_this_way: |
  Heading-less complete prose about a fictional open-source table classifier.
  Slop lexicon 0, no In conclusion, sparse connectors, contentful lesson
  closer ("This taught me") with no new number. Inspect-only discourse_shape
  is complete-prose. expected_hot follows current analyzeText behavior.
topic: fictional open-source table classifier
---

I shipped a small open-source table classifier in March. Twelve issues landed in the first week.

Header rows with years were read as measurements. That miss showed up on almost every messy spreadsheet.

A second pass over column names fixed it. Four pull requests carried the rule the next week.

This taught me to split headers from values before the rest of the pipeline moves.
