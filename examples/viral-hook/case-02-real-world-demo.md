---
pack: ko-viral-hook
type: real-world-demo
patterns: [1, 2, 3, 4, 5]
score_only: true
---

# Viral Hook Case 02: Real-World Threads Marketing Post

`ko-viral-hook` 팩이 실제 SNS 마케팅 콘텐츠에서 어떻게 동작하는지 보여주는 데모.
패턴 검증 목적의 비평적 분석으로, 인용은 짧은 공개 게시물에 한해 출처를 명시한다.

**Source:** Threads `@ai_ethan_sns` post `DX_bXIkG4eK` (2026-05-06 fetched)
**Backend:** codex-cli (Codex v0.128.0, gpt-5.5)
**patina:** v3.10.0 (with `ko-viral-hook` pack)

---

## 입력 (verbatim, 분석 목적 인용)

```
GitHub 역사상 이런 속도는 없었다.

단 60일 만에 별 25만 개.

OpenClaw라는 도구가 세운 기록임.

광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.
```

(글 4줄 / 약 80자, 비평·분석 목적의 짧은 인용)

---

## `--score` 결과

| Category | Weight | Detected | Raw Score | Weighted |
|----------|--------|----------|-----------|----------|
| content | 0.13 | 0/6 | 0.0 | 0.0 |
| language | 0.13 | 0/6 | 0.0 | 0.0 |
| style | 0.10 | 0/6 | 0.0 | 0.0 |
| communication | 0.22 | 0/4 | 0.0 | 0.0 |
| filler | 0.05 | 0/3 | 0.0 | 0.0 |
| structure | 0.17 | 0/5 | 0.0 | 0.0 |
| **viral-hook** | **0.10** | **5/5** | **86.7** | **8.7** |
| discord (모델 환각) | 0.20 | 0 | 0.0 | 0.0 |
| **Overall** | | | | **7.9 (±10)** |

**Interpretation:** `사람다움`. 다만 viral-hook 신호가 한 카테고리에 강하게 집중.

> 모델 코멘트: *"점수는 낮아도 viral-hook 신호는 강합니다. 'GitHub 역사상', '단 60일', '전 세계', '미친 듯이', 마지막 수사적 질문이 모두 클릭 유도형 문체로 잡힙니다."*

---

## `--audit` 결과

| Pattern | Category | Severity | Trigger |
|---------|----------|----------|---------|
| 1. 숫자 충격 훅 | ko-viral-hook | LOW | "단 60일 만에 별 25만 개." |
| 2. 클릭베이트 미스터리 종결 | ko-viral-hook | LOW | "...달려든 이유가 뭘까." |
| 3. 검증 회피 단언 | ko-viral-hook | LOW | "GitHub 역사상 이런 속도는 없었다." / "전 세계 개발자들이..." |
| 4. 호흡 최적화 단문 배열 | ko-viral-hook | LOW | 전체 4문장이 모두 짧은 단문 단락으로 분리됨 |
| 5. AI 인플루언서 어휘 | ko-viral-hook | LOW | "미친 듯이" |

기존 6개 카테고리(content/language/style/communication/filler/structure)에서는 **0건**.

---

## `--rewrite` 결과

```
GitHub에서 이런 속도는 처음이었다.

60일. 별 25만 개.

기록을 세운 건 OpenClaw라는 도구다.

광고도 없었다. 그런데 전 세계 개발자들이 한꺼번에 몰렸다. 숫자보다 그 반응이 더 이상하다.
```

### Diff 요약

| 변경 전 | 변경 후 | 효과 |
|---|---|---|
| "역사상 이런 속도는 없었다" | "이런 속도는 처음이었다" | 절대 권위 단언 → 1인칭 관찰 |
| "미친 듯이 달려든" | "한꺼번에 몰렸다" | 과장 어휘 제거 |
| "...이유가 뭘까." | "...그 반응이 더 이상하다." | 수사적 질문 → 평서 종결 |
| 4단락 모두 1줄 단문 | 마지막 단락 길게 합침 | 호흡 다양화 (burstiness) |

