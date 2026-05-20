# Before/After Gallery

patina는 예시로 보는 편이 가장 쉽습니다. 주장은 남고, AI 포장은 사라집니다.

## English: 부풀린 제품 카피

**Before**

> AI coding tools represent a transformative leap forward in the software development lifecycle, enabling teams to streamline workflows, enhance collaboration, and unlock unprecedented levels of productivity across the organization.

**After**

> AI coding tools are useful for the boring parts: test stubs, config files, small refactors. They do not fix a messy codebase, but they can save time when someone still checks the output.

**제거한 패턴**: 부풀린 중요도, 기업식 추상어, 세 갈래 장점 나열.

## Korean: 장점 나열

**Before**

> 본 솔루션은 사용자의 업무 효율성을 극대화하고, 생산성 향상을 도모하며, 더 나은 협업 경험을 제공하는 혁신적인 도구입니다.

**After**

> 이 도구는 반복 작업을 줄여준다. 문서 정리, 초안 작성, 간단한 협업 흐름처럼 사람이 굳이 매번 손으로 할 필요 없는 일에 잘 맞는다.

**제거한 패턴**: `혁신적인`, `도모`, 추상적인 장점 나열, 딱딱한 명사형 문장.

## English: 흐릿한 균형감

**Before**

> While there are challenges to consider, it is important to recognize that this technology has the potential to create meaningful value when implemented thoughtfully.

**After**

> The tool is useful, but only if someone checks the output. Without tests or review, it just makes wrong answers arrive faster.

**제거한 패턴**: 일반적인 caveat, 흐릿한 upside, 빈 균형감.

## Technical: 아키텍처 주장

**Before**

> This architecture provides a robust and scalable foundation for future enhancements, ensuring that teams can effectively adapt to evolving requirements while maintaining operational excellence.

**After**

> The architecture leaves room for new backends without touching the CLI entry point. That is the useful part. The tradeoff is more config surface, so the defaults need to stay boring and safe.

**제거한 패턴**: `robust and scalable foundation`, future-proofing 주장, operational-excellence filler.

## Korean: instructional / tutorial register

**Before**

> Git stash는 작업 중인 변경사항을 임시로 저장할 수 있는 매우 유용한 기능입니다. 본 명령어를 활용함으로써 사용자는 현재 작업 내용을 손실 없이 다른 브랜치로 신속하게 전환할 수 있게 됩니다.

**After**

> Git stash로 작업 중인 변경사항을 잠시 보관하세요. 커밋하기 애매한 수정이 있을 때 유용합니다. stash에 넣어두면 변경사항을 잃지 않고 다른 브랜치로 이동할 수 있습니다.

