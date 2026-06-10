# Humanization Data Backlog

Status: research brief, no corpus generated  
Written: 2026-06-06  
Scope: AI 문체 신호 완화와 자연스러운 글 품질 개선에 필요한 데이터 생성 후보, 미해결 이슈, 검증 기준을 정리한다.

이 문서는 구현 변경이나 새 데이터 생성을 하지 않는다. 기존 리베이스라인과 연구 메모를 바탕으로 다음 작업을 이슈화하기 위한 백로그다. Patina의 기준은 탐지 회피가 아니라 의미 보존, 주장 보존, 재현 가능한 문체 신호 완화다.

## Source Documents

- [2025 Rebaseline Plan](./2025-rebaseline-plan.md): 언어, 클래스, 레지스터, 모델 패밀리별 최소 매트릭스와 claim gate.
- [2026 Rebaseline](./2026-rebaseline.md): KO/EN 공개 매니페스트와 비공개 생성 샘플 기반의 현재 주장 가능 범위.
- [Latest Rebaseline Benchmark](../benchmarks/rebaseline-latest.md): 현재 커버리지, precision/recall, register별 FN/FP 위험.
- [Register Stratified Benchmark](../benchmarks/register-stratified-latest.md): KO human control register별 오탐 위험.
- [Lexicon Freshness Audit](./lexicon-freshness-audit.md): EN 최신성, KO 부분 최신성, ZH/JA 외부 보정 필요.
- [ZH/JA Lexicon Calibration](./zh-ja-lexicon-calibration.md): ZH/JA phrase-only lexicon의 한계와 외부 코퍼스 필요.
- [AI Human Metrics](./ai-human-metrics.md): 의미 보존과 AI-like writing signal reduction을 함께 보는 평가 방향.
- [Human Eval Panel](./human-eval-panel.md): 30쌍, 5명 평가자 기반의 자연스러움/의미 손실 평가 설계.
- [Adversarial MPS](./adversarial-mps.md): MPS proxy 통과가 자연스러운 문체를 보장하지 않는다는 한계.
- [Judge Agreement](./judge-agreement.md): 생성기 family와 judge family 간 합의도 측정 계획.

## Current Evidence Snapshot

| Area | Current evidence | Gap |
| --- | --- | --- |
| KO/EN rebaseline | 800 public scored manifest rows, 600 generated private rows, KO/EN 중심의 claim-ready baseline | ZH/JA는 public benchmark coverage가 0에 가깝고, edited-AI class가 비어 있다 |
| Class coverage | `ai-like` 600, `natural-human` 200 | `lightly edited AI`, `heavily edited AI`, `open-weight` cells are empty |
| KO GPT-family | KO GPT-family catch rate가 낮은 셀로 보고됨 | 전역 threshold 조정보다 KO-specific miss review와 diagnostic 보강이 먼저 필요 |
| Register risk | `chat-update` FN, `technical-how-to` FP가 높은 위험군 | register별 fixture와 rewrite QA가 별도 필요 |
| Lexicon freshness | EN은 HAP-E 기반 재채굴로 상대적으로 최신, KO는 partial, ZH/JA는 작은 regression corpus 수준 | KO/ZH/JA는 hot/cold lift 기준 재채굴과 sidecar 근거가 필요 |
| Meaning preservation | adversarial MPS fixtures는 의미 보존 proxy가 자연스러운 문체를 보장하지 않음을 보여줌 | rewrite 품질 평가는 MPS와 humanness를 분리해야 한다 |

## Data Backlog

| Priority | Work item | Why it matters | Minimum artifact |
| --- | --- | --- | --- |
| P0 | KO GPT-family miss-review manifest | 현재 KO GPT 계열 누락은 threshold 문제인지 pattern/lexicon 문제인지 분해가 필요하다 | raw text 없이 `sample_id`, `lang`, `register`, `model_family`, `signals`, `miss_reason`, `source_doc`를 담은 manifest |
| P0 | Edited-AI class intake | 실제 사용자 입력은 원본 AI 문장보다 light/heavy edit 상태일 가능성이 높다 | 언어별 `lightly edited AI`, `heavily edited AI` fixture 후보와 편집 정책 메모 |
| P0 | ZH/JA calibration pilots | 현재 ZH/JA lexicon은 broad claim에 충분하지 않다 | 언어별 class/register 최소 pilot manifest, 출처, 라이선스, reviewer note |
| P0 | Open-weight model-family positives | GPT/Claude/Gemini 중심 claim은 모델 family 편향을 만든다 | 기존 prompt matrix를 재사용한 open-weight positive manifest |
| P1 | Register-specific FP/FN stress sets | `chat-update`, `technical-how-to`, KO learner/native controls에서 실사용 리스크가 크다 | register별 false-positive/false-negative fixture 후보와 기대 판정 |
| P1 | Rewrite quality paired set | rewrite가 score만 낮추고 의미나 자연스러움을 잃는지 확인해야 한다 | before/after pair, MPS proxy, patina score delta, human preference label |
| P1 | KO/ZH/JA lexicon remine | 최신 AI 표현은 빠르게 변하고 언어별로 다르게 나타난다 | hot/cold lift, cold document frequency, reviewer decision sidecar |
| P2 | API decoding parameter sweep | 생성 온도와 decoding 설정에 따라 문체 신호가 달라진다 | model, temperature, top_p, prompt version이 포함된 generated sample manifest |
| P2 | Cross-judge agreement matrix | 특정 judge family에 맞춘 과적합을 줄여야 한다 | generator family x judge family x sample matrix와 disagreement notes |

