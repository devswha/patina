---
pattern: 15
type: failure
name: Inline-Header Vertical Lists
pack: en-style
language: en
---

# Pattern 15 (en): Inline-Header Vertical Lists — Failure Case (False Positive)

## Input Text

> ### Configuration Options
>
> - **timeout:** Maximum wait time in milliseconds before the request is aborted. Default: `5000`.
> - **retries:** Number of retry attempts after a failed request. Set to `0` to disable. Default: `3`.
> - **baseURL:** Root URL prepended to all relative paths. Must include the protocol (e.g., `https://api.example.com`).
> - **headers:** Key-value pairs sent with every request. Accepts an object or a `Headers` instance.

## Expected Output

> (No correction — Pattern 15 should not fire on this text)

## Applied Pattern

- Pattern 15 (Inline-Header Vertical Lists): Four bullets with "**Label:** explanation" format — "timeout:", "retries:", "baseURL:", "headers:".

## Judgment

**Failure (false positive)** — The exclusion condition applies: this is API reference documentation where the bold-label-colon format is the correct and expected convention. Each entry describes a named configuration parameter, its data type semantics, and its default value. Converting these into flowing prose would obscure the parameter names, scatter the defaults, and make the documentation harder to scan. The label-and-description format is the industry standard for parameter tables when a full HTML table is not used.
