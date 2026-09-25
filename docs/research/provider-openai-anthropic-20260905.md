# OpenAI and Anthropic provider research — 2026-09-05

Verified on **September 5, 2026 (Asia/Seoul)**. This report covers public documentation for Patina rewrite, audit, and model-assisted scoring. It contains no new model calls, experimental ranking, human ratings, private inputs, or usage receipts. The matching JSON record (not kept in the repository) listed sources, prices, capabilities, and each manifest mapping.

The fetched sources document GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, Claude Fable 5.1, Opus 5, Sonnet 5, and Haiku 4.5. GPT-5.5, GPT-5.4 Mini, and Sonnet 4.6 remain in this comparison because the existing studies name them. This is a scoped inventory, not proof of exhaustive vendor or account coverage. [O-CATALOG], [O-ASTRA], [O-SOL], [O-TERRA], [O-LUNA], [A-CATALOG], [A-FABLE]; local manifests M and I below.

**Retrieval evidence and conflicts**

Official pages were read as full page bodies or official Markdown, not accepted from search snippets. The six OpenAI model-card Markdown GETs returned HTTP 200. A direct local GET of the Claude overview returned HTTP 403; the public web tool could read Claude documentation. No authentication or WAF bypass was used. The JSON records methods and retrieval dates, and leaves origin HTTP status unknown when the web tool did not expose it.

Two extraction paths returned different versions of official content. Exa's OpenAI overview still introduced GPT-5.5, while the web tool and individual cards exposed Astra/5.6. Exa's older Claude overview named Fable 5 and a future Sonnet price increase. The current Fable 5.1 card identifies `claude-fable-5-1`, released **September 1, 2026**. That establishes a public vendor ID independently of the earlier CLI observations. [O-CATALOG], [O-ASTRA], [A-FABLE], [A-CODE-MODEL]

The current pricing paragraph says the Sonnet 5 increase planned for **September 1, 2026** was canceled: **$2 input / $10 output per million tokens are standard rates**. The specific Sonnet card agrees. The Exa pricing extraction still contained the old $3/$15 schedule. For Fable 5.1, use its specific **$0.25 cache-read** rate rather than a generic 10%-of-input rule. These conflicts remain in the JSON; no later tariff or account bill is inferred. [A-PRICING], [A-SONNET], [A-FABLE]

**Documented text capabilities and effort**

Context/output columns are token limits, not expected response lengths or equivalent word counts across languages. All listed OpenAI cards support text/image input, text output, streaming, Structured Outputs, Responses, and Chat Completions. That makes them plausible text-processing candidates, but a vendor capability does not prove that OpenCodex passes the corresponding parameter through. [O-ASTRA], [O-SOL], [O-TERRA], [O-LUNA], [O-55], [O-MINI]

| OpenAI public ID | Supported reasoning effort | API default | Context / max output | Evidence |
| --- | --- | --- | --- | --- |
| `gpt-6-astra` | `low`, `medium`, `high`, `xhigh`, `max` | Unverified | 1,050,000 / 128,000 | [O-ASTRA] |
| `gpt-5.6-sol` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | medium | 1,050,000 / 128,000 | [O-SOL] |
| `gpt-5.6-terra` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | medium | 1,050,000 / 128,000 | [O-TERRA] |
| `gpt-5.6-luna` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | medium | 1,050,000 / 128,000 | [O-LUNA] |
| `gpt-5.5` | `none`, `low`, `medium`, `high`, `xhigh` | medium | 1,050,000 / 128,000 | [O-55] |
| `gpt-5.4-mini` | `none`, `low`, `medium`, `high`, `xhigh` | none | 400,000 / 128,000 | [O-MINI] |

