# patina Launch Copy

Use this file as the source of truth for public launch posts. The positioning is deliberately "auditable cleanup / editing tool", not detector bypass.

## Positioning

patina detects recurring AI-writing patterns, rewrites the affected passages, and checks whether the original claims were preserved.

Short tagline:

> Strip the AI packaging. Keep the meaning.

Long tagline:

> A pattern-based cleanup tool for AI-sounding text. It shows what changed, why it changed, and whether the original claims survived.

## Before posting

- Run `npm run benchmark:report && npm test`.
- Check the current benchmark: [`docs/benchmarks/latest.md`](../benchmarks/latest.md).
- Keep claims to "editing signal" and "suspect-zone benchmark"; do not imply authorship proof.
- Link issues for useful feedback: false positives, missing patterns, benchmark fixtures.

## Avoid

Do not frame patina as:

- an AI detector bypass tool
- a way to fake authorship
- proof that text is human-written
- a universal paraphraser

Use these instead:

- auditable editing
- pattern-based cleanup
- meaning preservation
- false-positive-aware scoring
- diff/audit/score modes

## Show HN

Title:

```text
Show HN: patina – Strip the AI packaging, keep the meaning
```

Post body:

```text
Hi HN,

I built patina, a pattern-based cleanup tool for AI-sounding text.

It detects recurring LLM writing habits, rewrites the affected passages, and checks whether the original claims were preserved. It supports Korean, English, Chinese, and Japanese, and runs as a skill for Claude Code, Codex CLI, Cursor, and OpenCode, or as a standalone Node.js CLI.

The main difference from a generic paraphraser is auditability: patina can show what pattern it found, what it changed, and whether semantic anchors such as claims, polarity, causation, numbers, and negation survived the rewrite.

Example:

Before:
"Coffee has emerged as a pivotal cultural phenomenon that has fundamentally transformed social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue."

After:
"Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form — even between people from very different cultures."

This is not meant as an AI-detector bypass tool. Detectors are noisy. I treat the score as an editing signal, and the diff/audit output as the useful artifact.

Repo:
https://github.com/devswha/patina

I would especially like feedback on false positives, missing pattern families, and whether the MPS / diff / audit modes are useful for real writing workflows.
```

## Reddit / ClaudeAI Megathread

```text
I built patina, a Claude Code skill / CLI for cleaning up AI-sounding text.

It detects recurring AI writing patterns, rewrites them, and checks that the original meaning is preserved. It supports Korean, English, Chinese, and Japanese, and also works with Codex CLI, Cursor, OpenCode, and standalone Node.js.

Quick before/after:

Before:
“Coffee has emerged as a pivotal cultural phenomenon that has fundamentally transformed social interactions across the globe. This beloved beverage serves as a catalyst for community building, fosters meaningful connections, and facilitates cross-cultural dialogue.”

After:
“Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form, even between people from very different cultures.”

Repo:
https://github.com/devswha/patina

I’d especially like feedback on false positives, missing AI-writing patterns, and whether the audit/score/diff modes make sense for real Claude output.
```

## X launch thread

### 1

```text
I built patina: a pattern-based cleanup tool for AI-sounding text.

It strips the AI packaging while keeping the meaning.

Claude Code / Codex CLI / Cursor / OpenCode / Node CLI
KO / EN / ZH / JA

https://github.com/devswha/patina
```

### 2

```text
The goal is not detector bypass.

AI detectors are noisy. patina treats the score as an editing signal, not proof of authorship.

The useful parts are audit, diff, and meaning-preservation checks: what changed, why it changed, and whether the original claims survived.
```

### 3

```text
Example before:

“Coffee has emerged as a pivotal cultural phenomenon that has fundamentally transformed social interactions across the globe...”

This is the kind of AI packaging patina looks for: inflated stakes, vague abstraction, and generic benefit stacking.
```

### 4

```text
After:

“Coffee has quietly changed how people meet. Sit across from someone long enough, and something like a real connection tends to form — even between people from very different cultures.”

Same claims. Less model voice.
```

### 5

```text
Under the hood, patina tracks semantic anchors: claims, polarity, causation, numbers, and negation.

If a rewrite drops or flips an anchor, it retries or rolls back the change.

That is the part I care about most: editable output with a safety rail.
```

### 6

```text
Current calibration:

- 146 pattern catalog
- 91% Korean AI catch rate
- 76% English HC3 catch rate
- 13-25% false positives on human prose
- Latest fixture benchmark: https://github.com/devswha/patina/blob/main/docs/benchmarks/latest.md

False positives are documented because this should be used as an editor, not a judge.
```

### 7

```text
If you write with LLMs and hate the default polished-but-empty voice, try it and tell me where it fails.

I’m especially looking for missing patterns, false positives, and better before/after examples.

https://github.com/devswha/patina
```

## Short Korean community post

```text
patina라는 오픈소스 도구를 만들고 있습니다.

AI가 쓴 글에서 자주 보이는 표현 패턴을 잡아서, 의미는 유지한 채 더 자연스럽게 고치는 도구입니다. Claude Code 스킬로 쓸 수 있고, Codex CLI / Cursor / OpenCode / Node CLI에서도 동작합니다. 한국어, 영어, 중국어, 일본어 패턴을 지원합니다.

핵심은 “AI detector 우회”가 아니라 편집입니다. 어떤 패턴을 잡았는지, 왜 바꿨는지, 원래 주장과 의미가 보존됐는지를 audit / diff / score 모드로 확인할 수 있게 만드는 쪽에 집중했습니다.

레포:
https://github.com/devswha/patina

특히 한국어 false positive, 빠진 AI 문체 패턴, before/after 예시 피드백을 받고 싶습니다.
```

## Maintainer reply templates

### Detector-bypass concern

```text
Fair concern. I do not think of patina as a detector-bypass tool. AI detectors are noisy anyway.

The goal is editing: find repeated writing habits that make LLM output feel synthetic, rewrite those parts, and keep the meaning checkable through audit/diff/score modes.
```

### False positives

```text
False positives are real. Human prose can trigger patina, especially encyclopedic, corporate, academic, or heavily edited writing.

That is why I treat the score as a rough editing signal, not a truth machine. The diff and the highlighted patterns matter more than the exact number.
```

### Install help

```text
Install:

curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash

Then in Claude Code:

/patina --lang en

[paste text]

Or as a standalone CLI:

patina --lang en input.txt
```
