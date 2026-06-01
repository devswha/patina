---
pack: en-viral-hook
language: en
name: Viral Hook Patterns
version: 1.0.0
patterns: 9
corpus-snapshot:
  id: bootstrap-patterns-pre-provenance
  status: needs-quarterly-refresh
  source: maintainer-curated pattern packs before quarterly corpus snapshot tracking
  last_validated: null
score_only: true
---

# Viral Hook Patterns (score-only)

This pack is **score- and audit-only**. It catches "AI marketing influencer" signals — shock-number hooks, clickbait closings, source-skipping authority claims, breath-optimized short-sentence stacking, hyperbolic engagement vocabulary, fake-stat citations, stacked credentials, future-self promises, and aphoristic standalone punchlines — that are common in SNS and blog marketing copy. Rewrite mode does not touch them because they may be intentional rhetoric; the user decides.

A hit here does not mean the text is AI-generated. Humans use these patterns too. But when several appear together, the score aligns with the reader's intuition that "this reads like AI-polished marketing."

---

### 1. Shock Numbers as Hook

**Watch words:** in just N days, only N hours, jumped from 0 to N, hit N million in N weeks, N% growth in N months, broke the N-million mark, N-figure result

**Problem:** Specific shock numbers are used as the primary impact lever. Without a verifiable source (link, screenshot, named outlet), this reads more like marketing-bot or AI-influencer copy than something a person wrote about their own experience.

**Fire condition:** A bold claim relies on a striking number (time-to-X, scale, percentage) and the same piece offers no source or verification path.

**Exclusion:**
- First-person reports of personal numbers ("my salary is $4,000")
- Idioms ("a million times")
- Common-knowledge statistics that are independently verifiable

**Semantic Risk:** LOW — score-only, not rewritten.
**Detection examples:**
> 250K stars in just 60 days.

> $100M revenue with zero ad spend.

---

### 2. Clickbait Mystery Close

**Watch words:** what makes them tick, why is everyone, you'll never guess, can you believe, the reason might surprise you, here's why

**Problem:** The piece ends on an unresolved rhetorical question or teaser to drive clicks, follows, and comments instead of delivering information. AI-generated viral copy almost never skips this closing pattern.

**Fire condition:** The **last sentence** of the piece is a rhetorical question that the body has not answered, or a teaser that explicitly redirects the reader to engagement (subscribe, follow, save).

**Exclusion:**
- Genuine questions that lead into a follow-up paragraph or piece that answers them
- Real invitations to discussion with a specific channel and topic

**Semantic Risk:** LOW — score-only.
**Detection examples:**
> So why are devs flocking to it without any marketing?

> The reason might surprise you.

---

### 3. Source-Skipping Authority

**Watch words:** for the first time in history, a global first, never before seen, the only X that, reportedly (with no named source), industry insiders say (with no source)

**Problem:** Absolute authority or scope claims are made without a verifiable source. People typically hedge ("from what I've seen") or attribute; AI-influencer copy goes for impact via plain assertion.

**Fire condition:** Absolute scope or rank claims ("first ever", "no one has", "industry-wide change") appear without an accompanying source, link, screenshot, or named expert.

**Exclusion:**
- Self-evident factual statements
- Idiomatic exaggeration (clearly hyperbolic for effect)
- First-person personal claims ("the best book I've ever read")

**Semantic Risk:** LOW — score-only.
**Detection examples:**
> The fastest growth GitHub has ever seen.

> Developers worldwide are losing their minds over this.

---

### 4. Breath-Optimized Short-Sentence Stacking

**Watch words:** (structural pattern — judged by form, not vocabulary)

**Problem:** Sentences are intentionally clipped to one line each and separated by line breaks for vertical-scroll readability. This is a hallmark of SNS and blog marketing formatting. Real long-form human writing usually has natural burstiness — a mix of short and longer sentences.

**Fire condition:** The whole piece is composed almost entirely of one-sentence paragraphs, four or more in a row, with average sentence length under ~12 words. A handful of short sentences mixed with longer ones does not fire this.

**Exclusion:**
- Poetry, song lyrics, verse
- Genuinely short notes, announcements, alerts
- One- or two-line answers to a question
- Pieces dominated by code blocks, lists, or quoted dialogue

**Semantic Risk:** LOW — score-only; the format may be intentional.
**Detection examples:**
> No one has ever shipped this fast.
>
> 250K stars in 60 days.
>
> A tool called OpenClaw did it.
>
> Why are devs flocking to it without any marketing?

(Four one-line paragraphs, average ~10 words, line-break separated → fires.)

---

### 5. Hyperbolic Engagement Lexicon

**Watch words:** absolutely insane, totally wild, mind-blowing, game-changing, you can't sleep on this, don't miss out, hands down the best, literally everyone is, this changes everything, a no-brainer

**Problem:** Hype vocabulary tuned for SNS engagement. Humans use these too, but several stacked together is a strong signal — and AI-generated viral copy uses them as default amplifiers.

**Fire condition:**
- One occurrence in the piece: Low
- Two occurrences: Medium
- Three or more: High

**Exclusion:**
- Joking or self-deprecating context that explicitly flags the exaggeration
- Quoted speech or dialogue
- Sports, gaming, or other domains where these terms are conventional and a measurable outcome supports them

**Semantic Risk:** LOW — score-only.
**Detection examples:**
> This is absolutely insane and developers are losing their minds.

> Hands down the best dev tool of the year — don't sleep on it.

---

### 6. Fake Statistic Citation

**Watch words:** studies show N%, research says N%, data shows N%, according to research (with no named source), N% of people, science says, survey found (with no survey named)

**Problem:** A precise statistic borrows the feel of research without giving the reader a source to check. AI-polished marketing copy often uses fake precision to make ordinary advice feel proven.

