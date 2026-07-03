# AI 슬롭 택소노미

> AI 에게 디자인을 시켰을 때 사람이 가장 싫어하는, "AI 가 만들었다" 가 드러나는 클리셰 51개. 무엇이 신호인지 짚고, 대신 쓸 양화 패턴으로 연결하는 음화 사전입니다.

**8 Parts · 11 Categories · 51+ Keywords**

## Part 1: 컬러 · 표면

색·그라디언트·재질에서 가장 먼저 드러나는 AI 시그니처 (8개 키워드)

### 1. Gradient & Color · 그라디언트·색

특정 색과 그라디언트로 화면을 덮어 마무리한 듯 보이게 하는 클리셰.

| Pattern | 한글 | Aliases | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Purple-Blue Gradient | 보라-파랑 그라디언트 | AI Purple, VibeCode Purple | 히어로 배경·CTA·오브·텍스트에 보라에서 파랑으로 흐르는 그라디언트가 반복된다. | 구성·위계 고민 없이 그라디언트로 표면을 덮어 "혁신적" 인상을 흉내 낸다. | 2015~2020 모던 웹의 화석이라 즉시 낡고 무난하게 읽힌다. AI 데모의 비공식 깃발로 굳었다. | strong | median | Monochromatic (design), 60% Dominant (design) | prg.sh, r/webdev |
| Indigo-500 Accent | 인디고 액센트 | bg-indigo-500 | 버튼·링크·포커스 상태가 하나같이 라벤더-인디고 한 톤(#6366f1 류)으로 칠해진다. | Tailwind UI 디폴트 bg-indigo-500 이 학습 데이터를 오염시켜 누출된 단일 액센트. | 브랜드 색을 고른 흔적이 없어 "아무 색도 결정 안 한" 인상을 준다. | weak | median | 10% Accent (design), Complementary (design) | adamwathan (X), prg.sh |
| Everywhere Glow | 도처의 컬러 글로우 |  | 요소 뒤마다 큰 컬러 글로우와 네온 외곽 발광, 부드러운 box-shadow 가 깔린다. | 깊이를 만드는 대신 글로우로 균일하게 덮어 빛의 의도가 없다. | 모든 요소가 똑같이 빛나 위계가 사라지고 눈이 피로해진다. | weak | no-constraint | Figure-Ground (layout), Z-axis Layering (layout) | developersdigest |
| Iridescent Computational Palette | 무지갯빛 계산적 팔레트 |  | 다크 위 시안·네온 액센트, 무지갯빛·메탈릭 색 관계로 "하이퍼리얼" 표면을 만든다. | 전통 색 조화가 아니라 계산으로 뽑은 듯한 색 관계라 인공적으로 느껴진다. | 실제 브랜드·콘텐츠 맥락과 무관해 차갑고 공허하게 읽힌다. | weak | median | Analogous (design), Split-Complementary (design) | developersdigest, UX Planet |
| Mesh/Aurora Background Default | 메시·오로라 배경 디폴트 |  | 블러 처리된 컬러 블롭이 흐르는 오로라·메시 그라디언트를 모든 히어로 배경에 쓴다. | 콘텐츠와 무관하게 배경만 화려해 "빈 화면 채우기" 로 읽힌다. | 같은 배경이 수많은 AI 사이트에 반복돼 개성이 0 이 된다. | weak | no-constraint | Negative Space (layout), Swiss / Editorial (design) | 925studios |

### 2. Surface & Theme · 재질·테마

반투명 유리·상시 다크모드 같은 표면 처리의 디폴트화.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Glassmorphism Default | 글래스모피즘 디폴트 | 프로스티드 글라스 반투명 카드를 맥락 없이 기본값으로 깐다. | 2022년 유행이 LLM 디폴트로 굳어, 가독성·맥락 판단 없이 자동 적용된다. | 텍스트 대비를 깨고 저사양에서 무거우며 유행이 지난 인상을 준다. | weak | no-constraint | Swiss / Editorial (design), OutlinedCard (design) | developersdigest |
| Permanent Dark Mode | 상시 다크모드 | 토글 없이 항상 켜진 다크 테마에 중간 회색 본문, 대문자 라벨을 얹는다. | "테크스럽게 보이려는" 디폴트라 라이트 대안을 만든 흔적이 없다. | 강제된 다크는 장문 가독성을 떨어뜨리고 선택권을 뺏는다. | weak | median | DarkModeTransition (design) | developersdigest, r/ClaudeAI |
| Low-Contrast Body | 저대비 본문 | 다크 테마에서 본문이 WCAG AA 를 못 넘는 중간 회색으로 깔린다. | 미감 우선으로 명도를 낮춰 접근성 점검을 건너뛴 흔적. | 실제로 읽기 어려워 사용자를 배제하고, 점검 안 한 티가 명확하다. | strong | no-verify | Weight Contrast (layout) | developersdigest |

## Part 2: 타이포그래피

폰트 선택과 조합에서 드러나는 "고른 적 없음" 의 신호 (6개 키워드)

### 3. Typeface Defaults · 서체 디폴트

안전한 산세리프와 반복되는 조합으로 수렴하는 클리셰.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inter for Everything | Inter 도배 | Inter·Geist·Poppins 같은 안전한 산세리프를 모든 텍스트에 쓴다. | 학습 데이터에서 가장 흔한 폰트라 의도적 서체 선택이 없었음을 드러낸다. | 브랜드 목소리가 사라지고 모든 사이트가 형제처럼 보인다. | weak | median | High-Contrast Serif (design), Variable Fonts (design), Anti-AI Humantouch Type (design) | developersdigest, 925studios |
| Italic Serif Accent Word | 이탤릭 세리프 강조어 | Inter 일색 히어로에서 단어 하나만 이탤릭 세리프로, 또는 큰 이탤릭 세리프를 메인 헤드라인으로 쓴다. | 2025~2026 "유니버설 AI 스타트업 히어로" 로 급부상한 단일 패턴. | 차별화를 노린 장치가 역설적으로 가장 흔한 신호가 됐다. | strong | median | Exaggerated Hierarchy (design) | developersdigest, Figma trends |
| Repeated Font Combos | 반복 폰트 조합 | Space Grotesk + Instrument Serif + Geist 같은 조합이 페이지마다 재등장한다. | 특정 "트렌디" 조합이 데모마다 복제돼 출처가 같아 보인다. | 폰트 페어링을 직접 한 게 아니라 빌려온 인상을 준다. | weak | median | Neo-Grotesque Sans (design) | developersdigest |
| All-Caps Eyebrow / Title Case | 대문자 라벨·타이틀케이스 | 섹션 라벨을 작은 대문자 자간으로, 헤딩을 모든 단어 첫 글자 대문자로 쓴다. | SaaS 템플릿의 기본 위계 신호를 그대로 답습한다. | 읽기 리듬을 끊고 정형화된 마케팅 톤을 강요한다. | weak | median | Weight Contrast (layout) | developersdigest |

### 4. Type Effects · 텍스트 효과

텍스트에 거는 장식 효과의 무분별한 적용.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gradient Text | 그라디언트 텍스트 | 헤드라인·키워드에 보라-파랑 그라디언트 색을 입힌다. | 강조 수단이 없을 때 색 그라디언트로 때우는 디폴트. | 대비·가독성을 해치고 컬러 클리셰를 텍스트까지 확장한다. | weak | no-constraint | Scale Contrast (layout) | developersdigest |
| Extreme Hierarchy Cliché | 극단 위계 클리셰 | 120px+ 헤드라인과 10~12px 마이크로 텍스트만 병치하고 중간 단계가 없다. | 드라마만 노려 모듈러 스케일 없이 크기를 양극단으로 던진다. | 중간 정보가 사라져 위계가 아니라 충돌로 읽힌다. | weak | underspec | Modular Scale (layout) | community |

## Part 3: 레이아웃 · 구조

페이지 골격과 섹션 순서가 모두 형제처럼 같아지는 신호 (7개 키워드)

### 5. Page Skeleton · 페이지 골격

히어로와 섹션 순서가 정형화되어 수렴하는 클리셰.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Centered Hero | 가운데 정렬 히어로 | 큰 산세리프 헤드라인을 중앙에 두고 그 아래 부제와 버튼 2개를 놓는다. | AI 가 가장 자주 수렴하는 기본 히어로 구도. | 시선 유도·긴장감이 없고 모든 랜딩이 똑같아 보인다. | strong | median | Asymmetric Balance (layout), Asymmetric Split (design) | developersdigest, AXE-WEB |
| Fixed Section Stack | 정형 섹션 순서 | 히어로 → 피처 카드 3개 → 후기 → 가격표 → 푸터의 고정 순서를 그대로 쌓는다. | 모든 AI 페이지가 같은 형제 순서를 따른다. | 콘텐츠 우선순위를 따진 흔적이 없어 템플릿 그 자체로 읽힌다. | strong | median | Hierarchical Grid (layout), Sectioned Stack (layout) | AXE-WEB, dev.to |
| Icon-Top 3 Feature Cards | 아이콘 상단 3열 피처 카드 | 동일한 카드 3개에 상단 아이콘 + 제목 + 설명을 반복한다. | 정형 시퀀스의 핵심 블록이자 "3의 법칙" 의 레이아웃판. | 셋이 늘 동등해 무엇이 중요한지 알 수 없다. | strong | median | Bento Grid (layout), Asymmetric Balance (layout) | developersdigest |
| Numbered 1-2-3 Steps | 1-2-3 단계 레이아웃 | "1, 2, 3" 번호를 단 진행 블록을 거의 모든 페이지에 넣는다. | 설명을 단계로 쪼개는 디폴트 서술 틀. | 실제 절차가 아닌데도 형식만 빌려 도식적으로 읽힌다. | weak | median | Steps (design) | developersdigest |

### 6. Grid & Sizing · 그리드·크기

그리드 선택과 크기 처리에서 우선순위를 지워버리는 클리셰.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bento Grid Overuse | 벤토 그리드 남용 | 크기가 다른 둥근 칸들의 그리드를 맥락 없이 기본 레이아웃으로 쓴다. | Perplexity·Suno 류 AI 제품이 과사용해 AI 제품의 시그니처가 됐다. | 칸 크기가 우선순위를 담지 않으면 그저 트렌드 흉내로 읽힌다. | weak | no-constraint | Bento Grid (layout), Hierarchical Grid (layout) | Landdding, openads |
| Uniform Rounding & Sizing | 균일 라운드·사이즈 | 16px 동일 라운드, 동일 패딩, 동일 카드 높이가 화면을 덮는다. | 위계 대신 시각적 평탄함을 만들어 "아무 결정도 안 한" 인상을 준다. | 모든 요소가 동등해 시선이 멈출 곳이 없다. | weak | no-constraint | Scale Contrast (layout), Spatial Grouping (layout) | developersdigest |
| Stat Banner Row | 지표 배너 행 | "10k+ users", "99.9% uptime" 같은 숫자 메트릭을 가로로 늘어놓는다. | 신뢰를 숫자로 때우는 정형 블록. | 맥락 없는 숫자라 진위가 의심되고 클리셰로 읽힌다. | weak | median | Statistic (design) | developersdigest |

## Part 4: 컴포넌트 · UI 키트

특정 라이브러리 디폴트와 정형 컴포넌트가 그대로 노출되는 신호 (6개 키워드)

### 7. Kit Defaults · UI 키트 디폴트

스타일 개입 없이 라이브러리 기본 룩이 그대로 드러나는 클리셰.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shadcn Default Look | shadcn 디폴트 | shadcn/ui 기본 스타일을 한 줄도 손대지 않고 그대로 노출한다. | AI 에이전트가 복붙하도록 설계된 키트라 개입 없는 페이지가 동일 룩으로 수렴한다. | "AI 인터페이스의 비공식 깃발" 로 불릴 만큼 출처가 빤히 보인다. | strong | underspec | Padding Scale (layout), FilledCard (design) | The Fountain Institute |
| Lucide-Only Icons | Lucide 아이콘 일색 | shadcn 기본 아이콘 세트(Lucide)나 Hero Icons 만 일관되게 쓴다. | 커스텀·혼용 없이 단일 세트라 키트 디폴트가 그대로 보인다. | 브랜드 아이콘 언어가 없어 어디서 본 듯한 인상을 준다. | weak | underspec | SVGMorphing (design) | The Fountain Institute |
| Pill Eyebrow Badge | 헤드라인 위 알약 라벨 | 오버사이즈 헤드라인 바로 위에 작은 대문자 pill chip 을 단다. | "default AI SaaS hero" 의 고정 부품. | 거의 모든 AI 랜딩이 같은 자리에 같은 알약을 단다. | strong | median | Focal Point (layout) | developersdigest |
| Colored Left Border Cards | 카드 좌측 컬러 스트라이프 | 카드·인용구 왼쪽 가장자리에 3~4px 색 줄을 일괄로 넣는다. | 강조 장치가 없을 때 좌측 스트라이프로 때우는 디폴트. | 모든 카드가 같은 장식을 달아 위계가 평탄해진다. | weak | median | Figure-Ground (layout) | developersdigest |
| Dead "Get Started" CTA | 작동 안 하는 CTA | "Get Started" 버튼이 아무 데도 안 가거나 같은 페이지로 루프한다. | 생성 후 클릭을 점검하지 않은 흔적. | 실제로 동작하지 않아 신뢰를 즉시 무너뜨린다. | strong | no-verify | Button (design) | developersdigest, The Fountain Institute |
| Emoji Icon Navigation | 이모지 네비게이션 | 사이드바·네브바에 아이콘 대신 이모지를 쓴다. | 아이콘 시스템을 만들지 않고 이모지로 대체한 흔적. | 플랫폼마다 다르게 렌더되고 장난스러워 신뢰를 깎는다. | weak | no-constraint | NavigationMenu (design) | developersdigest |

## Part 5: 일러스트 · 이미지

생성 이미지 특유의 매끈함·과렌더링·해부 오류 신호 (5개 키워드)

### 8. Generated Imagery · 생성 이미지

생성 모델 특유의 룩과 결함이 그대로 노출되는 클리셰.

| Pattern | 한글 | Aliases | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Corporate Memphis | 코퍼릿 멤피스 | Alegria, Big Tech Art | 작은 머리에 길고 구부러진 사지, 얼굴 없는 인물이 춤추는 플랫 일러스트와 비현실 피부톤. | 2017 Facebook Alegria 발 과포화 스타일이 디폴트로 굳었다. | 개성을 지운 "글로벌 무난체" 라 조롱의 대상이 된 지 오래다. | strong | median | Linocut (visual), Risograph (visual) | Wikipedia, Webflow |
| Plastic AI Illustration | 플라스틱 AI 일러스트 |  | 약간 너무 매끈하고 너무 대칭이며 플라스틱 질감에 완벽한 조명을 가진 일러스트. | 손맛·불완전성이 없어 "사람이 그린 적 없음" 이 드러난다. | 균질한 완벽함이 차갑고 가짜처럼 느껴진다(uncanny). | strong | underspec | Etching (visual), Woodcut (visual) | UX Planet |
| Octane 3D Blob / Neon Render | 옥테인 3D 블롭·네온 렌더 |  | 발광 네온, 옥테인 렌더 글로시 3D 오브·블롭을 배경 비주얼로 쓴다. | Midjourney·생성 3D 의 시그니처 룩. | 내용과 무관한 장식이라 공허하고 양산형으로 읽힌다. | weak | median | Flat Fill (visual) | developersdigest |
| AI Stock Smoothness & Anatomy Glitches | AI 스톡 매끈함·해부 오류 |  | 과한 조명, 어긋난 비율, 손가락·텍스트 깨짐, 플라스틱 피부의 생성 스톡 이미지. | 디테일(손·눈·글자)을 확대하면 어긋남이 드러난다. | 점검 없이 박아넣은 결함이라 아마추어·날림 인상을 준다. | strong | no-verify | Image (design) | Originality.AI, doooob |
| Generic AI Logo Tropes | AI 로고 클리셰 |  | 헥사곤, 소용돌이(swirl), 뉴럴넷·뇌·회로 모티프에 그라디언트 + 산세리프 워드마크. | OpenAI 소용돌이 이후 "진지한 AI" 로고가 템플릿화됐다. | 경쟁 로고와 구별이 안 돼 브랜드 자산이 되지 못한다. | weak | median | Negative Space (layout) | ebaqdesign |

## Part 6: 카피 · UX 라이팅

문구·문장부호·포맷에서 드러나는 AI 글쓰기의 티 (9개 키워드)

### 9. Phrasing & Punctuation · 문구·문장부호

상투어와 정형 구문, 특정 문장부호의 과사용 클리셰.

| Pattern | 한글 | Aliases | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Em-Dash Overuse | em-dash 남발 |  | 한 단락에 em-dash 를 서너 개씩 넣어 부연과 전환을 잇는다. | 학술·저널 코퍼스가 고품질로 가중 학습돼 모델이 과사용한다. | 사람은 구두점을 무의식적으로 섞는데 AI 는 한 부호에 쏠린다. | weak | median | Caption (design) | Rolling Stone, Wikipedia |
| AI Buzzword Stack | AI 상투어 더미 |  | unleash·elevate·seamless·robust·cutting-edge·delve·harness 를 쌓아 인상만 준다. | 구체성 없는 상투어가 문장마다 반복된다. | 무엇을 하는 제품인지 끝까지 알 수 없다. | strong | median |  | Content Beta, Wikipedia |
| Vague Aspirational Headline | 막연한 포부형 헤드라인 |  | "Build the future of work" 류 본 헤드라인을 평균낸 무의미 문구. | 구체 가치 없이 거대 비전만 던지는 디폴트. | 아무 제품에나 붙어 식별·기억이 안 된다. | strong | median |  | 925studios |
| Rule of Three Everywhere | 3의 법칙 남용 |  | 형용사 셋, 짧은 구 셋을 모든 섹션에 반복해 충실해 보이게 위장한다. | 내용 밀도와 무관하게 3개 묶음이 기계적으로 반복된다. | 리듬이 단조롭고 의도가 아니라 습관으로 읽힌다. | weak | median |  | Wikipedia, Olivia Cal |
| Not Just X but Y | 대조 구문 반복 |  | "It is not just A, it is B" 류 균형 대조문을 반복한다. | 깊이를 흉내 내는 정형 수사 구조. | 같은 틀이 반복돼 공허한 멋부림으로 읽힌다. | weak | median |  | Wikipedia, Olivia Cal |
| Bold-Header Colon Lists | 볼드 헤더 콜론 리스트 |  | 불릿마다 볼드 헤더 + 콜론 + 설명 형식에 핵심어를 과도하게 볼드 처리한다. | AI 답변 포맷이 그대로 사용자 카피로 새어 나온다. | 말하는 사람이 아니라 요약기가 쓴 글로 읽힌다. | weak | median |  | Wikipedia |
| Emoji Overuse | 이모지 남발 |  | 초록 체크, 반복 스마일리를 본문·불릿에 과하게 넣는다. | 강조를 이모지로 때우는 디폴트 포맷. | 진지함을 깎고 시각적으로 산만하다. | weak | no-constraint |  | developersdigest, Olivia Cal |
| Hedging Language | 책임 회피 어법 |  | "may help", "can potentially" 처럼 확언을 피하는 어법이 깔린다. | 모델의 안전 어조가 마케팅 카피에까지 남는다. | 자신 없는 제품처럼 읽혀 설득력이 떨어진다. | weak | median |  | Olivia Cal |
| Korean AI Translationese | 한국어 AI 번역투 | 번역투, AI 티 | "오늘날 빠르게 변화하는", 무생물 주어, 과한 피동·병렬 등 영어 직역체 한국어. | 영어 코퍼스 패턴이 한국어로 옮겨와 어색한 번역투가 된다. | 한국 독자에게 즉시 "기계가 쓴 글" 로 들킨다. | strong | median |  | humanize-korean (내부) |

## Part 7: 모션 · 인터랙션

목적 없는 움직임과 다듬지 않은 상호작용의 신호 (4개 키워드)

### 10. Motion Defaults · 모션 디폴트

의미 없이 적용되거나 빠진 모션과 마이크로 인터랙션 클리셰.

| Pattern | 한글 | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Generic Fade-In on Scroll | 천편일률 페이드인 | 모든 스크롤 등장 애니메이션이 동일 타이밍·이징의 fade-up 으로 처리된다. | 상태·맥락과 무관하게 같은 효과가 전 요소에 일괄 적용된다. | 모션이 정보를 전달하지 않고 장식으로만 반복된다. | weak | median | StaggeredReveal (design), ScrollReveal (design) | developersdigest |
| Motion Without Meaning | 의미 없는 모션 | 튕기는 버튼, 흔들리는 아이콘, 떠다니는 배지처럼 목적 없는 움직임을 넣는다. | "움직이면 좋다" 는 디폴트 가정으로 모션을 남발한다. | 주의를 분산시키고 피로를 유발한다. | weak | no-constraint | LayoutAnimation (design) | developersdigest |
| Missing Micro-Interactions | 마이크로 인터랙션 부재 | 아무 일도 안 하는 hover, 피드백 없는 클릭처럼 상태 전환이 비어 있다. | 디폴트 템플릿을 다듬지 않은 흔적. | 반응이 없어 죽은 화면처럼 느껴진다. | weak | no-verify | HoverCard (design), SpringPhysics (design) | The Fountain Institute |
| Parallax & Marquee Overuse | 패럴랙스·마키 남용 | 패럴랙스 배경과 무한 흐르는 로고 마키를 맥락 없이 기본으로 넣는다. | "트렌디한 사이트" 의 부품을 무비판 복제한다. | 성능을 깎고 콘텐츠보다 효과가 앞선다. | weak | no-constraint | Parallax (design), Marquee (design) | community |

## Part 8: 메타 · 근본 원인

개별 클리셰를 낳는 구조적 원인. 처방의 출발점 (6개 키워드)

### 11. Root Causes · 근본 원인

표면 클리셰를 만드는 메커니즘. 한 항목이 여러 Part 의 신호를 동시에 설명한다.

| Pattern | 한글 | Aliases | Description | Tell | Why Disliked | Severity | Cause | Escape | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mean-Best Aesthetic | 평균의 평균 미감 | mean best, median aesthetic | 제약이 없으면 LLM 이 학습 코퍼스의 중앙값을 출력해 "무난함" 으로 수렴한다. | 모든 표면 클리셰가 결국 여기서 파생되는 우산 개념. | 디자인은 결정의 총합인데 결정이 빠진 평균만 남는다. | strong | median | Asymmetric Balance (layout) | r/vibecoding, prg.sh |
| Vague Taste-Word Prompting | 취향 단어만 던지기 |  | "modern, clean, premium" 같은 취향 단어만 주고 구체 명세를 안 준다. | 명세가 없으니 모델이 디폴트로 채운다. | 의도가 전달되지 않아 결과가 매번 같은 평균으로 떨어진다. | strong | underspec |  | illustration.app |
| No Brand Constraint | 제약 부재 |  | 브랜드 토큰·접근성 기준·콘텐츠 가드레일 없이 생성만 빠르게 한다. | 유행 패턴을 무비판 적용한 흔적이 화면 전반에 깔린다. | 차별화의 근거가 없어 경쟁 화면과 구별되지 않는다. | strong | no-constraint |  | developersdigest, illustration.app |
| Differentiation Failure | 차별화 실패 | homogenization, 동질화 | 결과가 동시대 다른 AI 산출물과 구별되지 않는 동질화 상태. | "어디서 본 것 같다" 가 첫 반응이 된다. | 브랜드 자산이 쌓이지 않고 기억에 남지 않는다. | strong | median | Anti-AI Humantouch Type (design) | Forbes, AXE-WEB |
| No Pre-Implementation Verification | 구현 전·후 검증 부재 |  | 생성한 결과를 사람이 점검하지 않아 슬롭 폰트·깨진 위계·죽은 링크가 남는다. | 한국 커뮤니티가 진단의 무게중심으로 짚는 원인. | 결함이 그대로 배포돼 날림 인상을 굳힌다. | strong | no-verify | Aspect-ratio Discipline (layout) | Threads(KR), Instagram(KR) |
| Cargo Cult of 2020 Web | 2020 웹의 화석화 |  | 2018~2022 유행 패턴을 현재의 "모던" 으로 착각해 재생산한다. | 학습 데이터 시점에 미감이 고정돼 시간이 멈춘 듯하다. | 이미 지난 트렌드라 낡고 뒤처진 인상을 준다. | weak | median | Swiss / Editorial (design) | prg.sh, community |