Use `reasoning.effort` in Responses and `reasoning_effort` in Chat Completions. Astra rejects `none`; its tool calling requires Responses, and its guidance excludes `temperature`, `top_p`, and logprob controls. The table leaves Astra's default unresolved rather than importing a default from another family. The `gpt-5.6` alias maps to Sol; it does not name Terra or Luna. GPT-5.5 and Mini document dated snapshots, which are retained in the JSON. [O-GUIDE], [O-REASONING], [O-SOL], [O-55], [O-MINI]

The listed Claude models accept text/images and produce text. The Claude API uses Messages. Its Structured Outputs page lists these families, including Fable 5.1 and Haiku 4.5; use the schema contract for the selected route rather than assuming CLI JSON is the same API feature. [A-CATALOG], [A-STRUCTURED]

| Claude public ID | Supported API effort | API default | Context / synchronous max output | Evidence |
| --- | --- | --- | --- | --- |
| `claude-fable-5-1` | `low`, `medium`, `high`, `xhigh`, `max` | high | 1,000,000 / 128,000 | [A-FABLE], [A-EFFORT] |
| `claude-opus-5` | `low`, `medium`, `high`, `xhigh`, `max` | high | 1,000,000 / 128,000 | [A-OPUS], [A-EFFORT] |
| `claude-sonnet-5` | `low`, `medium`, `high`, `xhigh`, `max` | high | 1,000,000 / 128,000 | [A-SONNET], [A-EFFORT] |
| `claude-sonnet-4-6` | `low`, `medium`, `high`, `max` | high | 1,000,000 / 128,000 | [A-46], [A-EFFORT] |
| `claude-haiku-4-5-20251001` | No effort parameter | — | 200,000 / 64,000 | [A-CATALOG], [A-EFFORT] |

Claude effort uses `output_config.effort`. It is separate from the thinking mode and is not a fixed token budget. Fable 5.1 always uses adaptive thinking. Opus 5 and Sonnet 5 enable adaptive thinking by default; Opus rejects disabled thinking at `xhigh`/`max`. Sonnet 5 rejects manual extended thinking and non-default sampling settings. Sonnet 4.6 retains manual thinking as a deprecated option; Haiku uses a manual thinking budget without effort or adaptive thinking. [A-EFFORT], [A-FABLE], [A-OPUS], [A-SONNET], [A-46], [A-THINKING]

The model pages describe Fable, Opus, Sonnet, and Haiku as different capability/latency choices. Those are vendor descriptions, not Patina results. Sonnet 4.6 is a legacy control, with its card promising no retirement before **February 17, 2027**. Public API listings do not establish account entitlement or native CLI availability. Invitation-only Mythos and other catalog entries are outside this comparison. [A-CATALOG], [A-FABLE], [A-46]

**API prices and billing boundaries**

All numbers below are **USD per one million text tokens**, standard direct API rates. OpenAI rows use the short-context base tier; Claude rows use default/global inference. They exclude subscription allocation, credits, tax, separately priced tools, and actual study charges. A dash means this report has no distinct cache-write tariff for that row.

| OpenAI ID | Input | Cache read | Cache write | Output | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| `gpt-6-astra` | 10 | 1 | 12.5 | 50 | [O-ASTRA] |
| `gpt-5.6-sol` | 4 | 0.4 | 5 | 20 | [O-SOL] |
| `gpt-5.6-terra` | 2 | 0.2 | 2.5 | 12 | [O-TERRA] |
| `gpt-5.6-luna` | 0.2 | 0.02 | 0.25 | 1.2 | [O-LUNA] |
| `gpt-5.5` | 5 | 0.5 | — | 30 | [O-55] |
| `gpt-5.4-mini` | 0.75 | 0.075 | — | 4.5 | [O-MINI] |

Sol's published promotional price lasts at least through **November 21, 2026**; later rates are unknown. The 5.6 cache-write figures above are arithmetic from the documented 1.25× input rate. Astra and 5.6 requests above 272K input tokens have input/output premiums; Astra also explicitly doubles cache rates. GPT-5.5 describes its long-context premium over the full session. Astra documents half-price Batch/Flex and a 2× Fast multiplier. Regional processing adds 10% for the listed GPT-5.5 and Mini rates. [O-SOL], [O-TERRA], [O-LUNA], [O-ASTRA], [O-55], [O-MINI]