### 핵심 관찰

`ko-viral-hook` 팩은 **score-only**이므로 rewrite 프롬프트에 주입되지 않았다. 그럼에도 모델이 위 변경을 수행한 이유:

1. **`ko-content #1 (과도한 중요성 부여)`** — "역사상" 같은 절대 단언이 기존 패턴에서도 일부 잡힘
2. **`core/voice.md`** — "Burstiness 지침" 등이 단문 배열을 자연스럽게 길이 다양화하도록 유도
3. **모델의 일반 휴머나이즈 지식** — Codex/gpt-5.5가 학습한 "사람 톤" 베이스라인

→ viral-hook 격리(score-only)는 의도대로 동작. 다만 다른 패턴이 우연히 일부 영역을 커버해 결과적으로 rewrite도 일정 수준 자연스러워짐.

---

## 종합 판단

patina의 dual-output이 사용자 직관과 일치:

- **score 7.9** — 결과물은 사람 톤이지만 viral 신호 강함을 정확히 표시
- **audit** — 5개 패턴 위치 정확
- **rewrite** — 받아쓰면 SNS 마케팅 톤이 아닌 일반 정보 전달 톤으로 바뀜

회귀 픽스처 결과(`case-01-marketing-hook.md`: 7.9)와 동일 점수 → 기준선 안정.

---

## ⚠ 발견된 부수 이슈 (이번 PR 변경 아님)

### 1. `--rewrite` 출력에 self-audit 메타 누출

```
남아 있는 AI 티: 없음.
```

이 한 줄이 본문 위에 붙어 출력됨. self-audit phase의 메타 출력이 본문으로 흘러나오는 기존 버그. 별도 fix 대상.

### 2. `--score` 출력에 `discord` 카테고리 환각

모델이 실재하지 않는 `discord` 카테고리(weight 0.20)를 출력에 포함. 항상 0건 검출이라 점수에 영향 없지만 출력이 지저분함. 모델 비결정성 이슈로 별도 PR.

### 3. 카테고리 가중치가 config와 일치하지 않음

config에 `content: 0.18`로 설정했지만 모델이 출력에 `0.13`을 사용. LLM이 supplied weights를 부분적으로 무시하는 비결정성. 별도 작업.

---

# Case 02b: Long-form Marketing Post (`examples/sample.md`)

같은 viral-hook 장르의 더 긴 케이스. 35줄 분량의 SNS 인플루언서 마케팅 포스트(AI 도구 추천 + 팔로우/뉴스레터 CTA 포함). 짧은 케이스와 비교해 viral-hook + 기존 카테고리가 함께 누적될 때 score가 어떻게 변하는지 보여준다.

**Source:** `examples/sample.md` (사용자 제공 픽스처)

## `--score`: **19.6/100** (mostly human, 신호 강함)

| Category | Detected | Raw | Weighted |
|----------|----------|-----|----------|
| **viral-hook** | #1 H, #2 M, #3 H, #4 H, #5 H | **93.3** | **9.3** |
| content | #1 (과도한 중요성) High | 16.7 | 2.2 |
| language | #9 (부정 병렬구조) Medium | 11.1 | 1.4 |
| communication | #19 (챗봇 표현) Low | 11.1 | 2.4 |
| structure | #25 Medium, #30 Low | 25.0 | 4.3 |
| style / filler | none | 0.0 | 0.0 |
| **Overall** | | | **19.6 (±10)** |

Case 02a(짧은 Threads 글, 7.9)보다 ~12점 높음 — 같은 viral 신호가 더 길게 누적되고, 거기에 기존 4개 카테고리(content/language/communication/structure)도 추가 기여하기 때문.

## `--audit`: 9개 패턴 검출 (viral-hook 5 + 기존 4)