**Fire condition:** A numeric or statistical claim is attributed to vague research, data, surveys, or science, and the same piece gives no named source, link, sample, date, or method.

**Severity rubric:**
- Low: One vague statistic supports a minor point.
- Medium: The statistic opens the piece or anchors the main call to action.
- High: Precise percentages support health, finance, career, or safety advice, or multiple unsourced statistics appear together.

**Exclusion:**
- A named report, publication, dataset, or linked source is provided
- The number is clearly labeled as an example or hypothetical
- First-party analytics include scope and measurement context
- Common public data that the reader can verify independently

**Semantic Risk:** LOW — score-only.
**Preservation Note:** Score-only by default; if the user asks to lower the hook, preserve real numbers and either cite, hedge, or remove the fake research frame. Do not invent a source.
**Before / after examples (manual lower-signal rewrite):**
> Before: Studies show 73% of founders lose money because they ignore this one habit.
>
> After: I do not have a source for that percentage, but weekly cash reviews can catch losses earlier.

---

### 7. Manufactured Authority Stacking

**Watch words:** Stanford-trained, Y Combinator-backed, ex-Google, Harvard-trained, Forbes-featured, award-winning, serial founder, trusted by top CEOs, industry-leading expert

**Problem:** Several prestige labels are stacked before a claim so the authority does the persuasive work. This reads like a growth-thread template when the credentials are vague, irrelevant, or not tied to evidence.

**Fire condition:** Two or more prestige credentials, titles, investors, schools, employers, awards, or media labels are stacked to sell a claim, and the piece does not show why those credentials prove the point.

**Severity rubric:**
- Low: Two credentials appear, but the person or product is named and the claim is narrow.
- Medium: Three or more credentials introduce advice, a product, or a trend without evidence.
- High: The credential stack replaces evidence for high-stakes advice or a direct purchase/signup call.

**Exclusion:**
- Resume, bio, speaker note, or press boilerplate where credentials are the subject
- Named, verifiable credentials that are relevant to the claim
- A sourced article where credentials supplement, rather than replace, evidence

**Semantic Risk:** LOW — score-only.
**Preservation Note:** Score-only by default; if toned down, keep verifiable affiliations and remove only the pile-up or unsupported leap from title to conclusion.
**Before / after examples (manual lower-signal rewrite):**
> Before: A Stanford-trained, Y Combinator-backed serial founder says this one workflow will 10x your growth.
>
> After: A founder shared the workflow they use for weekly growth reviews; test it on your own numbers before adopting it.

---

### 8. Future-Self / Parasocial Promise

**Watch words:** your future self will thank you, thank me later, listen friend, friend, save this for later, one year from now you'll be glad, future you, trust me on this

**Problem:** The copy simulates intimacy or future gratitude to pressure the reader into saving, sharing, or obeying advice. It is common in viral threads because it creates emotional urgency without adding evidence.

**Fire condition:** An opener or close addresses the reader as a friend, future self, or intimate confidant and promises later gratitude, usually around a save/share/follow call, without concrete support in the same piece.

**Severity rubric:**
- Low: One soft save-this or future-self phrase appears in a casual social post.
- Medium: The future-self promise frames the title, opener, or final call to action.
- High: The promise is paired with urgency, scarcity, or high-stakes life/career advice.

**Exclusion:**
- A real message to a known friend or community member
- Coaching, therapy, or accountability writing where the relationship is explicit
- Memoir or reflection addressed to the writer's own past/future self
- Plain calendar or reminder instructions without emotional pressure

**Semantic Risk:** LOW — score-only.
**Preservation Note:** Score-only by default; if rewritten, keep any useful reminder or action while removing simulated intimacy and unverifiable future payoff.
**Before / after examples (manual lower-signal rewrite):**
> Before: Listen, friend — your future self will thank you for saving this.
>
> After: Save this if you need a checklist for next month's planning.

---

### 9. Aphoristic Punchline / Standalone Declarative

**Watch words:** (structural pattern — judged by form, not vocabulary)

**Problem:** A short, grammatically complete declarative sentence (roughly ten words or fewer) is set on its own line or paragraph for rhetorical gravitas — a pseudo-profound mic-drop. One can be a stylistic choice; several across a piece, or one capping each paragraph, is a hallmark of AI-polished thought-leadership copy that gestures at depth without earning it. The judgment is about form and placement, not the words used.

**Fire condition:** A standalone, grammatically complete declarative sentence of about ten words or fewer is isolated on its own line or paragraph as a punchline, and the piece contains two or more such isolated aphorisms or caps successive paragraphs with them.

**Severity rubric:**
- Low: One standalone aphorism appears in the piece.
- Medium: Two standalone aphorisms appear.
- High: Three or more appear, or nearly every paragraph is capped with one.

**Exclusion:**
- Poetry, song lyrics, verse
- Genuinely short notes, answers, alerts, or one-line replies
- A deliberate aphorism backed by concrete support in the same passage
- Quoted speech or dialogue
- Headings and section titles

**Semantic Risk:** LOW — score-only; the isolated line may be intentional rhetoric.
**Preservation Note:** Score-only by default; if the user asks to lower the hook, fold the standalone line back into the surrounding paragraph or attach the concrete reason it points at, so the claim survives without the staged mic-drop.
**Before / after examples (manual lower-signal rewrite):**
> Before: We rebuilt the onboarding flow over two sprints.
>
> Symmetry becomes a trap.
>
> The team learned to ship smaller.
>
> Constraints are a gift.
>
> After: We rebuilt the onboarding flow over two sprints, and matching every screen to the old layout slowed us down — chasing visual symmetry became a trap. The team learned to ship smaller pieces, and the tight scope each sprint actually helped more than it hurt.
