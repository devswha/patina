# examples/

이 디렉토리에는 oh-my-humanizer 패턴의 동작을 검증하는 예제 파일들이 담겨 있다.

## 목적

패턴이 의도한 대로 동작하는지 (성공), 의도치 않게 오탐/과교정하는지 (실패) 두 가지 케이스를 각 패턴별로 문서화한다.

## 파일 명명 규칙

```
{패턴번호}-{판정}-{순번}.md          ← 한국어 패턴
en-{패턴번호}-{판정}-{순번}.md       ← 영어 패턴
```

- `{패턴번호}`: 패턴 번호 (예: `25`, `06`)
- `{판정}`: `success` (올바른 탐지/교정) 또는 `failure` (오탐/과교정)
- `{순번}`: 두 자리 정수 (01, 02, ...)

예시: `25-success-01.md`, `26-failure-01.md`, `en-01-success-01.md`

## 판정 유형

| 유형 | 설명 |
|------|------|
| **성공** | 패턴이 실제 AI 글쓰기 문제를 올바르게 탐지하고 교정한 경우 |
| **실패 (오탐)** | 패턴이 정상적인 텍스트를 AI 패턴으로 잘못 탐지한 경우 |
| **실패 (과교정)** | 패턴이 교정할 필요 없는 표현을 불필요하게 수정한 경우 |

## 한국어 패턴 예제 목록

| 파일 | 패턴 | 판정 | 설명 |
|------|------|------|------|
| `06-success-01.md` | #6 도입 공식 | 성공 | 틀에 박힌 시대적 도입부 → 구체적 수치로 교체 |
| `06-failure-01.md` | #6 도입 공식 | 실패 (오탐) | 구체적 역사적 언급을 공식 도입부로 오인 |
| `07-success-01.md` | #7 AI 특유 어휘 남발 | 성공 | AI 어휘 11개 집중 → 구체적 수치로 교체 |
| `07-failure-01.md` | #7 AI 특유 어휘 남발 | 실패 (오탐) | 데이터 밀집 연구문의 단독 "체계적인" 오탐 |
| `13-success-01.md` | #13 과도한 연결 표현 | 성공 | 연결 어구 4개 연쇄 → 수치+기관명으로 교체 |
| `13-failure-01.md` | #13 과도한 연결 표현 | 실패 (과교정) | 대조 구조의 단독 "한편" 과교정 |
| `19-success-01.md` | #19 챗봇 표현 | 성공 | 챗봇 서비스 어구 3개 → 실제 정책 내용으로 교체 |
| `19-failure-01.md` | #19 챗봇 표현 | 실패 (과교정) | 고객 안내문의 정상적인 공손 표현 과교정 |
| `23-success-01.md` | #23 과도한 헤징 | 성공 | 9겹 중첩 완화 표현 → 근거 있는 단언으로 교체 |
| `23-failure-01.md` | #23 과도한 헤징 | 실패 (과교정) | 의학 데이터 한계 표현을 AI 헤징으로 오인 |
| `24-success-01.md` | #24 막연한 긍정적 결론 | 성공 | 모호한 기대 마무리 → 구체적 일정/계획으로 교체 |
| `24-failure-01.md` | #24 막연한 긍정적 결론 | 실패 (과교정) | 진짜 개인적 기대감을 불필요하게 수정 |
| `25-success-01.md` | #25 구조적 반복 | 성공 | 동일 단락 구조 반복 → 다양한 구조로 변환 |
| `25-failure-01.md` | #25 구조적 반복 | 실패 (오탐) | 의도적 비교/대조 구조를 AI 반복으로 오인 |
| `26-success-01.md` | #26 번역체 | 성공 | 복수 번역체 표현 → 자연스러운 한국어로 교체 |
| `26-failure-01.md` | #26 번역체 | 실패 (오탐) | 학술 문맥의 단독 표현을 번역체로 오인 |
| `26-success-02.md` | #26 번역체 | 성공 (2) | 추가 번역체 케이스 |
| `27-success-01.md` | #27 수동태 남용 | 성공 | 이중 피동("~되어지다") → 능동/단순 수동으로 교체 |
| `27-failure-01.md` | #27 수동태 남용 | 실패 (과교정) | 법령 문맥의 정상적 수동태를 불필요하게 수정 |
| `28-success-01.md` | #28 불필요한 외래어 | 성공 | 경영 외래어 9개 집중 → 한국어로 교체 |
| `28-failure-01.md` | #28 불필요한 외래어 | 실패 (과교정) | IT 전문 용어를 대체 가능 외래어로 오인 |

## 영어 패턴 예제 목록

| 파일 | 패턴 | 판정 | 설명 |
|------|------|------|------|
| `en-01-success-01.md` | en #1 Undue Emphasis | Success | Software update inflated to "groundbreaking paradigm shift" |
| `en-01-failure-01.md` | en #1 Undue Emphasis | Failure (false positive) | Apollo 11 described with proportionate "turning point" |
| `en-07-success-01.md` | en #7 AI Vocabulary Words | Success | 15 watch-list words in 2 sentences → concrete findings |
| `en-07-failure-01.md` | en #7 AI Vocabulary Words | Failure (false positive) | Single "robust" in data-dense research text |

## 패턴 팩 참조

### 한국어
- `ko-content.md` — 패턴 #1–6 (콘텐츠 패턴)
- `ko-language.md` — 패턴 #7–12 (언어/문법 패턴)
- `ko-style.md` — 패턴 #13–18 (스타일 패턴)
- `ko-communication.md` — 패턴 #19–21 (소통 패턴)
- `ko-filler.md` — 패턴 #22–24 (채움/완화 패턴)
- `ko-structure.md` — 패턴 #25–28 (구조 패턴)

### English
- `en-content.md` — Patterns #1–6 (Content Patterns)
- `en-language.md` — Patterns #7–12 (Language Patterns)
- `en-style.md` — Patterns #13–18 (Style Patterns)
- `en-communication.md` — Patterns #19–21 (Communication Patterns)
- `en-filler.md` — Patterns #22–24 (Filler Patterns)
- `en-structure.md` — Patterns #25–28 (Structure Patterns)
