# Offline editor inspection

`patina inspect` returns a deterministic score and source-aligned diagnostics
without invoking a model or reading provider credentials.

```bash
patina inspect --lang en draft.md
cat draft.md | patina inspect --lang auto
```

The output is JSON with `schemaVersion: 1`, `sourceHash` (SHA-256 of the original
text), `language`, `score`, `available`, and `diagnostics`. Each diagnostic has
UTF-16 `start`/`end` offsets, a stable code, a message and signal names. It
contains no raw draft text. Editors can use their normal offset-to-position API.

Paragraph findings describe the analyzer's paragraph-level evidence. Where
lexical cues can be located, additional `scope: "sentence"` findings identify
the sentences contributing those cues. They do not assert an independent
sentence-level or authorship verdict. Inline/fenced code, URLs and HTML tags
are masked for these local hints. A localized paragraph retains its aggregate
record with `localized: true`, allowing editors to prefer the narrower ranges.
Document-level leakage findings are marked separately. NFC analysis is mapped
back to whole original graphemes, including decomposed accents and emoji.

The command honors resolved local configuration. Disabled or unavailable
deterministic analysis produces `available: false` and a null score. Inspection
is limited to 200,000 characters; use a selection for larger files. Provider,
backend and rewrite options are rejected.

Use inspection for background editor hints. Explicit `--audit` or rewrite
commands can still invoke the user's configured backend; apply rewritten text
only after a diff preview and an unchanged-document check.

`patina --audit --format json` also includes an `inspection` object for the
original input alongside the model's audit text. The model does not invent these
offsets. Oversized or unavailable inspection leaves the audit report usable with
`inspection.available: false`. At most 2,000 diagnostics are returned, with
`diagnosticsTruncated` marking additional findings; document-level evidence is
retained first. The underlying score and detector gates are unchanged.
