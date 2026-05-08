# Before/After Gallery

patina is easiest to understand with examples: the claims stay, the AI packaging goes.

## English: inflated product copy

**Before**

> AI coding tools represent a transformative leap forward in the software development lifecycle, enabling teams to streamline workflows, enhance collaboration, and unlock unprecedented levels of productivity across the organization.

**After**

> AI coding tools are useful for the boring parts: test stubs, config files, small refactors. They do not fix a messy codebase, but they can save time when someone still checks the output.

**Patterns removed**: inflated stakes, corporate abstractions, three-part benefit stack.

## Korean: benefit stacking

**Before**

> 본 솔루션은 사용자의 업무 효율성을 극대화하고, 생산성 향상을 도모하며, 더 나은 협업 경험을 제공하는 혁신적인 도구입니다.

**After**

> 이 도구는 반복 작업을 줄여준다. 문서 정리, 초안 작성, 간단한 협업 흐름처럼 사람이 굳이 매번 손으로 할 필요 없는 일에 잘 맞는다.

**Patterns removed**: `혁신적인`, `도모`, abstract benefit stacking, stiff noun-heavy phrasing.

## English: vague balance

**Before**

> While there are challenges to consider, it is important to recognize that this technology has the potential to create meaningful value when implemented thoughtfully.

**After**

> The tool is useful, but only if someone checks the output. Without tests or review, it just makes wrong answers arrive faster.

**Patterns removed**: generic caveat, vague upside, empty balance.

## Technical: architecture claims

**Before**

> This architecture provides a robust and scalable foundation for future enhancements, ensuring that teams can effectively adapt to evolving requirements while maintaining operational excellence.

**After**

> The architecture leaves room for new backends without touching the CLI entry point. That is the useful part. The tradeoff is more config surface, so the defaults need to stay boring and safe.

**Patterns removed**: `robust and scalable foundation`, future-proofing claims, operational-excellence filler.

## Korean: instructional / tutorial register

**Before**

> Git stash는 작업 중인 변경사항을 임시로 저장할 수 있는 매우 유용한 기능입니다. 본 명령어를 활용함으로써 사용자는 현재 작업 내용을 손실 없이 다른 브랜치로 신속하게 전환할 수 있게 됩니다.

**After**

> Git stash로 작업 중인 변경사항을 잠시 보관하세요. 커밋하기 애매한 수정이 있을 때 유용합니다. stash에 넣어두면 변경사항을 잃지 않고 다른 브랜치로 이동할 수 있습니다.