## Issue Candidates

1. Build KO GPT-family miss-review manifest
   - Acceptance: at least 100 KO GPT-family miss candidates or all currently available misses, whichever is smaller.
   - Acceptance: each row includes deterministic signal breakdown, register, model family, and reviewer reason.
   - Non-goal: do not change thresholds in the same issue.

2. Add edited-AI class intake scaffold
   - Acceptance: define `lightly edited AI` and `heavily edited AI` edit policies.
   - Acceptance: add manifest schema fields for edit depth, source relation, before/after hash, and reviewer.
   - Non-goal: do not publish private source text.

3. Fill ZH/JA external calibration manifests
   - Acceptance: collect source metadata for ZH/JA AI-like and natural-human pilot cells.
   - Acceptance: include license/source notes and reviewer confidence.
   - Non-goal: do not make broad ZH/JA accuracy claims from pilot data.

4. Add open-weight positive cells
   - Acceptance: generate or collect samples with the same prompt/register matrix used for closed model families.
   - Acceptance: record model name, version, serving path, decoding params, and prompt hash.
   - Non-goal: do not mix open-weight rows into published claims until n gates are met.

5. Run rewrite human-evaluation pilot
   - Acceptance: at least 30 before/after pairs, 5 raters, randomized order, naturalness preference, and meaning-loss labels.
   - Acceptance: report safe gain as score reduction only when meaning loss is not flagged.
   - Non-goal: do not treat MPS proxy as a humanness score.

6. Remine KO/ZH/JA lexicons
   - Acceptance: each candidate entry has hot/cold lift, cold document frequency, and reviewer decision.
   - Acceptance: reject terms that are common in natural professional writing unless context-gated.
   - Non-goal: do not add broad generic terms only because they appear in AI samples.

7. Add recurrent-marker QA for high-MPS outputs
   - Acceptance: identify rewrites that pass MPS but keep high AI-score or repetitive structure.
   - Acceptance: add a report field separating meaning preservation, naturalness, and residual AI-like signal.
   - Non-goal: do not weaken MPS to improve style metrics.

## False-Positive Feedback Intake Path

Playground false-positive reports should land in the structured GitHub issue form
(`.github/ISSUE_TEMPLATE/false_positive.yml`) with the flagged paragraph,
language, register, origin, redistribution status, and score output prefilled when
available. Triage converts accepted reports into local JSONL rows for
`scripts/rebaseline-intake.mjs`:

1. If `redistribution` allows a public fixture, keep the shortest reproducing text
   in the intake row and record reviewer notes.
2. If redistribution is private or issue-discussion-only, keep the text in the
   private intake output and publish only hashes/metadata.
3. Accepted false positives should enter the `natural-human` or
   `human-written with light AI editing` class, never an AI-positive class.
4. Each row must include `source_doc` with the GitHub issue URL and
   `reviewer_notes` explaining why the current score is too high.

Run `node scripts/rebaseline-intake.mjs --dry-run --require-source-review` before
writing any public manifest output. This keeps user reports connected to the
benchmark corpus without publishing private raw text by accident.

### From intake row to benchmark fixture

Accepted rows become suspect-zones natural fixtures through
`scripts/fp-fixture-export.mjs`:

```
npm run benchmark:rebaseline:fp-fixtures -- --dry-run
npm run benchmark:rebaseline:fp-fixtures
```

The exporter only promotes rows that are both `natural-human` and publicly
redistributable; private or no-redistribution rows are refused so raw text never
leaves the intake file. New fixtures land in
`tests/fixtures/suspect-zones/{lang}/natural/` as `{lang}-nat-NN-slug.md`,
numbered after the highest existing fixture for that language. After a real run,
regenerate the baseline with `npm run benchmark:ranges` and review the
`tests/fixtures/suspect-zones/expected-ranges.json` diff before committing.

## Manifest Fields

Use these fields for any new data issue unless a narrower schema already exists:

```yaml
sample_id:
lang:
register:
class:
model_family:
model_name:
model_version:
prompt_hash:
decoding:
source_type:
source_license:
source_hash:
original_hash:
rewrite_hash:
edit_depth:
patina_before_score:
patina_after_score:
mps_proxy:
meaning_loss_flag:
signals:
reviewer:
review_notes:
source_doc:
```

Do not commit private raw text when a hash, manifest row, or aggregate score is enough. If raw examples are required for a public fixture, keep them small, license-compatible, and explicitly reviewed.

## Guardrails

- Do not frame this work as detector bypass or evasion.
- Do not tune global thresholds to fix one language/model family miss cluster.
- Do not merge pilot ZH/JA data into published broad claims until the claim gate is met.
- Do not use MPS proxy as a substitute for naturalness evaluation.
- Do not add lexicon entries without cold-corpus checks.
- Do not publish private generated or user-provided source text.

## Suggested Order

Start with P0 issue 1 because it explains whether KO misses are caused by missing patterns, lexicon drift, register mismatch, or scoring weights. Then add the edited-AI intake scaffold before generating more samples, so future data lands in a stable shape.
