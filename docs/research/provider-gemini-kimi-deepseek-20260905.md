**Gemini, Moonshot/Kimi and DeepSeek for Patina — 2026-09-05 KST**

Documentation supports a shortlist, not an experimental winner. The most useful
finding is a request mismatch: the registered Moonshot API candidates disable
thinking for K3 and K2.7 Code, although their current docs require thinking.
Sampling also needs review before a comparable API cohort can run. The native
Kimi Code cohort has separate access, defaults and accounting.

This review made no model calls, inventory probes or credential reads. It used
public documentation retrieved on September 5, 2026, and repository snapshot
`722d814925312c8859f1c6499860597d8ce41482`. The
JSON companion (not kept in the repository) recorded source
dates, direct-response hashes where available, exact candidate mappings and
evidence limits. Parent-owned studies and their private receipts were not read.

**Google Gemini.** Google's current pages list stable `gemini-3.8-flash`,
stable `gemini-3.7-flash`, and preview `gemini-3.1-pro-preview`. The 3.8 page
was updated September 2, 2026; the migration guide was updated September 3.
All three document 1,048,576 input tokens, 65,536 output tokens and structured
output. [G38] [G37] [GPRO] [GNEW]

| Official Developer API ID | Documented thinking levels | Default | Patina candidate |
| --- | --- | --- | --- |
| `gemini-3.8-flash` | low / medium / high; minimal errors | medium | `gemini-3.8-low`, `gemini-3.8-medium`, `gemini-3.8-high` |
| `gemini-3.7-flash` | low / medium / high; minimal errors | medium | `gemini-3.7` |
| `gemini-3.1-pro-preview` | low / medium / high | high | `gemini-pro` |

Thinking defaults above are provider documentation, not measured settings in
OpenCodex. The three 3.8 suffixes are route labels for an effort comparison,
not three official Developer API model IDs. The registered Pro route is
`google-antigravity/gemini-3.1-pro`; its name differs from the public preview
endpoint. Keep that distinction until the parent verifies response identity.
Google documents these families in Antigravity, but does not establish the
mapping of a local OpenCodex alias. [GTHINK] [GACCESS]

Every Gemini experiment must use **only**
`http://127.0.0.1:10100/v1` and the registered
`google-antigravity/gemini-*` route. No Gemini key, direct API call, or Gemini
CLI fallback is allowed by this study. Nothing in this research probed that
endpoint.

Google's 3.8 migration guide tells clients to remove `temperature`, `top_p`,
`top_k` and the old thinking-budget control. Use the documented thinking-level
control when the transport supports it; do not assume that a route suffix
proves the applied effort. The guide identifies low effort as suitable for
drafting and latency-sensitive tasks. That supports testing low against
medium/high, not declaring it the better writer or scorer. [GNEW]

| Standard paid Developer API pricing, USD / 1M tokens | Input | Cached input | Output, including thinking |
| --- | ---: | ---: | ---: |
| 3.8 Flash and 3.7 Flash, through December 31, 2026 | 0.75 | 0.075 | 3.75 |
| 3.8 Flash and 3.7 Flash, from January 1, 2027 | 1.50 | 0.15 | 7.50 |
| 3.1 Pro Preview, prompt ≤200k tokens | 2.00 | 0.20 | 12.00 |
| 3.1 Pro Preview, prompt >200k tokens | 4.00 | 0.40 | 18.00 |

Caching storage adds $0.50 per million token-hours for the Flash introductory
period, then $1.00; Pro lists $4.50. These are API list prices, **not the
cost of an OpenCodex request**. Antigravity has plan-dependent quotas and
optional paid-credit overages; the account's settings and charges were not
inspected. Keep actual cost unknown. The API pricing page also lists
`gemini-3.5-flash-lite` at $0.30 input/$2.50 output, but this protocol has no
admitted route for it. It is an untested economy option, not a substitute to
insert into a frozen run. [GPRICE] [GBILL]