| Claude ID | Input | Cache read | Cache write: 5m / 1h | Output | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| `claude-fable-5-1` | 10 | 0.25 | 12.5 / 20 | 50 | [A-FABLE], [A-PRICING] |
| `claude-opus-5` | 5 | 0.5 | 6.25 / 10 | 25 | [A-OPUS], [A-PRICING] |
| `claude-sonnet-5` | 2 | 0.2 | 2.5 / 4 | 10 | [A-SONNET], [A-PRICING] |
| `claude-sonnet-4-6` | 3 | 0.3 | 3.75 / 6 | 15 | [A-46], [A-PRICING] |
| `claude-haiku-4-5-20251001` | 1 | 0.1 | 1.25 / 2 | 5 | [A-CATALOG], [A-PRICING] |

Claude's listed 1M-context models have no long-context token-price premium. Batch processing discounts input/output by 50%; cache writes and reads remain distinct usage categories. Fable 5.1's cache-read rate is a model-specific exception to older generic cache guidance. Keep the actual provider's current pricing modifiers when estimating a future API deployment. [A-PRICING], [A-FABLE]

Both providers bill reasoning/thinking tokens as output even when their full text is not visible. A short rewrite can therefore consume more billable output than the returned prose. OpenAI pro mode also aggregates additional model work at the selected model's token rates. No request or monthly cost is calculated here. [O-REASONING], [A-THINKING]

Native CLI billing must be recorded separately. Codex documents subscription/credit access and API-key token billing as different paths. A retrieved Claude Code model-configuration source states that Fable uses usage credits even inside a subscription's allowance. Independent verification of that statement was inconclusive because direct retrieval returned 403; treat it as unverified and do not infer this account's balance or charge. Its costs guide also documents background token use. An auxiliary model entry cannot, by itself, identify the model that wrote the answer. Preserve primary response identity, auxiliary usage, and actual billing evidence as separate fields in the parent study. [O-CODEX], [A-CODE-MODEL], [A-CODE-COST]

**Mapping to committed studies**

M = [model-evaluation-20260904.json](model-evaluation-20260904.json).
I = [model-evaluation-claude-isolated-20260905.json](model-evaluation-claude-isolated-20260905.json).

Every public ID below matches the requested model string exactly. The JSON includes the manifest SHA-256, JSON pointer, candidate ID, requested effort, and public source IDs. These are **configuration-to-catalog matches**, not newly checked model responses. The prior study notes report CLI canary/model-usage observations; this worker did not inspect or reproduce raw receipts.

| Verified public ID | Study candidate | Recorded route | Manifest pointer (requested effort) |
| --- | --- | --- | --- |
| `gpt-6-astra` | `openai-astra` | opencodex | M `/candidates/0` (low) |
| `gpt-5.6-sol` | `openai-sol` | opencodex | M `/candidates/1` (low) |
| `gpt-5.6-terra` | `openai-terra` | opencodex | M `/candidates/2` (low) |
| `gpt-5.6-luna` | `openai-luna` | opencodex | M `/candidates/3` (low) |
| `gpt-5.5` | `openai-5.5` | opencodex | M `/candidates/4` (low); I `/candidates/5` (low) |
| `gpt-5.4-mini` | `openai-mini` | opencodex | M `/candidates/5` (low) |
| `claude-fable-5-1` | `anthropic-fable` | claude-cli | I `/candidates/0` (high) |
| `claude-opus-5` | `anthropic-opus` | claude-cli | M `/candidates/11` (omitted); I `/candidates/1` (high) |
| `claude-sonnet-5` | `anthropic-sonnet` | claude-cli | M `/candidates/12` (omitted); I `/candidates/2` (high) |
| `claude-sonnet-4-6` | `anthropic-sonnet4.6` | claude-cli | M `/candidates/13` (omitted); I `/candidates/3` (high) |
| `claude-haiku-4-5-20251001` | `anthropic-haiku` | claude-cli | M `/candidates/14` (omitted); I `/candidates/4` (omitted) |

