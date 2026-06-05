# Korean-first launch drafts

Status: ready for maintainer posting. Score each copied post again after any
channel-specific edit. Use the playground link in every post:
<https://patina.vibetip.help/>.

## GeekNews

### Title

AI가 쓴 티 나는 문장, 패턴으로 잡아서 고쳐주는 도구를 만들었습니다

### Body

GPT로 초안을 만들면 글이 편해지는 대신 비슷한 티가 남습니다.
한국어에서는 “~적인”, “~하고 있다”, 과하게 높아진 한자어, 너무 반듯한 목록이 자주 보입니다.

patina는 이런 버릇을 패턴으로 잡고, 바꾼 이유를 남기면서 문장을 다듬는 오픈소스 도구입니다. 한국어, 영어, 중국어, 일본어를 지원합니다.

핵심은 저자 판정이 아니라 편집입니다. 어떤 표현을 잡았는지, 왜 바꿨는지, 원래 주장과 숫자가 살아 있는지를 audit, diff, score로 확인할 수 있게 만들었습니다.

웹에서 먼저 써볼 수 있습니다.
<https://patina.vibetip.help/>

레포는 여기입니다.
<https://github.com/devswha/patina>

특히 한국어 오탐 사례가 궁금합니다. 사람이 직접 쓴 글인데 patina가 어색하다고 잡는 문장이 있으면 이 글 댓글로 편하게 붙여주셔도 됩니다.
웹에서 바로 신고: 플레이그라운드(<https://patina.vibetip.help/>)에서 '오탐 신고' 버튼을 누르면 걸린 문장이 자동으로 채워진 GitHub 폼이 열립니다.

## Velog

### Title

한국어 AI 티를 줄이는 오픈소스 편집 도구, patina

### Body

AI가 쓴 초안은 바로 버리기엔 아깝고, 그대로 내보내기엔 어딘가 매끈합니다. 문제는 대개 내용보다 포장입니다. 같은 형용사가 반복되고, 목록은 너무 정돈되어 있고, 한국어 문장은 갑자기 격식체와 한자어 쪽으로 기웁니다.

patina는 그 지점을 편집 대상으로 봅니다. 한국어, 영어, 중국어, 일본어의 반복 패턴을 찾고, 해당 문장을 다시 쓰며, 변경 이유와 의미 보존 여부를 함께 보여줍니다.

Node CLI로도 쓰고, Claude Code, Codex, Cursor, OpenCode 스킬로도 쓸 수 있습니다. codex, claude, gemini CLI 중 하나에 이미 로그인돼 있다면 별도 API 키 없이도 돌릴 수 있습니다.

먼저 웹 playground에서 문체 신호를 확인해볼 수 있습니다.
<https://patina.vibetip.help/>

소스와 설치 방법은 GitHub에 정리했습니다.
<https://github.com/devswha/patina>

제가 가장 보고 싶은 피드백은 오탐입니다. 사람이 쓴 글을 잘못 잡는 사례가 있어야 한국어 패턴을 더 조심스럽게 다듬을 수 있습니다. 댓글로 편하게 남겨주셔도 됩니다.
playground(<https://patina.vibetip.help/>)의 '오탐 신고' 버튼을 누르면 걸린 문장이 자동으로 채워진 GitHub 폼이 열립니다.

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
