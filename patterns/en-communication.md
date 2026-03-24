---
pack: en-communication
language: en
name: Communication Patterns
version: 1.0.0
patterns: 3
---

# Communication Patterns

### 19. Collaborative Communication Artifacts

**Watch words:** I hope this helps!, Let me know if you need, Feel free to ask, Happy to help, Don't hesitate to reach out, I'd be glad to, Is there anything else, Hope that clarifies things, Let me know if you'd like me to

**Fire condition:** Any chatbot-style conversational phrase appears in content that is not a live interactive conversation.

**Exclusion:** Acceptable in transcripts of actual live chat sessions, intentional UI microcopy for chatbot interfaces, or dialogue being quoted and analyzed.

**Problem:** AI includes chatbot conversational phrases in written content. These are appropriate in a live chat but not in articles, reports, or documentation.

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

**Before:**
> Great question! That's a really fascinating topic. You've raised an excellent point about the economic factors at play. Let me break this down for you.

**After:**
> The main economic factor is the gap between housing supply and demand. Building permits in the metro area dropped 18% last year while population grew 2.1%.
