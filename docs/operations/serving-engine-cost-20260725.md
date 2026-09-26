# Serving-engine cost and quality measurements (2026-07-25)

> **Status note (2026-09-02, index pass):** the deepseek verdict here was superseded by `serving-engine-deepseek-0731-correction-20260803.md`; the free tier ran on deepseek from 2026-08-03 and is back on gemini as of the owner's 2026-09-02 confirmation. The Pro-tier pin is unchanged.

Measured to answer one question: what should serve the Pro tier and the free
trial, given that the incumbent (`claude-sonnet-5`) consumes essentially the
whole $9.99 subscription when one license exhausts its monthly character cap.

Not a Gate-B artifact, not an approval, and not a decision to change any
provider default. Provider defaults and launch bindings stay frozen where the
v6.4 preflight hold pins them.

## Why the prompt is unusually cache-friendly

The rewrite prompt is a fixed prefix (pattern catalog + profile + voice) with
only the user text after the data fence:

| language | total prompt | cacheable prefix | user text |
|---|---:|---:|---:|
| ko | 41,651 chars | 41,517 (99.7%) | 134 |
| en | 72,561 chars | 72,427 (99.8%) | 134 |
| zh | 35,294 chars | 35,160 (99.6%) | 134 |
| ja | 38,639 chars | 38,505 (99.7%) | 134 |

Cost is therefore dominated by input tokens that are identical on every
request, which makes prompt caching — not model choice — the first lever.

## Prompt caching, measured on the real path

`PATINA_ANTHROPIC_NATIVE_CACHE=1`, ko web prompt, `claude-sonnet-5`, two
identical calls:

| call | input | cache write | cache read | latency |
|---|---:|---:|---:|---:|
| 1st | 147 | 34,254 | 0 | 25.2s |
| 2nd | 147 | 0 | **34,254** | **12.0s** |

Cost per request at the checked-in sonnet-5 rates ($3 in / $15 out /
$0.30 cache read / $3.75 5m cache write), 1,500 output tokens assumed:

| state | cost | vs uncached |
|---|---:|---:|
| uncached | $0.1257 | — |
| cache miss (write) | $0.1514 | +20% |
| cache hit (read) | $0.0332 | **−74%** |

Break-even hit rate is **21.7%**. With the 5-minute ephemeral TTL refreshing
on each hit, that is roughly **3 requests/hour per language variant**; the four
languages hold separate cache entries, so low-traffic variants stay in the
surcharge region. Latency halves on every hit regardless of traffic.

| hit rate | cost/request | monthly cap exhausted (50 requests) |
|---|---:|---:|
| 0% | $0.1514 | $7.57 |
| 50% | $0.0923 | $4.62 |
| 90% | $0.0450 | $2.25 |

## Candidate engines, same fixtures and same judge

6 fixtures (ko 3 + en 3), fixed judge `grok-4.5` (calibrated AUC 0.93,
independent of every candidate). Cost uses measured tokens (~18.8k in / ~280
out) at published rates; `gpt-5.3-chat-latest` has no published rate (the 5.3
line is absent from the pricing table) and is interpolated from 5.2/5.4.

| engine | pass | MPS mean | **MPS worst** | fidelity mean | s/rewrite | $/rewrite |
|---|---|---:|---:|---:|---:|---:|
| gemini-3.6-flash | 3/6 | **91.9** | **80.0** | **68.0** | 8.3 | $0.0302 |
| deepseek-v4-flash | 3/6 | 77.2 | 15.0 | 61.1 | 14.1 | **$0.0032** |
| gpt-5.3-chat-latest | 2/6 | 70.5 | 15.0 | 61.1 | **4.2** | $0.0404 |

The pass counts are not an absolute quality verdict — this gate is strict
enough that `claude-sonnet-4-6` scored 2/3 and `claude-sonnet-5` 1/3 on the ko
subset, and the blog register fails for nearly every model. Only the relative
comparison is meaningful.

**Worst-case MPS is the deciding column.** deepseek-v4-flash is 10x cheaper
than gemini-3.6-flash and ties on pass count, but it dropped to MPS 15 on
`ko-blog-01` (most of the original meaning gone). gpt-5.3-chat-latest did the
same.

## Expanded run (2026-07-26): the 6-fixture read was wrong

Rerun on all 22 fixtures with `gpt-5.3-chat-latest` as the fixed judge
(calibrated AUC 0.99, independent of both engines). Two 6-fixture claims from
the section above did not survive:

| engine | pass | AI-score delta | MPS mean | MPS worst | fidelity mean | meaning-loss fixtures | $/rewrite |
|---|---|---:|---:|---:|---:|---:|---:|
| gemini-3.6-flash | 9/22 | **13.0** | 76.3 | 20 | 69.4 | **7** | **$0.030** |
| claude-sonnet-5 (Pro pin) | 8/22 | 11.8 | 73.1 | 20 | 65.2 | 10 | $0.156 |
| gpt-4.1-mini (free default) | 10/22 | **0.2** | 84.8 | 33.3 | 81.8 | 4 | $0.008 |

1. "gemini-3.6-flash never falls below MPS 80" was small-sample luck. On 22
   fixtures its worst case is 20 (`ko-instructional-01`), the same floor as
   sonnet-5. It still loses meaning on fewer fixtures (7 vs 10) and improves
   the AI score more (13.0 vs 11.8) at a fifth of the cost and a third of the
   latency, so the ranking holds — but on margin, not dominance.