**제거한 패턴**: `매우 유용한` (ko-content #4 promotional adjective), `본 명령어를 활용함으로써` (ko-style noun-heavy formal connector), `~할 수 있게 됩니다` (ko-structure #25 inflated future-tense). 튜토리얼이 명령을 *언제* 쓰는지 알려 주도록 사용 맥락("커밋하기 애매한 수정이 있을 때")을 추가했습니다.

## Korean: 1인칭 회고 — abstract metaphor → sensory detail

**Before**

> 처음 코드 리뷰를 받았던 날을 떠올리면 여전히 마음 한구석이 묘해지는 것을 느낀다. 선배의 피드백 한 줄 한 줄이 마치 거대한 산처럼 다가왔으며, 그 순간은 개발자로서의 성장에 있어 잊을 수 없는 의미 있는 전환점이었다고 표현할 수 있을 것이다.

**After**

> 처음 코드 리뷰를 받던 날이 아직도 가끔 떠오른다. 선배가 남긴 피드백은 한 줄씩 읽을 때마다 이상하게 크게 느껴졌다. 모니터 앞에서 댓글을 하나씩 열어보던 장면이 선명하다. 손은 마우스 위에 있었고, 머릿속은 자꾸 하얘졌다. 지금 생각하면 그날은 대단한 사건이라기보다, 내가 처음으로 내 코드를 남의 눈으로 본 날에 가까웠다.

**제거한 패턴**: `마치 거대한 산처럼` (ko-content abstract metaphor), `의미 있는 전환점이었다고 표현할 수 있을 것이다` (ko-structure #25 hedge stack + ko-content inflated significance). 구체적인 신체 디테일(`손은 마우스 위에`, `머릿속은 자꾸 하얘졌다`)로 바꿨습니다. narrative profile의 `concrete-emotions: amplify` 설정입니다.

## Korean: SNS marketing — viral-hook signals

**Before**

> GitHub 역사상 이런 속도는 없었다. 단 60일 만에 별 25만 개. OpenClaw라는 도구가 세운 기록임. 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.

**After**

> GitHub에서 이런 속도는 거의 못 봤다. 60일 만에 별 25만 개. OpenClaw가 만든 기록이다. 광고로 뜬 게 아니다. 개발자들이 새벽 3시에 버그 잡다가 짜증 나던 부분을 정확히 긁었다.

**제거한 패턴**: `역사상 ... 없었다` (ko-viral-hook #3 source-skipping authority claim), `미친 듯이 달려든` (ko-viral-hook #5 hyperbolic engagement lexicon), `이유가 뭘까` (ko-viral-hook #2 clickbait mystery close → 구체적 설명으로 해결). viral-hook pack은 **score-only**지만, content/style pack이 적용된 regular rewrite에서도 모델이 이런 신호를 다시 잡아냅니다.

## English: chatbot register

**Before**

> I'd be happy to help you understand Git stash! That's a great question. Git stash is a very useful command that allows you to temporarily save your changes. Let me know if you have any other questions!

**After**

> Git stash temporarily saves your in-progress changes so you can switch branches without committing or losing them. It's most useful when a fix or quick task pulls you off the work you're already doing.

**제거한 패턴**: `I'd be happy to help` + `That's a great question` (en-communication #19 chatbot expressions, #21 sycophancy), `very useful` (en-content promotional adjective), `Let me know if you have any other questions` (en-communication closing politeness). chat affect를 걷어내고 실제 답변만 남겼습니다.

## English: viral-hook authority claim

**Before**

> The fastest growth GitHub has ever seen — devs around the world are absolutely losing their minds. Why is everyone flocking to OpenClaw without any marketing?

**After**

> OpenClaw hit 250K stars in 60 days with no paid promotion. The popularity didn't come from marketing — it came from one shipped command that replaces a few hours of cluster setup. NVIDIA has since picked it up, which makes the timing easier to read.

**제거한 패턴**: `the fastest GitHub has ever seen` (en-viral-hook #3 source-skipping authority claim), `absolutely losing their minds` (en-viral-hook #5 hyperbolic lexicon), `Why is everyone ... without any marketing?` (en-viral-hook #2 clickbait mystery close). 근거 없는 절대 표현을 구체적인 숫자와 확인 가능한 보강 사실로 바꿨습니다. 위 Korean SNS 예시처럼 viral-hook은 score-only이며, rewrite는 인접한 content/style pattern을 통해 이를 줄입니다.

## 갤러리 추가 자료

이 페이지는 표준 짧은 예시를 보여 줍니다. repo에는 복사해서 볼 수 있는 더 긴 fixture와 case study도 있습니다.

- **`examples/short/`** — 네 개의 짧은 Korean fixture(marketing, tutorial, essay, email)와 짝을 이루는 `*-rewritten.md` 파일.
- **`examples/genres/`** — 세 개의 긴 Korean genre(technical, academic, narrative)와 짝을 이루는 rewrite.
- **`examples/tones/`** — 같은 입력을 여섯 tone(`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`)과 `auto`로 rewrite한 결과. 나란히 보려면 `examples/tones/RESULTS.md`를 참고하세요.
- **`examples/viral-hook/`** — iterative improvement workflow를 다루는 case study(`case-01`부터 `case-09`): viral-hook detection, codex/claude/gemini comparison, voice profile, multi-genre validation.
- **`examples/sample-rewritten-*.md`** — 같은 장문의 Korean SNS marketing post를 Codex / Claude / Gemini-3로 rewrite한 결과. `case-03`에서 cross-model comparison에 사용합니다.

## patina가 확인하는 것

- rewrite가 AI-writing pattern을 제거했나요?
- rewrite가 원래 주장을 유지했나요?
- rewrite가 source에 없던 내용을 추가했나요?
- 변경을 `--audit`, `--diff`, `--score`로 검토할 수 있나요?

목표는 editing quality이지 detector evasion이 아닙니다. AI detector는 잡음이 많습니다. patina는 score를 대략적인 신호로 보고, diff를 실제로 유용한 산출물로 봅니다.
