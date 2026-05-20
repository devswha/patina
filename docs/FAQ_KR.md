# FAQ

용어가 낯설다면 먼저 [Glossary](GLOSSARY.md)를 보세요. MPS, fidelity, burstiness, MATTR, 모드 등 반복해서 나오는 용어를 짧게 설명합니다.

## patina는 AI detector 우회 도구인가요?

아닙니다. patina는 편집과 audit을 위한 도구입니다.

AI detector는 잡음이 많습니다. patina는 어떤 score도 텍스트가 사람이나 AI가 썼다는 증거로 보지 않습니다. 유용한 산출물은 audit, diff, meaning-preservation check입니다. 무엇이 바뀌었는지, 왜 바뀌었는지, 원래 주장이 살아남았는지를 보는 데 씁니다.

## "Strip the AI packaging"은 무슨 뜻인가요?

모델 출력에는 비슷한 겉습관이 자주 나타납니다. 부풀린 중요도, 흐릿한 균형감, 장점 나열, 기업식 추상어, 박자감이 일정한 문단, filler transition 같은 것들입니다. patina는 이런 패턴을 찾아 해당 구간을 더 담백한 문장으로 바꿉니다.

목표는 텍스트를 속이기 좋게 만드는 것이 아닙니다. 실제 메시지는 유지하면서 일반적인 모델 말투를 걷어내는 것입니다.

## patina는 의미를 어떻게 보존하나요?

patina는 rewrite 전에 semantic anchor를 뽑습니다. 주장, 극성, 인과, 숫자, 부정, 그 밖의 위험도가 높은 세부 정보를 추적합니다. 각 rewrite 단계 뒤에는 그 anchor가 여전히 있는지, 극성이 그대로인지 확인합니다.

rewrite가 anchor를 약화하거나 삭제하거나 뒤집으면, patina는 해당 구간을 다시 시도하거나 되돌립니다.

## MPS가 무엇인가요?

MPS는 Meaning Preservation Score입니다. rewrite 쪽 안전 신호로, 추출한 anchor 중 얼마나 많이 편집 후에도 살아남았는지 추정합니다.

MPS가 높다고 해서 문장이 완벽하다는 뜻은 아닙니다. patina가 추적하던 주장을 rewrite가 명백히 떨어뜨리거나 뒤집지 않았다는 뜻입니다.

## AI-likeness score는 무엇을 뜻하나요?

score는 0부터 100까지의 대략적인 편집 신호입니다. 낮을수록 AI처럼 덜 들립니다.

이 값은 진실 판정기가 아닙니다. scoring formula는 deterministic이지만 severity assignment는 모델 실행 사이에 대략 8-10점 정도 달라질 수 있습니다. 정확한 숫자보다 범위와 하이라이트된 패턴을 더 중요하게 보세요.

## 정확도는 어느 정도인가요?

현재 calibration은 한국어 AI 텍스트에서 91% editing-hotspot recall [84.0-95.4%], HC3 English ChatGPT 샘플에서 76% [66.7-83.3%]를 보고합니다. 각각 n=100, binomial 95% CI입니다. 사람 글 오탐은 문체별 13-25% point-estimate range로 따로 추적합니다.

오탐은 예상되는 일입니다. 특히 백과사전식, 기업 문서, 학술 문서, 강하게 편집된 글에서 그렇습니다. patina는 수상한 구간을 편집하는 데 쓰는 도구이지, 작성자를 비난하는 도구가 아닙니다.

작성자 비난이 아니라 편집 힌트로 보아야 하는 register 예시는 [False-positive Gallery](FALSE-POSITIVES.md)를 참고하세요.

의도한 사용 입장은 [ETHICS.md](ETHICS.md)를 참고하세요.

## API key 없이도 동작하나요?

네. 이미 Codex CLI를 설치하고 로그인했다면 가능합니다. installer는 patina를 Codex CLI backend에 연결할 수 있으므로 이 경로에서는 별도 API key가 필요하지 않습니다.

다른 provider는 문서화된 backend/provider 설정으로 구성할 수 있습니다.

## Claude Code에서만 동작하나요?

아닙니다. patina는 Claude Code, Codex CLI, Cursor, OpenCode용 skill로 동작하고, standalone Node.js CLI로도 사용할 수 있습니다.

## 어떤 언어를 지원하나요?

한국어, 영어, 중국어, 일본어를 지원합니다. 패턴 팩은 언어 접두사로 자동 탐색되므로 새 언어는 새 패턴 파일을 기여해 추가할 수 있습니다.

## 내 문체나 패턴을 추가할 수 있나요?

네. voice preference에는 custom profile을, 로컬 규칙에는 custom pattern pack을 사용하세요. repo는 built-in pattern과 사용자 custom 설정을 분리합니다.

## 기여자는 무엇부터 시작하면 좋나요?

가장 쉬운 기여는 근거가 있는 작은 예시입니다. before/after 쌍, 오탐 사례, 빠진 AI-writing pattern, 모델 출력에 반복해서 보이는 언어별 표현이 좋습니다.

좋은 패턴 기여에는 실패 예시와 성공적인 rewrite가 둘 다 있어야 합니다.