**Patterns removed**: `매우 유용한` (ko-content #4 promotional adjective), `본 명령어를 활용함으로써` (ko-style noun-heavy formal connector), `~할 수 있게 됩니다` (ko-structure #25 inflated future-tense). Use-context ("커밋하기 애매한 수정이 있을 때") added so the tutorial actually teaches *when* to use the command.

## Korean: 1인칭 회고 — abstract metaphor → sensory detail

**Before**

> 처음 코드 리뷰를 받았던 날을 떠올리면 여전히 마음 한구석이 묘해지는 것을 느낀다. 선배의 피드백 한 줄 한 줄이 마치 거대한 산처럼 다가왔으며, 그 순간은 개발자로서의 성장에 있어 잊을 수 없는 의미 있는 전환점이었다고 표현할 수 있을 것이다.

**After**

> 처음 코드 리뷰를 받던 날이 아직도 가끔 떠오른다. 선배가 남긴 피드백은 한 줄씩 읽을 때마다 이상하게 크게 느껴졌다. 모니터 앞에서 댓글을 하나씩 열어보던 장면이 선명하다. 손은 마우스 위에 있었고, 머릿속은 자꾸 하얘졌다. 지금 생각하면 그날은 대단한 사건이라기보다, 내가 처음으로 내 코드를 남의 눈으로 본 날에 가까웠다.

**Patterns removed**: `마치 거대한 산처럼` (ko-content abstract metaphor), `의미 있는 전환점이었다고 표현할 수 있을 것이다` (ko-structure #25 hedge stack + ko-content inflated significance). Replaced with concrete physical detail (`손은 마우스 위에`, `머릿속은 자꾸 하얘졌다`) — the narrative profile's `concrete-emotions: amplify` setting.

## Korean: SNS marketing — viral-hook signals

**Before**

> GitHub 역사상 이런 속도는 없었다. 단 60일 만에 별 25만 개. OpenClaw라는 도구가 세운 기록임. 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.

**After**

> GitHub에서 이런 속도는 거의 못 봤다. 60일 만에 별 25만 개. OpenClaw가 만든 기록이다. 광고로 뜬 게 아니다. 개발자들이 새벽 3시에 버그 잡다가 짜증 나던 부분을 정확히 긁었다.

**Patterns removed**: `역사상 ... 없었다` (ko-viral-hook #3 source-skipping authority claim), `미친 듯이 달려든` (ko-viral-hook #5 hyperbolic engagement lexicon), `이유가 뭘까` (ko-viral-hook #2 clickbait mystery close → resolved into concrete explanation). The viral-hook pack is **score-only**, but the model still re-frames these signals during a regular rewrite once the content/style packs are applied.

## English: chatbot register

**Before**

> I'd be happy to help you understand Git stash! That's a great question. Git stash is a very useful command that allows you to temporarily save your changes. Let me know if you have any other questions!

**After**

> Git stash temporarily saves your in-progress changes so you can switch branches without committing or losing them. It's most useful when a fix or quick task pulls you off the work you're already doing.

**Patterns removed**: `I'd be happy to help` + `That's a great question` (en-communication #19 chatbot expressions, #21 sycophancy), `very useful` (en-content promotional adjective), `Let me know if you have any other questions` (en-communication closing politeness). Replaces the chat affect with the actual answer.

## English: viral-hook authority claim

**Before**

> The fastest growth GitHub has ever seen — devs around the world are absolutely losing their minds. Why is everyone flocking to OpenClaw without any marketing?

**After**

> OpenClaw hit 250K stars in 60 days with no paid promotion. The popularity didn't come from marketing — it came from one shipped command that replaces a few hours of cluster setup. NVIDIA has since picked it up, which makes the timing easier to read.

**Patterns removed**: `the fastest GitHub has ever seen` (en-viral-hook #3 source-skipping authority claim), `absolutely losing their minds` (en-viral-hook #5 hyperbolic lexicon), `Why is everyone ... without any marketing?` (en-viral-hook #2 clickbait mystery close). Concrete numbers + a verifiable corroborating fact replace the unsupported absolutes. Like the Korean SNS example above, viral-hook is score-only — the rewrite drives this through neighboring content/style patterns.

## More gallery material

This page shows the canonical short examples. The repo also ships longer fixtures and full case studies you can copy from:

- **`examples/short/`** — four short Korean fixtures (marketing, tutorial, essay, email) with paired `*-rewritten.md` files.
- **`examples/genres/`** — three longer Korean genres (technical, academic, narrative) with paired rewrites.
- **`examples/tones/`** — the same input rewritten in six tones (`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`) plus `auto`. See `examples/tones/RESULTS.md` for the side-by-side.
- **`examples/viral-hook/`** — case studies (`case-01` through `case-09`) covering the iterative improvement workflow: viral-hook detection, codex/claude/gemini comparisons, voice profiles, multi-genre validation.
- **`examples/sample-rewritten-*.md`** — the same long-form Korean SNS marketing post rewritten by Codex / Claude / Gemini-3, used in `case-03` for cross-model comparison.

## What patina is checking

- Did the rewrite remove AI-writing patterns?
- Did the rewrite keep the original claims?
- Did the rewrite introduce anything that was not in the source?
- Can the change be inspected through `--audit`, `--diff`, or `--score`?

The goal is editing quality, not detector evasion. AI detectors are noisy; patina treats the score as a rough signal and the diff as the useful artifact.
