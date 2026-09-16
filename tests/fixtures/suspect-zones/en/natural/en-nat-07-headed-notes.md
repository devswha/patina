---
fixture_id: en-nat-07-headed-notes
language: en
class: natural
expected_hot: false
discourse_shape: headed-notes
why_designed_this_way: |
  Same facts as en-ai-08-complete-arc, written as headings plus bullets.
  No lesson closer, no why-scaffolding. Inspect-only discourse_shape is
  headed-notes. expected_hot follows current analyzeText behavior.
topic: fictional open-source table classifier
---

# Work

- open-source table classifier
- public repository
- twelve issues

# Problem

- header rows read as numeric columns
- years in headers treated as measurements

# Method

- second pass over column names

# Result

- fewer misses
- four pull requests