**Moonshot API.** The documented current candidates are `kimi-k3`,
`kimi-k2.6`, `kimi-k2.7-code` and `kimi-k2.7-code-highspeed`, served through
the registered `https://api.moonshot.ai/v1` endpoint. K3 documentation requires
a successful top-up of at least $1; this worker did not check account funding.
Kimi membership and Kimi Code benefits do not fund this API. [KMODELS] [KK3]
[KPRODUCT]

| Official API ID | Context tokens | Reasoning / sampling contract |
| --- | ---: | --- |
| `kimi-k3` | 1,048,576 | Always thinks; top-level `reasoning_effort` low / high / max, default max; omit K2.x `thinking`; fixed temperature 1.0 |
| `kimi-k2.6` | 262,144 | Thinking on by default, can be disabled; fixed temperature 1.0 when on, 0.6 when off |
| `kimi-k2.7-code` | 262,144 | Thinking and preserved thinking always on; disabling thinking errors; fixed temperature 1.0 |
| `kimi-k2.7-code-highspeed` | 262,144 | Same constraints and model as K2.7 Code; different serving-speed option |

Kimi says to omit fixed sampling fields. K3 accepts
`max_completion_tokens`, default 131,072, with a parameter ceiling of
1,048,576; that ceiling does not create extra space beyond its context.
K3 and K2.7 require preserved assistant reasoning in multi-turn use. For this
text study, parse the final `message.content`, not `reasoning_content`.
Kimi documents JSON mode and structured output, with complex-schema limitations
on K2.6. These features are reasons to test scorer validity; they are not
evidence of calibration or reliable authorship detection. [KK3] [KPARAM]
[KJSON]

| Moonshot API pricing, USD / 1M tokens, excluding applicable tax | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| `kimi-k3` | 3.00 | 0.30 | 15.00 |
| `kimi-k2.6` | 0.95 | 0.16 | 4.00 |
| `kimi-k2.7-code` | 0.95 | 0.19 | 4.00 |
| `kimi-k2.7-code-highspeed` | 1.90 | 0.38 | 8.00 |

The pricing extracts lose some MDX table headers. The official platform's
pricing cards confirm the column meanings for K3, K2.7 Code and K2.6; the
HighSpeed row is from the K2.7 pricing table. No listed rate is assigned to
native Code usage. No advertised tokens-per-second figure is treated as a
Patina latency measurement. [KPRICE3] [KPRICE26] [KPRICE27] [KHOME]

The dated August 31, 2026 changelog says K2.5 and the Moonshot V1 family were
retired, even though the catalog still shows historical rows. Do not recommend
those rows as current fallbacks. [KCHANGE] [KMODELS]

**Native Kimi Code.** Its official coding-service IDs are `k3`,
`k3-256k`, `kimi-for-coding`, and `kimi-for-coding-highspeed`. Patina's
`kimi-code/` prefix is a local profile namespace. The provider maps the first
pair to K3 and the second pair to K2.7 Code; that documented family mapping
does not disclose a particular study call's server revision. [KACCESS]

| Patina native candidate | Selected profile | Documented service limits |
| --- | --- | --- |
| `kimi-code-k3` | `kimi-code/k3` | Moderato+: 256K; Allegretto+: up to 1M |
| `kimi-code-k3-256k` | `kimi-code/k3-256k` | Moderato+: 256K |
| `kimi-code-standard` | `kimi-code/kimi-for-coding` | All members: 256K |
| `kimi-code-highspeed` | `kimi-code/kimi-for-coding-highspeed` | Allegretto+: 256K |

Code documents K3's default effort as **high**, versus **max** for Moonshot
API. Its docs say K3 1M uses about twice the quota of K3-256k and HighSpeed
uses three times standard quota. These are provider quota claims, not measured
costs. The same docs warn that disabling thinking on K3/K2.7 routes to K2.6,
and a mistyped HighSpeed ID can fall back to standard. No such fallback was
observed here. Keep effort and server identity unverified where the collector
does not establish them. [KCODE] [KPARAM]

Code shares membership quota: weekly renewal, a rolling five-hour window and
a monthly cap. Optional Extra Usage has its own paid balance; it is not a
Moonshot API balance. Neither subscription pricing nor advertised speed can
be converted into a per-request charge without account-specific evidence.
Provider documentation describes Code as a programming service and directs
own-product integrations to Kimi Platform. Native experimental access therefore
does not establish a hosted Patina serving plan. [KBILL] [KACCESS] [KPRODUCT]

