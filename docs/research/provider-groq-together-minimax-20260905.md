# Groq, Together and MiniMax: hosted-model research

Checked **September 5, 2026 (Asia/Seoul)**. Access and funded inputs for all three providers are missing per the assignment. No credentials were inspected; no model endpoint, live study, or paid call was run. This report supplies candidates for a later parent-owned admission process. It contains no experimental ranking or winner.

Repository evidence is from `722d814925312c8859f1c6499860597d8ce41482`. The assigned worktree has no physical AGENTS.md; the supplied instructions and the main worktree's AGENTS.md were read, along with G1 context. The scope stays with hosted text-model selection and the path to a viable paid product. Runtime, shared branches, and active study worktrees were left untouched.

The matching JSON record (not kept in the repository) stored source dates, exact IDs, proposed settings, limits, conflicts, and admission requirements. Its top-level `candidates` is deliberately empty. The existing harness does not enforce an arbitrary `admissionStatus` field; putting blocked rows in that executable list would be misleading. Candidate descriptions live under `documentedCandidates`.

**Catalog shortlist**

Groq and Together are inference hosts. OpenAI, Qwen, GLM, DeepSeek and MiniMax are upstream model families in this shortlist. Direct MiniMax is both model developer and host. A family name, a host-prefixed API identifier, and a local subscription profile are separate identities. In particular, `MiniMax-M3` and `MiniMaxAI/MiniMax-M3` use different hosts and do not establish identical serving settings. [G1], [T1], [M3]

Prices below are published USD per million input/output tokens for online inference. They are not measured Patina costs. Context/output columns report host documentation; “Unspecified” means no supported maximum was established from the reviewed sources. Exact identifiers and model limits must be rechecked at admission.

| Host | Provider-specific model ID | Upstream family | Input / output | Context / max output tokens | Catalog status | Evidence |
|---|---|---|---:|---:|---|---|
| groq | `qwen/qwen3.8-27b` | qwen | $0.80 / $4.00 | 131,042 / 16,384 | preview | [G1], [G4] |
| groq | `openai/gpt-oss-120b` | openai | $0.15 / $0.60 | 131,072 / 65,536 | production | [G1] |
| groq | `openai/gpt-oss-20b` | openai | $0.075 / $0.30 | 131,072 / 65,536 | production | [G1] |
| together | `Qwen/Qwen3.5-9B` | qwen | $0.17 / $0.25 | 262,144 / Unspecified | serverless | [T1] |
| together | `zai-org/GLM-5.3-Flash` | glm | $0.15 / $0.50 | 1,048,575 / Unspecified | serverless | [T1] |
| together | `deepseek-ai/DeepSeek-V4-Flash-0731` | deepseek | $0.14 / $0.28 | 1,048,576 / Unspecified | serverless | [T1] |
| together | `MiniMaxAI/MiniMax-M3` | minimax | $0.30 / $1.20 | 524,288 / Unspecified | serverless | [T1] |
| together | `Qwen/Qwen3.8-Flash` | qwen | $0.15 / $0.47 | 1,000,000 / Unspecified | serverless | [T1] |
| minimax | `MiniMax-M3` | minimax | $0.30 / $1.20 | 1,000,000 / Unspecified | current | [M1], [M2], [M3] |
| minimax | `MiniMax-M2.7` | minimax | $0.30 / $1.20 | 204,800 / Unspecified | current | [M1], [M2], [M3] |
| minimax | `MiniMax-M2.7-highspeed` | minimax | $0.60 / $2.40 | 204,800 / Unspecified | current | [M1], [M2], [M3] |

The first proposals target inexpensive baselines and a small set of useful controls. For Together, begin with Qwen3.5-9B, GLM-5.3-Flash and DeepSeek-V4-Flash-0731; add M3 for a host comparison and Qwen3.8-Flash after its undocumented schema behavior is checked. For direct MiniMax, screen M3 and use M2.7/highspeed as controls. Groq's production GPT-OSS rows need the judge-family fix described below; Qwen3.8 is a preview candidate. These are experiment-order judgments, not quality findings.

