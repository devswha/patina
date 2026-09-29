# Patina에 기여하기

CLI 수정, 감지 신호, 패턴, 예시, Document Type, Persona, 통합 기능,
문서 등 다양한 형태로 기여할 수 있습니다.

## 저장소 구성

- `src/`, `api/`, `playground/`에는 실행되는 제품 코드가 있습니다.
- `SKILL.md`와 `core/`는 제품의 텍스트 처리 흐름을 설명합니다.
- `patterns/`, `document-types/`, `personas/`, `examples/`에는 제품 자산이 있습니다.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md)는 현재 모듈 구조를 설명합니다.
- [QA.md](docs/QA.md)는 테스트 명령과 검증 범위를 정리합니다.
- [WORKFLOW.md](docs/WORKFLOW.md)에는 Git, CI, 릴리스 명령 예시가 있습니다.
- `docs/research/`에는 날짜별 연구와 제안이, `docs/operations/`에는
  운영 방법과 과거 기록이 있습니다.

## 로컬 개발

개발 검사는 Node 24를 사용합니다. 배포된 CLI의 최소 Node 버전은
`package.json`에 기록돼 있습니다.

```bash
npm ci
npm test
npm run lint
```

구현 중에는 관련 테스트만 실행할 수 있습니다. `npm run test:browser`는
Chromium fixture로 playground를 검사합니다. 다른 명령은 `package.json`과
[하네스 안내](docs/HARNESS.md)에 있습니다.

## 새 패턴 추가

패턴은 `patterns/{lang}-{category}.md`에 있습니다. 카테고리는 content,
language, style, structure, communication, filler, score 전용 viral-hook입니다.
기존 팩의 frontmatter와 번호가 붙은 `### N.` 항목에서 형식을 볼 수 있습니다.

- Watch words와 감지 조건
- 제외 조건과 오탐 예시
- 편집하려는 문제의 설명
- 원래 의미를 유지한 before/after 텍스트

언어 팩은 한국어, 영어, 중국어, 일본어입니다. 한 언어부터 기여할 수 있습니다.
[패턴 제안 폼](.github/ISSUE_TEMPLATE/pattern_proposal.yml)과
[pattern of the week](docs/community/pattern-of-the-week.md)는 아이디어를
정리할 때 참고할 수 있습니다.

팩 frontmatter는 `patterns:` 수를 기록합니다. 카탈로그는
`docs/PATTERNS.md`와 `docs/PATTERNS-{lang}.md`에, 예시는 `examples/`에 있습니다.
패턴 수가 달라지면 README와 SKILL 메타데이터에도 영향을 줄 수 있습니다.

근거가 달라지면 패턴을 추가, 수정, 약화하거나 삭제할 수 있습니다.
[패턴 최신성 안내](process/pattern-freshness.md)는 관련 도구와 출처 필드를 설명합니다.

## 오탐과 fixture

오탐 보고에는 언어, 글의 맥락, 관찰한 신호, 공유 가능한 작은 재현 사례가
도움이 됩니다. 제외 조건, 감지 로직, Document Type override를 바꾸거나
신뢰하기 어려운 패턴을 제거하는 방법 등을 검토할 수 있습니다.

Suspect-zone fixture는 `tests/fixtures/suspect-zones/{lang}/{ai|natural}/`에
있습니다. Frontmatter는 fixture와 예상 측정값을 설명합니다.

```yaml
---
fixture_id: en-ai-07-example
language: en
class: ai
expected_hot: true
why_designed_this_way: |
  이 fixture가 검사하는 결정론적 신호를 설명합니다.
expected_metrics:
  cv_band: low
---
```

`npm run benchmark:report`는 `tests/quality/results.json`,
`docs/benchmarks/latest.json`, `docs/benchmarks/latest.md`를 재생성합니다.

## 감지 신호

현재 `src/features/`의 분석기는 모델이나 네트워크 없이 로컬에서 신호를
계산합니다. `src/features/index.js`는 이를 문단과 문서 결과로 합칩니다.
[ARCHITECTURE.md](docs/ARCHITECTURE.md)는 호출 경로와 공개 출력을,
`core/stylometry.md`는 현재 점수 계산을 설명합니다.

`npm run benchmark:signal-impact`는 신호별 기여와 오탐을 비교합니다.
조건을 맞춘 사람 글, 감지하지 못한 예시, 언어·register별 결과는 새 감지기를
평가하는 데 도움이 됩니다. 같은 도구로 새로운 접근이나 기존 방식의 수정도
실험할 수 있습니다.

## Document Type과 Persona

Document Type은 `document-types/{name}.md`에 있습니다. Frontmatter에는
`document-type`, `scope`, `purpose`, `audience`, `structure`, `style`, `avoid`,
언어별 `pattern-overrides`가 들어갑니다. 현재 `suppress`는 결정론적 분석에
영향을 주고, `reduce`/`amplify`는 런타임 가중치 변경 없이 정책 의도를 표현합니다.

`patina persona new`는 재사용할 수 있는 목소리 메타데이터를 만듭니다.
현재 Persona 검증기는 목소리 필드와 Document Type, Register, 안전성 필드를
구분합니다.

## 번역

영어·한국어 문서 쌍에는 `README`, `CONTRIBUTING`, `docs/FAQ`,
`docs/AUTHENTICATION`, `docs/EXAMPLES`가 있습니다. 두 버전을 함께 살펴보면
명령과 설명을 맞추는 데 도움이 됩니다. 패턴은 영어 표현을 그대로 옮기기보다
대상 언어에서 자연스러운 예시로 설명할 수 있습니다.

## 버전과 릴리스

`package.json`이 패키지 버전의 기준입니다. `npm run release:check`는
연결된 버전 정보와 CHANGELOG를 검사하며, `npm run release:sync-plugin-versions`는
플러그인 버전 정보를 갱신합니다. [릴리스 안내](docs/integrations/release.md)는
산출물 생성, npm 공개, 컨테이너 배포를 설명합니다.

## PR 절차

변경은 보통 PR을 통해 `main`에 반영합니다. 동작, 판단 근거, 관련 검사 결과를
설명하면 검토에 도움이 됩니다. 논의나 추적이 필요할 때 Issue를 사용할 수
있습니다. 리뷰 중 다른 대안을 검토하거나 새로운 근거에 따라 접근을 바꿀 수 있습니다.

저장소는 공개돼 있습니다. 합성 예시와 정리된 요약을 사용하면 자격 증명이나
개인 텍스트를 공개하지 않고도 비공개 입력의 문제를 논의할 수 있습니다.
