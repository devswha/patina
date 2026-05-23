# patina Launch: Platform House-Rules and Hard-Question Q&A

Companion to [`patina-launch-copy.md`](patina-launch-copy.md) and
[`patina-launch-execution.md`](patina-launch-execution.md). Those files hold the
copy and the posting order. This file covers two things they do not: the
per-platform rules that keep a post from being removed or flagged, and honest
answers to the questions a maintainer gets asked on launch day.

Posting stays maintainer-owned. Nothing here authorizes automated posting.

## Platform house-rules

Each platform removes posts for different reasons. Read the matching section
before copying a draft into that channel.

### Hacker News (Show HN)

- The title must be at most 80 characters and read plainly. No hype, no
  exclamation points, no site name in the title. The launch-copy title was 82
  characters; the shorter replacements are tracked in the #286 review comment.
- Show HN is for things people can run, inspect, or try. The playground
  qualifies. Keep it free of signup and email gates so a reader can try it in
  one click.
- Do not ask anyone to upvote, and do not coordinate votes. Stay in the thread
  and answer questions yourself for the first several hours.
- Post one Show HN per project. Reposting quickly reads as gaming the ranking.
- A blog post or a writeup is off topic for Show HN because there is nothing to
  try. Link the playground or the repo, not an essay.

### Product Hunt

- Launch at 12:01 AM Pacific, ideally Tuesday or Wednesday, and only on a day
  when someone can stay online for most of the next 18 hours.
- Never ask for upvotes. Ask people to visit and comment. Vote rings, bought
  votes, and incentives all get penalized.
- Post the maker comment in the first minute: why it exists and the try-it link.
  Then reply to every comment quickly. Comment quality moves ranking more than
  raw upvote count.
- Self-promotion inside comments gets removed, so keep replies useful.

### Reddit

- The working ratio is roughly ten genuine contributions for every promotional
  post. A brand-new account that only posts its own tool gets filtered.
- Many subreddits gate posting behind karma and account age. Check the sidebar
  of each target subreddit before posting, because the thresholds vary widely.
- Disclose that you built it. Some subreddits require a flair or an affiliation
  note, and skipping that can earn a ban even when the content is fine.
- Match the angle to the room. r/LocalLLaMA cares about the local, no-key path.
  r/writing and r/Korean care about the editing and voice angle. Read the rules
  for each before posting.

### Korean communities

- GeekNews (news.hada.io) behaves like Hacker News: a neutral title, a link to
  something a reader can actually try, and an author who answers in the thread.
- Velog is a blog platform, so a longer write-up is welcome there. Open with the
  writing problem and reach the tool after the reader recognizes it.
- Clien is sensitive to anything that reads as an advertisement. Frame it as a
  personal project that wants feedback, lead with the Korean angle, and link the
  false-positive form so the post is asking for help rather than attention.

### Applies everywhere

Score the final text and keep the proof before posting. Lead with the writing
problem, not the tool. Never use "bypass", "undetectable", or "beats detectors".
Keep the playground link in every broad post.

## Hard-question Q&A

These extend the reply templates already in `patina-launch-copy.md`. The answers
follow [`docs/ETHICS.md`](../ETHICS.md) and [`docs/FAQ.md`](../FAQ.md); keep them
consistent if either file changes.

### "Isn't this just helping people cheat or evade AI detectors?"

It is built for editing, not evasion. The ethics statement is explicit that
patina is not for honor-code evasion, disclosure circumvention, or plagiarism
laundering, and that a cleaner sentence is not evidence that AI was not used. If
a school or publisher asks whether AI assisted the writing, the honest answer is
still yes. The score is an editing signal, not a guarantee against any detector.

### "What is your false-positive rate? It flagged something I wrote by hand."

False positives are real and we publish the numbers. The 2026-05-22 calibration
reports a 67.3% editing-hotspot catch rate, with a confidence interval of 63.5
to 71.0, against samples from GPT-5.5, Claude Sonnet 4.6, and Gemini 2.5 Pro
(n=600, Korean and English). Human-control false positives run at 16.0%, with an
interval of 11.6 to 21.7 (n=200). Encyclopedic, corporate, academic, and heavily
edited prose trip it most often. Treat the highlighted diff as the useful output
and the number as a rough signal. Misfires are worth reporting through the
false-positive form so they become fixtures.

### "Does it send my text anywhere?"

The web playground runs entirely in the browser. It makes no network calls,
loads no analytics or trackers, and is served as static files, so the text you
paste never leaves the page. The CLI does its deterministic analysis locally.
When you ask it to rewrite, that step calls whichever CLI you are already logged
into, such as Codex, Claude, or Gemini, under your own account. patina runs no
server of its own and holds no API key to phone home with.

### "How is this different from QuillBot, GPTZero, or the undetectable-text tools?"

Most of those are English-first and either detector-facing or black-box
paraphrasers. patina shows the work: which pattern fired, why a passage changed,
and whether the claims survived. It treats Korean as a first-class language
rather than an afterthought, runs locally without a required API key, and is
open source under MIT. The comparison page lists this as time-stamped evidence
for a small corpus, not as a claim that one tool beats another.

### "Isn't this just regex? How is it not brittle?"

There are two layers. The audit is deterministic stylometry: burstiness,
vocabulary diversity, lexicon density, and Korean-specific diagnostics, combined
with the pattern packs. The rewrite is model-driven and guarded by meaning
checks. Severity can shift by roughly eight to ten points between runs, which is
exactly why the output is a range and a diff rather than a verdict.

### "How does it preserve meaning, and why should I trust the rewrite?"

Before rewriting, patina extracts anchors: claims, polarity, causation, numbers,
and negation. After each rewrite phase it checks whether those anchors are still
present and unchanged, and it retries or rolls back the section if one is dropped
or flipped. A high meaning-preservation score does not promise good prose; it
means the claims being tracked survived the edit.

### "Does it need an API key, or only work in Claude Code?"

Neither is required. If you are logged into the Codex CLI, or another configured
backend, there is no separate API key. It runs as a skill in Claude Code, Codex,
Cursor, and OpenCode, and as a standalone Node CLI. Korean, English, Chinese, and
Japanese are supported.

### "Why another humanizer? The space is crowded."

The crowded part is English detector-bypass services. patina is aimed somewhere
else: a Korean-first, auditable, local editing pass that you can inspect and
self-host. The goal is not a lower detector score. The goal is an edit you can
explain.

### "What is the license?"

MIT. Use it commercially, self-host it, and fork it.

## When not to engage

Answer the cheating framing once, honestly, and move on rather than arguing.
Do not claim accuracy beyond the published calibration numbers and their
intervals. Do not promise any outcome against a specific detector. If a thread
turns hostile, the diff and the published numbers are the argument; repetition is
not.