2. `gpt-4.1-mini` topping the pass/MPS columns is an artifact, not a win. Its
   AI-score delta is **0.2**: it returns the input essentially unchanged, so it
   trivially preserves meaning while doing none of the product's work. Six of
   its 22 results carry `ai_not_improved`. **The free tier is currently serving
   no real rewrite.** Pass counts must always be read next to the AI delta.

Both frontier engines fail the same registers (blog, instructional, social,
product, marketing) while passing email, public-docs, chat, and academic. Two
independent frontier models failing identically points at the prompt or the
gate for those registers, not at the models — that is the larger lever behind
the ~40% pass rate, and it is untouched by any engine swap.

## Voided and re-run (2026-07-27)

Every number above is void. Two defects sat under it: a fidelity rubric that
charged removal of stylistic packaging as omitted claims, and a harness prompt
built without the persona, so rewrites were graded on meaning they were never
instructed to preserve. Both penalized whichever engine stripped hype hardest —
the behaviour the product exists for.

Rerun on the same 22 fixtures with both defects fixed, on subscription seats
(judge `gpt-5.5` via codex, candidates via their own seats, zero API spend):

| | gemini-3.6-flash | claude-sonnet-5 |
|---|---:|---:|
| pass | **20/22** (ko 11/11, en 9/11) | **20/22** (ko 11/11, en 9/11) |
| MPS mean | 90.4 | 91.5 |
| fidelity mean | 92.4 | 94.7 |
| $/rewrite | **$0.030** | $0.156 |
| s/rewrite | **8.3** | 27.7 |

**The two engines are level on quality.** Identical pass counts, and sonnet-5's
1.1-point MPS edge is inside one fixture of noise at n=22. The shipped choice
(gemini-3.6-flash on both tiers) holds, but the correct justification is not
"gemini rewrites better" — it is "quality is level, cost is 5x lower and
latency 3x lower".

`en-marketing-01` fails on both engines, which points at that fixture or the
prompt rather than at either model.

Cheaper candidates were rerun on the same fixed apparatus to see whether the
shipped engine could be undercut. It cannot, and the two failure modes are
mirror images:

| engine | pass | MPS mean | MPS worst | meaning-loss | not-improved | $/rewrite |
|---|---|---:|---:|---:|---:|---:|
| gemini-3.6-flash | **20/22** | 90.4 | 60 | 1 | 1 | $0.030 |
| claude-sonnet-5 | **20/22** | 91.5 | 50 | 2 | 0 | $0.156 |
| deepseek-v4-flash | 18/22 | 83.9 | **24** | 4 | 1 | $0.003 |
| gemini-3.5-flash-lite | 10/22 | 84.9 | 40 | 4 | **8** | $0.007 |

`deepseek-v4-flash` is ten times cheaper and still rewrites hard, but it gutted
`ko-news-01` to MPS 24 — roughly three quarters of a news item's content gone.
`gemini-3.5-flash-lite` fails the other way: eight fixtures carry
`ai_not_improved`, and four Korean ones score MPS 100 while the AI score
barely moves, meaning it returns the input nearly unchanged. That is the same
evasion `gpt-4.1-mini` showed and the reason its earlier apparent lead was an
artifact.

Holding both ends at once is the actual difficulty of this task, and
`gemini-3.6-flash` is the cheapest model measured that does it. Treat $0.030
per rewrite as the current floor rather than a number to shave.

Still unmeasured on the fixed apparatus: `gpt-4.1-mini`, `gpt-5.4-mini`,
`gpt-5.3-chat-latest`, `gpt-5.6-luna`, `grok-4.3`. The OpenAI-hosted ones are
blocked on an exhausted account balance, not on method. None of them is in
production, and given that both cheaper models failed in opposite directions,
none is a promising cost lever.

## Published rates gathered while comparing (per 1M tokens)

| model | input | cached input | output | training on input |
|---|---:|---:|---:|---|
| deepseek-v4-flash | $0.14 | $0.0028 | $0.28 | — |
| deepseek-v4-pro | $0.435 | $0.0036 | $0.87 | — |
| grok-4.3 | $1.25 | $0.20 | $2.50 | — |
| grok-4.5 | $2.00 | $0.30 | $6.00 | — |
| kimi-k2.6 | $0.95 | $0.16 | $4.00 | — |
| kimi-k3 | $3.00 | $0.30 | $15.00 | — |
| gemini-3.6-flash (paid) | $1.50 | $0.15 | $7.50 | no |
| gemini-3.6-flash (batch) | $0.75 | $0.075 | $3.75 | no |
| gemini-3.6-flash (free tier) | $0 | — | $0 | **yes** |
| claude-sonnet-5 | $3.00 | $0.30 | $15.00 | no |

The free Gemini tier trains on submitted content, so it cannot serve customer
text; the paid tier does not. Untested engines with a price advantage over
gemini-3.6-flash: `grok-4.3` ($0.024/rewrite) and `kimi-k2.6` ($0.019). GLM
and a per-token Qwen endpoint have no key in this environment.

## Order of operations this implies

1. Caching first. It is already implemented on both the buffered and streaming
   paths, costs nothing to enable, carries no quality risk, and is worth up to
   −74% once traffic clears ~3 requests/hour per language.
2. Engine comparison second, and on worst-case meaning preservation rather than
   headline pass counts.
3. Any Pro provider/model change goes through the frozen-default process; the
   contract allowlist (`PROVIDER_PRESETS`) currently offers neither
   `gemini-3.6-flash` nor `gpt-5.3-chat-latest`.
