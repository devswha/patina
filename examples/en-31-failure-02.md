---
pattern: 31
type: failure
name: Conclusion Signal Words
pack: en-filler
language: en
---

# Pattern 31: Conclusion Signal Words — Failure (False Positive)

## Input Text

> Friday deploy postmortem. Lessons learned:
> - Add a rollback runbook to the deploy checklist.
> - Page the secondary reviewer before a Friday production push.
> - Write the cache-flush order into the incident template.

## Expected Output

> (No correction — this text should not trigger Pattern 31)

## Applied Pattern

- Pattern 31 (Conclusion Signal Words): "Lessons learned" heads the list.

## Judgment

**Failure (false positive)** — The lessons-learned list is the deliverable. Adding a rollback runbook, paging the secondary reviewer, and recording the cache-flush order are named actions, not narrator commentary on a story the body already told. The no-correction control keeps those actions.
