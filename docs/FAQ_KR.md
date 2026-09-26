# FAQ

용어가 낯설다면 먼저 [Glossary](GLOSSARY.md)를 보세요. MPS, fidelity, burstiness, MATTR, 모드 등 반복해서 나오는 용어를 짧게 설명합니다.

## patina는 AI detector 우회 도구인가요?

아닙니다. patina는 편집과 audit을 위한 도구입니다.

AI detector는 잡음이 많습니다. patina는 어떤 score도 텍스트가 사람이나 AI가 썼다는 증거로 보지 않습니다. 유용한 산출물은 audit, diff, meaning-preservation check입니다. 무엇이 바뀌었는지, 왜 바뀌었는지, 원래 주장이 살아남았는지를 보는 데 씁니다.

## "Strip the AI packaging"은 무슨 뜻인가요?

모델 출력에는 비슷한 겉습관이 자주 나타납니다. 부풀린 중요도, 흐릿한 균형감, 장점 나열, 기업식 추상어, 박자감이 일정한 문단, filler transition 같은 것들입니다. patina는 이런 패턴을 찾아 해당 구간을 더 담백한 문장으로 바꿉니다.

목표는 텍스트를 속이기 좋게 만드는 것이 아닙니다. 실제 메시지는 유지하면서 일반적인 모델 말투를 걷어내는 것입니다.

## patina는 의미를 어떻게 보존하나요?

의미 보존은 전역 규칙입니다. Document Type, Persona, Register는 안전 기준을
낮출 수 없습니다. CLI rewrite에는 항상 숫자 누락 검사가 적용됩니다.
`--verify`는 MPS/fidelity 기준과 한 번의 보수적인 retry를 추가하고, agent
skill의 `--strict`는 문서화된 retry/rollback gate를 적용합니다.

## MPS가 무엇인가요?

MPS는 Meaning Preservation Score입니다. rewrite 쪽 안전 신호로, 추출한 anchor 중 얼마나 많이 편집 후에도 살아남았는지 추정합니다.

MPS가 높다고 해서 문장이 완벽하다는 뜻은 아닙니다. patina가 추적하던 주장을 rewrite가 명백히 떨어뜨리거나 뒤집지 않았다는 뜻입니다.

## AI-likeness score는 무엇을 뜻하나요?

score는 0부터 100까지의 대략적인 편집 신호입니다. 낮을수록 AI처럼 덜 들립니다.

진실 판정기는 아닙니다. 기본 `--score`는 LLM 판단과 deterministic signal을
결합하므로 모델 실행마다 달라질 수 있습니다. `--score --offline`은 로컬에서
재현 가능한 signal만 보고합니다. 정확한 숫자보다 범위와 탐지된 패턴을 보세요.

## 정확도는 어느 정도인가요?

현재 calibration(2026-05-22)은 GPT-5.5, Claude Sonnet 4.6, Gemini 2.5 Pro CLI 샘플에서 67.3% editing-hotspot catch [63.5-71.0%] (n=600, 한국어+영어)를 보고합니다. 사람 글 컨트롤 오탐은 16.0% [11.6-21.7%] (n=200)입니다. 언어×모델별 수치는 [2026-rebaseline.md](research/2026-rebaseline.md)를 참고하세요.

오탐은 예상되는 일입니다. 특히 백과사전식, 기업 문서, 학술 문서, 강하게 편집된 글에서 그렇습니다. patina는 수상한 구간을 편집하는 데 쓰는 도구이지, 작성자를 비난하는 도구가 아닙니다.

작성자 비난이 아니라 편집 힌트로 보아야 하는 register 예시는 [False-positive Gallery](FALSE-POSITIVES.md)를 참고하세요.

의도한 사용 입장은 [ETHICS.md](ETHICS.md)를 참고하세요.

## API key 없이도 동작하나요?

네. `--score --offline`과 `patina-score` precommit gate에는 backend가
필요하지 않습니다. LLM 기반 모드는 API key 대신 로그인된 Codex, Claude,
Gemini CLI를 사용할 수 있습니다. [Authentication](AUTHENTICATION.md)을
참고하세요.

## 입력한 텍스트가 외부로 전송되나요?

CLI의 deterministic analysis는 로컬에서 실행됩니다. LLM 기반 CLI 모드는
사용자가 선택한 backend로만 텍스트를 보냅니다.

hosted playground의 rewrite와 score 요청은 patina 서버로 전송됩니다. free는
서버 provider를 사용하고, BYOK key는 요청 단위로 전달되며 저장·로그되지
않습니다. Pro license는 서버에서 Polar로 검증합니다. 브라우저가
LLM provider를 직접 호출하지는 않습니다.

## Claude Code에서만 동작하나요?

아닙니다. patina는 Claude Code, Codex CLI, Cursor, OpenCode용 skill로 동작하고, standalone Node.js CLI로도 사용할 수 있습니다.

## 어떤 언어를 지원하나요?

한국어, 영어, 중국어, 일본어를 지원합니다. 패턴 팩은 언어 접두사로 자동 탐색되므로 새 언어는 새 패턴 파일을 기여해 추가할 수 있습니다.

## Document Type, Persona, Register는 서로 겹치나요?

아닙니다. Document Type은 장르·용도·구조 관습·pattern policy를 정합니다.
Persona v2는 선택 가능한 재사용 voice fingerprint이며, 생략하면 원문
voice를 보존합니다. Register는 `casual`/`professional` 전달 방식만 정하며,
생략하면 원문 register를 보존합니다. 의미 보존 기준과 verification은 세
축과 독립된 전역 규칙입니다.

## 기여자는 무엇부터 시작하면 좋나요?

가장 쉬운 기여는 근거가 있는 작은 예시입니다. before/after 쌍, 오탐 사례, 빠진 AI-writing pattern, 모델 출력에 반복해서 보이는 언어별 표현이 좋습니다.

좋은 패턴 기여에는 실패 예시와 성공적인 rewrite가 둘 다 있어야 합니다.

## 패턴은 어떻게 제출하나요?

[CONTRIBUTING_KR.md](../CONTRIBUTING_KR.md)를 따르세요. 그 파일이 방법 안내입니다. [패턴 제안 이슈](https://github.com/devswha/patina/issues/new?template=pattern_proposal.yml)를 열고([`.github/ISSUE_TEMPLATE/pattern_proposal.yml`](../.github/ISSUE_TEMPLATE/pattern_proposal.yml)), `patterns/{lang}-*.md`의 팩 템플릿으로 추가합니다.

현재 패턴 하나를 성공/오탐으로 풀어 둔 예는 [pattern of the week](community/pattern-of-the-week.md)에 있습니다.