**DeepSeek.** Current docs name `deepseek-v4-flash` as
DeepSeek-V4-Flash-0731 and `deepseek-v4-pro` as DeepSeek-V4-Pro-0813.
The corresponding updates are dated July 31 and August 13, 2026.
Both document 1M context, up to 384K output and JSON output. These are
provider labels and limits, not response identities measured in this review.
The August 21 vision experimental release is outside the text-only protocol.
[DPRICE] [DCHANGE]

Thinking defaults to enabled/high. The Chat Completions toggle is
`thinking.type: enabled|disabled`; native effort levels are low/high/max.
Requested medium and xhigh map to high. Temperature and related sampling
controls have no effect in thinking mode. The registered Flash/Pro candidates
explicitly disable thinking, which is documented. A reasoning comparison would
need a new explicit cohort. [DTHINK]

| DeepSeek API pricing, USD / 1M tokens | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| V4 Flash, off-peak | 0.22 | 0.007 | 0.66 |
| V4 Flash, peak | 0.44 | 0.014 | 1.32 |
| V4 Pro, off-peak | 0.66 | 0.022 | 1.98 |
| V4 Pro, peak | 1.32 | 0.044 | 3.96 |

The schedule took effect August 16, 2026 at 16:00 UTC. Peak hours are
Monday–Friday 01:00–04:00 and 06:00–10:00 UTC; all other hours are off-peak.
Charges draw on granted or topped-up balances. An estimate needs actual input,
cache and output usage plus the applicable time window. Legacy
`deepseek-chat`/`deepseek-reasoner` names had a documented July 24, 2026
discontinuation date; they are not recommended replacements. [DPRICE] [DCHANGE]

**Repository implications.** The
[original protocol](model-evaluation-20260904.json) and
[native Kimi Code protocol](model-evaluation-kimi-code-20260905.json) remain
unchanged. The JSON companion maps all 15 in-scope candidate entries to the
relevant documentation.

| Static finding | Evidence in this snapshot | Parent-owned next step |
| --- | --- | --- |
| Unsupported Moonshot thinking settings | `kimi-k3`, `kimi-code`, `kimi-code-fast` all set disabled | Register corrected requests in a new cohort; retain earlier errors |
| Requested temperature is not a universal control | `src/api.js` assigns temperature after `extraBody`; rewrite uses 0.2, scorer normally 0.1 then 0 on schema retry | Review omission and effective-setting metadata; `extraBody` alone cannot remove it |
| Native effort is not pinned | `kimi-study-transport.mjs` and `src/backends/kimi-cli.js` select a profile without setting or verifying effort | Report it as unverified; preserve source/cohort boundaries |
| Catalog identity is not response identity | Native trace parser establishes selected profile; Gemini routes differ from official IDs | Parent audits receipts before assigning model-specific outcomes |

The HTTP client's existing temperature fallback only recognizes certain 400
unsupported/deprecated messages. It does not prove that Kimi's fixed-value
errors will recover, nor that a proxy honored the requested temperature. A
compatibility failure is a request/transport result, not a model-quality score.

The parent reports three blockers as of September 5, 2026 KST: native Kimi
Code's five-hour quota is exhausted; the original highspeed scorer has a
partial transport failure; DeepSeek funded API input is missing. This worker
did not check reset times, balances or receipts. Keep the original highspeed
failure attached to its parent-audited cohort, and do not transfer it to the
separate native cohort. Kimi's error reference distinguishes quota exhaustion,
request errors and overload; those categories require different handling.
[KERROR]

The documentation-based shortlist is Gemini 3.8 effort variants against
3.7/Pro controls, Kimi K3 against K2.6 and the Code serving variants, and
DeepSeek V4 Flash against Pro. Native K3-256k is worth retaining as a quota
comparison for short text. These are experiment choices. No source establishes
Patina's best writer, best scorer, per-language quality, human preference or
actual operating cost. Final selection remains dependent on the registered
repeats, validated scorer outputs, preserved semantic anchors and independent
cross-family rewrite judgments.

