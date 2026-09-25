# Before/After Gallery

These curated examples illustrate wording edits; they are not recorded model runs or measured fidelity results. Inputs may contain unverified claims. Each output is constrained by its own input.

The English [email, report and product showcases](../playground/examples/en.js) use newly authored synthetic inputs. The [short English launch source](../examples/short/marketing-launch-en.md) and its [curated expected rewrite](../examples/short/marketing-launch-en-rewritten.md) are also illustrative; they are separate from the historical demo recording.

The `examples/en-*-success-*.md` and `examples/en-*-failure-*.md` files are standalone cases. A failure file is a no-correction control, not the input for a success file.

## English: inflated product copy

**Before**

> AI coding tools represent a transformative leap forward in the software development lifecycle, enabling teams to streamline workflows, enhance collaboration, and unlock unprecedented levels of productivity across the organization.

**After**

> AI coding tools change software development by helping teams simplify workflows, collaborate better, and reach levels of productivity not seen before across the organization.

**Edit note**: Wording simplified: inflated framing and stacked benefits. The claims about workflows, collaboration and productivity remain; no specific tasks or limitations are invented.

## Korean: benefit stacking

**Before**

> 본 솔루션은 사용자의 업무 효율성을 극대화하고, 생산성 향상을 도모하며, 더 나은 협업 경험을 제공하는 혁신적인 도구입니다.

**After**

> 이 도구는 사용자의 업무 효율을 극대화하고 생산성을 높이며 더 나은 협업 경험을 제공하는 새로운 도구입니다.

**Edit note**: Wording simplified: `도모`, stiff noun phrases. The efficiency, productivity and collaboration claims remain; no task examples are added.

## English: vague balance

**Before**

> While there are challenges to consider, it is important to recognize that this technology has the potential to create meaningful value when implemented thoughtfully.

**After**

> This technology has challenges, but thoughtful implementation could create meaningful value.

**Edit note**: Wording simplified: filler around the caveat and potential benefit. Both the challenge and the conditional possibility remain.

## Technical: architecture claims

**Before**

> This architecture provides a robust and scalable foundation for future enhancements, ensuring that teams can effectively adapt to evolving requirements while maintaining operational excellence.

**After**

> This architecture gives future enhancements a strong, scalable base. Teams can adapt to changing requirements while maintaining high operational standards.

**Edit note**: Wording simplified: formal phrasing. The architecture, scalability, adaptability and operational-quality claims remain; no backend, CLI or configuration details are added.

## Korean: instructional / tutorial register

**Before**

> Git stash는 작업 중인 변경사항을 임시로 저장할 수 있는 매우 유용한 기능입니다. 본 명령어를 활용함으로써 사용자는 현재 작업 내용을 손실 없이 다른 브랜치로 신속하게 전환할 수 있게 됩니다.

**After**

> Git stash는 작업 중인 변경사항을 임시로 저장하는 유용한 기능입니다. 이 명령어를 쓰면 현재 작업 내용을 잃지 않고 다른 브랜치로 빠르게 전환할 수 있습니다.

**Edit note**: Wording simplified: `본 명령어를 활용함으로써`, `전환할 수 있게 됩니다`. Temporary storage, retained changes and quick branch switching stay; no new use case is added.

## Korean: 1인칭 회고 — preserving the memory

**Before**

> 처음 코드 리뷰를 받았던 날을 떠올리면 여전히 마음 한구석이 묘해지는 것을 느낀다. 선배의 피드백 한 줄 한 줄이 마치 거대한 산처럼 다가왔으며, 그 순간은 개발자로서의 성장에 있어 잊을 수 없는 의미 있는 전환점이었다고 표현할 수 있을 것이다.

**After**

> 처음 코드 리뷰를 받았던 날을 떠올리면 여전히 마음 한구석이 묘하다. 선배의 피드백은 한 줄 한 줄이 거대한 산처럼 느껴졌다. 개발자로 성장하는 데 그날이 잊을 수 없는 의미 있는 전환점이었다고 말할 수 있을 것 같다.

**Edit note**: Wording simplified: indirect phrasing. The memory, feeling, metaphor, significance and tentative assessment remain. No scene, physical reaction or revised interpretation is invented.

## Korean: SNS marketing — viral-hook signals

**Before**

> GitHub 역사상 이런 속도는 없었다. 단 60일 만에 별 25만 개. OpenClaw라는 도구가 세운 기록임. 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.

**After**

> GitHub에서 전례 없는 속도로 OpenClaw가 60일 만에 별 25만 개를 기록했다. 광고 한 번 없이 전 세계 개발자들이 몰려든 이유가 뭘까.

**Edit note**: Illustrative manual wording edit. The speed claim, 60 days, 250K stars, tool name and no-advertising claim remain, and the unanswered question stays unanswered. These claims are not independently verified. The viral-hook pack is score/audit-only; this is not an automatic rewrite result.

## English: chatbot register

**Before**

> I'd be happy to help you understand Git stash! That's a great question. Git stash is a very useful command that allows you to temporarily save your changes. Let me know if you have any other questions!

**After**

> Git stash is a useful command that lets you temporarily save your changes.

**Edit note**: Chatbot framing removed: the offer to help, flattery and closing invitation. The source answer stays; no branch-switching or interrupted-work scenario is added.

## English: viral-hook authority claim

**Before**

> The fastest growth GitHub has ever seen — devs around the world are absolutely losing their minds. Why is everyone flocking to OpenClaw without any marketing?

**After**

> OpenClaw has the fastest growth GitHub has ever seen, and developers around the world are excited about it. Why are they flocking to it without any marketing?

**Edit note**: Illustrative manual wording edit. The ranking, global interest, absent marketing and unresolved question remain unverified source claims. No star count, setup savings, shipped command or corporate adoption is invented. The viral-hook pack is score/audit-only; this is not an automatic rewrite result.

## More gallery material

This page shows the canonical short examples. The repo also contains longer examples and case studies:

- **`examples/short/`** — four short Korean fixtures (marketing, tutorial, essay, email) with paired `*-rewritten.md` files.
- **`examples/genres/`** — three longer Korean genres (technical, academic, narrative) with paired rewrites.
- **`examples/rewrite-axes/`** — v7 axis fixtures. `casual`/`professional` demonstrate Register; `academic`/`narrative`/`marketing`/`instructional` demonstrate Document Type. Their outputs should be checked against their own inputs; this English-lane review does not validate every linked file.
- **`examples/viral-hook/`** — detection case studies (`case-01`, `case-02`) for the score-only viral-hook pack.

## What patina is checking

- Did the rewrite remove AI-writing patterns?
- Did the rewrite keep the original claims?
- Did the rewrite introduce anything that was not in the source?
- Can the change be inspected through `--audit`, `--diff`, or `--score`?

The goal is editing quality, not detector evasion. AI detectors are noisy; patina treats the score as a rough signal and the diff as the useful artifact.