M requests `low` for each OpenAI route. I requests `high` for Fable 5.1, Opus 5, Sonnet 5, and Sonnet 4.6. Omitted effort stays unknown at runtime; API defaults do not prove a CLI's effective setting. The isolated manifest records Claude Code 2.1.261. Current public CLI documentation can describe a newer feature set, so matching documentation does not establish passthrough on that installed version. Sources: M, I, [A-CODE-MODEL].

**Shortlist for the parent study — hypotheses, not a ranking**

| Purpose | Candidates | Reason to include; evidence still needed |
| --- | --- | --- |
| Quality-sensitive rewrite and audit | Astra, Sol, Fable 5.1, Opus 5, Sonnet 5 | Vendor capability positioning warrants comparison. Measure claim/number/polarity/causation preservation and naturalness separately for KO/EN/ZH/JA. [O-ASTRA], [O-SOL], [A-FABLE], [A-OPUS], [A-SONNET] |
| Latency and operating cost | Terra, Luna, Mini, Sonnet 5, Haiku 4.5 | Published positioning and tariffs justify a speed/cost lane. Lower tariff is neither measured latency nor lower subscription cash spend. [O-TERRA], [O-LUNA], [O-MINI], [A-CATALOG], [A-SONNET] |
| Model-assisted score reliability | Astra/Sol and Opus 5/Sonnet 5 as separately identified judge candidates | Structured output aids parsing. It does not establish semantic correctness, calibrated scores, or agreement with humans. [O-STRUCTURED], [A-STRUCTURED] |

Keep the existing low/high settings as controls. Further effort sweeps should use only admitted route settings on the same inputs; compare higher effort only where its measured benefit matters. Astra has no `none`, Fable cannot disable thinking, and Haiku has no effort knob. The parent owns those runs. [O-ASTRA], [A-FABLE], [A-EFFORT]

For scoring, proposed acceptance checks are schema validity, refusal/truncation handling, repeated-run stability, and agreement with authorized labels where such labels actually exist. Missing human labels remain missing. Validate score ranges in application code as well as checking the JSON shape. Keep deterministic Patina signals separate from model-judged scores. This is a validation proposal, not a claim that any candidate passed it. [O-STRUCTURED], [A-STRUCTURED]; repository AGENTS.md.

**Limits and handoff**

Account access, effective response identity/effort, route capability, latency, token usage, actual billing, and Patina quality remain for the parent study. No best-model ranking follows from this source review. Direct local Claude retrieval still returned 403; the readable official-page evidence and stale extraction differences are retained. Only this Markdown file and its JSON companion are changed.

**Source ledger**

Every entry was retrieved on **2026-09-05**. The JSON adds retrieval method, locator, and short excerpts; excerpts are not duplicated here. Specific model cards and the current pricing paragraph take precedence over the conflicting older extractions described above.

