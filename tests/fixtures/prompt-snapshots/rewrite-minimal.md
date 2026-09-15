This text reads like AI. Rewrite it so it sounds like a real person wrote it. If you spot any of the phrases below, swap them out for something natural. Don't over-paraphrase — keep the meaning, numbers, and causation intact. Keep the rewrite about the same length as the original (within roughly ±30%): while keeping the document purpose and register, actually remove or tighten empty hype, stock openings, and redundancy. Do not keep those phrases just because they appear in the source. Preserve numbers, agents, conditions, negation, uncertainty, causation, obligation, risk, important intensity, and attributed evaluations. If numbers and time spans already convey scale, you may drop redundant emphasis. If a phrase is the only carrier of intensity, do not delete that intensity — keep the force while tightening the wording. Do not change direct quotations, requested slogans, or already-natural sentences without need. Do not change claims or stance the document purpose does not authorize.

Before editing, read the whole text and fix in your head what the document is, who is speaking to whom, and its recurring domain terms. Keep that frame throughout. Preserve the source’s dominant voice; do not invent an author identity or personality. Preserve and unify the source’s dominant register; register drift between sentences is not allowed. Reuse the document’s own terms instead of generic synonyms. Never output this analysis; apply it to the body only.

Also fix the sentence rhythm. AI text keeps every sentence nearly the same length, and uniform sentence length is the strongest AI signal there is — no amount of vocabulary swapping removes it. In each paragraph mix at least one short sentence (5–8 words) with at least one long one (20+ words): split a long sentence into a blunt statement plus a longer follow-up, merge two same-length sentences, or tack a clipped two-word fragment after a key claim. When you finish, scan the sentence lengths — if they still look uniform, rework that paragraph.

**Markdown structure — preserve headings (required).** Treat every Markdown ATX heading line (a line starting with one or more `#` followed by a space) as fixed structure, exactly like a fenced code block. Copy each heading line through verbatim — never reword, translate, reformat, reorder, merge, or split it — and never add a heading that was not in the input or remove one that was. Rewrite only the body prose beneath the headings. The set and text of headings in your output must be identical to the input.

## AI signal words (reference)

- **en-structure**: firstly, secondly, in conclusion
- **en-content**: transformative, robust, scalable, pivotal

## Rewrite Axis Contract

- Meaning and safety are global: no axis may change claims, numbers, polarity, causation, commitments, or verification floors.
- Document Type owns purpose, audience, structure, domain vocabulary/precision, and pattern bounds. It never selects Persona or Register.
- Persona is omitted: preserve the source voice; do not invent an author identity or personality.
- Register is omitted: preserve the source’s dominant casual/professional delivery.
- Never infer one axis from another. If instructions appear to conflict, field ownership wins: Document Type for document conventions, Persona for idiolect, Register for casual/professional markers; meaning and safety override all three.

## Document policy

```json
{
  "document_type": "default",
  "name": "General-purpose text",
  "scope": "Unclassified prose",
  "purpose": "Preserve the message while removing detectable AI-writing residue.",
  "audience": [
    "The source text’s intended reader"
  ],
  "structure": [
    "Preserve source order",
    "Use only necessary headings"
  ],
  "style": [
    "Concrete",
    "Direct"
  ],
  "avoid": [
    "Invented claims",
    "Template filler"
  ],
  "pattern_policy": {
    "4": "reduce"
  }
}
```

## Output format

1. 다듬은 본문을 `[BODY]` ... `[/BODY]` 안에. 본문만, 머리말·메타·"최종 결과물" 같은 라벨 없이.
2. `[SELF_AUDIT]` ... `[/SELF_AUDIT]` 안에 짧게: 어떤 부분을 손봤는지와 남은 AI 신호.

## Input

<INPUT REDACTED>

## Output
