---
pack: en-structure
language: en
name: Structure Patterns
version: 1.1.0
patterns: 4
phase: structure
---

# Structure Patterns

---

### 25. Metronomic Paragraph Structure

**Fire condition:** 3+ consecutive paragraphs follow the identical internal template — e.g., claim → evidence → significance, or problem → solution → benefit, or intro → development → conclusion.

**Exclusion:** Academic abstracts, legal briefs, and comparative reviews (product A vs. product B on the same criteria) where the repeated structure is the required format, not an AI artifact. Also exclude texts with 2 or fewer paragraphs.

**Burstiness note:** After breaking the structure, vary paragraph function deliberately. Some paragraphs should present pure evidence with no stated implication. Some should be a single-sentence observation. Some should open with a question, a contradiction, or a concrete detail rather than a topic claim.

**Problem:** AI stamps every paragraph with the same internal template regardless of what the content actually requires. Human writing varies paragraph shape: some paragraphs open with a question, some lead with a specific detail, some end without resolving anything. Metronomic regularity is one of the strongest structural signals of AI generation.

**Before:**
> The electric vehicle market has experienced unprecedented growth in recent years. Sales doubled between 2021 and 2023, driven by falling battery costs and expanded charging infrastructure. This trend signals a fundamental shift in how consumers relate to personal transportation.
>
> Battery technology has improved considerably over the same period. Energy density has increased by 40% since 2018, while costs have fallen from $140 to $90 per kWh. These advances have made electric vehicles competitive with internal combustion alternatives on a total cost of ownership basis.
>
> Government policy has played a significant supporting role. Tax credits of up to $7,500 are available in the United States, and the EU has mandated a ban on new petrol vehicle sales by 2035. Such regulatory tailwinds are expected to sustain the sector's momentum into the next decade.

**After:**
> Electric vehicle sales doubled between 2021 and 2023. The main driver isn't policy — it's battery prices, which fell from $140 to $90 per kWh.
>
> The US $7,500 tax credit helps, but it phases out once a manufacturer hits 200,000 vehicles sold. Tesla already passed that cap years ago.
>
> Whether the EU's 2035 petrol ban survives is genuinely unclear. Germany's coalition nearly collapsed over it in 2023, and three major automakers are lobbying for a 2040 date instead.

---

### 26. Passive Nominalization Chains

**Watch words:** was conducted, was performed, was developed, was established, were identified, is required, has been shown, is provided, are considered, is achieved, is determined, is utilized, is noted

**Fire condition:** 2+ passive nominalization phrases in the same paragraph — e.g., "an analysis was conducted", "consideration was given to", "a decision was made".

**Exclusion:** Scientific methods sections and formal regulatory documents where passive voice is a disciplinary norm. Also acceptable when the actor is genuinely unknown, irrelevant, or appropriately omitted.

**Burstiness note:** Replace passives with active verbs — but vary the subjects. Avoid making every sentence "We did X." Mix "The team found Y" with "Data showed Z" with bare declaratives that start with the finding itself.

**Problem:** AI chains passive nominalizations that convert active situations into abstract bureaucratic prose. "An analysis was conducted" means "we analyzed." The passive form removes agency and adds syllables without adding meaning.

**Before:**
> An extensive review of the literature was conducted in order to identify key patterns. Consideration was given to a range of methodological approaches, and a decision was made to adopt a mixed-methods design. Data collection was performed over a six-month period, after which an analysis was undertaken to identify recurring themes.

**After:**
> We reviewed 47 papers published between 2018 and 2024. Most used surveys; we chose interviews instead, since the population was small enough to go deep. Six months of interviews, then we coded the transcripts.

---

### 27. Zombie Nouns (Excessive Nominalization)

**Watch words:** make an improvement to, provide a description of, conduct an analysis of, give consideration to, offer an explanation of, achieve a reduction in, have an impact on, make a decision about, reach a conclusion regarding, perform an evaluation of, carry out an investigation into, give an indication of

