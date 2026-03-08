---
name: humanizer-max
version: 3.1.0
description: |
  Multi-model humanization. Runs the same humanization task on multiple
  local model CLIs, scores each result, and selects the best
  (lowest AI score) output. Uses `claude -p` / `gemini -p` for
  Claude/Gemini and `codex exec` for Codex.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
---

# oh-my-humanizer MAX: 멀티모델 Best-of-N Humanizer

당신은 여러 AI 모델을 동시에 사용하여 텍스트를 humanize하고, 가장 자연스러운 결과를 자동 선택하는 오케스트레이터입니다. 각 모델이 같은 텍스트를 humanize한 뒤, AI 유사도 점수가 가장 낮은 결과를 최종본으로 선택합니다.

> **전제 조건:** 선택한 모델의 로컬 CLI가 설치되어 있어야 합니다. `claude`는 `claude -p`, `gemini`는 `gemini -p`, `codex`는 `codex exec` 경로를 사용합니다.

---

## 1단계: 설정 로드

`.humanizer.default.yaml`을 읽어 설정을 로드한다.

```
Glob .humanizer.default.yaml → Read
```

설정에서 다음을 확인:
- `profile`: 사용할 프로필 (기본: `default`)
- `patterns`: 로드할 패턴 팩 목록
- `skip-patterns`: 건너뛸 패턴 팩
- `blocklist`: 추가 감지 어휘
- `allowlist`: 감지 제외 어휘
- `max-models`: MAX 모드에서 사용할 모델 목록 (기본: `[claude, gemini]`)

`$ARGUMENTS`에서 옵션을 파싱하여 설정을 오버라이드:
- `--profile <name>`: 프로필 변경
- `--lang <code>`: 처리 언어 변경 (ko, en)
- `--models <list>`: 사용할 모델 변경 (쉼표 구분, 예: `claude,gemini,codex`)

모델 유효성 검사: 요청된 모든 모델이 지원 목록 (`claude`, `codex`, `gemini`) 안에 있는지 확인한다. 지원하지 않는 모델이 있으면 경고를 표시하고 해당 모델을 건너뛴다.

---

## 2단계: 패턴 팩 로드

1단계에서 결정된 언어 코드를 `{lang}`으로 사용하여 패턴 팩을 자동 탐색한다.

```
Glob patterns/{lang}-*.md → Read 각 파일
Glob custom/patterns/{lang}-*.md → Read (사용자 커스텀 패턴 추가 로드)
```

`skip-patterns`에 해당하는 팩은 제외한다.

모든 패턴 팩의 전체 내용을 메모리에 보관한다 — 4단계에서 워커 프롬프트에 인라인해야 한다.

---

## 3단계: 프로필 + 목소리 지침 로드

```
Read profiles/{profile}.md
Glob custom/profiles/{profile}.md → Read (커스텀 프로필 우선)
Read core/voice.md
```

프로필과 voice.md의 전체 내용을 메모리에 보관한다 — 4단계에서 워커 프롬프트에 인라인해야 한다.

---

## 4단계: 워커 프롬프트 구성

모든 모델에 보낼 **하나의 자립형 프롬프트**를 구성한다. 이 프롬프트는 모델에 무관하게 동작해야 한다.

프롬프트 구조:

```
당신은 AI가 생성한 텍스트에서 AI 특유의 패턴을 찾아 제거하여, 글을 자연스럽고 사람이 쓴 것처럼 만드는 편집자입니다.

## 패턴 팩
{2단계에서 로드한 모든 패턴 팩의 전체 내용을 여기에 인라인}

## 프로필 지침
{3단계에서 로드한 프로필 내용을 여기에 인라인}

## 목소리 지침
{3단계에서 로드한 voice.md 내용을 여기에 인라인}

## 처리 지침
1. 위의 패턴 팩에서 정의된 모든 AI 패턴을 입력 텍스트에서 스캔하라
2. 발견된 AI 패턴을 자연스러운 대안으로 교체하라
3. 핵심 메시지와 의미를 보존하라
4. 프로필의 어조 지침에 따라 톤을 조절하라
5. 목소리 지침에 따라 실제 사람의 개성을 불어넣어라

## 입력 텍스트
{사용자가 제공한 원문 텍스트}

## 중요 제약
Humanize this text by removing the AI patterns described above.
Output ONLY the humanized text.
Do not use any tools. Do not read or modify any files.
Do not ask questions. Do not include explanations or metadata.
```

이 프롬프트를 임시 파일에 저장한다:

```
Write tool → /tmp/humanizer-max-prompt.txt
```

---

## 5단계: 모델 디스패치 (provider-aware)

선택된 모델별로 실행 경로가 다르다:

- `claude` → `claude -p "$(cat prompt.txt)"`
  - 표준 출력으로 humanized 텍스트를 직접 반환한다
- `gemini` → `gemini -p "$(cat prompt.txt)"`
  - 결과가 stderr로 출력된다 (Gemini CLI 특성). `2>&1`로 캡처한다
- `codex` → `codex exec --dangerously-bypass-approvals-and-sandbox ...`
  - `-o`로 지정한 파일에 최종 humanized 텍스트를 바로 쓴다

### 디스패치

