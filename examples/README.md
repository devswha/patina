# examples/

이 디렉토리에는 patina 패턴의 동작을 검증하는 예제 파일들이 담겨 있다.

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
| `01-success-01.md` | #1 과도한 중요성 부여 | 성공 | 앱 업데이트를 "패러다임의 전환"으로 과장 → 구체적 변경 내용으로 교체 |
| `01-failure-01.md` | #1 과도한 중요성 부여 | 실패 (오탐) | 실제 역사적 대사건(훈민정음)에서 강조 표현 사용 |
| `02-success-01.md` | #2 과도한 주목도/미디어 언급 | 성공 | 구체적 매체명 없이 "세계적 주목" 주장 → 구체적 인용으로 교체 |
| `02-failure-01.md` | #2 과도한 주목도/미디어 언급 | 실패 (오탐) | 기사 제목·날짜·인용이 구체적으로 명시된 경우 |
| `03-success-01.md` | #3 ~하며/~하고 피상적 분석 | 성공 | "~하며/~하고" 5개 연쇄 → 구체적 수치로 교체 |
| `03-failure-01.md` | #3 ~하며/~하고 피상적 분석 | 실패 (오탐) | 단일 연결로 인과 관계가 명확한 경우 |
| `04-success-01.md` | #4 홍보성/광고성 언어 | 성공 | 수식어 7개 남발 → 구체적 사실/수치로 교체 |
| `04-failure-01.md` | #4 홍보성/광고성 언어 | 실패 (오탐) | 소설 장면 묘사에서 문학적 수사 사용 |
| `05-success-01.md` | #5 모호한 출처 인용 | 성공 | 익명 권위 3개 연속 → 구체적 기관·보고서로 교체 |
| `05-failure-01.md` | #5 모호한 출처 인용 | 실패 (오탐) | 상식적 합의 사실("의사들은 운동이 좋다고 권장") |
| `06-success-01.md` | #6 도입 공식 | 성공 | 틀에 박힌 시대적 도입부 → 구체적 수치로 교체 |
| `06-failure-01.md` | #6 도입 공식 | 실패 (오탐) | 구체적 역사적 언급을 공식 도입부로 오인 |
| `07-success-01.md` | #7 AI 특유 어휘 남발 | 성공 | AI 어휘 11개 집중 → 구체적 수치로 교체 |
| `07-failure-01.md` | #7 AI 특유 어휘 남발 | 실패 (오탐) | 데이터 밀집 연구문의 단독 "체계적인" 오탐 |
| `08-success-01.md` | #8 ~적(的) 접미사 남발 | 성공 | 한 문장에 "~적" 형용사 4개 → 구체적 서술로 교체 |
| `08-failure-01.md` | #8 ~적(的) 접미사 남발 | 실패 (오탐) | 학술 전문 용어("체계적 문헌 고찰") 단독 사용 |
| `09-success-01.md` | #9 부정 병렬구조 | 성공 | 부정 병렬 구조 3회 연쇄 → 긍정 서술로 교체 |
| `09-failure-01.md` | #9 부정 병렬구조 | 실패 (오탐) | 실질적 오해 교정 목적의 대비 구조 |
| `11-success-01.md` | #11 유의어 순환 | 성공 | 같은 대상을 4가지 명칭으로 지칭 → 일관된 명칭으로 통일 |
| `11-failure-01.md` | #11 유의어 순환 | 실패 (오탐) | 모회사·자회사 의도적 구분 |
| `12-success-01.md` | #12 장황한 조사 사용 | 성공 | "~에 있어서" 류 4개 연쇄 → 간결한 조사로 교체 |
| `12-failure-01.md` | #12 장황한 조사 사용 | 실패 (오탐) | "교사로서" 자격·역할 구분 목적 단독 사용 |
| `13-success-01.md` | #13 과도한 연결 표현 | 성공 | 연결 어구 4개 연쇄 → 수치+기관명으로 교체 |
| `13-failure-01.md` | #13 과도한 연결 표현 | 실패 (과교정) | 대조 구조의 단독 "한편" 과교정 |
| `14-success-01.md` | #14 볼드체 남발 | 성공 | 키워드 기계적 볼드 처리 → 볼드 제거, 간결하게 |
| `14-failure-01.md` | #14 볼드체 남발 | 실패 (오탐) | UI 가이드에서 버튼명 표시 |
| `15-success-01.md` | #15 인라인 헤더 목록 | 성공 | "**레이블:** 설명" 형식 반복 → 산문으로 통합 |
| `15-failure-01.md` | #15 인라인 헤더 목록 | 실패 (오탐) | API 파라미터 문서의 표준 양식 |
| `17-success-01.md` | #17 이모지 | 성공 | 비즈니스 보고서에 이모지 장식 → 이모지 제거 |
| `17-failure-01.md` | #17 이모지 | 실패 (오탐) | SNS 마케팅 카피에서 의도적 이모지 사용 |
| `18-success-01.md` | #18 과도한 한자어/공식어 | 성공 | 일반 글에 공문서투 표현 남발 → 쉬운 말로 교체 |
| `18-failure-01.md` | #18 과도한 한자어/공식어 | 실패 (오탐) | 실제 공문서에서 관례적 공식어 사용 |
| `19-success-01.md` | #19 챗봇 표현 | 성공 | 챗봇 서비스 어구 3개 → 실제 정책 내용으로 교체 |
| `19-failure-01.md` | #19 챗봇 표현 | 실패 (과교정) | 고객 안내문의 정상적인 공손 표현 과교정 |
| `20-success-01.md` | #20 학습 데이터 기한 면책 | 성공 | AI 면책 표현 3개 → 구체적 출처·날짜로 교체 |
| `20-failure-01.md` | #20 학습 데이터 기한 면책 | 실패 (오탐) | AI 기술 문서에서 모델 사양 설명 |
| `21-success-01.md` | #21 아첨하는 말투 | 성공 | 본론 앞 아첨 표현 3개 → 본론 직접 시작 |
| `21-failure-01.md` | #21 아첨하는 말투 | 실패 (과교정) | 인터뷰 전사본의 직접 인용 |
| `22-success-01.md` | #22 채움 표현 | 성공 | 채움 표현 5개 연쇄 → 간결한 표현으로 교체 |
| `22-failure-01.md` | #22 채움 표현 | 실패 (오탐) | 계약서에서 법률 정밀성을 위한 표현 |
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
| `en-03-success-01.md` | en #3 Superficial -ing Analyses | Success | 4+ "-ing" chains with no causal depth → concrete findings |
| `en-03-failure-01.md` | en #3 Superficial -ing Analyses | Failure (false positive) | Participles with genuine causal connections |
| `en-04-success-01.md` | en #4 Promotional Language | Success | Promotional adjectives in editorial prose → factual rewrite |
| `en-04-failure-01.md` | en #4 Promotional Language | Failure (false positive) | Promotional language inside direct quotation being analyzed |
| `en-07-success-01.md` | en #7 AI Vocabulary Words | Success | 15 watch-list words in 2 sentences → concrete findings |
| `en-07-failure-01.md` | en #7 AI Vocabulary Words | Failure (false positive) | Single "robust" in data-dense research text |
| `en-08-success-01.md` | en #8 Copula Avoidance | Success | Multiple "serves as" circumlocutions → direct verbs |
| `en-08-failure-01.md` | en #8 Copula Avoidance | Failure (false positive) | "Serves as" describing formal institutional role |
| `en-13-success-01.md` | en #13 Em Dash Overuse | Success | 3+ em dashes in one paragraph → varied punctuation |
| `en-13-failure-01.md` | en #13 Em Dash Overuse | Failure (false positive) | Single em dash for literary dramatic pause |
| `en-19-success-01.md` | en #19 Collaborative Communication | Success | Chatbot phrases in editorial content → direct prose |
| `en-19-failure-01.md` | en #19 Collaborative Communication | Failure (false positive) | Chatbot phrases quoted as UX research objects |
| `en-21-success-01.md` | en #21 Sycophantic Tone | Success | Flattery before substantive content → direct start |
| `en-21-failure-01.md` | en #21 Sycophantic Tone | Failure (false positive) | "Great question" in attributed direct dialogue |
| `en-22-success-01.md` | en #22 Filler Phrases | Success | Multiple filler phrases → concise rewrite |
| `en-22-failure-01.md` | en #22 Filler Phrases | Failure (false positive) | "In order to" in legal/regulatory context |
| `en-25-success-01.md` | en #25 Metronomic Paragraph Structure | Success | 3+ identical paragraph templates → varied structure |
| `en-25-failure-01.md` | en #25 Metronomic Paragraph Structure | Failure (false positive) | Repeated structure in comparative product review |
| `en-26-success-01.md` | en #26 Passive Nominalization Chains | Success | 2+ passive nominalizations → active verbs |
| `en-26-failure-01.md` | en #26 Passive Nominalization Chains | Failure (false positive) | Passive voice in scientific methods section |

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
