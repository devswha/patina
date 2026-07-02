---
pack: ai-lexicon-ko
language: ko
version: 2.0.0
entries: 33
entry-provenance: lexicon/provenance/ai-ko.json
corpus-snapshot:
  id: ko-remine-2026-07
  status: validated
  source: >-
    hot 840 docs (ko-intake 130 + ko-modern-generations 120 + KatFish essay AI 590,
    5+1 registers) vs cold 466 docs (web-human-controls 285 + KatFish essay human 181).
    KatFish: Park et al., ACL 2025 (arXiv:2503.00032). Raw corpus stays local/private;
    aggregate report at docs/benchmarks/lexicon-freshness-ko-2026-07.md
  last_validated: 2026-07-02
---

# AI-favored 어휘 (Korean)

한국어 AI 텍스트가 사람 글보다 훨씬 자주 쓰는 표현 모음. `ko-*.md` 28-패턴 카탈로그를
보강하는 결정론 탐지 레이어다.

**v2.0 수록 원칙 (2026-07 개정):** v1.x 는 "카탈로그가 명명한 어휘는 렉시콘에서 제외"
원칙을 썼으나, 결정론 레이어(analyzeText/score)는 카탈로그를 읽지 않으므로 이 원칙이
탐지 사각지대를 만들었다 (예: `결론적으로`는 ko-filler.md 에 있어 렉시콘에서 빠졌고,
그 결과 결정론 채점이 전혀 못 잡았다). v2.0 부터 **외부 검증된 고정밀 앵커는 카탈로그와
중복 수록**한다. 중복 항목은 아래에 개별 표기.

**v2.0 승격 게이트 (사전등록, 전 항목 통과):**
- hot/cold doc-frequency lift ≥4× (phrase ≥6×), cold DF ≤5%
- 신규 항목은 hot DF ≥8 + 2개 이상 레지스터 출현 (주제 누출 방지)
- 주제/도메인 명사·일반 용언 기각 — 담화 표지/의례적 스캐폴드만 수록
- 근거 코퍼스·전체 keep/drop 결정: docs/benchmarks/lexicon-freshness-ko-2026-07.md

v1.x 96 항목 중 75 항목이 2026-07 재마이닝에서 게이트 미달로 제거됨
(측정 증거 있는 미달 20 / 코퍼스 무증거 55 — 리포트의 drop 아카이브 참조).

매칭 규칙:
- "Strict matches" 항목: 전체 단어/어절 단위 (대소문자 무시; 한국어는 의미 없음)
- "Multi-word phrases" 항목: 부분 문자열 매칭 (조사/어미 변형 자연 포착)
- 문말 앵커 항목(`중요합니다.` 등)은 마침표 포함 — 문장 종결 위치에서만 매칭되어 정밀도를 높인다

## Strict matches (whole word/phrase)

- 가시화
- 꼽힌다
- 더 나아가
- 면모
- 본질
- 양상
- 일환
- 자리매김
- 자리잡은
- 차별화
- 평가된다
- 한걸음 더
- 한편으로는
- 활성화
- 결론적으로
- 궁극적으로

## Multi-word phrases (substring)

- 새로운 가능성을
- 시사점을 제공
- 의미가 있다
- 자리 잡았다
- 자리잡고 있다
- 중요한 의미
- 큰 의미를
- 이를 통해
- 중요합니다.
- 있습니다. 또한,
- 중요한 역할을
- 필요가 있습니다
- 있으며, 이는
- 하나입니다.
- 영향을 미칩니다.
- 가능성이 큽니다.
- 라고 할 수 있습니다

## Notes on each entry (why AI-favored)

**유지된 v1.x 항목** (재마이닝 통과 21개): 한국어 AI 글이 "구체 묘사" 대신 "추상 명명"으로
도피할 때 쓰는 어휘 축 — `자리매김`, `양상`, `면모`, `본질`, `일환`, `활성화`,
`차별화`, `가시화` 등. 사람은 행동·수치·일화로 쓰지만 AI 는 추상명사로 채운다.
phrase 쪽은 단락 도입·결론의 의례적 구문 (`시사점을 제공`, `중요한 의미` 등).

**v2.0 신규 항목** (2026-07 마이닝, im-not-ai taxonomy v2.0 / KatFish 교차 검증):
- `결론적으로` (strict) — im-not-ai D-1 (KatFish-validated); ko-filler.md 앵커 중복 수록; lift 83.492 (hot 301/840, cold 2/466)
- `궁극적으로` (strict) — im-not-ai D-1 계열; ko-filler.md 앵커 중복 수록; lift 6.102 (hot 11/840, cold 1/466)
- `이를 통해` (phrase) — im-not-ai D-1; ko-language.md 패턴 7 앵커 중복 수록; lift 51.315 (hot 185/840, cold 2/466)
- `중요합니다.` (phrase) — 공허한 중요성 단정 (D-2 계열), 문말 앵커; n/a
- `있습니다. 또한,` (phrase) — 문장 경계 연결 스캐폴드 (C-11 어휘형); lift 61.024 (hot 110/840, cold 1/466)
- `중요한 역할을` (phrase) — 의례적 콜로케이션; lift ∞ (hot 67/840, cold 0/466)
- `필요가 있습니다` (phrase) — im-not-ai signature phrase; lift 16.088 (hot 58/840, cold 2/466)
- `있으며, 이는` (phrase) — 연결 스캐폴드; lift ∞ (hot 37/840, cold 0/466)
- `하나입니다.` (phrase) — 나열 상투구 (~중 하나입니다), 문말 앵커; n/a
- `영향을 미칩니다.` (phrase) — 영향 단정 상투구, 문말 앵커; lift ∞ (hot 24/840, cold 0/466)
- `가능성이 큽니다.` (phrase) — 헤징 상투구, 문말 앵커; lift ∞ (hot 17/840, cold 0/466)
- `라고 할 수 있습니다` (phrase) — im-not-ai signature phrase; lift 8.876 (hot 16/840, cold 1/466)

엔트리 추가 기준: 위 승격 게이트를 통과하고, 사람 텍스트에서도 비슷한 빈도로 나오는
표현이 아닐 것. 코퍼스가 커버하지 못하는 레지스터(보도자료/마케팅)의 후보는
코퍼스 확장 전까지 추가하지 않는다.
