---
pattern: 14
type: failure
name: Boldface Overuse
pack: en-style
language: en
---

# Pattern 14 (en): Boldface Overuse — Failure Case (False Positive)

## Input Text

> To adjust your notification preferences, open **Settings** from the top-right menu. Select **Privacy** from the left sidebar, then scroll down to the **Data Sharing** section. Toggle off **Share usage analytics** and click **Save Changes** to confirm.

## Expected Output

> (No correction — Pattern 14 should not fire on this text)

## Applied Pattern

- Pattern 14 (Boldface Overuse): Five bolded terms in one paragraph — "Settings", "Privacy", "Data Sharing", "Share usage analytics", "Save Changes".

## Judgment

**Failure (false positive)** — Although the paragraph contains five bolded terms (exceeding the 3-per-paragraph threshold), the exclusion condition applies: every bolded term is a UI element name — menu items, section labels, toggles, and buttons. Bold formatting in UI documentation is the standard convention for distinguishing interface elements from surrounding instructional text. Stripping bold here would make the instructions harder to follow, as users would struggle to distinguish clickable element names from descriptive prose. This is exactly the reference-material use case the pattern explicitly excludes.
