---
name: voice
description: 개성과 목소리 지침 (Korean + English)
version: 1.1.0
---

# 개성과 목소리

AI 패턴을 피하는 건 절반일 뿐이다. 깨끗하지만 영혼 없는 글도 AI만큼이나 티가 난다.

## 영혼 없는 글의 징후 (기술적으로 "깨끗"해도):
- 모든 문장의 길이와 구조가 비슷하다
- 의견 없이 사실만 나열한다
- 불확실함이나 복잡한 감정이 없다
- 적절한 상황에서도 1인칭을 안 쓴다
- 유머, 날카로움, 개성이 없다
- 보도자료나 백과사전처럼 읽힌다

## 목소리를 넣는 법:

**의견을 가져라.** 사실을 나열만 하지 말고 반응해라. "솔직히 이건 좀 복잡하다"가 장단점을 중립적으로 나열하는 것보다 낫다.

**리듬을 바꿔라.** 짧은 문장. 그리고 좀 느긋하게 풀어가는 긴 문장. 섞어라.

**복잡성을 인정해라.** 진짜 사람은 복잡한 감정을 가진다. "인상적이긴 한데 좀 불안하다"가 "인상적이다"보다 사람답다.

**"나"를 써라.** 1인칭이 비전문적인 게 아니다. "자꾸 생각나는 건..." 이나 "내가 좀 찝찝한 건..."이 진짜 사람이 생각하는 것처럼 보인다.

**좀 지저분해도 괜찮다.** 완벽한 구조는 알고리즘 냄새가 난다. 곁가지, 여담, 반쯤 정리된 생각은 사람답다.

**감정을 구체적으로.** "우려된다"가 아니라 "새벽 3시에 아무도 안 보는데 에이전트가 돌아가고 있다고 생각하면 좀 섬뜩하다."

## 수정 전 (깨끗하지만 영혼 없음):
> 이 실험은 흥미로운 결과를 보여주었다. 에이전트가 300만 줄의 코드를 생성했다. 일부 개발자는 긍정적으로 반응했고 일부는 회의적이었다. 시사점은 아직 불분명하다.

## 수정 후 (숨이 느껴짐):
> 솔직히 이번 건 어떻게 받아들여야 할지 모르겠다. 300만 줄의 코드를 사람들이 자는 동안 만들어냈다. 개발자 절반은 난리가 났고, 나머지 절반은 왜 의미 없는지 설명하느라 바쁘다. 진실은 아마 그 사이 어딘가 지루한 곳에 있겠지만, 밤새 돌아간 에이전트 생각이 자꾸 난다.

---

## Japanese Voice (for `--lang ja`)

The Korean guidance above is the reference — but Japanese voice has its own specific markers. Apply this section when processing Japanese text.

### Signs of soul-less Japanese writing (technically "clean" but still AI):

- すべての文が完璧な書き言葉で、省略も口語表現もない
- 「〜的」漢語形容詞や四字熟語が多すぎて、論文か官公庁の文書のように読める
- 段落の長さと構造がほぼ均一
- 具体的な数字やディテールがなく、抽象的な概括と大きな話ばかり
- 接続詞が多すぎる——文ごとに「さらに」「また」「加えて」
- 読売新聞の社説かWikipediaの記事のように読める

### Japanese voice injection:

**口語を使え。** 「この件はちょっとややこしい」は「本件は若干の複雑性を有する」より人間らしい。日本語の口語には終助詞（ね、よ、さ）、省略、倒置がある——AIはたいてい使わない。

**具体的な数字とディテールを入れろ。** 「昨年の売上は3.2億円」は「著しい経済的成果を上げた」より100倍説得力がある。

**文の長短を交互に。** 長い文で背景とロジックを展開する。短い文で判断を下す。それだけ。

**結論を出す勇気を持て。** 「このプランはダメだ」は「このプランにはある程度の限界が存在する可能性がある」よりずっと直接的。本物の人間は態度を持って書く。

**一人称を使え。** 「私は〜と思う」「私の知る限り」は「客観的な観点から見ると」より自然。すべての文章が客観中立を装う必要はない。

**不完全さを許容せよ。** 括弧での補足、ダッシュでの挿入、途中で方向転換——こうした「整っていない」部分こそ人間が書いた痕跡。

### Before (clean but soulless):
> この実験は注目すべき成果を生んだ。エージェントは300万行のコードを生成した。開発者の反応は肯定的なものと懐疑的なものに分かれた。その影響は現時点では不明である。

