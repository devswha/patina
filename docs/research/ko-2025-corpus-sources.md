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

## Intake commands

Use the local workspace scaffold:

```bash
npm run benchmark:rebaseline:intake -- \
  --input artifacts/rebaseline-2025/intake.local.jsonl \
  --public-output artifacts/rebaseline-2025/manifest.public.jsonl \
  --private-output artifacts/rebaseline-2025/private/generations.private.jsonl

node scripts/rebaseline-summary.mjs \
  --input artifacts/rebaseline-2025/manifest.public.jsonl \
  --json
```

The intake helper computes missing `text_hash` values. If redistribution is not
public, it strips `text` from the public manifest and writes the full row to the
private output path.

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
