---
pattern: 22
type: failure
name: Filler Phrases
pack: en-filler
---

# Pattern 22: Filler Phrases — Failure (False Positive)

## Input Text

> The regulation requires employers to provide 60 days' notice in order to allow workers sufficient time to seek new employment. The "in order to" clause was added during the 1988 amendment specifically to close a loophole that had permitted same-day layoffs.

## Expected Output

> (No correction — this text should not trigger Pattern 22)

## Applied Pattern

- Pattern 22 (Filler Phrases): "in order to" appears twice in the text.

## Verdict

**Failure (false positive)** — The exclusion condition applies: "in order to" is occasionally necessary for clarity in legal or formal regulatory writing where "to" could be misread as part of an infinitive chain. In the first sentence, "requires employers to provide... in order to allow" needs the full phrase to distinguish the purpose clause from the preceding infinitive "to provide." The second mention is a quoted reference to the legal text itself. Only one filler phrase type appears, and in both cases it serves a genuine disambiguating function in a regulatory context.
