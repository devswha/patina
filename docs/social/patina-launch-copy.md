# patina Launch Copy and Playbook

Use this file as the source of truth for public launch posts. The positioning is deliberately **auditable cleanup / editing tool**, not detector bypass.

Execution checklist:
[`docs/social/patina-launch-execution.md`](patina-launch-execution.md).

## Launch sequence

Run the launch in this order. Do not skip the Korean-first pass: it is the wedge that makes patina different from generic English humanizers.

| Order | Surface | Primary angle | Launch state |
|---:|---|---|---|
| 1 | Korean communities: GeekNews, Velog, Clien | Korean AI tells plus auditable edits | Ready after final score pass |
| 2 | Show HN | Local, auditable, benchmarked prose cleanup | Ready after final score pass |
| 3 | Product Hunt | Visual demo plus “keep the meaning” | Ready after final score pass |
| 4 | Reddit / X / Threads / LinkedIn | Local/no-key angle or editing/voice angle | Reuse the channel drafts below |

## Prerequisite checklist

| Item | Status | Launch impact |
|---|---|---|
| npm package live (#203) | Done | Use `npx patina-cli` in posts. |
| GitHub Action v1 (#204) | Done | Mention PR comments and README score badge. |
| README score badge (#282) | Done | Use as adoption/social proof. |
| Ethics framing (#164, [`docs/ETHICS.md`](../ETHICS.md)) | Done | Never imply detector evasion. |
| Comparison page (#213, [`docs/COMPARISON.md`](../COMPARISON.md)) | Done | Cite only factual comparisons. |
| Web playground (#208) | Ready | Use <https://patina.vibetip.help/> as the try-it-now URL. |
| Shareable card generator (#283) | Helpful | Product Hunt and X work better with it. |
| “Signs of AI writing” guide (#285) | Helpful | Use as top-of-funnel content. |

## Non-negotiable rules

- Score every final post before publishing. Target `<= 30`.
- Attach the score screenshot or CLI output to the internal launch thread.
- Lead with the writing problem. Mention the tool after the reader recognizes the problem.
- Do not use “bypass,” “undetectable,” or “beats detectors.”
- Avoid hype vocabulary, emoji-bullet stacks, and tidy three-item slogans.
- Link the playground from every broad-launch post: <https://patina.vibetip.help/>. Keep the repo link nearby for source, install, and issues.

Score command:

```bash
node scripts/precommit-score.mjs docs/social/patina-launch-copy.md
```

Last local score check: 2026-05-23, `docs/social/patina-launch-copy.md` scored 6.3% (`node scripts/precommit-score.mjs docs/social/patina-launch-copy.md`).

Korean-first launch drafts are now split out for exact channel copying:
[`docs/social/patina-launch-korean-first.md`](patina-launch-korean-first.md).
Last score check on 2026-05-23: Korean-first drafts 0.0%, this file 6.3%.

## Positioning

Short tagline:

> Strip the AI packaging. Keep the meaning.

Long tagline:

> A pattern-based cleanup tool for AI-sounding text. It shows what changed, why it changed, and whether the original claims survived.

One-sentence description:

> patina finds recurring AI-writing habits in Korean, English, Chinese, and Japanese, rewrites the affected passages, and keeps the edit auditable.

## Assets to attach

- Social preview: [`assets/social/patina-og.svg`](../../assets/social/patina-og.svg)
- Before/after card: [`assets/social/patina-before-after.svg`](../../assets/social/patina-before-after.svg)
- Static badge fallback: [`assets/brand/patina-badge.svg`](../../assets/brand/patina-badge.svg)
- Benchmark report: [`docs/benchmarks/latest.md`](../benchmarks/latest.md)
- Comparison page: [`docs/COMPARISON.md`](../COMPARISON.md)

## Korean communities

Title options:

```text
patina — 한국어·영어 AI 글의 “AI 티”를 찾아서 지워주는 오픈소스
AI가 쓴 티 나는 문장, 패턴으로 잡아서 고쳐주는 도구를 만들었습니다
```

Post body:

```text
GPT한테 글을 맡기면 어딘가 티가 납니다. “~적인”, “~하고 있다”, 갑자기 늘어나는 한자어, 너무 반듯한 목록 같은 것들요.

patina는 그런 패턴을 찾아서 고칩니다. 한국어, 영어, 중국어, 일본어를 지원하고, Claude Code / Codex / Cursor / OpenCode 스킬이나 Node CLI로 쓸 수 있습니다.

핵심은 AI detector 우회가 아니라 편집입니다. 어떤 표현을 잡았는지, 왜 바꿨는지, 원래 주장과 의미가 보존됐는지를 audit / diff / score로 확인할 수 있게 만들었습니다.

API 키 없이도 쓸 수 있습니다. codex, claude, gemini CLI 중 하나에 로그인돼 있으면 됩니다.

웹에서 먼저:
https://patina.vibetip.help/

레포:
https://github.com/devswha/patina

특히 한국어 오탐 사례가 궁금합니다. 사람이 쓴 글인데 patina가 AI 티로 잡는 문장이 있으면 이 글 댓글로 편하게 붙여주셔도 됩니다.
웹에서 바로 신고: 플레이그라운드(https://patina.vibetip.help/)에서 '오탐 신고' 버튼을 누르면 걸린 문장이 자동으로 채워진 GitHub 폼이 열립니다.
```

## Show HN

Title:

```text
Show HN: Patina – rewrite AI text patterns in Korean/English/Chinese/Japanese
```

Post body:

```text
Hi HN,

I built Patina because I kept editing the same LLM tells out of drafts: inflated adjectives, neat three-part lists, hedging on hedging, and in Korean, suffixes like “~적”, progressive “~고 있다”, and needless Sino-Korean phrasing.

Patina turns those habits into a pattern catalog for Korean, English, Chinese, and Japanese. It can rewrite the affected passages, but it is not a black-box paraphraser. It shows what changed, why it changed, and whether claims, numbers, polarity, causation, and negation survived the edit.

It runs as a skill in Claude Code, Codex CLI, Cursor, and OpenCode, or as a standalone Node CLI:

npx patina-cli --lang en draft.md

If you are already logged into codex, claude, or gemini CLI, you can use it without adding an API key.

This is not meant as a detector-bypass tool. I treat the score as an editing signal, not proof of authorship. False positives are documented because the useful output is the audit and diff, not a verdict.

Try:
https://patina.vibetip.help/

Repo:
https://github.com/devswha/patina

The feedback I want most: human text that Patina wrongly flags, missing pattern families, and examples where the rewrite preserved the wrong thing.
```

## Product Hunt

Tagline:

```text
Strip the AI packaging. Keep the meaning.
```

Description:

```text
Patina finds the habits that make text read as AI-written — in Korean, English, Chinese, and Japanese — and rewrites them out. It is not a black-box paraphraser: it shows what changed, why it changed, and whether your claims survived. Use it in Claude Code, Codex, Cursor, OpenCode, or as a Node CLI.
```

Maker comment:

```text
I built Patina because I was tired of removing the same AI tells from drafts by hand. Two details matter to me: it works on Korean, where most English-first humanizers miss the obvious tells, and it is auditable. Every edit should have a reason and a meaning-preservation check.

I do not want this framed as “make text undetectable.” Detectors are noisy. Patina is an editing pass: find the synthetic packaging, remove it, and keep the claim intact.

Try it on something you wrote at https://patina.vibetip.help/ and tell me where it is wrong. False positives are the most useful reports.
```

## Reddit

### r/LocalLLaMA

```text
I built Patina, a local-friendly tool for cleaning up AI-sounding prose.

It runs through the CLI you already use. If you are logged into codex, claude, or gemini, you can run Patina without adding a separate API key. It also works as a Claude Code / Codex / Cursor / OpenCode skill.

The tool finds recurring LLM writing habits, rewrites the affected text, and checks whether the original claims survived. It supports Korean, English, Chinese, and Japanese.

This is not an “undetectable text” project. The score is an editing signal. The useful artifact is the audit: what pattern fired, what changed, and whether meaning drifted.

Try:
https://patina.vibetip.help/

Repo:
https://github.com/devswha/patina

I am looking for false positives and missing pattern families, especially outside English.
```

### r/writing or r/Korean

```text
I built a tool that spots and rewrites AI-sounding patterns in writing, including Korean.

The goal is not to hide authorship. It is to make AI-assisted drafts easier to edit. Patina points out habits like inflated phrasing, tidy generic structure, and Korean AI tells such as “~적인”, “~하고 있다”, and needless formal nouns.

It then rewrites the affected passages and checks that the original meaning survived. You can see the audit and diff instead of trusting a black-box paraphrase.

Try:
https://patina.vibetip.help/

Repo:
https://github.com/devswha/patina

If you have human-written text that gets flagged, I would love to see it. Those examples are the best way to reduce false positives.
```

## X / Threads

### Korean thread

```text
1/ AI가 쓴 글은 티가 납니다. “~적인”, 너무 반듯한 목록, 갑자기 늘어나는 한자어 같은 것들요.

patina는 그런 패턴을 찾아서 고칩니다. KO / EN / ZH / JA.
```

```text
2/ 그냥 다시 써주는 도구는 많습니다.

patina는 뭘 왜 바꿨는지, 원래 의미가 보존됐는지까지 보여주는 편집 도구에 가깝습니다.
```

```text
3/ API 키 없이도 쓸 수 있습니다.

codex / claude / gemini CLI 중 하나만 로그인돼 있으면 Node CLI나 에디터 스킬로 바로 돌릴 수 있습니다.
```

```text
4/ 목표는 detector 우회가 아닙니다.

점수는 편집 신호일 뿐이고, 중요한 건 audit / diff / meaning check입니다.

https://github.com/devswha/patina
```

### English single post

```text
I built Patina: an AI-writing cleanup tool that works on Korean, shows its edits, and checks whether the meaning survived.

Not detector bypass. Just auditable editing for text that sounds too packaged.

Claude Code / Codex / Cursor / OpenCode / Node CLI.
https://github.com/devswha/patina
```

## LinkedIn

```text
Every team ships AI-assisted writing now: docs, release notes, support replies, launch posts. The problem is not that the writing is AI-assisted. The problem is that it often reads like it.

I built Patina for the editing pass after generation. It finds the habits that make prose feel machine-written, rewrites the affected passages, and checks whether the original claims survived.

The important part for work is auditability. You can see what changed and why instead of trusting a black-box paraphrase.

It supports Korean, English, Chinese, and Japanese, and runs as an editor skill or Node CLI.

https://github.com/devswha/patina
```

## Maintainer reply templates

### Detector-bypass concern

```text
Fair concern. I do not think of Patina as a detector-bypass tool. AI detectors are noisy anyway.

The goal is editing: find repeated writing habits that make LLM output feel synthetic, rewrite those parts, and keep the meaning checkable through audit, diff, and score modes.
```

### False positives

```text
False positives are real. Human prose can trigger Patina, especially encyclopedic, corporate, academic, or heavily edited writing.

That is why I treat the score as a rough editing signal, not a truth machine. The diff and highlighted patterns matter more than the exact number.
```

### Install help

```text
Install (standalone CLI, nothing to trust beyond npm):

npx patina-cli --lang en input.txt

Or inside Claude Code:

/patina --lang en

[paste text]

Prefer a one-line installer? Review the script first, then:

curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

## Post-launch triage

- Collect false-positive reports under the `false-positive` label.
- Use <https://github.com/devswha/patina/issues/new?template=false_positive.yml> for public false-positive reports.
- Turn repeated missing patterns into pattern issues with examples.
- Add strong before/after examples to `docs/EXAMPLES.md` or `examples/`.
- Re-score public copy after edits; keep the launch thread evidence attached.
