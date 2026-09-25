# Patina 모델 선택 가이드 — 2026-09-05

용도부터 고르면 된다. 아래 표는 글 다듬기와 AI 표현 패턴 점수 작업을 구분하고, 같은 제공업체 안에서 비교를 마친 후보를 정리한 결과다. 다른 입력이나 계정에서의 결과는 아직 모른다.

## 글 다듬기

[전체 확인 리포트](model-rewrite-confirmation-20260905.md)는 모델마다 34개 입력을 세 번씩 처리했다. 표의 통과 수는 102회 전체 시도가 분모다. 숫자 검사와 두 심판의 MPS·fidelity 90점 이상, hard fail 없음 조건을 모두 만족해야 통과한다. 심판 오류가 난 시도도 분모에 남는다.

| 제공업체 | 먼저 검토할 후보 | 같은 업체의 비교 후보 | 통과 수 | 판단 강도 |
|---|---|---|---|---|
| OpenAI | **Astra** | Terra | 58/102 대 45/102 | 이 입력군에서는 중간 |
| Anthropic | **Sonnet 5** | Fable 5.1 | 42/102 대 36/102 | 낮음: 차이 불확실 |
| Gemini | **3.8 medium 경로** | 3.8 high 경로 | 18/102 대 10/102 | 낮음: 경로·실제 effort 미확인 |

Astra와 Terra의 통과율 차이는 +12.7%p이며, 짝지은 입력 단위 95% 구간은 +2.9~+23.5%p다. Sonnet과 Fable의 차이는 +5.9%p지만 구간이 −5.9~+19.6%p로 넓고 Gemini medium과 high의 구간도 0을 포함하므로, 두 쌍의 순서를 확정하기는 어렵다. 업체 안의 비교까지만 읽자. 여섯 모델 전체의 절대 순위는 아니다.

## AI 표현 패턴 점수

여기서는 `scoreText`의 최종 패턴 점수를 비교하며, 의미 보존을 평가하는 MPS·fidelity 심판까지 추천하지는 않는다. 용도가 다르다. 특히 점수용 추천 모델을 같은 계열의 생성물에 붙이면 독립 심판 조건을 만족하지 못한다.

[공개 점수 리포트](../benchmarks/live-scorer-20260905.md)의 A/C 결과에 검증을 마친 D 집계를 더하면, 각 후보는 최초 49회와 재확인 98회를 합쳐 147/147회에서 유효한 점수를 냈다. 입력은 49개다. 같은 글을 세 번 측정한 것이므로 147개의 독립 글이나 사람 표본으로 세면 안 된다. 선택 순서는 유효 출력률 → AUC → 지연시간이다.

| 제공업체 | 규칙상 추천 | 비교 후보 | 합산 AUC | 판단 강도 |
|---|---|---|---|---|
| OpenAI | **GPT-5.5** | Terra | 0.989038 대 0.961538 | 이 입력군에서는 중간 |
| Gemini | **Pro 경로** | 3.8 low 경로 | 0.977425 대 0.772575 | 이 입력군에서는 중간 |
| Anthropic | **Sonnet 4.6** | Opus 5 | 0.987644 대 0.985229 | 낮음 |

GPT-5.5는 두 재확인 회차에서 Terra를 앞섰고 Pro는 세 회차 모두 3.8 low를 앞섰지만, Sonnet 4.6과 Opus의 합산 AUC 차이는 0.002415에 불과하다. 차이는 작다. 짝지은 입력 단위 95% 구간도 −0.021182~+0.030658로 0을 포함하며, 재확인 98회만 보면 Opus가 앞선다.

기다리는 시간이 중요하다면 Anthropic 점수용 대안으로 **Opus 5**를 검토할 만하다. 근거는 관측 지연이다. 147회 합산 중앙값이 Opus 17.152초, Sonnet 4.6 68.390초였지만 동시 작업이 있는 환경에서 측정했으므로 모델 자체의 속도 차이로 단정할 수는 없다.

## 사용한 ID와 설정

아래 ID는 실험에 요청한 문자열이다. OpenAI·Gemini는 OpenCodex 경로, Claude는 개인 설정을 배제한 native CLI를 썼다. `low`·`high` 요청값이 실제로 적용됐다는 뜻은 아니다. [OpenAI·Anthropic 조사](provider-openai-anthropic-20260905.md)와 [Gemini 경로 조사](provider-gemini-kimi-deepseek-20260905.md)에 공식 문서와의 대응 관계가 있다.

