# KO/2025+ Corpus Source Inventory

Verified: 2026-05-21. This inventory turns the Korean rebaseline blocker
(#303/#157/#155/#160) into an executable intake plan. It is not a public
performance claim.

## Decision

Use a **metadata-first corpus**:

1. keep raw text in `artifacts/rebaseline-2025/` or another private store;
2. commit only redistributable examples, hashes, metadata, and aggregate reports;
3. do not publish catch-rate claims until `docs/research/2025-rebaseline-plan.md`
   reaches its n≥100 public claim gate.

That lets Patina use current Korean sources without copying restricted corpora
into the repository.

## Source matrix

| source | role | evidence | repo policy | first intake |
|---|---|---|---|---|
| KatFish / KatFishNet | Korean AI-vs-human seed set; especially useful for #303 punctuation/spacing checks | ACL 2025/arXiv paper says KatFish covers human and four-LLM Korean text across three genres; the public GitHub repo contains `katfish_dataset/*.jsonl` | Treat raw rows as **license-review** until a license/redistribution decision is recorded. Hash-only rows are OK. | Pull 5 metadata-only rows per genre, record source file, row id, class, genre, and `sha256` hash. |
| 모두의 말뭉치 | human Korean controls for product-doc, news/editorial, dialogue, summary registers | NIKL lists 2024/2025 corpora and requires corpus application/approval fields | Do not commit raw text. Store local extracts privately and commit only hashes/metrics unless approval explicitly allows publication. | Apply for research/evaluation use; start with 25 human-control paragraphs after approval. |
| 한국어 학습자 말뭉치 | false-positive stress test for learner/second-language Korean, not a normal human baseline | Official site describes learner writing/speech corpora and notes original learner material is privacy-protected; Data.go.kr lists research-purpose distribution limits | Use as a separate FP envelope. Do not blend with native Korean controls. Commit metadata/hashes only. | Add `class: natural-human`, `register: learner-writing` only after schema/register decision, or map to `academic-summary` with reviewer note. |
| HAERAE-HUB/KOREAN-SyntheticText-1.5B | broad synthetic Korean AI-like pool | Hugging Face dataset page shows text parquet with 1.55M rows | Synthetic side only. Check dataset card/license before committing full text; otherwise hash-only. | Sample short paragraphs for lexicon mining candidates, then manually review before pattern changes. |
| Maintainer-generated 2026 prompts | controlled GPT/Claude/Gemini/open-weight model-era rows | Generated from repo-owned prompts and reproducible metadata | Preferred public seed when provider terms and prompt contents allow redistribution. Keep prompts public; keep vendor UI copies private if unsure. | Generate 5 rows each for GPT-family, Claude-family, Gemini-family, and open-weight across blog/product-doc/chat-update. |
| Community false-positive submissions | real Patina FP cases | GitHub false-positive issue template captures language/register/score output | Use only with explicit fixture permission. Strip account/private context by default. | Convert accepted issues into hash-only rows first; promote to fixture only after permission. |
| KOGL / Korea.kr / MCST / Seoul OpenGov web pages | small natural-human Korean pilot controls for source/provenance workflow | Public policy/help pages with visible source URLs and licensing/copyright guidance | Commit only hash-only metadata until page-level redistribution and attribution are reviewed. Keep raw extracts in ignored `artifacts/rebaseline-2025/private/`. | `artifacts/rebaseline-2025/human-controls.public.jsonl` contains 10 hash-only candidate rows across blog, product-doc, academic-summary, technical-how-to, and chat-update registers. |

## Intake commands

Use the local workspace scaffold:

```bash
npm run benchmark:rebaseline:intake -- \
  --input artifacts/rebaseline-2025/intake.local.jsonl \
  --public-output artifacts/rebaseline-2025/manifest.public.jsonl \
  --private-output artifacts/rebaseline-2025/private/generations.private.jsonl \
  --require-source-review

node scripts/rebaseline-summary.mjs \
  --input artifacts/rebaseline-2025/manifest.public.jsonl \
  --json
```

The intake helper computes missing `text_hash` values. If redistribution is not
public, it strips `text` from the public manifest and writes the full row to the
private output path.

Tracked starter files:

- `artifacts/rebaseline-2025/prompts.template.jsonl` — repo-owned prompt
  anchors for Korean academic/종결-다, product-doc, blog, chat/update,
  technical-how-to, and edited-AI rows.
- `artifacts/rebaseline-2025/intake.local.example.jsonl` — 25 metadata-only
  rows matching the pilot buckets below. The hashes are placeholders; replace
  them locally before treating the file as evidence.
- `artifacts/rebaseline-2025/human-controls.public.jsonl` — 10 web-sourced
  Korean natural-human candidate rows. It is hash-only and validates the
  collection path; it is not enough to change thresholds.

To regenerate the tracked web candidate manifest from a local/private raw file:

```bash
npm run benchmark:rebaseline:intake -- \
  --input artifacts/rebaseline-2025/private/web-human-controls.private.jsonl \
  --public-output artifacts/rebaseline-2025/human-controls.public.jsonl \
  --private-output artifacts/rebaseline-2025/private/web-human-controls.copy.private.jsonl \
  --require-source-review

node scripts/rebaseline-summary.mjs \
  --input artifacts/rebaseline-2025/human-controls.public.jsonl \
  --json
```

To score those candidates without committing raw text:

```bash
npm run benchmark:rebaseline:score -- \
  --input artifacts/rebaseline-2025/private/web-human-controls.private.jsonl \
  --output artifacts/rebaseline-2025/human-controls.public.jsonl \
  --scored-at 2026-05-21
```

## 25-row Korean pilot

Before changing thresholds again, collect a small pilot that proves the workflow
and exposes label/register holes:

| bucket | target rows | notes |
|---|---:|---|
| native human controls | 8 | At least two each for academic/종결-다, product-doc, blog, community/update. |
| self-generated AI-like | 8 | GPT-family, Claude-family, Gemini-family, open-weight; keep prompt ids. |
| lightly/heavily edited AI | 4 | One light and one heavy edit for two registers; preserve before/after hashes. |
| KatFish metadata-only comparison | 3 | One each for essay, poetry, abstract; hash-only until license review. |
| FP submissions / learner stress | 2 | Separate reviewer note so learner Korean does not distort native baseline. |

Exit criteria for the pilot:

- `npm run benchmark:rebaseline:intake -- --input artifacts/rebaseline-2025/intake.local.jsonl --dry-run --require-source-review`
  passes before any rows are scored.
- `node scripts/rebaseline-summary.mjs --input <manifest>` validates with no errors.
- every row has `source_review` or `reviewer_notes` explaining redistribution
  status when raw text is absent;
- no threshold or README catch-rate claim changes are made from the pilot alone;
- findings are posted back to #303/#157/#155 before #160 lexicon mining starts.

## Source links

- KatFishNet paper: <https://arxiv.org/abs/2503.00032>
- KatFishNet repository: <https://github.com/Shinwoo-Park/katfishnet>
- 모두의 말뭉치 request page: <https://kli.korean.go.kr/corpus/main/requestMain.do>
- 모두의 말뭉치 introduction: <https://kli.korean.go.kr/m/introduce/corpusIntroduce.do>
- 한국어 학습자 말뭉치: <https://kcorpus.korean.go.kr/index/goIntroduceSite.do>
- 한국어 학습자 말뭉치 Data.go.kr metadata: <https://www.data.go.kr/data/15094033/fileData.do>
- HAERAE Korean SyntheticText: <https://huggingface.co/datasets/HAERAE-HUB/KOREAN-SyntheticText-1.5B>
- KOGL introduction: <https://www.kogl.or.kr/info/introduce.do>
- KOGL license guide: <https://www.kogl.or.kr/info/license.do>
- Korea.kr policy article: <https://www.korea.kr/news/policyNewsView.do?newsId=148959377>
- MCST KOGL type guide: <https://www.mcst.go.kr/site/s_open/kogl/koglType.jsp>
- MCST copyright Q&A: <https://www.mcst.go.kr/site/s_policy/copyright/question/question17.jsp>
- Seoul OpenGov copyright policy: <https://opengov.seoul.go.kr/copyright>