Qwen3.5-9B's Together model page claims 201 languages; Groq describes Qwen3.8 as multilingual. Those statements justify language checks but do not validate Korean, English, Chinese and Japanese rewrite fidelity. MiniMax's “multilingual programming” claims concern code. None of these sources establishes Patina's four-language naturalness, audit accuracy, or score calibration. [T7], [G4], [M5]

**Host limits, prices and access**

Groq's catalog publishes Developer Plan limits of 1,000 RPM and 250,000 TPM for the three shortlisted rows. Limits are organizational and the account's actual plan remains unknown. The tabbed rate-limit page exposes lower values near both Free/Developer labels in text extraction; this report does not assign those values to a plan. Groq's pricing URL redirected to its homepage without a price table, so catalog and model pages supply the token prices. [G1], [G3], [G7]

Groq marks `llama-3.3-70b-versatile`, the local default, as Enterprise / Contact Sales. Its hosted MiniMax M2.7 row is Enterprise preview. Qwen3.8's documented context is exactly 131,042 tokens; this report does not round it to 131,072. [G1], [G4]

Together uses dynamic organization/model rate limits; a universal RPM/TPM number would be unsupported. Its docs distinguish rate-limit 429 responses from capacity 503 responses and describe `x-ratelimit-reset` in seconds. The current catalog omits the local default `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free`. It does list free `Prism-ML/Ternary-Bonsai-27B`; account eligibility and suitability remain unknown. The old preset's free-tier note is therefore not admission evidence. [T1], [T4]

Together lists Qwen3.5-9B and GLM-5.3-Flash as FP8, and DeepSeek-V4-Flash-0731 and MiniMax-M3 as FP4. A host comparison must preserve those disclosures. Catalog cache-read rates for those latter three models are $0.03, $0.03 and $0.06 respectively; Qwen3.5-9B and Qwen3.8-Flash have no catalog cache price. A dash is unknown support/pricing, never zero cost. [T1]

Direct MiniMax publishes M3 limits of 200 RPM / 10,000,000 TPM and M2.7-family limits of 500 RPM / 20,000,000 TPM, subject to model/interface/account. Standard M3 pricing shown after the advertised discount is $0.30/$1.20 with $0.06 cache reads at inputs up to 512k; above 512k it is $0.60/$2.40 with $0.12 cache reads. Priority costs 1.5 times standard. M2.7/highspeed cache reads cost $0.06 and cache writes $0.375. The pay-as-you-go API balance is separate from Subscription Key plans. No plan or balance was inspected. [M2], [M4]

For cost planning, sum each attempt's billed uncached input, cached input, cache writes and output at the applicable rates, then add judge calls and any other documented charges. Provider tokenization and reasoning usage matter. Hidden reasoning does not imply free reasoning; cached tokens do not imply the same discount across hosts. Missing attempt usage stays unknown. [M2], [T2], [T3], [T5]

**Unresolved source differences**

| Claim | Observed sources | Admission treatment |
|---|---|---|
| Together Qwen3.7-Max prices | Catalog input/output/cache: $2.50/$7.50/$0.50; pricing page: $1.25/$3.75/$0.13. [T1], [T2] | Pricing page includes a Batch API price control whose rendered state is unclear. Confirm billing mode and quote; do not average the values. |
| Together Qwen3.8-2.4T cache price | Catalog $0.50; pricing page $0.25. Both show $2/$6 uncached input/output. [T1], [T2] | Resolve before budgeting this reserve candidate. |
| Together MiniMax-M3 context | Catalog 524,288; model page 1M; direct MiniMax documents 1,000,000. [T1], [T8], [M3] | Plan against 524,288 on Together until resolved; direct-host limits do not override it. |
| Groq strict JSON support | Detailed support list includes Qwen3.8; later comparison summary mentions only GPT-OSS. [G6] | Preserve the detailed claim and require a real schema canary. |
| Together endpoint | Compatibility page uses `api.together.ai/v1`; the local preset and Qwen model example use `api.together.xyz/v1`. [T3], [T7] | Propose the documented `.ai` endpoint for the new cohort; aliases were not probed. |
| Together GLM effort | Model page gives low/high/max; generic compatibility guidance is narrower. [T3], [T5], [T9] | Leave provider default in the initial proposed profile; verify before forcing effort. |