All public source links below were retrieved September 5, 2026. Google and
DeepSeek facts use direct public-page fetches: initial cached extracts were
stale, and DeepSeek's non-trailing-slash pricing route returned a different
page. Some Kimi platform origin requests returned 403, so those sources use
Exa's extraction of the primary pages; their crawl freshness cannot be proved
from the extraction. The JSON records that limitation. No authenticated
provider endpoint was requested.

[G38]: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash "Gemini 3.8 Flash; retrieved 2026-09-05; page date 2026-09-02"
[G37]: https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash "Gemini 3.7 Flash; retrieved 2026-09-05; page date 2026-08-13"
[GPRO]: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview "Gemini 3.1 Pro Preview; retrieved 2026-09-05; page date 2026-08-18"
[GTHINK]: https://ai.google.dev/gemini-api/docs/thinking "Gemini thinking; retrieved 2026-09-05; page date 2026-09-04"
[GNEW]: https://ai.google.dev/gemini-api/docs/latest-model "What's new in Gemini 3.8 Flash; retrieved 2026-09-05; page date 2026-09-03"
[GPRICE]: https://ai.google.dev/gemini-api/docs/pricing "Gemini Developer API pricing; retrieved 2026-09-05"
[GACCESS]: https://antigravity.google/docs/models/ "Antigravity models; retrieved 2026-09-05"
[GBILL]: https://antigravity.google/docs/plans "Antigravity plans; retrieved 2026-09-05"
[KMODELS]: https://platform.kimi.ai/docs/models.md "Kimi API model list; retrieved 2026-09-05"
[KPARAM]: https://platform.kimi.ai/docs/api/models-overview.md "Kimi model parameter reference; retrieved 2026-09-05"
[KK3]: https://platform.kimi.ai/docs/guide/kimi-k3-quickstart.md "Kimi K3 quickstart; retrieved 2026-09-05"
[KJSON]: https://platform.kimi.ai/docs/guide/response_format.md "Kimi structured output; retrieved 2026-09-05"
[KPRICE3]: https://platform.kimi.ai/docs/pricing/chat-k3.md "Kimi K3 API pricing; retrieved 2026-09-05"
[KPRICE27]: https://platform.kimi.ai/docs/pricing/chat-k27-code.md "Kimi K2.7 Code API pricing; retrieved 2026-09-05"
[KPRICE26]: https://platform.kimi.ai/docs/pricing/chat-k26.md "Kimi K2.6 API pricing; retrieved 2026-09-05"
[KHOME]: https://platform.kimi.ai/ "Kimi API platform pricing cards; retrieved 2026-09-05"
[KPRODUCT]: https://platform.kimi.ai/docs/guide/product-plans.md "Compare Kimi products; retrieved 2026-09-05"
[KCHANGE]: https://platform.kimi.ai/docs/platform-changelog.md "Kimi platform changelog; retrieved 2026-09-05; page date 2026-08-31"
[KCODE]: https://www.kimi.com/code/docs/en/kimi-code/models.html "Kimi Code model configuration; retrieved 2026-09-05"
[KACCESS]: https://www.kimi.com/code/docs/en/ "Kimi Code overview and access; retrieved 2026-09-05"
[KBILL]: https://www.kimi.com/code/docs/en/kimi-code/membership.html "Kimi Code membership benefits; retrieved 2026-09-05"
[KERROR]: https://www.kimi.com/code/docs/en/kimi-code/error-reference.html "Kimi Code error reference; retrieved 2026-09-05"
[DPRICE]: https://api-docs.deepseek.com/quick_start/pricing/ "DeepSeek models and pricing; retrieved 2026-09-05"
[DTHINK]: https://api-docs.deepseek.com/guides/thinking_mode/ "DeepSeek thinking mode; retrieved 2026-09-05"
[DCHANGE]: https://api-docs.deepseek.com/updates/ "DeepSeek change log; retrieved 2026-09-05; page date 2026-08-21"
