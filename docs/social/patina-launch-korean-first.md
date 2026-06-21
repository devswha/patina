# Korean-first launch drafts

Status: ready for maintainer posting. Score each copied post again after any
channel-specific edit. Use the playground link in every post:
<https://patina.vibetip.help/>.

## GeekNews

### Title

AI가 쓴 티 나는 문장, 패턴으로 잡아서 고쳐주는 도구를 만들었습니다

### Body

> Submission link URL = repo (<https://github.com/devswha/patina>). Do NOT repeat the repo link in the body — the header link carries it. Verified 2026-06-02: em-dash 0, patina 20 (1/5 hot; the one hot paragraph is the opener quoting "~적인/~하고 있다" as examples).

GPT로 초안을 만들면 글이 편해지는 대신 비슷한 티가 남습니다.
한국어에서는 "~적인", "~하고 있다", 과하게 높아진 한자어, 너무 반듯한 목록이 자주 보입니다.

patina는 이런 버릇을 패턴으로 잡고, 바꾼 이유를 남기면서 문장을 다듬는 오픈소스 도구입니다. 한국어, 영어, 중국어, 일본어를 지원합니다.

핵심은 저자 판정이 아니라 편집입니다. 어떤 표현을 잡았는지, 왜 바꿨는지, 원래 주장과 숫자가 살아 있는지를 audit, diff, score로 확인할 수 있게 만들었습니다.

설치 없이 웹에서 먼저 써볼 수 있습니다. https://patina.vibetip.help/

만들면서 제일 궁금했던 게 오탐입니다. 사람이 직접 쓴 글인데 patina가 어색하다고 잡으면 그게 제일 고치고 싶은 부분이라서요. 그런 문장 있으면 댓글로 던져주세요. 플레이그라운드에 '오탐 신고' 버튼을 달아놔서, 누르면 걸린 문장이 채워진 깃허브 폼이 바로 뜹니다.

## Velog

### Title

한국어 AI 티를 줄이는 오픈소스 편집 도구, patina

### Tags

오픈소스, AI, 글쓰기, 한국어, CLI, 개발도구

### Body

> Long-form blog format (wave 2). Repo link STAYS in the body here (Velog has no header link field, unlike GeekNews). Replace `BEFORE_AFTER_IMAGE` by drag-uploading `.omc/research/patina-playground-demo-ko.gif` (motion) or the red/green still pair (`patina-demo-ko-still-red.jpg` + `-green.jpg`). Verified 2026-06-02: em-dash 0, patina 20 (2/10 hot — both hot paragraphs are the intentional AI-slop example quote + its explanation; real copy is clean). Re-score if you edit the example.

AI가 쓴 초안은 바로 버리기엔 아깝고, 그대로 내보내기엔 어딘가 매끈합니다. 문제는 대개 내용이 아니라 포장입니다. 같은 형용사가 반복되고, 목록은 너무 정돈돼 있고, 한국어 문장은 슬그머니 격식체와 한자어 쪽으로 기웁니다.

patina는 그 지점을 편집 대상으로 봅니다. 한국어, 영어, 중국어, 일본어의 반복 패턴을 찾고, 해당 문장을 다시 쓰며, 무엇을 왜 바꿨는지와 원래 의미가 남았는지를 같이 보여줍니다. 저자 판정이 아니라 편집이 핵심입니다.

예를 들면 이런 문장입니다.

> 이 솔루션은 혁신적인 접근을 통해 사용자 경험을 극대화하고, 다양한 측면에서 지속 가능한 가치를 제공합니다. 또한 체계적인 프로세스를 기반으로 팀의 생산성을 효과적으로 향상시키고 있습니다.

patina는 여기서 "혁신적인 / 체계적인 / 효과적인" 같은 ~적 형용사 쌓임, "다양한 측면에서 / 기반으로" 같은 빈 수식, "향상시키고 있다" 진행형, 그리고 문장 길이가 너무 고른 점을 잡아냅니다. 같은 내용을 사람이 쓰면 보통 이렇게 됩니다.

> 온보딩 문서를 patina로 한번 훑었다. 결과는 1,400자에서 600자. 군더더기 형용사를 걷어내고 실제로 하는 일만 남기니 그렇게 줄었고, 무엇보다 그제서야 사람들이 끝까지 읽기 시작했다.

![patina playground: AI 티 문장은 빨강, 다듬으면 초록](BEFORE_AFTER_IMAGE)

쓰는 방법은 여러 가지입니다. 단독 Node CLI로도 돌리고, Claude Code·Codex·Cursor·OpenCode 스킬로도 붙습니다. codex나 claude, gemini CLI 중 하나에 이미 로그인돼 있다면 별도 API 키조차 필요 없습니다.

설치 없이 웹에서 먼저 써볼 수 있습니다. https://patina.vibetip.help/ 소스와 설치법은 깃허브에 정리해뒀습니다. https://github.com/devswha/patina

만들면서 제일 궁금했던 건 오탐입니다. 사람이 직접 쓴 글인데 patina가 어색하다고 잡으면 그게 제일 고치고 싶은 부분이라서요. 그런 문장 있으면 댓글로 던져주세요. 플레이그라운드에 '오탐 신고' 버튼을 달아놔서, 누르면 걸린 문장이 채워진 깃허브 폼이 바로 뜹니다.

## Clien-style short post

### Title

한국어 AI 티 잡는 오픈소스 도구를 만들었습니다

### Body

AI로 초안을 만들다 보면 결국 사람이 다시 지우는 표현들이 있었습니다. “~적인”, “~하고 있다”, 필요 이상으로 격식 있는 표현, 너무 반듯한 문단 같은 것들입니다.

patina는 그런 부분을 패턴으로 찾고 문장을 다듬습니다. 그냥 바꿔 쓰고 끝내는 도구가 아니라, 어떤 표현을 왜 바꿨는지와 원래 의미가 남아 있는지를 같이 보여주려 했습니다.

지원 언어는 한국어, 영어, 중국어, 일본어입니다. 웹에서 탐지만 먼저 해볼 수 있고, 실제 재작성은 CLI나 에디터 스킬로 실행합니다.

Playground:
<https://patina.vibetip.help/>

GitHub:
<https://github.com/devswha/patina>

한국어 오탐 사례를 찾고 있습니다. 사람이 쓴 글인데 어색하다고 잡히는 문장이 있으면 이 글 댓글로 편하게 알려주세요. 그런 사례가 패턴을 줄이는 데 제일 도움이 됩니다.
playground(<https://patina.vibetip.help/>)의 '오탐 신고' 버튼으로도 걸린 문장이 자동으로 채워진 GitHub 폼을 열 수 있습니다.

## Posting checklist

- Re-score the exact copied post after edits.
- Attach the score output to the internal launch note.
- Do not promise authorship proof.
- Capture false-positive examples with language, register, score output, and the paragraph that fired.
- Send public false-positive examples to <https://github.com/devswha/patina/issues/new?template=false_positive.yml>.
