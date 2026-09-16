---
document-type: default
name: 기본 문서 유형
version: 3.0.0
scope: 일반 텍스트 — 다른 문서 유형이 명시되지 않은 모든 경우. 원문의 의도된 격식과 용도를 유지한다.
purpose: "Preserve the source document’s function when no narrower document policy is selected."
audience:
  - "The source document’s existing audience"
structure:
  - "Preserve the source order, hierarchy, and formatting unless an AI pattern requires a local repair"
  - "Add no genre template, heading scheme, or call to action"
style:
  - "Use concrete, readable prose appropriate to the detected source context"
  - "Keep domain terms that carry meaning"
avoid:
  - "Inferring a Persona, casual/professional Register, or new document genre"
  - "Adding opinions, first-person voice, anecdotes, emotion, or intimacy absent from the source"
# pattern-overrides 없음 — 모든 패턴을 기본 가중치로 적용한다.
# 특정 패턴을 강화/억제하려면 적합한 문서 유형(blog/academic/formal/resume/personal-statement/project-writeup 등)을 사용한다.
---

# 기본 문서 유형

원문의 문서 기능과 지배 어투를 먼저 파악하고, 이를 유지하면서 AI 패턴을 제거한다. 어떤 방향으로도 강제로 끌고 가지 않는다.

## 범위

다른 문서 유형이 명시되지 않은 모든 텍스트에 적용된다. `--document-type blog`나 `--document-type formal`을 주지 않으면 default가 사용된다.

## 패턴 처리

- 모든 패턴을 동일한 우선순위로 처리한다.
- `blocklist`/`allowlist` 설정이 있으면 그에 따라 조절한다.
- 특정 패턴을 강화/억제하려면 `--document-type <name>`을 명시한다.
