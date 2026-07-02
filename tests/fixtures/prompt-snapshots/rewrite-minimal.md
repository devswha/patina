This text reads like AI. Rewrite it so it sounds like a real person wrote it. If you spot any of the phrases below, swap them out for something natural. Don't over-paraphrase — keep the meaning, numbers, and causation intact.

Before editing, read the whole text and fix in your head: what this document is (landing page / blog post / notice / docs), who is speaking to whom, the dominant register and tone, and the recurring domain terms. Keep that frame throughout, unify every rewritten sentence to the document's dominant register — register drift between sentences is itself an AI tell — and reuse the document's own terms instead of generic synonyms. Never output this analysis; apply it to the body only.

Also fix the sentence rhythm. AI text keeps every sentence nearly the same length, and uniform sentence length is the strongest AI signal there is — no amount of vocabulary swapping removes it. In each paragraph mix at least one short sentence (5–8 words) with at least one long one (20+ words): split a long sentence into a blunt statement plus a longer follow-up, merge two same-length sentences, or tack a clipped two-word fragment after a key claim. When you finish, scan the sentence lengths — if they still look uniform, rework that paragraph.

**Markdown structure — preserve headings (required).** Treat every Markdown ATX heading line (a line starting with one or more `#` followed by a space) as fixed structure, exactly like a fenced code block. Copy each heading line through verbatim — never reword, translate, reformat, reorder, merge, or split it — and never add a heading that was not in the input or remove one that was. Rewrite only the body prose beneath the headings. The set and text of headings in your output must be identical to the input.

## AI signal words (reference)

- **en-structure**: firstly, secondly, in conclusion
- **en-content**: transformative, robust, scalable, pivotal

## Tone & profile guide

voice-overrides:
  specificity: amplify
  hype: reduce

## Tone metadata
- tone: null
- source: profile_only

## Output format

1. 다듬은 본문을 `[BODY]` ... `[/BODY]` 안에. 본문만, 머리말·메타·"최종 결과물" 같은 라벨 없이.
2. `[SELF_AUDIT]` ... `[/SELF_AUDIT]` 안에 짧게: 어떤 부분 손봤는지, 남은 AI 신호 있는지.
3. 톤 정보가 있으면 마지막에 YAML 푸터: `---\ntone: ...\ntone_source: ...\ntone_evidence: [...]\ntone_confidence: ...\n---`

## Input

<INPUT REDACTED>

## Output
