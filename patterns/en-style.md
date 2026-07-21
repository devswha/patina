---
pack: en-style
language: en
name: Style Patterns
version: 1.0.0
patterns: 6
corpus-snapshot:
  id: bootstrap-patterns-pre-provenance
  status: needs-quarterly-refresh
  source: maintainer-curated pattern packs before quarterly corpus snapshot tracking
  last_validated: null
---

# Style Patterns

### 13. Em Dash Overuse

**Long-form fire condition:** 1+ em dash appears in each of 2+ consecutive paragraphs, or the document-level em-dash count is high relative to sentence count.

**Short-form scoring branch (`social` / `marketing` register only):** On English input of at most 200 non-whitespace characters and 1–4 prose sentences, count the em dashes that fall outside the exclusions below and score them directly: 1 → Low, 2 → Medium, 3+ → High. Always record `em_dash_count` and `em_dash_per_sentence = em_dash_count / max(1, prose_sentence_count)`. This is a **weak** score/audit signal — one dash alone is not evidence the author is AI, and it is inert for the default profile. The deterministic engine (`src/features/short-form.js`) records it and the scorer floors an eligible reply off an exact 0 via `computeShortFormEvidenceFloor` in `src/scoring.js` (~1.7 for a single dash), which keeps it inside the human band rather than promoting it.

**Exclusion:** Do not trigger on interrupted speech in quoted dialogue, glossary or dictionary-style separators, or deliberate literary style where one or two parenthetical em dashes are clearly intentional.

**Burstiness note:** When rewriting em-dash-heavy passages, distribute the repairs across commas, sentence breaks, parentheses, and colons. Uniform substitution (replacing every em dash with a comma) produces a new rhythm problem.

**Problem:** AI overuses em dashes in place of commas, parentheses, or subordinate clauses to create a polished effect. Human writers use them sparingly across a document; one em dash per paragraph over several paragraphs is a tell.

**Semantic Risk:** LOW

**Before:**
> The pilot launched in March — a date chosen to align with the grant cycle.
>
> The first cohort included twelve clinics — each one serving a different rural county.
>
> Early feedback was positive — though the team still needs retention data before expanding.

**After:**
> The pilot launched in March, a date chosen to align with the grant cycle.
>
> The first cohort included twelve clinics, each serving a different rural county.
>
> Early feedback was positive. The team still needs retention data before expanding.

**Short-form before / after (`--profile social`):**
> Before: built patina for exactly that — it keeps your meaning intact.
>
> After: built patina for exactly that. it keeps your meaning intact.

The single dash reads as a light AI-polish tell in a promo reply; a period (or comma) keeps the same beat without it. This branch only scores/audits it — rewrite mode still leaves genuinely intentional single dashes alone.

---

### 14. Boldface Overuse

**Fire condition:** 5+ bolded terms in a single document, or 3+ in a single paragraph.

**Exclusion:** Bold is appropriate in UI documentation (button names, field labels), safety warnings ("**Do not** delete this file"), and genuine reference material where bold signals terminology. Only trigger in flowing prose.

**Problem:** AI bolds key terms as if writing a study guide or corporate slide deck. In normal prose, bolding should be rare or absent.

**Semantic Risk:** LOW

**Before:**
> **Machine learning** is a subset of **artificial intelligence** that uses **statistical methods** to enable computers to **learn from data**. The most common approaches include **supervised learning**, **unsupervised learning**, and **reinforcement learning**.

**After:**
> Machine learning is a subset of artificial intelligence that uses statistical methods to let computers learn from data. The three main approaches are supervised learning, unsupervised learning, and reinforcement learning.

---

### 15. Inline-Header Vertical Lists

**Fire condition:** 2+ "**Label:** explanation" bullets in the same list.

**Exclusion:** Legitimate reference content — API parameter tables, changelog entries, feature comparison grids — where label-and-description is the correct and expected format.

**Burstiness note:** When rewriting, avoid converting every bullet into a single run-on sentence. Vary the approach: some items can merge into prose, others can become numbered steps if order matters, and short items can stay as a plain list without bold labels.

**Problem:** AI converts prose into pseudo-heading bullet points with a bold label and colon on every item. This format is appropriate for reference docs but not for articles, essays, or narrative text.

**Semantic Risk:** LOW

**Before:**
> - **Accessibility:** The platform supports screen readers and keyboard navigation.
> - **Performance:** Load times have been reduced by 40%.
> - **Security:** All data is encrypted end-to-end.

**After:**
> The platform now supports screen readers and keyboard navigation, load times are down 40%, and all data is encrypted end-to-end.

---

### 16. Title Case in Headings

**Fire condition:** 3+ content words (non-articles, non-prepositions) capitalized in the same heading when sentence case would be correct.

**Exclusion:** Proper nouns, brand names, product names, and acronyms within headings always require capitalization regardless of style guide.

**Problem:** AI capitalizes every word in headings (Title Case) instead of using sentence case. In most modern style guides (AP, APA, Google developer docs), sentence case is preferred for readability.

**Semantic Risk:** LOW

**Before:**
> ## The Impact Of Remote Work On Urban Development And Housing Markets

**After:**
> ## The impact of remote work on urban development and housing markets

---

### 17. Emojis

**Watch words:** emojis used as section markers or emphasis

**Fire condition:** Any emoji in professional, academic, or editorial text.

**Exclusion:** Personal blogs, social media copy, and casual newsletters where emojis are a deliberate stylistic choice. Also exclude emoji in quoted material being analyzed.

**Problem:** AI inserts emojis to add visual interest to text where they are inappropriate. This is especially common in listicles, summaries, and instructional content.

**Semantic Risk:** LOW

**Before:**
> Here are five tips for better sleep:
> 1. Set a consistent bedtime
> 2. Avoid screens before bed
> 3. Keep your room cool
> 4. Limit caffeine after noon
> 5. Try reading instead of scrolling

**After:**
> Five tips for better sleep:
> 1. Set a consistent bedtime.
> 2. Avoid screens before bed.
> 3. Keep your room cool.
> 4. Limit caffeine after noon.
> 5. Read instead of scrolling.

---

### 18. Curly Quotation Marks

**Watch words:** curly/smart quotes used in contexts where straight quotes are standard

**Fire condition:** Curly quotes appear inside code blocks, inline code spans, configuration file examples, or plain-text technical documents where straight quotes are required.

**Exclusion:** Curly quotes in narrative prose are typographically correct and not this pattern. Only trigger in technical or code contexts where curly quotes cause syntax errors or compatibility issues.

**Problem:** AI generates curly quotes in contexts where straight quotes are standard, such as code blocks, plain-text documents, configuration files, and technical documentation. This can cause syntax errors and compatibility issues.

**Semantic Risk:** LOW

**Before:**
> Set the variable: `name = "hello"`
>
> In your config file, add: `timeout = '30'`

**After:**
> Set the variable: `name = "hello"`
>
> In your config file, add: `timeout = '30'`
