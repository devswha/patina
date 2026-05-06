---
pack: ko-viral-hook
type: success
patterns: [1, 2, 3, 4, 5]
score_only: true
---

# Viral Hook Case 01: Marketing Influencer Post (all 5 patterns)

회귀 테스트용 가상 픽스처. SNS 마케팅 콘텐츠에서 흔히 보이는 "AI 인플루언서 톤" 5개 패턴을 한 글에 압축해 넣은 합성 텍스트로, 모든 viral-hook 패턴이 동시에 발화해야 한다.

## 입력 텍스트

```
다이어트 역사상 이런 결과는 없었다.

단 14일 만에 5kg 감량.

OO-Method라는 비법이 만든 변화임.

광고 한 번 없이 전 세계 사람들이 미친 듯이 따라한 이유가 뭘까.
```

## 기대 출력 (`--rewrite`)

> (rewrite 모드에서는 변경되지 않아야 함 — viral-hook 팩은 `score_only: true`)

## 기대 출력 (`--audit`)

5개 패턴 모두 검출:

| Pattern | Category | Trigger |
|---|---|---|
| 1. 숫자 충격 훅 | ko-viral-hook | "단 14일 만에 5kg 감량" |
| 2. 클릭베이트 미스터리 종결 | ko-viral-hook | "...따라한 이유가 뭘까" |
| 3. 검증 회피 단언 | ko-viral-hook | "다이어트 역사상...", "전 세계 사람들이..." |
| 4. 호흡 최적화 단문 배열 | ko-viral-hook | 4문장이 1줄/1단락 형식 |
| 5. AI 인플루언서 어휘 | ko-viral-hook | "미친 듯이" |

## 기대 출력 (`--score`)

- viral-hook 카테고리 raw score: 80~95 (5/5 검출, 다수 High severity)
- 다른 카테고리(content/language/style/communication/filler/structure): 0.0 — false positive 없을 것
- Overall: 6~16 범위 (LLM 분산 ±10 고려)
- Interpretation: `human` 또는 `mostly human`이지만 viral 신호가 한 카테고리에 집중

## 실측 (codex-cli, gpt-5.5)

```
| viral-hook | 0.10 | #1 High, #2 High, #3 High, #4 High, #5 Low | 86.7 | 8.7 |
| 다른 카테고리 | — | 0/N detected | 0.0 | 0.0 |
| Overall | — | — | — | 7.9 |
```

## 회귀 기준선

이 픽스처가 다음 조건 중 하나라도 어기면 회귀로 판단:

1. `--audit`에서 5개 viral-hook 패턴 중 **3개 미만** 검출 → 패턴 정의 또는 prompt 약화
2. `--score`에서 viral-hook 카테고리 raw score < 50 → 심각도 평가 약화
3. content/language/style 카테고리에서 패턴 검출 → false positive
4. `--rewrite` 모드에서 텍스트가 변경됨 → score-only 격리 깨짐

## 적용 패턴 상세

각 패턴이 발화되는 근거는 `patterns/ko-viral-hook.md` 정의 참조.
