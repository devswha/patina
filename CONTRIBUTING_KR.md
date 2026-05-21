# Patina에 기여하기

기여를 검토해 주셔서 감사합니다. Patina는 패턴 기반 도구이므로 가장 큰 도움이 되는 기여는 새 패턴, 더 나은 예시, 프로필 개선인 경우가 많습니다.

## 공개 문서와 내부 문서

사용자용 문서는 `README*.md`, `docs/`, `examples/`, `patterns/`, `profiles/`, 스킬 엔트리포인트에 둡니다. 유지보수자나 에이전트용 메모는 `docs/internal/` 아래에 두며, 공개 문서 목록으로 승격하기 전까지는 설치, CLI, API 계약으로 보지 않습니다.

루트의 Markdown 파일을 옮길 때는 공개 문서라면 `README.md`에서 링크하거나, 내부 문서라면 `docs/internal/`로 옮기고 대상 독자를 짧게 적습니다.

## 한국어 번역 정책

설치, 지원, 기여, 예시, 문제 해결을 설명하는 주요 사용자 문서는 한국어 쌍을 유지해야 합니다. 필수 쌍은 다음과 같습니다.

- `README.md` → `README_KR.md`
- `CONTRIBUTING.md` → `CONTRIBUTING_KR.md`
- `docs/FAQ.md` → `docs/FAQ_KR.md`
- `docs/AUTHENTICATION.md` → `docs/AUTHENTICATION_KR.md`
- `docs/EXAMPLES.md` → `docs/EXAMPLES_KR.md`

PR에서 위 영어 문서를 바꾸면 같은 PR에서 한국어 쌍도 갱신하거나, 번역이 잠시 뒤처져도 안전한 이유를 설명하세요. 명령어, 경로, 설정 키, 이슈 번호, 코드 펜스는 원문이 바뀌지 않는 한 그대로 둡니다.

## 새 패턴 추가

1. **올바른 팩을 고릅니다.** 패턴은 `patterns/{lang}-{category}.md`에 있습니다. 카테고리: content, language, style, structure, communication, filler.