**Proposed request profiles**

All rows remain blocked. The JSON's `proposedExtraBody` becomes `extraBody` only in a separately admitted manifest. The 8,192-token caps below are proposed study budgets, not model limits. They need a truncation canary and budgeting review before collection.

| Candidate ID | Proposed extra body | Purpose / caveat | Parameter evidence |
|---|---|---|---|
| `groq-qwen38-instruct` | `{"reasoning_effort":"none","reasoning_format":"hidden","max_completion_tokens":8192}` | Qwen multilingual candidate with documented non-thinking and JSON support; evaluation only while preview. | [G5], [G6] |
| `groq-gptoss120-low` | `{"reasoning_effort":"low","include_reasoning":false,"max_completion_tokens":8192}` | Production structured-output candidate; requires upstream-family judge exclusion before rewrite judging. | [G5], [G6] |
| `groq-gptoss20-low` | `{"reasoning_effort":"low","include_reasoning":false,"max_completion_tokens":8192}` | Lower listed token-cost comparison to 120B; quality and end-to-end speed unknown. | [G5], [G6] |
| `together-qwen35-9b-instruct` | `{"reasoning":{"enabled":false},"max_tokens":8192}` | Small multilingual baseline; host claims 201 languages and demonstrates schema output without thinking. | [T5], [T6] |
| `together-glm53-flash` | `{"max_tokens":8192}` | Low listed cost and document-work candidate; leave reasoning default until exact control is admitted. | [T9] |
| `together-deepseek-v4-flash-0731` | `{"max_tokens":8192}` | Dated provider identifier and low listed output cost; check final-content separation and schema under defaults. | [T3] |
| `together-minimax-m3-instruct` | `{"reasoning":{"enabled":false},"max_tokens":8192}` | Host comparison for direct MiniMax M3; provider IDs, context and serving precision are separate. | [T3], [T5] |
| `together-qwen38-flash` | `{"max_tokens":8192}` | Newer Qwen flash comparison; optional after exact reasoning and JSON behavior are checked. |  |
| `minimax-m3-instruct` | `{"thinking":{"type":"disabled"},"reasoning_split":true,"service_tier":"standard","max_completion_tokens":8192}` | Direct current M-series candidate with documented thinking-off mode; start with standard short-input pricing. | [M3] |
| `minimax-m27` | `{"reasoning_split":true,"max_tokens":8192}` | Prior-generation control; reasoning stays on even if a disabled field is accepted. | [M3] |
| `minimax-m27-highspeed` | `{"reasoning_split":true,"max_tokens":8192}` | Provider speed variant of M2.7; equal quality/faster inference are vendor claims to test, not results. | [M3] |

Groq GPT-OSS has low/medium/high reasoning effort; “none” is not supported for that family. Qwen supports “none.” Hiding/splitting reasoning changes response presentation, not necessarily reasoning work. For MiniMax M3, `thinking.type=disabled` turns thinking off; M2.x accepts that field but continues thinking. Use `reasoning_split` for M2.x so `content` can hold final prose separately. [G5], [M3]

The baseline should keep the existing prompt-only score format. Strict structured output is an optional, separate experiment: it needs the correct scorer schema, a separate protocol hash, and provider-specific support. Do not attach a scoring schema to rewrite requests. Together's example uses Qwen3.5-9B with thinking disabled; its catalog marks JSON support for the other shortlisted rows except Qwen3.8-Flash. MiniMax's reviewed OpenAI-compatible reference does not establish JSON-schema enforcement. [T1], [T6], [M3]