| 용도 | 요청 ID | 기록된 설정 |
|---|---|---|
| OpenAI 글 다듬기 | `gpt-6-astra` / `gpt-5.6-terra` | `reasoning_effort: low` 요청 |
| OpenAI 패턴 점수 | `gpt-5.5` / `gpt-5.6-terra` | `reasoning_effort: low` 요청 |
| Claude 글 다듬기 | `claude-sonnet-5` / `claude-fable-5-1` | CLI `effort: high` 요청 |
| Claude 패턴 점수 | `claude-sonnet-4-6` / `claude-opus-5` | CLI `effort: high` 요청 |
| Gemini 글 다듬기 | `google-antigravity/gemini-3.8-flash-medium` / `google-antigravity/gemini-3.8-flash-high` | 접미사는 경로 라벨; 실제 effort 미확인 |
| Gemini 패턴 점수 | `google-antigravity/gemini-3.1-pro` / `google-antigravity/gemini-3.8-flash-low` | Pro effort 미지정; low 적용 미확인 |

## Kimi와 아직 비교하지 못한 제공업체

Kimi Code 글 다듬기는 예비 비교에서 **standard·highspeed가 각각 6/12회** 통과했다. 전체 확인 204회는 아직 실행하지 않았다. 패턴 점수 후보는 **highspeed·K3-256k**지만, 최초·가용성 확인 각 49회의 결과만 참고할 수 있다. 재확인 196회는 유효 37건, 스키마 오류 1건, 점수가 없는 호출 실패 158건이었다. 사용한도 진단이 보고됐으나 모든 실패의 원인을 확정한 것은 아니다. 확인 완료 추천은 보류한다.

해당 프로필은 `kimi-code/kimi-for-coding`, `kimi-code/kimi-for-coding-highspeed`, `kimi-code/k3-256k`다. 실제 effort와 서버 모델은 미확인이다. Kimi Code와 Moonshot API는 접근 권한과 과금 경로도 다르다. [Kimi 조사](provider-gemini-kimi-deepseek-20260905.md)를 함께 읽어야 한다.

| 제공업체 | 문서상 검토 후보 — 실측 추천 아님 |
|---|---|
| DeepSeek | `deepseek-v4-flash`, `deepseek-v4-pro` |
| Groq | `qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b` |
| Together | `Qwen/Qwen3.5-9B`, `zai-org/GLM-5.3-Flash`, `MiniMaxAI/MiniMax-M3` |
| MiniMax | `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` |

접근부터 확인해야 한다. 이 후보들은 권한이나 유료 API 입력이 확보되지 않아 비교를 마치지 못했고, 문서 등재만으로 이 계정의 호출 가능 여부를 알 수도 없다. [DeepSeek 조사](provider-gemini-kimi-deepseek-20260905.md)와 [Groq·Together·MiniMax 조사](provider-groq-together-minimax-20260905.md)에 제안 설정과 미확인 항목이 있다. 호스팅 업체가 달라도 GPT-OSS는 OpenAI 계열이므로 OpenAI 계열 생성물의 독립 심판으로 쓰면 안 된다.

## 결과를 읽을 때

설정상 OpenAI 생성물은 Gemini·Claude가 평가했고, Claude 생성물에는 OpenAI·Gemini를, Gemini 생성물에는 OpenAI·Claude를 심판으로 배정했다. 업체 안의 비교가 우선이다. 생성 모델 계열마다 심판 패널도 바뀌기 때문에 업체 간 순위에는 패널 효과가 섞이며, 이를 생성 모델만의 품질 차이로 읽을 수는 없다.

OpenCodex의 `response.model`은 요청한 별칭을 되돌려줄 수 있다. 별칭 일치가 upstream 모델·가중치 확인은 아니다. 자연스러움과 의미 보존 판정도 모델 평가이며 사람의 평점이 없다. 패턴 점수의 AUC 역시 이 입력군의 라벨 구분력이지 인간·AI 저자 판별 정확도가 아니다.

A/C 점수 결과는 원본·영수증·실행 결과가 서로 맞는지 검증했으나 전체 과거 설정 객체는 복구하지 못한 반면, D는 전체 V8 입력과 점수 재현까지 확인했다. 재표집 구간으로도 같은 입력에서 후보를 고른 편향은 사라지지 않는다. 실제 청구액도 미확인이다. 이 가이드는 기본 모델·CLI·스킬 동작을 변경하지 않는다.