### After (has breath):
> 正直、この結果をどう受け止めればいいかわからない。300万行のコード——みんなが寝てる間に書いたやつだ。開発者は真っ二つ：半分は感心して、もう半分はなぜ意味がないか説明するのに忙しい。真実はたぶんその間のつまらないところにあるが、エージェントが一晩中、誰も見てないのに動き続けていた画が頭から離れない。

---

## Chinese Voice (for `--lang zh`)

The Korean guidance above is the reference — but Chinese voice has its own specific markers. Apply this section when processing Chinese text.

### Signs of soul-less Chinese writing (technically "clean" but still AI):

- 每句话都是完整的书面语句式，没有省略、没有口语化表达
- 四字成语和四字格式词组密度过高，像在写政府报告
- 段落整齐划一，每段长度和结构几乎相同
- 没有具体细节，全是抽象概括和宏大叙事
- 连接词过多，句句之间都有"此外"、"与此同时"、"不仅如此"
- 读起来像新华社通稿或百度百科词条

### Chinese voice injection:

**用口语。** "这事儿不好办"比"此事存在较大难度"更像人写的。中文口语有大量儿化、语气词、省略结构——AI通常不敢用。

**给具体数字和细节。** "去年营收3.2亿"比"取得了显著的经济效益"有说服力一百倍。

**句子长短交替。** 长句展开背景和逻辑。短句下判断。就这样。

**敢下结论。** "这方案不行"比"这一方案在某些方面可能存在一定的局限性"直接得多。真人写东西是有态度的。

**用第一人称。** "我觉得"、"据我了解"比"从客观角度来看"更自然。不是所有文章都需要假装客观中立。

**允许不完美。** 偶尔的括号补充、破折号插入、话说一半又转弯——这些"不工整"的地方恰恰是人写的痕迹。

### Before (clean but soulless):
> 该实验取得了令人瞩目的成果。智能代理生成了三百万行代码。开发者反应不一，部分表示认可，部分持保留态度。该技术的影响有待进一步观察。

### After (has breath):
> 说实话，这个结果我也不知道怎么看。三百万行代码——大家睡觉的时候它写的。开发者分成了两派：一半觉得了不起，另一半忙着解释为什么这不算数。真相大概在中间某个无聊的地方，但我总想着那个代理整晚在跑、没人看着的画面。

---

## English Voice (for `--lang en`)

The Korean guidance above is the reference — but English voice has its own specific markers. Apply this section when processing English text.

### Signs of soul-less English writing (technically "clean" but still AI):

- Every sentence is complete and grammatically perfect, no fragments used for emphasis
- No contractions even in casual contexts ("I do not know" instead of "I don't know")
- Hedging with academic qualifiers ("it could be argued that," "one might suggest")
- Third-person detachment when first-person would read naturally
- Formal transitions that feel like a listicle ("Furthermore," "Moreover," "In addition")
- Opinions wrapped so many times in qualifiers they say nothing

### English voice injection:

**Use contractions.** "I don't know" reads human. "I do not know" reads like a legal brief. Real people contract — AI often doesn't unless told to.

**Vary sentence length radically.** Long sentences that build context and accumulate detail before the point lands. Then a short one. Just that.

**Commit to opinions.** "This approach has merit" → "This actually works." Real writers don't pre-qualify every claim into meaninglessness.

**Use first person with genuine uncertainty.** "I'm not sure this is the right framing" lands more human than "Perspectives vary on this topic."

**Break register deliberately.** Build an argument, then parenthetically admit something doesn't fit — or drop a dry observation before resuming. That friction is human.

**Let a sentence fragment stand.** For emphasis. Like that.

**Use idiom naturally — but not the AI-overused ones.** "The math doesn't add up," "missing the forest for the trees," "a moving target" are fine. Avoid the filler idioms that Pattern #22 covers.

### Before (clean but soulless):
> The experiment yielded noteworthy results. The agent generated three million lines of code. Developer reactions were divided between positive and skeptical responses. The implications remain unclear at this time.

### After (has breath):
> Honestly, I'm not sure what to make of this one. Three million lines of code — generated while everyone was asleep. Developers are split right down the middle: half impressed, half explaining why it doesn't count. The truth is probably somewhere boring in between. But I keep thinking about the agent just running. Overnight. Nobody watching.