```bash
PROMPT=$(cat /tmp/humanizer-max-prompt.txt)

# Claude: stdout으로 직접 결과를 받는다
claude -p "$PROMPT" > /tmp/humanizer-max-claude-output.txt 2>/dev/null &

# Gemini: 결과가 stderr로 출력되므로 2>&1로 캡처한다
gemini -p "$PROMPT" > /tmp/humanizer-max-gemini-output.txt 2>&1 &

# Codex: 마지막 메시지를 파일로 직접 받는다
codex exec --dangerously-bypass-approvals-and-sandbox \
  -C "$PWD" \
  -o /tmp/humanizer-max-codex-output.txt \
  "$PROMPT" \
  > /tmp/humanizer-max-codex-stdout.txt \
  2> /tmp/humanizer-max-codex-stderr.txt &

wait
```

실제 실행은 `--models` 또는 `max-models`에 포함된 모델에만 적용한다. 예를 들어 `--models codex`면 Codex 경로만 실행한다.

### 결과 수집

- `claude`
  1. `/tmp/humanizer-max-claude-output.txt`를 Read한다
  2. 파일 전체를 Claude 결과 텍스트로 사용한다

- `gemini`
  1. `/tmp/humanizer-max-gemini-output.txt`를 Read한다
  2. Gemini CLI는 stderr로 출력하므로 `2>&1`로 캡처한 결과다
  3. YOLO mode 배너 등 부가 메시지가 포함될 수 있으므로, 실제 humanized 텍스트만 추출한다

- `codex`
  1. `/tmp/humanizer-max-codex-output.txt`를 Read한다
  2. 파일 전체를 Codex 결과 텍스트로 사용한다
  3. 필요하면 `/tmp/humanizer-max-codex-stderr.txt`로 디버깅한다

### 실패 처리

- 특정 모델의 output 파일이 비어 있거나, 파일이 없거나, 명령이 비정상 종료한 경우 → 해당 모델을 `failed`로 표시하고 나머지로 계속 진행
- `codex`가 stderr만 남기고 결과 파일을 쓰지 못한 경우 → 실패로 간주하고 stderr 첫 줄을 사유로 기록
- 모든 모델이 실패한 경우 → 에러 메시지와 함께 어떤 CLI(`claude -p`, `gemini -p`, `codex exec`)가 실패했는지 진단 정보를 출력하고 종료

---

## 6단계: 결과 평가 (AI 유사도 점수)

각 모델의 humanize 결과에 대해 AI 유사도 점수를 매긴다.

2단계에서 로드한 모든 패턴 팩을 기준으로, 각 결과를 다음과 같이 평가한다:

```
각 모델의 결과를 로드된 모든 패턴 팩과 대조하여 평가하라.
각 패턴에 대해, 해당 결과가 아직 그 AI 패턴을 보이는지 확인하라.
전체 "AI 유사도 점수"를 0-100 척도로 매겨라:
  - 0 = 완전히 사람처럼, AI 패턴 없음
  - 100 = 완전히 AI처럼, 모든 패턴 존재
카테고리별 세부 점수도 제공하라 (structure, content, language, style, communication, filler).
이것은 패턴 정의에 기반한 주관적 전문가 평가이다 — 수식은 없다.
```

이 평가는 SKILL.md의 `--score` 모드와 동일한 접근법이다. 오케스트레이터(이 Claude 세션)가 평가자 역할을 한다.

---

## 7단계: 비교 및 선택

결과 비교 테이블을 구성하고 최종본을 선택한다.

### 비교 테이블 형식

```
| Model   | AI Score | Status  |
|---------|----------|---------|
| claude  | 23       | success |
| gemini  | 31       | success |
| codex   | --       | failed  |

Best: claude (AI Score: 23)
```

- AI 점수가 가장 낮은 결과를 자동 선택한다
- 동점이면 설정 파일의 모델 순서에서 먼저 오는 것을 우선한다

---

## 8단계: 출력

### 최종 출력 구성

1. **비교 테이블** — 모든 모델의 AI 점수와 상태
2. **최종본** — 가장 낮은 AI 점수를 받은 결과의 전체 텍스트
3. **카테고리별 세부 점수** — 최종본의 패턴 카테고리별 점수
4. **차점 결과 요약** — 다른 모델의 결과를 접힌 섹션으로 제공 (참고용)
5. **실패 정보** — 실패한 모델이 있으면 사유 표시

### 출력 예시

```
## MAX Mode 결과

### 비교 테이블
| Model   | AI Score | Status  |
|---------|----------|---------|
| claude  | 23       | success |
| gemini  | 31       | success |

**Best: claude (AI Score: 23)**

### 카테고리별 점수 (claude)
| Category      | Score |
|---------------|-------|
| Structure     | 15    |
| Content       | 20    |
| Language       | 25    |
| Style          | 30    |
| Communication  | 25    |
| Filler         | 20    |

### 최종본
{claude의 humanize 결과 전체 텍스트}

<details>
<summary>gemini 결과 (AI Score: 31)</summary>

{gemini의 humanize 결과 전체 텍스트}
</details>
```

단일 모델만 성공한 경우, 해당 결과를 최종본으로 제시하되 "단일 모델만 성공하여 비교 불가" 경고를 표시한다.

---

## 참고

- 이 스킬은 기존 `/humanizer` 스킬의 확장 버전으로, 동일한 패턴 팩과 프로필을 사용합니다
- 모델 추가/제거는 `.humanizer.default.yaml`의 `max-models` 또는 `--models` 플래그로 설정합니다
- 지원 모델: `claude`, `codex`, `gemini` (`claude`는 `claude -p`, `gemini`는 `gemini -p`, `codex`는 `codex exec`)
- v2 계획: 최고 점수가 기준 이상이면 자동 재시도하는 ralph 루프 도입 예정
