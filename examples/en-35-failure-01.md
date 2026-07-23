---
pattern: 35
type: failure
name: Throat-Clearing Openers
pack: en-filler
language: en
---

# Pattern 35: Throat-Clearing Openers — Failure (False Positive)

## Input Text

> I'll be honest, I almost shut the company down in March. Payroll cleared with eleven dollars to spare, and I didn't tell anyone — not my cofounder, not my wife. Writing this newsletter entry is the first time I've said it out loud.

## Expected Output

> (No correction — this text should not trigger Pattern 35)

## Applied Pattern

- Pattern 35 (Throat-Clearing Openers): "I'll be honest" opens the paragraph.

## Judgment

**Failure (false positive)** — The exclusion condition applies: this is first-person writing where the phrase carries real reluctance before a socially difficult disclosure. "I'll be honest" is not staging a business claim as candid; it marks the author steeling themselves to admit something they concealed. Deleting it would flatten genuine self-disclosure into a bare report and change the register of a confessional passage.
