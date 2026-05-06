---
pack: en-viral-hook
language: en
name: Viral Hook Patterns
version: 1.0.0
patterns: 5
score_only: true
---

# Viral Hook Patterns (score-only)

This pack is **score- and audit-only**. It catches "AI marketing influencer" signals — shock-number hooks, clickbait closings, source-skipping authority claims, breath-optimized short-sentence stacking, and hyperbolic engagement vocabulary — that are common in SNS and blog marketing copy. Rewrite mode does not touch them because they may be intentional rhetoric; the user decides.

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
