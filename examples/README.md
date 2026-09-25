# examples/

이 디렉토리에는 patina 패턴의 동작을 검증하는 예제 파일들이 담겨 있다.

## 목적

패턴이 의도한 대로 동작하는지 (성공), 의도치 않게 오탐/과교정하는지 (실패) 두 가지 케이스를 각 패턴별로 문서화한다.
Document Type 전용 예시는 `examples/document-types/`에 둔다. 이 예시는 패턴 번호보다 문서 정책과 구조 관습을 설명하며, 외부 라이선스가 있는 원문을 복사하지 않는다.

## 재작성 3축 예시

재작성 입력은 서로 독립적인 세 축으로 나뉜다.

| 축 | 예시 | 바꾸는 것 | 바꾸지 않는 것 |
|---|---|---|---|
| Document Type | [`document-types/`](document-types/), [`rewrite-axes/academic-ko.md`](rewrite-axes/academic-ko.md) | 장르·용도·구조 관습·패턴 정책 | 목소리, casual/professional 전달 방식, 사실 |
| Persona | `patina --persona <name>` | 사용자가 명시적으로 고른 재사용 목소리 | 장르, Register, 사실, 검증 하한 |
| Register | [`rewrite-axes/casual-ko.md`](rewrite-axes/casual-ko.md), [`rewrite-axes/professional-ko.md`](rewrite-axes/professional-ko.md) | `casual | professional` 전달 방식 | 장르, Persona, 사실 |

Persona와 Register를 생략하면 원문의 목소리와 레지스터를 보존한다. 모든 before/after는 주장·수치·극성·인과를 그대로 유지해야 하며, Document Type이나 Register를 바꾼다는 이유로 인물·장면·성과·사례를 새로 만들 수 없다.

## 파일 명명 규칙

```
{패턴번호}-{판정}-{순번}.md          ← 한국어 패턴
en-{패턴번호}-{판정}-{순번}.md       ← 영어 패턴
zh-{패턴번호}-{판정}-{순번}.md       ← 중국어 패턴
ja-{패턴번호}-{판정}-{순번}.md       ← 일본어 패턴
```

- `{패턴번호}`: 패턴 번호 (예: `25`, `06`)
- `{판정}`: `success` (올바른 탐지/교정) 또는 `failure` (오탐/과교정)
- `{순번}`: 두 자리 정수 (01, 02, ...)

예시: `25-success-01.md`, `26-failure-01.md`, `en-01-success-01.md`, `zh-01-success-01.md`, `ja-01-success-01.md`

## 판정 유형

| 유형 | 설명 |
|------|------|
| **성공** | 패턴이 실제 AI 글쓰기 문제를 올바르게 탐지하고 교정한 경우 |
| **실패 (오탐)** | 패턴이 정상적인 텍스트를 AI 패턴으로 잘못 탐지한 경우 |
| **실패 (과교정)** | 패턴이 교정할 필요 없는 표현을 불필요하게 수정한 경우 |

## 커버리지

재작성 패턴 번호마다 success/failure 예제 한 쌍(`-success-01`, `-failure-01`)이 있다. 몇몇 번호(#25, #26, #28, #31)는 두 번째 예제(`-02`)를 더 둔다. 현재 범위는 KO #1–41, EN #1–38, ZH·JA 각 #1–37이다. 각 번호가 어떤 패턴인지는 `patterns/{lang}-*.md`와 `docs/PATTERNS-{KO,EN,ZH,JA}.md`에서 확인한다. 새 패턴을 추가할 때는 같은 이름 규칙으로 한 쌍을 함께 추가한다.

success 예제는 패턴 파일의 수정 전/후 쌍을 독립 fixture로 옮긴 것이고, failure 예제는 각 패턴의 배제 조건이 실제로 작동해야 하는 안전장치 사례다. 스코어 전용 viral-hook 팩은 재작성하지 않으므로 탐지 예시만 둔다.

## 그 밖의 예시

- `short/`, `genres/` — 짧은 원문과 긴 장르별 원문, 그리고 짝을 이루는 재작성
- `rewrite-axes/` — Document Type·Register 축 예시
- `document-types/` — Document Type 정책 예시
- `viral-hook/` — 스코어 전용 viral-hook 팩의 탐지 case study(`case-01`, `case-02`)
- `sample.md` — `viral-hook/case-02`가 쓰는 장문 입력
- `e2e/` — 과거 E2E 실행 기록

## 패턴 팩 참조

팩 파일 이름은 `patterns/{lang}-{팩}.md`다.

| 팩 | KO | EN | ZH / JA |
|---|---|---|---|
| content (콘텐츠) | #1–6 | #1–6 | #1–6 |
| language (언어/문법) | #7–12, #32–34 | #7–12, #32–34 | #7–12, #32–34 |
| style (스타일) | #13–18, #37 | #13–18, #37–38 | #13–18, #37 |
| communication (소통) | #19–21, #29, #40 | #19–21, #29 | #19–21, #29 |
| filler (채움/완화) | #22–24, #31, #35–36, #38–39 | #22–24, #31, #35–36 | #22–24, #31, #35–36 |
| structure (구조) | #25–28, #30, #41 | #25–28, #30 | #25–28, #30 |
| viral-hook (스코어 전용) | 9개 | 9개 | 9개 |