viral-hook 5/5 적중:
- #1 숫자 충격 훅, #2 클릭베이트 미스터리 종결, #3 검증 회피 단언, #4 호흡 최적화 단문 배열
- #5 AI 인플루언서 어휘 — Medium severity ("미친 듯이", "가장 싸게 올라탈 타이밍" 2개 누적)

기존 카테고리에서 추가 검출:
- ko-language #30 — 수사적 질문 단락 시작
- ko-language #9 — 부정 병렬구조 ("...아니다" 반복) **Medium**
- ko-filler #24 — 막연한 긍정적 결론 ("...가장 싸게 올라탈 타이밍이다") **Medium**
- ko-communication #19 — 챗봇 표현 ("...더 깊게 다뤄드릴게요")

→ 기존 28개 패턴팩이 viral 콘텐츠의 일부 신호(수사적 질문, 부정 병렬, 챗봇 표현)는 이미 잡고 있었음을 확인. viral-hook 팩은 그 위에 **clickbait/shock-numbers/source-skipping** 같은 마케팅 특화 신호를 보강하는 역할.

## `--rewrite`: 핵심 변환

| 원문 | 리라이트 |
|---|---|
| "GitHub 역사상 이런 속도는 없었다" | "GitHub에서 이런 속도는 거의 못 봤다" |
| "미친 듯이 달려든 이유가 뭘까" | (제거, 평서 정보 톤으로 전환) |
| "가려운 곳을 정확히 긁어줬기 때문임" | "제일 짜증 나던 부분, 그걸 정확히 긁었다" |
| 1줄 1단락 단문 6개 (1~3문단) | 호흡 묶음 (3~4문장 단락) |
| "표준이 바뀌고 있다는 신호임" | "기본값이 바뀌는 쪽에 가깝다" |
| "99%는 ... 상위 1%는" | "대부분은 ... 움직이는 사람은" |
| "지금이 가장 싸게 올라탈 타이밍이다" | "지금이 가장 싸게 배울 수 있는 타이밍이다" |

CTA 영역(팔로우/저장/해시태그/뉴스레터 안내)은 SNS 포맷의 의도된 장치라 거의 보존. 본문 톤은 분명히 **마케팅 → 정보 전달**로 이동.

## 종합 비교

|  | Case 02a (짧은 글) | Case 02b (긴 글) |
|---|---|---|
| 분량 | 4줄, ~80자 | 35줄, ~600자 |
| viral-hook 검출 | 5/5 (모두 LOW) | 5/5 (#1 H, #2 M, #3 H, #4 H, #5 M) |
| viral-hook raw | 86.7 | 93.3 |
| 기존 카테고리 추가 검출 | 0 | 4 (content/language/comm/structure) |
| Overall | 7.9 | 19.6 |

같은 장르·같은 viral 패턴이라도 분량과 누적 신호 따라 점수가 7.9 → 19.6으로 ~2.5배 올라감. 사용자 직관("마케팅 톤 강함")과 일치하는 방향.

### 관찰: viral-hook 팩의 기여

기존 28개 패턴만으로 점수를 매기면 약 10점에 머물렀을 것 (viral-hook 9.3 빼고 계산). 사용자가 명백히 "AI 인플루언서 콘텐츠"로 인지하는 글에 대해 **9~12점 정도의 갭을 viral-hook이 메움**. 이게 score를 사람 직관에 정렬시키는 효과.

### `--rewrite`의 한계

긴 케이스에서도 self-audit 메타가 본문 위로 누출됨:
> *잔여 AI 티: 큰 수치와 NVIDIA 협업 주장은 출처가 없으면 과장 광고처럼 보일 수 있습니다. 다만 rewrite 모드라 사실관계는 유지했습니다.*

또한 viral-hook이 score-only라 rewrite는 자체적으로 마케팅 신호를 잡았지만, 일부 강한 viral 어휘("가장 싸게 올라탈 타이밍" → "가장 싸게 배울 수 있는 타이밍")는 표면 어휘만 살짝 바꿀 뿐 구조는 유지됨. score-only 격리의 의도된 동작.
