---
pack: en-language
language: en
name: Language Patterns
version: 1.0.0
patterns: 6
---

# Language Patterns

### 7. AI Vocabulary Words

**Watch words:** delve, tapestry, landscape, multifaceted, comprehensive, pivotal, testament, intricate, nuanced, leverage, foster, crucial, moreover, furthermore, realm, robust, facilitate, endeavor, resonate, underscore, embark, myriad, paramount, encompass, holistic, synergy, elucidate, culminate, juxtapose, burgeoning

**Fire condition:** 3+ watch words appear in one paragraph.

**Semantic Risk:** MEDIUM
**Preservation Note:** Replacing AI vocabulary words changes the specific connotations carried by words like "nuanced" or "multifaceted"; ensure the substituted terms preserve the intended meaning and register.

**Problem:** These words appear at dramatically higher rates in AI-generated text than in human writing. Individually they are normal English words; clustered together they are a telltale fingerprint.

**Before:**
> This comprehensive report delves into the multifaceted landscape of renewable energy, leveraging nuanced insights to foster a robust understanding. Moreover, the intricate tapestry of stakeholder interests underscores the pivotal role of policy in this crucial endeavor.

**After:**
> This report covers renewable energy policy from three angles: cost, grid reliability, and public opinion. Each section uses data from the EIA and interviews with six state utility commissioners.

---

### 8. Copula Avoidance ("serves as")

**Watch words:** serves as, acts as, functions as, stands as, operates as, works as, remains as, exists as

**Fire condition:** 2+ copula-avoidance constructions in the same paragraph, or a single instance where "is" would be shorter and clearer.

**Exclusion:** "Serves as" is acceptable when the subject has a formally designated role function (e.g., "the committee serves as an advisory board" — institutional role, not decorative usage).

**Semantic Risk:** MEDIUM
**Preservation Note:** "Serves as" sometimes implies a functional or designated role distinct from mere identity; replacing with "is" may flatten a meaningful distinction about purpose or function.

**Problem:** AI avoids the simple verb "is" by using unnecessarily complex copula constructions. "The park serves as a gathering place" instead of "The park is a gathering place."

**Before:**
> The library serves as a vital community hub, functioning as both an educational resource and a social gathering space. It also acts as a testament to the city's commitment to public access.

**After:**
> The library is the neighborhood's main public space. People use it for study groups, ESL classes, and the Saturday morning story hour, which draws about 40 kids a week.

---

### 9. Negative Parallelisms

**Watch words:** not just...but, not merely...but also, not only...but, goes beyond...to, more than just...it is, transcends...to become

**Fire condition:** 2+ "not X but Y" structures in the same document, or a single instance where the positive statement alone would be simpler and equally clear.

**Exclusion:** Genuine contrastive clarification correcting a misconception ("the event is not a conference but a workshop — no keynotes, only hands-on sessions") — the negative frame is doing real work here.

**Semantic Risk:** MEDIUM
**Preservation Note:** The negative framing sometimes carries a genuine contrast or correction; collapsing "not X but Y" to just "Y" may lose the implicit rejection of a common assumption the author intended to address.

**Problem:** AI uses negative-then-positive constructions to make simple points sound profound. Instead of stating what something is, it first states what it is not.

**Before:**
> This initiative is not just a policy change but a fundamental reimagining of urban planning. It goes beyond mere infrastructure investment to become a statement about the kind of city residents want to live in.

**After:**
> The initiative rezones 12 blocks for mixed-use development and adds a bike lane network connecting the east and west sides of the river.

---

### 10. Rule of Three Overuse

**Fire condition:** 3-item lists appear 2+ times in the same document, or a triple-part sentence where the count is arbitrary and another count would be equally valid.

**Exclusion:** Naturally occurring triads in genuinely three-part processes (past/present/future; input/process/output; beginning/middle/end) are not this pattern.

**Burstiness note:** When rewriting, use the naturally correct count — one strong point if that is all there is, two contrasting items if that is the real structure, four if there are actually four. Varying list counts across a document signals human authorship.

**Problem:** AI defaults to triple-item lists and three-part structures when the natural count might be two, four, or one. This creates a rhythm that feels rehearsed rather than spontaneous.

**Semantic Risk:** LOW

**Before:**
> The program fosters creativity, innovation, and collaboration. Participants gain inspiration, practical skills, and lasting connections. The result is a more dynamic, inclusive, and forward-thinking community.

**After:**
> The program pairs early-career designers with experienced mentors for a 10-week project. Last year's cohort produced two apps that are still in active use.

---

### 11. Elegant Variation (Synonym Cycling)

**Fire condition:** The same entity referred to by 3+ different names or synonyms within a single paragraph.

**Exclusion:** Legitimate disambiguation (using "the company" vs. "Microsoft" when distinguishing a parent from a subsidiary, or "the study" vs. "the 2023 Stanford paper" for precision) is not this pattern.

**Problem:** AI rotates synonyms for the same entity to avoid repeating a word, producing text that feels strangely evasive. A city becomes "the metropolis," then "the urban center," then "the municipality" — all within the same paragraph.

**Semantic Risk:** LOW

**Before:**
> Tokyo is the most populous city in Japan. The metropolis is known for its blend of tradition and modernity. The urban center attracts millions of tourists each year. The Japanese capital continues to grow.

**After:**
> Tokyo is the most populous city in Japan, with about 14 million residents. It draws roughly 20 million foreign tourists a year, a number that has doubled since 2015.

---

### 12. False Ranges

**Watch words:** from X to Y, ranging from...to, spanning...to, everything from...to, whether...or

**Fire condition:** A "from X to Y" construction appears where the two poles do not meaningfully bound a spectrum — the range is decorative rather than informative.

**Exclusion:** Genuine numeric or temporal ranges ("from 10 to 100 employees", "from January to March", "from $5 to $50") are not this pattern.

**Problem:** AI creates artificial ranges to sound comprehensive, often pairing two extremes that do not meaningfully define a spectrum.

**Semantic Risk:** MEDIUM
**Preservation Note:** Removing a range construction may drop a genuine scope claim about audience or coverage; verify whether the range was intended to convey actual breadth before eliminating it.

**Before:**
> The festival offers something for everyone, from young children to seasoned professionals, spanning everything from traditional folk music to cutting-edge electronic performances.

**After:**
> The festival has three stages. The main stage books established acts (this year: Yo-Yo Ma, Thundercat). The tent stage is for local bands. There is also a children's area with instrument demos.