**Fire condition:** 3+ nominalized verb phrases in the same paragraph — e.g., "make improvements" instead of "improve", "conduct an analysis" instead of "analyze".

**Exclusion:** Noun forms that carry meaning unavailable in the verb ("the investigation" as a noun refers to an ongoing process; "investigate" does not). Also acceptable in legal contexts where nominalized forms have specific technical definitions.

**Burstiness note:** Replace nominalized phrases with verbs, but not every instance. Keep one or two where the noun form fits naturally — avoid creating staccato prose by over-correcting.

**Problem:** AI converts verbs into bloated noun phrases, a pattern called "zombie nouns." Every action becomes an abstract event: "improve" becomes "make an improvement to," "analyze" becomes "conduct an analysis of." The result is wordy, impersonal, and slow.

**Before:**
> The committee made a decision to conduct an analysis of the current situation and to provide a recommendation regarding future strategy. An evaluation of the available options was performed, and after careful consideration was given to each alternative, an agreement was reached on the most viable approach.

**After:**
> The committee analyzed the situation and agreed on a strategy. They evaluated three options and chose the one with the lowest implementation risk.

---

### 28. Stacked Subordinate Clauses

**Fire condition:** A single sentence contains 3+ embedded relative clauses, appositives, or participial phrases before the main verb reaches its object — or the reader must parse 4+ commas before understanding the sentence's main claim.

**Exclusion:** Legal definitions and technical specifications occasionally require nested qualification. Academic writing may also stack clauses when the embedded information is non-negotiable to the sentence's meaning and cannot be separated without losing precision.

**Burstiness note:** Break stacked sentences into two or three shorter ones. Start one sentence with the main clause, then add a separate sentence for the embedded detail. Vary lengths — don't make every resulting sentence the same.

**Problem:** AI builds sentences with cascading embedded clauses that delay the main verb and obscure the subject-verb relationship. The result is technically grammatical but exhausting to read and often contains no insight beyond what a shorter sentence would convey.

**Before:**
> The initiative, which was developed in response to increasing concerns about, and growing awareness of, the urgent need to address the challenges facing both urban and rural communities in the context of rapid technological transformation, aims to bridge the gap between innovation and equitable access.

**After:**
> Rural and urban communities are getting left behind as technology changes fast. The initiative targets that gap directly — access to tools, not just the tools themselves.

---

## English Burstiness Guidelines

Even without dedicated structure patterns, apply these burstiness principles when rewriting English text in Phase 1 (structure pass) or Phase 2 (sentence/lexical pass):

### What is burstiness?

Human writing varies sentence length and structure unpredictably. AI writing is uniform: similar sentence length, consistent clause structure, even paragraph size. Burstiness means introducing deliberate irregularity.

### How to apply

**Sentence length variation:**
- Mix short punchy sentences (4–8 words) with longer ones (20–35 words).
- A paragraph that opens with a one-sentence fragment and then unpacks in the next sentence reads as human.
- Avoid stretches of 4+ consecutive sentences with similar length.

**Paragraph length variation:**
- Paragraphs do not need to be 3–5 sentences. A single-sentence paragraph is fine for emphasis.
- Vary: short/long/medium, not medium/medium/medium.

**List count variation:**
- Do not default to 3-item lists. Use 2 items if there are 2, or 4 if there are 4.
- See Pattern #10 (Rule of Three) for correction details.

**Structure variation:**
- Mix declarative sentences, rhetorical questions, and sentence fragments.
- Not every sentence needs a subject-verb-object structure.

### When to apply

Apply burstiness corrections when:
- All paragraphs are approximately the same length.
- Most sentences follow the same syntactic pattern (Subject + Verb + Object + subordinate clause).
- The overall rhythm feels metronomic (consistently even pacing).

Do **not** manufacture burstiness if the source text is already varied. Check before correcting.