2. **템플릿을 따릅니다.** 각 패턴에는 다음이 필요합니다.
   - 번호(다음 번호, 예: #30)
   - Watch words
   - Fire condition(언제 감지해야 하는가?)
   - Exclusion condition(언제 감지하지 않아야 하는가?)
   - 문제 설명
   - before/after 예시

3. **가능한 언어에 추가합니다.** 현재 언어 팩은 4개(ko, en, zh, ja)입니다. 한 언어만 알아도 괜찮습니다. 해당 언어 PR을 만들고 나머지는 번역이 필요하다고 적어 주세요.

4. **카운트를 맞춥니다.** 패턴을 추가한 뒤:
   - 팩 헤더의 `patterns:` 수를 올립니다.
   - README.md와 README_KR.md의 패턴 표와 총계를 갱신합니다.
   - SKILL.md 설명에 하드코딩된 총계가 있으면 갱신합니다.

5. **예시를 추가합니다.** 가능하면 `examples/{lang}-{number}-success-01.md`와 `examples/{lang}-{number}-failure-01.md`(오탐 사례)를 추가합니다.

## 기존 패턴 개선

가장 흔한 개선은 더 나은 before/after 예시입니다. "after" 텍스트는 원래 의미를 보존해야 하며, 다른 내용으로 바꾸면 안 됩니다.

간단한 확인법: 누군가 "after"만 읽어도 "before"와 같은 핵심 내용을 이해할 수 있나요? 감정 방향이 뒤집히면 나쁜 예시입니다.

## 패턴 평가 체크리스트

패턴 PR을 열기 전에 확인하세요.

- **Fire condition:** 실제 AI 생성 예시 2-3개 이상에서 감지될 수 있나요?
- **Exclusion condition:** 사람이 쓴, 해당 장르에 자연스러운 예시가 감지를 피할 수 있나요?
- **Semantic risk:** rewrite가 손상할 수 있는 사실, 숫자, 극성, 인과, 도메인 용어는 무엇인가요?
- **Before/after pair:** after가 단순 동의어 교체가 아니라 같은 주장을 보존하나요?
- **Freshness evidence:** 새 모델 시대의 tell을 제안한다면 50문서 hot/cold fixture, manifest, 또는 수집 계획을 연결했나요?
- **Count sync:** 팩 frontmatter의 `patterns:`가 번호가 붙은 `### N.` 패턴 heading 수와 같아야 합니다.

## 오탐 분류 절차

학술, 백과사전식, 법률, 기업, 강하게 편집된 문체에서는 오탐이 생길 수 있습니다. 오탐을 보고하려면:

1. false-positive 이슈 템플릿을 사용합니다.
2. 언어, 장르/문체, score/audit excerpt, 과하게 감지된 패턴을 포함합니다.
3. 비공개 텍스트를 제거하거나 재배포 가능한 최소 발췌로 바꿉니다.
4. 수정 방향이 exclusion rule, 낮은 severity, profile override, benchmark fixture 중 무엇인지 제안합니다.

유지보수자는 패턴을 바로 삭제하기보다 exclusion을 좁히는 쪽을 우선해야 합니다.

## 벤치마크 fixture 추가

Suspect-zone fixture는 `tests/fixtures/suspect-zones/{lang}/{ai|natural}/` 아래에 둡니다.

각 fixture에는 YAML frontmatter가 필요합니다.

```yaml
---
fixture_id: en-ai-07-example
language: en
class: ai
expected_hot: true
why_designed_this_way: |
  Explain which deterministic signal should fire and why.
expected_metrics:
  cv_band: low
---
```

그다음 실행합니다.

```bash
npm run benchmark:report
```

이 명령은 `tests/quality/results.json`, `docs/benchmarks/latest.json`, `docs/benchmarks/latest.md`를 다시 생성합니다.

## 예시 번역

- 숫자, 엔티티, 부정, 인과, 양태 같은 원문의 semantic anchor를 보존합니다.
- 영어 AI tell을 대상 언어에서 tell이 아닌데 직역하지 않습니다.
- 어떤 표현이 해당 문체에서는 정상이라면 대상 언어의 오탐 메모를 추가합니다.
- 예시는 재배포 가능해야 합니다. 비공개 사용자 텍스트를 붙여 넣지 마세요.

## 프로필 추가

프로필은 `profiles/{name}.md`에 있습니다. 기존 파일(예: `blog.md`)을 복사한 뒤 조정합니다.
- `voice-overrides`: 어떤 voice dimension을 키우거나 줄일지
- `pattern-overrides`: 언어별 패턴 severity 조정

## 패턴 노후화

AI 문체 패턴은 모델이 미세 조정되면서 바뀝니다. 어떤 패턴은 약해지고(예: "delve"가 밈이 된 뒤), 새 패턴이 나타나기도 합니다.

처리 방식:
- **커뮤니티 보고:** 더 이상 reliable signal이 아닌 패턴을 발견하면 이슈를 엽니다.
- **새 패턴 제안:** 새 AI tell을 발견하면 실제 예시 3개 이상과 50문서 평가 fixture 또는 수집 계획을 포함해 이슈를 엽니다.
- **분기별 리뷰:** 유지보수자는 [`process/pattern-freshness.md`](process/pattern-freshness.md)의 corpus freeze window, promotion threshold, frontmatter metadata 규칙을 따릅니다.
- **Lexicon provenance:** 새로 마이닝하거나 다시 마이닝한 lexicon 항목은 동작을 바꾸기 전에 `added`, `source`, `last_validated` provenance를 기록해야 하며, `npm run lexicon:freshness`로 sidecar가 실제 shipped entry와 맞는지 확인합니다.
- **버전 메모:** 각 패턴 팩에는 `version` 필드가 있습니다. 패턴이 바뀌면 올립니다.
- **대체 없는 삭제 금지:** 패턴을 바로 제거하지 않습니다. `low` severity로 낮추거나 프로필에서 `reduce`로 옮깁니다.

## 버전 정책

Patina는 CLI 동작과 패턴 팩 호환성에 semantic versioning을 사용합니다.

- **Major:** 패턴 삭제/재번호 매기기, config/result schema 변경, 공개 CLI 의미 변경, 기존 패턴 팩과의 호환성 파괴.
- **Minor:** 패턴, 언어, 프로필, 모드, 백엔드, benchmark schema field, 기여자용 workflow 추가.
- **Patch:** 버그 수정, severity/exclusion 조정, 예시 명확화, schema 변경 없는 docs 갱신 또는 benchmark fixture refresh.

각 changelog 항목에는 짧은 semver rationale line을 넣어 downstream 사용자가 pin, test, upgrade 중 무엇을 해야 하는지 알 수 있게 합니다.

## 행동 강령

도움이 되게 행동하세요. 불필요하게 날을 세우지 마세요. AI 문체 패턴은 도덕적 결함이 아닙니다. 우리는 도구를 만드는 것이지 재판을 여는 것이 아닙니다.

## PR 절차

1. `main`에서 fork/branch를 만듭니다.
2. 변경합니다.
3. 패턴 카운트가 일치하는지 확인합니다.
4. 명확한 설명과 함께 PR을 엽니다.
5. 보너스: 변경을 보여 주는 before/after 예시를 포함합니다.