**Compatibility with the inspected code**

| Path | Observed behavior | Consequence for admission |
|---|---|---|
| [src/providers.js:33](../../src/providers.js#L33) | Three presets already exist. Explicit arguments precede preset defaults. | Supply exact model/endpoint; do not trust catalog access from a preset. |
| [src/api.js:361](../../src/api.js#L361) | Bearer-authenticated `/chat/completions`, one user prompt, optional `responseFormat` and `extraBody`. No output cap by default. | All three have a documented compatible route, but no endpoint was tested. Set an admitted cap. [G2], [T3], [M3] |
| [src/backends/index.js:24](../../src/backends/index.js#L24) | CLI HTTP invoke forwards neither `extraBody` nor `responseFormat`. | Study success with thinking controls does not establish CLI rewrite/audit behavior. Parent must review that gap before production use. |
| [model-evaluation-transport.mjs:146](../../scripts/research/model-evaluation-transport.mjs#L146) | Study HTTP calls merge candidate `extraBody`; default deadline 180 seconds and up to two transport retries. | Existing harness can carry proposed fields without runtime edits here. |
| [src/scoring.js:79](../../src/scoring.js#L79) | Invalid JSON triggers one scorer retry at temperature 0. Groq converts zero to a tiny positive value. | Record requested/effective behavior; do not claim deterministic generation. [G2] |
| [src/api.js:468](../../src/api.js#L468) | Backoff reads `retry-after`, not Together's documented `x-ratelimit-reset`. | Parent must pace requests; generic backoff alone does not prove compliance with Together limits. [T4] |
| [src/api.js:301](../../src/api.js#L301) | SSE appends `delta.content`; API metadata has raw responses, but study return records omit `finish_reason`. Automatic streaming starts only above 300 seconds. | Keep the normal 180-second buffered path; require private finish-reason/truncation evidence. Longer streaming runs need usage and delta-semantics checks. |
| [study-journal.mjs:67](../../scripts/research/study-journal.mjs#L67) | Exact response-model equality determines HTTP identity acceptance; terminal attempts/receipts bind resume. | Missing or aliased identities fail admission. Do not silently rewrite expected IDs. |
| [model-rewrite-benchmark.mjs:37](../../scripts/research/model-rewrite-benchmark.mjs#L37) | Judge filtering compares `provider`, not upstream model family. | A Groq/Together OpenAI model can be assigned an OpenAI judge. Hold those rewrite judgments until parent reviews family-aware handling; do not disguise the host field. |
| [prompt-builder.js:347](../../src/prompt-builder.js#L347), [cli/run.js:316](../../src/cli/run.js#L316) | Audit builds separate detection instructions and a deterministic backstop/source inspection. | Rewrite and score results alone do not validate audit reports. |

The study's HTTP transport rejects remote non-HTTPS endpoints and embedded URL credentials. Its Gemini guard requires the parent's admitted loopback OpenCodex route and explicit `google-antigravity/gemini-*` identity. A Gemini API key, direct API request, or direct CLI fallback is outside this study. [Local transport](../../scripts/research/model-evaluation-transport.mjs#L39)

**Execution admission checklist**

1. Parent supplies provider access, funded balance, spend ceiling and a new private output directory. Account access remains missing until observed. Confirm model lifecycle, region, price mode and actual limits.
2. Freeze source SHA, config/pattern/prompt hashes, fixture identities, selected candidates, settings and judge seats. Copy selected rows into a new admitted manifest. Carry upstream-family metadata and the existing fixed judge seats from the [reviewed protocol](model-evaluation-20260904.md); do not edit an active manifest or reuse a frozen collector.
3. Resolve the hosted-OpenAI judge issue before rewrite judging. Keep one active request per provider and coordinate shared judge seats with the parent. Do not start a second writer on an active output directory.
4. Run parent-owned canaries for each of KO/EN/ZH/JA: nonempty final content, exact response-model identity, usage, no tools, bounded output, score JSON schema, and the scorer's temperature-zero retry. Check that thinking controls behave as documented. Admission proves a working route, not quality.
5. Budget every transport retry, scorer retry and both judges. The existing harness has deadlines and receipts but no total-dollar limiter; the parent needs spend controls and a stop rule before launch.
6. Verify `finish_reason` and cap behavior privately. Current study rows omit finish reasons; do not treat a truncated nonempty rewrite as a completed observation. A missing usage record cannot support a cost comparison.
7. Screen 49 scorer fixtures and 12 rewrite fixtures once per admitted candidate. The read-only loaders reported scorer EN/KO/ZH/JA counts 13/12/12/12 and screening counts 4/4/2/2.
8. Use two different upstream judge families and the existing thresholds: number safety, MPS ≥90, fidelity ≥90 and zero HARD_FAIL anchors. Keep judge rationales private. Model naturalness ratings are not human ratings.
9. Check audit separately with production `buildPrompt(mode: 'audit')` and the real CLI/output path on source-bound public controls. Check claimed pattern matches against the input, four-language coverage and report formatting. The current rewrite/scorer study has no audit ranking phase; a parent-owned admission runner must use the existing private journal and state this limitation.
10. Select scorer finalists by valid-output rate, AUROC, then latency; repeat the top two twice more. Select rewrite finalists by safe-output rate, naturalness, then latency; run the top two on the 34-fixture full suite three times. These are the existing protocol's rules, not fabricated observations. Full-suite EN/KO/ZH/JA counts are 11/11/6/6.
11. Use different bound directories when suite, selected set, repeat count or protocol changes. Persist terminal attempt receipts before another call, retain errors, and never silently retry an unresolved in-flight call.
12. Parent independently reviews sanitized results and receipt completeness before publication or model selection. Keep raw texts, receipts and credentials out of tracked files. No new corpus provenance, authorship labels or human ratings may be inferred.

After admission, the existing harness accepts these command shapes. They were **not executed**. The Together example assumes a separately reviewed subset of this shortlist and excludes the deferred OpenAI-family row. `PATINA_ADMITTED_PROTOCOL` and `PATINA_STUDY_PRIVATE_ROOT` must point to parent-owned private inputs and a new output root; credentials are provisioned separately.

```sh
node tests/quality/live-scorer-benchmark.mjs --live \
  --candidates "${PATINA_ADMITTED_PROTOCOL:?}" --provider together \
  --repeat 1 --output "${PATINA_STUDY_PRIVATE_ROOT:?}/together-score-screen"

node scripts/research/model-rewrite-benchmark.mjs --live \
  --candidates "${PATINA_ADMITTED_PROTOCOL:?}" --provider together \
  --suite screening --repeat 1 --phase rewrite \
  --output "${PATINA_STUDY_PRIVATE_ROOT:?}/together-rewrite-screen"

node scripts/research/model-rewrite-benchmark.mjs --live \
  --candidates "${PATINA_ADMITTED_PROTOCOL:?}" --provider together \
  --suite screening --repeat 1 --phase judge --judge openai-5.5 \
  --output "${PATINA_STUDY_PRIVATE_ROOT:?}/together-rewrite-screen"

node scripts/research/model-rewrite-benchmark.mjs --live \
  --candidates "${PATINA_ADMITTED_PROTOCOL:?}" --provider together \
  --suite screening --repeat 1 --phase judge --judge gemini-3.7 \
  --output "${PATINA_STUDY_PRIVATE_ROOT:?}/together-rewrite-screen"

node scripts/research/model-rewrite-benchmark.mjs \
  --candidates "${PATINA_ADMITTED_PROTOCOL:?}" --provider together \
  --suite screening --repeat 1 --phase report \
  --output "${PATINA_STUDY_PRIVATE_ROOT:?}/together-rewrite-screen"
```

Those judge strings are existing harness seat IDs; this report makes no new claim about their current access or server resolution. Gemini stays on OpenCodex. Report generation reads and writes the bound study directory, so the parent owns that phase too.

**Reserve and excluded candidates**

| Host | Exact ID | Reason to defer / exclusion | Evidence |
|---|---|---|---|
| groq | `qwen/qwen3.6-27b` | Optional earlier Qwen control; preview, $0.60 input/$3.00 output; 131072 context/16384 completion. | [G1], [G5] |
| groq | `llama-3.3-70b-versatile` | Local preset default is listed Enterprise / Contact Sales; price and account access unknown. | [G1] |
| groq | `minimaxai/minimax-m2.7` | Enterprise preview / Contact Sales; do not transplant direct MiniMax prices or limits. | [G1] |
| groq | `groq/compound` | Model-and-tool system; unsuitable for a tool-free single-model study. | [G1] |
| together | `openai/gpt-oss-120b` | Optional same-family host control ($0.15/$0.60, context 131072, MXFP4). Needs family-aware judge handling. | [T1], [T2], [T5] |
| together | `zai-org/GLM-5.3` | Higher-price control after screening; $1.40/$4.40, cached $0.26, context 1048575. | [T1], [T2] |
| together | `deepseek-ai/DeepSeek-V4-Pro-0813` | Higher-price control; $1.32/$3.96, cached $0.13, context 1048576; effort mapping differs by model. | [T1], [T2], [T5] |
| together | `moonshotai/Kimi-K3` | Hosted API control only; $3.00/$15.00, cached $0.30, context 1048576; not Kimi Code subscription identity or billing. | [T1], [T2] |
| together | `Qwen/Qwen3.8-2.4T-A95B` | Catalog $2.00/$6.00; cache price disagreement and context unspecified. Resolve before budgeting. | [T1], [T2] |
| together | `Qwen/Qwen3.7-Max` | Catalog and pricing page disagree on input/output/cache prices; context unspecified. | [T1], [T2] |
| together | `Prism-ML/Ternary-Bonsai-27B` | Listed free, context 262144, but schema/language evidence and account eligibility unverified. Do not equate with old Llama -Free default. | [T1], [T2] |
| minimax | `MiniMax-M2.5` | Legacy; defer unless required for historical regression. Do not infer latest status from older M2.5 articles. | [M1], [M2] |

This list is deliberately bounded. It does not claim to enumerate every enterprise deployment or older model. Provider benchmarks, advertised speed and context size cannot replace the requested Patina experiments.

**Source register**

Every source below was retrieved on **2026-09-05 KST**. These are dynamic official pages; a page's publication/update time was not established unless stated. There is no immutable historical snapshot or authenticated catalog response in this artifact. MiniMax also served public `.md` versions. Some direct shell GETs to Groq/Together and Together `.md` variants returned 403; public browser-readable pages were used without authentication or bypass.

| ID | Publisher / page | Evidence |
|---|---|---|
| [G1] | Groq: Supported models | Catalog, production/preview/enterprise classification, prices, developer limits and exact IDs. |
| [G2] | Groq: OpenAI compatibility | Base URL, unsupported fields and temperature-zero conversion. |
| [G3] | Groq: Rate limits | Organization limits, tabbed plan ambiguity, exact-account caveat. |
| [G4] | Groq: Qwen 3.8 27B model | Multilingual claim; preview status; context 131042; output 16384; price 0.80/4.00. |
| [G5] | Groq: Reasoning | Qwen none/default/low/medium/high; GPT-OSS low/medium/high; reasoning presentation switches. |
| [G6] | Groq: Structured outputs | Strict support list includes both GPT-OSS sizes and Qwen3.8; no streaming/tool use; later summary omits Qwen. |
| [G7] | Groq: Pricing URL retrieval | Redirected to https://groq.com/ without a price table; use G1/G4 for prices. |
| [T1] | Together AI: Available serverless models | Exact IDs, host context, quantization, per-token prices and structured-output flags. |
| [T2] | Together AI: Pricing | Chat token prices; disagreements with T1 for Qwen3.7-Max and Qwen3.8-2.4T cache. |
| [T3] | Together AI: OpenAI compatibility | api.together.ai/v1, chat route, ignored fields, usage-shape caveats. |
| [T4] | Together AI: Serverless rate limits | Dynamic organization/model limits, 429 versus 503, x-ratelimit-reset seconds. |
| [T5] | Together AI: Reasoning | Hybrid toggle for Qwen3.5-9B/MiniMax-M3; model-specific effort; output reasoning fields. |
| [T6] | Together AI: Structured outputs | JSON schema with reasoning disabled example; truncation and schema checks. |
| [T7] | Together AI: Qwen3.5 9B model | 201-language claim, thinking toggle, .xyz endpoint example and 0.17/0.25 prices. |
| [T8] | Together AI: MiniMax M3 model | 1M context claim conflicts with T1 524288; same namespaced model; 0.30/1.20 prices. |
| [T9] | Together AI: GLM-5.3-Flash model | Document-work use cases; model page says low/high/max effort; 0.15/0.50 prices. |
| [M1] | MiniMax: Models | Current M3 and M2.7/highspeed; older generations under legacy. |
| [M2] | MiniMax: Pay as you go | Standard discounted M3 input-length tiers, priority multiplier, M2.7 cache read/write prices. |
| [M3] | MiniMax: OpenAI SDK compatibility | Exact IDs/context, reasoning_split, M3 thinking disabled/adaptive, M2 thinking cannot be disabled. |
| [M4] | MiniMax: Rate limits | M3 200 RPM/10M TPM; M2.7 family 500 RPM/20M TPM; account/interface dependent. |
| [M5] | MiniMax: Model invocation | Both API protocols, M3 context 1M, native Anthropic recommendation, coding versus prose distinction. |

**Local verification**

The fixture loaders were imported read-only; only counts were printed. JSON and reference checks passed for 11 candidate descriptions, 21 official source entries and local file/line references. All 11 transport shapes passed `validateTransport` without network or credentials. Both harness `--help` commands matched the examples. The prose gate passed at 21.9% (7/32 paragraphs; limit 30%). These are artifact checks, not provider admission. Full runtime gates, independent review and integration remain with the parent.

[G1]: https://console.groq.com/docs/models
[G2]: https://console.groq.com/docs/openai
[G3]: https://console.groq.com/docs/rate-limits
[G4]: https://console.groq.com/docs/model/qwen/qwen3.8-27b
[G5]: https://console.groq.com/docs/reasoning
[G6]: https://console.groq.com/docs/structured-outputs
[G7]: https://groq.com/pricing
[T1]: https://docs.together.ai/docs/serverless/models
[T2]: https://www.together.ai/pricing
[T3]: https://docs.together.ai/docs/inference/openai-compatibility
[T4]: https://docs.together.ai/docs/serverless/rate-limits
[T5]: https://docs.together.ai/docs/inference/chat/reasoning
[T6]: https://docs.together.ai/docs/inference/chat/structured-outputs
[T7]: https://www.together.ai/models/qwen3-5-9b
[T8]: https://www.together.ai/models/minimax-m3
[T9]: https://www.together.ai/models/glm-5-3-flash
[M1]: https://platform.minimax.io/docs/guides/models-intro
[M2]: https://platform.minimax.io/docs/guides/pricing-paygo
[M3]: https://platform.minimax.io/docs/api-reference/text-openai-api
[M4]: https://platform.minimax.io/docs/guides/rate-limits
[M5]: https://platform.minimax.io/docs/guides/text-generation
