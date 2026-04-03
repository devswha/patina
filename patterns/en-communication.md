---
pack: en-communication
language: en
name: Communication Patterns
version: 1.1.0
patterns: 4
---

# Communication Patterns

### 19. Collaborative Communication Artifacts

**Watch words:** I hope this helps!, Let me know if you need, Feel free to ask, Happy to help, Don't hesitate to reach out, I'd be glad to, Is there anything else, Hope that clarifies things, Let me know if you'd like me to

**Fire condition:** Any chatbot-style conversational phrase appears in content that is not a live interactive conversation.

**Exclusion:** Acceptable in transcripts of actual live chat sessions, intentional UI microcopy for chatbot interfaces, or dialogue being quoted and analyzed.

**Problem:** AI includes chatbot conversational phrases in written content. These are appropriate in a live chat but not in articles, reports, or documentation.

**Semantic Risk:** LOW

**Before:**
> The French Revolution began in 1789, driven by fiscal crisis and food shortages. I hope this helps! Let me know if you need more details on any specific aspect of the revolution. Feel free to ask about the key figures involved.

**After:**
> The French Revolution began in 1789, driven by fiscal crisis and food shortages. The immediate trigger was the near-bankruptcy of the French state and a bread price spike that hit Paris hardest.

---

### 20. Knowledge-Cutoff Disclaimers

**Watch words:** as of my last update, I don't have access to real-time, my training data, I cannot verify current, as of my knowledge cutoff, I'm not able to browse, please verify this information, this may have changed since

**Fire condition:** Any AI self-reference or training-data caveat appears in editorial, journalistic, or analytical content.

**Exclusion:** Acceptable in technical documentation explicitly about AI systems, or in content that intentionally discloses AI generation (with a proper disclosure note). Also acceptable if the caveat is replaced with a dated, source-cited fact.

**Problem:** AI includes training-data caveats in content that should not reference AI limitations. These disclaimers break the fourth wall and remind readers the text was machine-generated.

**Semantic Risk:** MEDIUM
**Preservation Note:** The disclaimer sometimes carries a genuine factual caveat about data currency; removing it without replacing the claim with a dated source may leave an unverified assertion that the reader cannot assess.

**Before:**
> As of my last update in April 2024, the company had around 5,000 employees. I don't have access to real-time data, so please verify this information with current sources.

**After:**
> The company had about 5,000 employees as of its 2024 annual report.

---

### 21. Sycophantic/Servile Tone

**Watch words:** Great question!, That's an excellent point, You've raised a fascinating, What a thoughtful, That's a really interesting, Absolutely!, You're absolutely right, What a great observation

**Fire condition:** Any flattering or servile opener appears before substantive content.

**Exclusion:** None — this pattern has no valid context in editorial, analytical, or journalistic writing. Even in conversational formats, drop the flattery and start with the answer.

**Problem:** AI flatters the reader or questioner before answering. This servile opener adds no information and signals AI generation.

**Semantic Risk:** LOW

**Before:**
> Great question! That's a really fascinating topic. You've raised an excellent point about the economic factors at play. Let me break this down for you.

**After:**
> The main economic factor is the gap between housing supply and demand. Building permits in the metro area dropped 18% last year while population grew 2.1%.

---

### 29. False Nuance (Retroactive Reframing)

**Watch words:** Actually, it's more nuanced than that, To be more precise, Well, it's not quite that simple, That said, the reality is more complex, More accurately, In fairness, it's more that, If we're being precise, Though to be fair

**Fire condition:** The text restates or lightly reframes the preceding claim under the guise of adding nuance, without introducing new information, evidence, or a genuinely different perspective.

**Exclusion:** Acceptable when the reframe introduces a substantive correction, cites new evidence, or genuinely shifts the analytical frame in a way that changes the conclusion. Also acceptable in dialogue transcripts where the speaker is visibly self-correcting with new data.

**Problem:** AI hedges its own statements by immediately re-qualifying them in a way that sounds thoughtful but adds nothing. The "nuance" is cosmetic — the second sentence says the same thing as the first in slightly different words. This creates an illusion of depth while padding the text.

**Semantic Risk:** HIGH
**Preservation Note:** Removing the reframing clause may delete a genuine qualification or exception; verify that the retained primary claim accurately stands alone before removing the "nuance" sentence.

**Before:**
> Remote work increases productivity. Actually, it's more nuanced than that — remote work can enhance productivity in certain contexts while presenting challenges in others, and the net effect depends on organizational culture and individual work styles.

**After:**
> Remote work increases productivity for focused solo tasks — a Stanford study found a 13% gain for call center workers. It hurts spontaneous collaboration, though: Microsoft's 2021 internal data showed cross-team communication dropped 25% after going fully remote.
