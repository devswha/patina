# patina Launch Execution Packet

Last prepared: 2026-05-23.

Use this packet when the maintainer is ready to post. Agents may prepare copy,
score proof, and follow-up notes, but should not publish from maintainer-owned
accounts.

## Current source files

| Purpose | File |
|---|---|
| Broad channel copy | [`patina-launch-copy.md`](patina-launch-copy.md) |
| Korean-first copy | [`patina-launch-korean-first.md`](patina-launch-korean-first.md) |
| Top-of-funnel English guide | [`signs-of-ai-writing.md`](signs-of-ai-writing.md) |
| Top-of-funnel Korean guide | [`signs-of-ai-writing_KR.md`](signs-of-ai-writing_KR.md) |
| Share-card usage | [`share-card.md`](share-card.md) |

## Pre-post checklist

Run these before copying any post into a public channel:

```bash
node scripts/precommit-score.mjs \
  docs/social/patina-launch-copy.md \
  docs/social/patina-launch-korean-first.md \
  docs/social/signs-of-ai-writing.md \
  docs/social/signs-of-ai-writing_KR.md
```

Latest local result:

| File | Score | Status |
|---|---:|---|
| `docs/social/patina-launch-copy.md` | 6.3% | pass |
| `docs/social/patina-launch-korean-first.md` | 0.0% | pass |
| `docs/social/signs-of-ai-writing.md` | 0.0% | pass |
| `docs/social/signs-of-ai-writing_KR.md` | 20.0% | pass |

Confirm the links used in broad posts:

- Playground: <https://patina.vibetip.help/>
- Repository: <https://github.com/devswha/patina>
- False-positive form: <https://github.com/devswha/patina/issues/new?template=false_positive.yml>
- Benchmark report: [`docs/benchmarks/latest.md`](../benchmarks/latest.md)

## Posting order

| Order | Channel | Copy source | Maintainer action |
|---:|---|---|---|
| 1 | GeekNews | `patina-launch-korean-first.md` → GeekNews | Post or mark deferred in #286. |
| 2 | Velog | `patina-launch-korean-first.md` → Velog | Post or mark deferred in #286. |
| 3 | Clien-style short post | `patina-launch-korean-first.md` → Clien-style short post | Post or mark deferred in #286. |
| 4 | Show HN | `patina-launch-copy.md` → Show HN | Post with playground + repo links. |
| 5 | Product Hunt | `patina-launch-copy.md` → Product Hunt | Use brand/social assets and maker comment. |
| 6 | Reddit | `patina-launch-copy.md` → Reddit | Pick LocalLLaMA or writing/Korean angle. |
| 7 | X / Threads / LinkedIn | `patina-launch-copy.md` → X / Threads | Use short copy and link playground first. |

## #286 update template

After each channel action, add a short comment to #286:

```text
Channel:
Status: posted | queued | deferred
URL:
Copy source:
Score command:
Score result:
Notes / feedback:
```

If a post is deferred, record the reason instead of leaving the checkbox
ambiguous.

## Feedback triage

Capture useful launch feedback with enough detail to reproduce it:

- language and register,
- copied paragraph or a private/non-redistributable note,
- score output,
- expected behavior,
- whether the reporter allows the text to be used as a fixture.

Public false-positive reports should use:
<https://github.com/devswha/patina/issues/new?template=false_positive.yml>.

## Close criteria for #286

Keep #286 open until each channel is either:

- posted with URL and score proof,
- queued with owner/date,
- or explicitly deferred with reason.