- **O-CATALOG** — [OpenAI model catalog](https://developers.openai.com/api/docs/models); Choosing a model; Frontier models.
- **O-ASTRA** — [GPT-6 Astra model card](https://developers.openai.com/api/docs/models/gpt-6-astra.md); Model details; Pricing; Endpoints; Supported features.
- **O-SOL** — [GPT-5.6 Sol model card](https://developers.openai.com/api/docs/models/gpt-5.6-sol.md); Model details; Pricing; Endpoints; Supported features.
- **O-TERRA** — [GPT-5.6 Terra model card](https://developers.openai.com/api/docs/models/gpt-5.6-terra.md); Model details; Pricing; Endpoints; Supported features.
- **O-LUNA** — [GPT-5.6 Luna model card](https://developers.openai.com/api/docs/models/gpt-5.6-luna.md); Model details; Pricing; Endpoints; Supported features.
- **O-55** — [GPT-5.5 model card](https://developers.openai.com/api/docs/models/gpt-5.5.md); Model details; Pricing; Endpoints; Snapshots.
- **O-MINI** — [GPT-5.4 Mini model card](https://developers.openai.com/api/docs/models/gpt-5.4-mini.md); Model details; Pricing; Endpoints; Snapshots.
- **O-GUIDE** — [GPT-6 Astra model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra); Reasoning effort; API compatibility; Pro mode.
- **O-REASONING** — [OpenAI reasoning models](https://developers.openai.com/api/docs/guides/reasoning); How reasoning works; Allocating space for reasoning.
- **O-STRUCTURED** — [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs); How to use; Supported schemas; Refusals.
- **O-CODEX** — [Codex pricing](https://developers.openai.com/codex/pricing/); Plans; API key; Usage limits.
- **A-CATALOG** — [Claude models overview](https://platform.claude.com/docs/en/models/overview); Latest models comparison; Legacy models; Model IDs.
- **A-FABLE** — [Claude Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview); Model details; Availability; Thinking.
- **A-OPUS** — [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview); Model details; Thinking; Pricing.
- **A-SONNET** — [Claude Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/overview); Model details; Pricing; Thinking.
- **A-46** — [Claude Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview); Pricing and availability; Thinking.
- **A-PRICING** — [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing); Model pricing; Batch processing; Long context pricing.
- **A-EFFORT** — [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort); Supported models; Effort levels; Model defaults.
- **A-THINKING** — [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/thinking); Per-model support; Billing.
- **A-STRUCTURED** — [Claude Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs); Availability; JSON outputs; Limitations.
- **A-CODE-COST** — [Claude Code costs](https://code.claude.com/docs/en/costs); Track usage; Background token usage.
- **A-CODE-MODEL** — [Claude Code model configuration](https://code.claude.com/docs/en/model-config); Fable pricing and usage; Effort levels; Model availability.

[O-CATALOG]: https://developers.openai.com/api/docs/models
[O-ASTRA]: https://developers.openai.com/api/docs/models/gpt-6-astra.md
[O-SOL]: https://developers.openai.com/api/docs/models/gpt-5.6-sol.md
[O-TERRA]: https://developers.openai.com/api/docs/models/gpt-5.6-terra.md
[O-LUNA]: https://developers.openai.com/api/docs/models/gpt-5.6-luna.md
[O-55]: https://developers.openai.com/api/docs/models/gpt-5.5.md
[O-MINI]: https://developers.openai.com/api/docs/models/gpt-5.4-mini.md
[O-GUIDE]: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra
[O-REASONING]: https://developers.openai.com/api/docs/guides/reasoning
[O-STRUCTURED]: https://developers.openai.com/api/docs/guides/structured-outputs
[O-CODEX]: https://developers.openai.com/codex/pricing/
[A-CATALOG]: https://platform.claude.com/docs/en/models/overview
[A-FABLE]: https://platform.claude.com/docs/en/models/fable-5-1/overview
[A-OPUS]: https://platform.claude.com/docs/en/models/opus-5/overview
[A-SONNET]: https://platform.claude.com/docs/en/models/sonnet-5/overview
[A-46]: https://platform.claude.com/docs/en/models/sonnet-4-6/overview
[A-PRICING]: https://platform.claude.com/docs/en/about-claude/pricing
[A-EFFORT]: https://platform.claude.com/docs/en/build-with-claude/effort
[A-THINKING]: https://platform.claude.com/docs/en/build-with-claude/thinking
[A-STRUCTURED]: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
[A-CODE-COST]: https://code.claude.com/docs/en/costs
[A-CODE-MODEL]: https://code.claude.com/docs/en/model-config
