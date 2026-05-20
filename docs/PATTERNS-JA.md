# Japanese Pattern Reference

This page expands the Japanese pattern packs into a browsable reference. It is generated from `patterns/ja-*.md`, so the numbers, names, watch words, fire conditions, and examples mirror the source pattern files.

- Rewrite-capable patterns: 32
- Score/audit-only viral-hook patterns: 5
- Main selector: [PATTERNS.md](PATTERNS.md)

## Pattern Index

| # | Type | Pattern | Source |
|---|------|---------|--------|
| 1 | rewrite | 過度な重要性の強調 | [ja-content.md](../patterns/ja-content.md) |
| 2 | rewrite | 過度な注目度・メディア言及 | [ja-content.md](../patterns/ja-content.md) |
| 3 | rewrite | ～しながら/～することで 表層的分析 | [ja-content.md](../patterns/ja-content.md) |
| 4 | rewrite | 広告的・宣伝的言語 | [ja-content.md](../patterns/ja-content.md) |
| 5 | rewrite | 曖昧な出典引用 | [ja-content.md](../patterns/ja-content.md) |
| 6 | rewrite | 定型的な課題と展望 | [ja-content.md](../patterns/ja-content.md) |
| 7 | rewrite | AI特有の語彙の多用 | [ja-language.md](../patterns/ja-language.md) |
| 8 | rewrite | 〜的（てき）接尾辞の多用 | [ja-language.md](../patterns/ja-language.md) |
| 9 | rewrite | 否定並列構造 | [ja-language.md](../patterns/ja-language.md) |
| 10 | rewrite | 三の法則の多用 | [ja-language.md](../patterns/ja-language.md) |
| 11 | rewrite | 類義語の循環 | [ja-language.md](../patterns/ja-language.md) |
| 12 | rewrite | カタカナ外来語の多用 | [ja-language.md](../patterns/ja-language.md) |
| 32 | rewrite | 「より」比較副詞の濫用 | [ja-language.md](../patterns/ja-language.md) |
| 13 | rewrite | 接続表現の過剰使用 | [ja-style.md](../patterns/ja-style.md) |
| 14 | rewrite | 太字の多用 | [ja-style.md](../patterns/ja-style.md) |
| 15 | rewrite | インラインヘッダーリスト | [ja-style.md](../patterns/ja-style.md) |
| 16 | rewrite | ございます／でございます敬語の過剰使用 | [ja-style.md](../patterns/ja-style.md) |
| 17 | rewrite | 絵文字 | [ja-style.md](../patterns/ja-style.md) |
| 18 | rewrite | 過剰なである調／硬質文体 | [ja-style.md](../patterns/ja-style.md) |
| 19 | rewrite | チャットボットの痕跡 | [ja-communication.md](../patterns/ja-communication.md) |
| 20 | rewrite | 学習データ切断日の免責 | [ja-communication.md](../patterns/ja-communication.md) |
| 21 | rewrite | お世辞・追従的な語調 | [ja-communication.md](../patterns/ja-communication.md) |
| 29 | rewrite | 偽りのニュアンス（事後的な言い換え） | [ja-communication.md](../patterns/ja-communication.md) |
| 22 | rewrite | フィラー表現 | [ja-filler.md](../patterns/ja-filler.md) |
| 23 | rewrite | 過剰なヘッジング | [ja-filler.md](../patterns/ja-filler.md) |
| 24 | rewrite | 空虚な楽観的結論 | [ja-filler.md](../patterns/ja-filler.md) |
| 31 | rewrite | 結論シグナルワードの濫用 | [ja-filler.md](../patterns/ja-filler.md) |
| 25 | rewrite | 構造的繰り返し | [ja-structure.md](../patterns/ja-structure.md) |
| 26 | rewrite | 翻訳調 | [ja-structure.md](../patterns/ja-structure.md) |
| 27 | rewrite | ている進行形の多用 | [ja-structure.md](../patterns/ja-structure.md) |
| 28 | rewrite | 起承転結の過剰使用 | [ja-structure.md](../patterns/ja-structure.md) |
| 30 | rewrite | 修辞的疑問の段落冒頭 | [ja-structure.md](../patterns/ja-structure.md) |
| VH-1 | score/audit only | 数字ショックフック | [ja-viral-hook.md](../patterns/ja-viral-hook.md) |
| VH-2 | score/audit only | クリックベイト末尾 | [ja-viral-hook.md](../patterns/ja-viral-hook.md) |
| VH-3 | score/audit only | 出典回避の権威主張 | [ja-viral-hook.md](../patterns/ja-viral-hook.md) |
| VH-4 | score/audit only | 息継ぎ最適化の短文羅列 | [ja-viral-hook.md](../patterns/ja-viral-hook.md) |
| VH-5 | score/audit only | 誇張エンゲージメント語彙 | [ja-viral-hook.md](../patterns/ja-viral-hook.md) |

## コンテンツパターン

### 1. 過度な重要性の強調

- Source: [ja-content.md](../patterns/ja-content.md)
- Type: rewrite-capable pattern
- Watch words: 画期的な、革新的な、パラダイムシフト、歴史的な転換点、新たな地平を切り開く、礎を築く、金字塔、～の先駆けとなる、～において極めて重要な意義を持つ、～の幕開け、時代を画する
- Fire condition: 同一段落に注意語彙が2つ以上出現するか、「画期的」「パラダイムシフト」などの強い表現が日常的な事象・製品に使われている場合。
- Example files: [failure](../examples/ja-01-failure-01.md) · [success](../examples/ja-01-success-01.md)

Example before:

> 日本の半導体産業の発展は、国家経済において画期的な役割を果たし、グローバル技術競争における革新的なパラダイムシフトを意味する。この成果は新たな地平を切り開く礎を築いた。

Example after:

> 日本の半導体産業は1980年代にDRAM世界シェアの80%を占めた。現在はロジック半導体の製造拠点誘致に2兆円規模の補助金を投じている。

### 2. 過度な注目度・メディア言及

- Source: [ja-content.md](../patterns/ja-content.md)
- Type: rewrite-capable pattern
- Watch words: 大きな注目を集めている、世界的に認められた、国内外のメディアから高い評価を受け、各方面から称賛の声が上がっている、話題を呼んでいる
- Fire condition: 具体的な媒体名・記事タイトル・日付なしに、広範な注目・報道・評価を主張している場合。媒体名があっても文脈なく羅列しただけの場合。
- Example files: [failure](../examples/ja-02-failure-01.md) · [success](../examples/ja-02-success-01.md)

Example before:

> この作品は国内外のメディアから高い評価を受け、世界的に認められた芸術家として大きな注目を集めている。各方面から称賛の声が上がっている。

Example after:

> ニューヨーク・タイムズは2024年の記事で、この作品を「日本の現代美術における新たな潮流」と紹介した。

### 3. ～しながら/～することで 表層的分析

- Source: [ja-content.md](../patterns/ja-content.md)
- Type: rewrite-capable pattern
- Watch words: 示しながら、強調しつつ、反映しており、象徴するとともに、促進しながら、体現しつつ、見せながら、物語っており
- Fire condition: 一文または連続する節に「～しながら/～しつつ/～しており」の連結形が3つ以上並び、具体的な因果説明なく羅列のみの場合。
- Example files: [failure](../examples/ja-03-failure-01.md) · [success](../examples/ja-03-success-01.md)

Example before:

> この祭りは地域文化の多様性を示しながら、伝統と現代の調和を象徴するとともに、地域経済の活性化を促進しつつ、世代間交流の場を提供している。

Example after:

> 祭りには毎年約30万人が訪れる。期間中、周辺商店街の売上は通常の40%増になる。

### 4. 広告的・宣伝的言語

- Source: [ja-content.md](../patterns/ja-content.md)
- Type: rewrite-capable pattern
- Watch words: 素晴らしい、世界クラスの、必見の、息をのむような、魅力あふれる、唯一無二の、圧巻の、感動的な、類まれなる、他に類を見ない、～の宝庫、至高の
- Fire condition: 同一対象に宣伝的な形容詞が2つ以上つくか、「息をのむような」「～の宝庫」などの強い修飾語が叙述文（広告引用ではない本文）に使われている場合。
- Example files: [failure](../examples/ja-04-failure-01.md) · [success](../examples/ja-04-success-01.md)

Example before:

> 京都は素晴らしい歴史的建造物と魅力あふれる文化遺産が調和する世界クラスの観光都市であり、日本文化の宝庫と言える。息をのむような景観は訪れる人々に感動的な体験を与える。

Example after:

> 京都市内には世界遺産が17件ある。2023年の観光客数は約5,300万人で、コロナ前の水準に戻った。オーバーツーリズム対策として、一部の寺社は拝観料を値上げしている。

### 5. 曖昧な出典引用

- Source: [ja-content.md](../patterns/ja-content.md)
- Type: rewrite-capable pattern
- Watch words: 専門家によると、研究によれば、関係者は、業界では、一部の見方では、調査結果が示すように（具体的調査名なし）
- Fire condition: 出典が人名・機関・発表日なく「専門家」「関係者」「研究によれば」などの匿名権威のみで提示されている場合。
- Example files: [failure](../examples/ja-05-failure-01.md) · [success](../examples/ja-05-success-01.md)

Example before:

> 専門家によると、この技術は今後の産業全般に革新的な変化をもたらすと見られている。関係者は、市場規模は継続的に成長すると予測している。

Example after:

> 経済産業省の2024年版「ものづくり白書」によると、国内製造業のAI導入率は前年比12ポイント増の34%に達した。

### 6. 定型的な課題と展望

- Source: [ja-content.md](../patterns/ja-content.md)
- Type: rewrite-capable pattern
- Watch words: 課題はあるものの、今後の発展が期待される、～にもかかわらず前途は明るい、さまざまな課題を乗り越え、急速に変化する現代社会において、～の時代を迎え、100年に一度の変革期、Society 5.0の実現に向けて
- Fire condition: 同一段落または結論部で曖昧な課題表現（「さまざまな課題が残されている」）と曖昧な楽観表現（「今後の発展が期待される」）が同時に出現する場合。または導入部が「急速に変化する～」「100年に一度の変革期」などの時代公式で始まる場合。
- Example files: [failure](../examples/ja-06-failure-01.md) · [success](../examples/ja-06-success-01.md)

Example before:

> これらの成果にもかかわらず、依然としてさまざまな課題が残されている。しかし、持続的な努力と革新により、今後の発展が期待される。

Example after:

> 2024年の会計検査院報告書は、人員不足と予算執行率の低さを主要な問題として指摘した。省庁は2025年度予算を18%増額し、専門人材40名を採用する方針だ。

## 言語・文法パターン

### 7. AI特有の語彙の多用

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 同一段落に高頻度語彙が3つ以上出現する場合。
- Example files: [failure](../examples/ja-07-failure-01.md) · [success](../examples/ja-07-success-01.md)

Example before:

> さらに、多様な革新的技術が活発に開発されており、これにより体系的かつ効果的なソリューションを提供している。加えて、こうした持続的な取り組みは主導的な役割を果たしている。

Example after:

> 今年出た技術の中では、バッテリー寿命を20%延ばした電力管理チップと、処理速度が従来の2倍になったNPUがある。

### 8. 〜的（てき）接尾辞の多用

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: 革新的、体系的、効果的、効率的、先進的、積極的、総合的、核心的、戦略的、実質的、根本的、画期的、抜本的
- Fire condition: 一文に「〜的」形容詞が3つ以上、または連続2文にわたって4つ以上使用された場合。
- Example files: [failure](../examples/ja-08-failure-01.md) · [success](../examples/ja-08-success-01.md)

Example before:

> 革新的かつ体系的なアプローチにより、効果的かつ効率的な成果を導き、先進的かつ積極的な姿勢で総合的な発展を推進している。

Example after:

> チームは既存のプロセスを単純化し、不要な承認ステップを省いて、デプロイ時間を半分に短縮した。

### 9. 否定並列構造

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: 〜にとどまらず、〜のみならず〜も、単に〜だけでなく、〜を超えて
- Fire condition: 同一文書に否定並列構造が2回以上出現、または肯定文だけでより簡潔に表現できる箇所に使用された場合。
- Example files: [failure](../examples/ja-09-failure-01.md) · [success](../examples/ja-09-success-01.md)

Example before:

> これは単なる技術革新にとどまらず、社会全体にわたる根本的な変革を意味する。これは経済的側面のみならず、社会的・文化的側面においても重大な意味を持つ。

Example after:

> この技術は最初に製造工程に導入され、その後物流と顧客サービスにも使われ始めた。

### 10. 三の法則の多用

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 同一文書に3項目の列挙が2回以上出現、または3つにまとめた根拠が恣意的で他の数でも同等に成り立つ場合。
- Example files: [failure](../examples/ja-10-failure-01.md) · [success](../examples/ja-10-success-01.md)

Example before:

> このプログラムは創造性、革新性、そして持続可能性を追求します。参加者はインスピレーション、実践的スキル、そして持続的なつながりを得ることができます。

Example after:

> このプログラムは実務プロジェクト中心で、参加者は8週間かけて実際の製品開発に取り組む。昨年のコホートが作った2つのアプリは今も使われている。

### 11. 類義語の循環

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 同一段落で同一対象が3つ以上の異なる名称・同義語で指称された場合。
- Example files: [failure](../examples/ja-11-failure-01.md) · [success](../examples/ja-11-success-01.md)

Example before:

> 東京は日本最大の都市である。この大都市は伝統と現代の融合で知られる。同都市圏には多くの観光客が訪れる。日本の首都は今も成長を続けている。

Example after:

> 東京の人口は約1,400万人で、日本最大の都市だ。外国人観光客は年間約2,000万人で、2015年から倍増した。

### 12. カタカナ外来語の多用

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: イノベーション、ソリューション、パフォーマンス、ガバナンス、コンセンサス、シナジー、モメンタム、マイルストーン、トリガー、スケールアップ、オンボーディング、フィードバックループ、ペインポイント、ディシジョンメイキング、エコシステム、レジリエンス、サステナビリティ
- Fire condition: 同一段落に日本語の代替がある外来語が3つ以上出現する場合。業界で定着した専門用語（マーケティング、ブランディング等）は除外。
- Example files: [failure](../examples/ja-12-failure-01.md) · [success](../examples/ja-12-success-01.md)

Example before:

> 今回のプロジェクトのインサイトをレバレッジし、シナジーを最大化して、サステナブルなモメンタムを確保することがキーマイルストーンだ。チームのパフォーマンスを向上させるため、オンボーディングプロセスを改善し、ペインポイントを解決するソリューションを導入する必要がある。

Example after:

> 今回のプロジェクトから得た教訓を活かして相乗効果を高め、推進力を維持するのが主な目標だ。チームの成果を上げるには、新入社員の受け入れ体制を改善し、現場の課題を解決する仕組みを作る必要がある。

### 32. 「より」比較副詞の濫用

- Source: [ja-language.md](../patterns/ja-language.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 1つの文書に「より + 形容詞/副詞」の形が 2 回以上登場。または、1つの段落に「より + 形容詞」が 1 回出現し、同じ段落に他のフォーマルマーカー（「かと思われます」「であると考えます」「いたします」「ございます」など）が共起する場合。
- Example files: [failure](../examples/ja-32-failure-01.md) · [success](../examples/ja-32-success-01.md)

Example before:

> プロジェクトのスケジュールに関しては、より具体的なマイルストーンの設定が必要かと思われます。予算配分についても、より効率的な運用方法の検討が必要であると考えます。可能であれば、来週中により深い議論を進められれば幸いです。

Example after:

> プロジェクトの日程は、もっと具体的なマイルストーンが必要そうです。予算の使い方についても、一度見直したほうがよさそうです。来週、もう少しじっくり話せる時間を取れたら助かります。

## スタイルパターン

### 13. 接続表現の過剰使用

- Source: [ja-style.md](../patterns/ja-style.md)
- Type: rewrite-capable pattern
- Watch words: これにより、こうした点で、こうした中、一方で、また、さらに、加えて、これに伴い、これに関連して、これを踏まえて、それゆえ、したがって
- Fire condition: 連続3文以上で毎文の冒頭に接続表現が付く場合、または同一段落に注意語彙が3つ以上出現する場合。
- Example files: [failure](../examples/ja-13-failure-01.md) · [success](../examples/ja-13-success-01.md)

Example before:

> これにより、企業の競争力が強化された。こうした点で、今回の施策は大きな意味を持つ。一方で、一部では懸念の声も上がっている。こうした中、今後の方向性について議論が必要である。

Example after:

> 施策後、輸出企業10社のうち7社が営業利益を伸ばした。ただし中小企業団体は原材料コストの上昇負担が依然大きいと表明している。

### 14. 太字の多用

- Source: [ja-style.md](../patterns/ja-style.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 同一段落に太字処理された語句が3つ以上、または文書全体で5つ以上。
- Example files: [failure](../examples/ja-14-failure-01.md) · [success](../examples/ja-14-success-01.md)

Example before:

> **機械学習**は**人工知能**の一分野であり、**統計的手法**を用いてコンピュータに**データからの学習**を可能にする。主なアプローチには**教師あり学習**、**教師なし学習**、**強化学習**がある。

Example after:

> 機械学習は人工知能の一分野で、統計的手法によりデータから学習する。主なアプローチは教師あり学習、教師なし学習、強化学習の3つ。

### 15. インラインヘッダーリスト

- Source: [ja-style.md](../patterns/ja-style.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 同一リストに「**ラベル：** 説明」形式の項目が2つ以上。
- Example files: [failure](../examples/ja-15-failure-01.md) · [success](../examples/ja-15-success-01.md)

Example before:

> - **ユーザー体験：** 新しいインターフェースにより体験が大幅に改善された。
> - **パフォーマンス：** アルゴリズム最適化で処理速度が50%向上した。
> - **セキュリティ：** エンドツーエンド暗号化でセキュリティが強化された。

Example after:

> 今回のアップデートではUIを刷新し、アルゴリズム最適化で処理速度を50%向上させ、エンドツーエンド暗号化を追加した。

### 16. ございます／でございます敬語の過剰使用

- Source: [ja-style.md](../patterns/ja-style.md)
- Type: rewrite-capable pattern
- Watch words: 〜でございます、〜ございます、〜いただけますと幸いです、〜させていただきます、〜いただければと存じます、〜いただけますでしょうか
- Fire condition: 同一段落で「ございます」「させていただきます」が3回以上使われた場合、またはカジュアルな文脈（ブログ記事、解説文等）で過剰な敬語が使われた場合。
- Example files: [failure](../examples/ja-16-failure-01.md) · [success](../examples/ja-16-success-01.md)

Example before:

> こちらの機能についてご説明させていただきます。この技術は非常に優れたものでございまして、多くの場面でご活用いただけるものとなっております。ご不明な点がございましたら、お気軽にお問い合わせいただければと存じます。

Example after:

> この機能は画像認識の精度を従来比15%向上させたもので、製造ラインの検品に使える。詳しくはドキュメントの第3章を参照。

### 17. 絵文字

- Source: [ja-style.md](../patterns/ja-style.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 専門的・学術的・編集テキストに絵文字が1つでも出現する場合。
- Example files: [failure](../examples/ja-17-failure-01.md) · [success](../examples/ja-17-success-01.md)

Example before:

> 🚀 **リリース：** 製品は第3四半期にリリースされます
> 💡 **インサイト：** ユーザーはシンプルさを好みます
> ✅ **次のステップ：** フォローアップミーティングを設定してください

Example after:

> 製品は第3四半期にリリース予定。ユーザー調査の結果、シンプルなUIへの好みが最も高かった。次のステップはフォローアップ会議の日程調整。

### 18. 過剰なである調／硬質文体

- Source: [ja-style.md](../patterns/ja-style.md)
- Type: rewrite-capable pattern
- Watch words: 〜と言えよう、〜であると言わざるを得ない、〜の感が否めない、〜と言っても過言ではない、〜の一助となれば幸いである、鑑みるに、畢竟、蓋し
- Fire condition: 同一段落に硬質文体表現が3つ以上出現する場合、または日常的な内容（ブログ、ガイド等）に学術的な結びの表現が使われた場合。
- Example files: [failure](../examples/ja-18-failure-01.md) · [success](../examples/ja-18-success-01.md)

Example before:

> この事態を鑑みるに、早急な対策が必要であると言わざるを得ない。現状の問題点を指摘することが今後の改善の一助となれば幸いである。

Example after:

> 対策は急いだ方がいい。現状の問題は2つ：人手不足と、既存システムとの互換性だ。

## コミュニケーションパターン

### 19. チャットボットの痕跡

- Source: [ja-communication.md](../patterns/ja-communication.md)
- Type: rewrite-capable pattern
- Watch words: お役に立てれば幸いです、ご不明な点がございましたら、以下にまとめました、ご紹介させていただきます、さらに詳しい情報が必要な場合は、お答えします
- Fire condition: リアルタイム対話ではないコンテンツ（記事、報告書、文書）にチャットボット的表現が1つでも出現する場合。
- Example files: [failure](../examples/ja-19-failure-01.md) · [success](../examples/ja-19-success-01.md)

Example before:

> フランス革命についてまとめさせていただきます。お役に立てれば幸いです！さらに詳しい情報が必要な場合は、お気軽にお尋ねください。

Example after:

> フランス革命は1789年に始まった。直接のきっかけは国家の財政破綻寸前の状態と、パリでのパン価格の高騰だった。

### 20. 学習データ切断日の免責

- Source: [ja-communication.md](../patterns/ja-communication.md)
- Type: rewrite-capable pattern
- Watch words: 私の知識のカットオフ時点では、リアルタイム情報にはアクセスできません、最新の情報と異なる場合があります、具体的なデータは変動している可能性があります、最新の情報をご確認ください
- Fire condition: 編集・報道・分析コンテンツにAI学習データの限界を示唆する自己参照または免責表現が1つでも出現する場合。
- Example files: [failure](../examples/ja-20-failure-01.md) · [success](../examples/ja-20-success-01.md)

Example before:

> 私の知識のカットオフ時点では、同社の従業員数は約5,000人です。具体的なデータは変動している可能性がありますので、最新の情報をご確認ください。

Example after:

> 同社の2024年度有価証券報告書によると、従業員数は約5,000人。

### 21. お世辞・追従的な語調

- Source: [ja-communication.md](../patterns/ja-communication.md)
- Type: rewrite-capable pattern
- Watch words: 素晴らしいご質問ですね、おっしゃる通りです、非常に鋭いご指摘です、とても興味深いテーマですね、大変価値のあるお考えですね
- Fire condition: 実質的な内容の前にお世辞・追従表現が1つでも出現する場合。
- Example files: [failure](../examples/ja-21-failure-01.md) · [success](../examples/ja-21-success-01.md)

Example before:

> 素晴らしいご質問ですね！おっしゃる通り、これは非常に重要なテーマです。経済的要因に関するご指摘は鋭いですね。詳しくご説明させていただきます。

Example after:

> 経済的要因が核心だ。昨年、住宅供給は18%減少したが、人口は2.1%増えており、需給ギャップが拡大している。

### 29. 偽りのニュアンス（事後的な言い換え）

- Source: [ja-communication.md](../patterns/ja-communication.md)
- Type: rewrite-capable pattern
- Watch words: 実はもう少し微妙な問題で, 正確に言えば, 単純にはそう言えませんが, もちろん現実はもっと複雑で, より正確には, 公平に見れば, もう少し掘り下げると
- Fire condition: 先行する主張を新たな証拠・視点なしに「微妙だ」というフレーミングで言い換える場合。

Example before:

> リモートワークは生産性を向上させます。実はもう少し微妙な問題でして、リモートワークは特定の状況では生産性を高める可能性がありますが、他の状況では課題をもたらすこともあり、純効果は組織文化と個人の働き方によって異なります。

Example after:

> リモートワークは集中作業の生産性を高める——スタンフォードの研究でコールセンター従業員基準13%の向上が確認された。ただし自発的な協業には不利で、マイクロソフトの2021年社内データによると、完全リモート移行後にチーム間コミュニケーションが25%減少した。

## フィラー・ヘッジングパターン

### 22. フィラー表現

- Source: [ja-filler.md](../patterns/ja-filler.md)
- Type: rewrite-capable pattern
- Watch words: 周知の通り、言うまでもなく、疑いなく、指摘すべきは、強調すべきは、注目すべきは、事実として、〜という点は注目に値する、〜に留意する必要がある
- Fire condition: 同一段落にフィラー表現が2つ以上出現、または削除しても意味が変わらないフィラーが単独使用された場合。
- Example files: [failure](../examples/ja-22-failure-01.md) · [success](../examples/ja-22-success-01.md)

Example before:

> 周知の通り、AIは世界を変えつつある。言うまでもなく、この技術の発展速度は多くの人の予想を上回っている。指摘すべきは、ある程度AIの倫理的問題も顕在化しているという点である。

Example after:

> OpenAIの昨年の売上は16億ドルから36億ドルに伸びた。同時期にEUのAI規制法が施行され、ハイリスクAIシステムにコンプライアンス審査が義務付けられた。

### 23. 過剰なヘッジング

- Source: [ja-filler.md](../patterns/ja-filler.md)
- Type: rewrite-capable pattern
- Watch words: おそらく〜かもしれない、ある程度〜の可能性がある、〜とも考えられなくはない、ある意味では〜とも言える、〜と言えるかもしれない、一概には〜とは言い切れない
- Fire condition: 同一主張にヘッジ・限定表現が3つ以上重なる場合、またはヘッジが多すぎて反証不可能になっている場合。
- Example files: [failure](../examples/ja-23-failure-01.md) · [success](../examples/ja-23-success-01.md)

Example before:

> おそらく、ある程度この政策は何らかの効果をもたらす可能性があるかもしれないと考えられなくはないが、これはさまざまな要因に依存すると言えるかもしれない。

Example after:

> この政策は効果がある可能性があるが、最大の変数は実行力だ。大阪のパイロットでは、減税後に中小企業の生存率が62%から71%に上がった。

### 24. 空虚な楽観的結論

- Source: [ja-filler.md](../patterns/ja-filler.md)
- Type: rewrite-capable pattern
- Watch words: 今後が期待される、今後の展開に注目したい、大きな可能性を秘めている、輝かしい未来が待っている、ワクワクする未来、無限の可能性、新たな章の幕開け
- Fire condition: 同一段落または結論部に空虚な楽観表現が2つ以上出現、または最終文が楽観フィラーだけで構成されている場合。
- Example files: [failure](../examples/ja-24-failure-01.md) · [success](../examples/ja-24-success-01.md)

Example before:

> 今後が大いに期待される！AIの発展は輝かしい未来をもたらすだろう。ワクワクする展開を楽しみにしたい。

Example after:

> 来四半期に大阪と福岡にデータセンターを新設する計画で、年末の稼働開始を目指している。

### 31. 結論シグナルワードの濫用

- Source: [ja-filler.md](../patterns/ja-filler.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 文書の最終段落（または最後から2番目）の先頭文が上記シグナルワードのいずれかで始まる。または、同じ文書に結論シグナルワードが 2 回以上登場。
- Example files: [failure](../examples/ja-31-failure-01.md) · [success](../examples/ja-31-success-01.md)

Example before:

> 結論として、デジタルノマドのライフスタイルは一時的な流行ではなく、社会全体に持続的に根付く新しい標準として定着しつつある。

Example after:

> デジタルノマドはもう流行の話ではない。働き方そのものが変わり、人々はその上に新しい日常を築いている。

## 構造パターン

### 25. 構造的繰り返し

- Source: [ja-structure.md](../patterns/ja-structure.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 連続3つ以上の段落が同一の内部構造テンプレートに従う場合。
- Example files: [failure](../examples/ja-25-failure-01.md) · [success](../examples/ja-25-success-01.md)

Example before:

> 医療分野では、AIが重要な役割を果たしている。例えば、AI診断支援システムが多くの病院で導入されている。この技術の応用は医療サービスの質の向上に貢献している。
>
> 教育分野でも、AIは大きな可能性を示している。例えば、個別最適化学習システムが生徒に合わせた学習プランを提供している。この革新は教育の公平化に新たな道を開いている。
>
> 交通分野においても、AIの活用が進んでいる。例えば、自動運転技術が商業化に向けて加速している。この発展は都市交通に新たなアプローチを提供している。

Example after:

> AIが病院で一番役に立っているのは、派手なものではなく、画像診断の補助だ。東大病院のデータでは、AI肺結節スクリーニングの見落とし率が医師単独より12ポイント低い。
>
> 教育は別の話だ。
>
> アダプティブラーニングはもう5〜6年やっているが、効果の定量化が難しい。交通には硬いデータがある——Waymoは東京での実証実験で累計200万kmを走行した。

### 26. 翻訳調

- Source: [ja-structure.md](../patterns/ja-structure.md)
- Type: rewrite-capable pattern
- Watch words: 〜という事実、〜することが可能である、〜によって〜される、〜に関して、〜に基づいて、〜の観点から、〜する傾向がある
- Fire condition: 同一段落に翻訳調の表現が2つ以上出現する場合。単独1回は許容。
- Example files: [failure](../examples/ja-26-failure-01.md) · [success](../examples/ja-26-success-01.md)

Example before:

> この技術が有望であるという事実は否定できない。この技術によって多くの問題が解決されることが可能であり、この技術に関して関心を持つことが必要である。

Example after:

> この技術は有望だ。実際にA社はこれで不良率を30%減らした。関心を持つ価値はある。

### 27. ている進行形の多用

- Source: [ja-structure.md](../patterns/ja-structure.md)
- Type: rewrite-capable pattern
- Watch words: 〜している、〜を推進している、〜を展開している、〜に取り組んでいる、〜を進めている、〜に拍車をかけている
- Fire condition: 同一段落で「〜ている」系の進行形が3回以上使用された場合、または連続2文がともに「〜ている」で終わる場合。
- Example files: [failure](../examples/ja-27-failure-01.md) · [success](../examples/ja-27-success-01.md)

Example before:

> 企業は新たな市場を開拓しており、技術革新を推進しており、グローバルなパートナーシップを拡大している。これにより持続的な成長を遂げている。

Example after:

> 企業は今年東南アジア市場に進出し、来年はヨーロッパ展開を計画している。

### 28. 起承転結の過剰使用

- Source: [ja-structure.md](../patterns/ja-structure.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 文章全体が「導入（テーマ提示）→展開（具体例）→転換（別の視点）→結論（まとめ）」の四段構成に明確に従い、結論が導入の繰り返しになっている場合。
- Example files: [failure](../examples/ja-28-failure-01.md) · [success](../examples/ja-28-success-01.md)

Example before:

> DXは現代企業にとって不可避の課題である。技術面では、クラウドとAIの導入が進んでいる。しかし、人材不足という壁もある。今後も継続的な取り組みが必要だ。

Example after:

> 従業員200人のメーカーが、去年すべての受注管理をkintoneに移行した。理由は単純で、コロナ後に海外顧客とのやりとりが全部オンラインになり、FAXとメールでは追いつかなくなったからだ。IT部門は3人で、2ヶ月で完了した。

### 30. 修辞的疑問の段落冒頭

- Source: [ja-structure.md](../patterns/ja-structure.md)
- Type: rewrite-capable pattern
- Watch words: Structural pattern; inspect the fire condition rather than a fixed vocabulary list.
- Fire condition: 段落の冒頭が疑問形（"なぜ…か"、"どうすれば…"、"何が…"、"…とは何か"）で、答えが同じ段落内で即座に提示される。または、文書全体で段落冒頭の修辞的疑問が 2 回以上登場。
- Example files: [failure](../examples/ja-30-failure-01.md) · [success](../examples/ja-30-success-01.md)

Example before:

> では、韓国のコーヒー文化はなぜこれほど急速に成長したのか？答えは意外にも単純だ。カフェは単なる飲料の販売空間を超えて、社交の拠点になったからだ。
>
> では、今後の展望はどうだろうか？専門家たちはこのトレンドが当面続くと見ている。

Example after:

> 韓国のコーヒー文化が急速に育った理由は意外にも単純だ。カフェが飲み物を売る場所を超えて、人々が集まる拠点になった。
>
> この流れは当面続きそうだ。専門家たちの意見も一致している。

## バイラルフックパターン（スコア専用） (score/audit only)

### Viral 1. 数字ショックフック

- Source: [ja-viral-hook.md](../patterns/ja-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: たった N 日で / わずか N 時間、N 万人 / N 億再生 / フォロワー N 万、ゼロ予算で / 0 円で、N 倍成長、N% 急増
- Fire condition: 主張がインパクト数字（時間・規模・割合）に依存し、同じ投稿内に検証経路がない場合。

Detection example:

> たった 60 日でスター 25 万。
> 広告ゼロで全世界バズった。

### Viral 2. クリックベイト末尾

- Source: [ja-viral-hook.md](../patterns/ja-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: 〜とは？、〜の理由、知らないと損する、〜って実は…、見ないと後悔する
- Fire condition: 投稿の**最後の文**が本文で答えていない修辞疑問、もしくはフォロー・保存などのアクションを明示的に誘導する締め。

Detection example:

> その理由、知ってる？
> なぜ世界中の開発者が殺到するのか？

### Viral 3. 出典回避の権威主張

- Source: [ja-viral-hook.md](../patterns/ja-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: 史上初 / 過去最高 / 過去最速、業界初 / 唯一無二、〜らしい（出典なし）、〜と言われている（主体なし）、業界関係者によると（出典なし）
- Fire condition: 「史上初」「業界唯一」「過去最速」など絶対範囲・順位の主張が出典なしで登場。同じ投稿に他の検証手がかり（リンク・引用・スクリーンショット）も無い。

Detection example:

> GitHub 史上、こんなスピードは見たことがない。
> 世界中のエンジニアが殺到している。

### Viral 4. 息継ぎ最適化の短文羅列

- Source: [ja-viral-hook.md](../patterns/ja-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: （構造的パターン——形で判断、語彙ではない）
- Fire condition: 投稿全体がほぼ「1文＝1行＝1段落」形式で、4文以上連続、平均文長が15字未満の場合。短文が一つ二つ混じる程度では発火しない。

Detection example:

> こんなスピード、見たことない。
>
> 60 日でスター 25 万。
>
> OpenClaw というツールが達成。
>
> 広告ゼロでなぜここまで広がったのか？
> 
> （4段落の短文、平均約12字、改行分離 → 発火。）

### Viral 5. 誇張エンゲージメント語彙

- Source: [ja-viral-hook.md](../patterns/ja-viral-hook.md)
- Type: score/audit only; rewrite modes skip this pack
- Watch words: ヤバい / マジヤバい、神アプデ / 神回 / 神ツール、革命 / ゲームチェンジャー、見ないと損、知らないと損、絶対に試すべき、圧倒的、爆速、神コスパ
- Fire condition:

> - 1投稿に1回出現：Low
> - 2回出現：Medium
> - 3回以上：High

Detection example:

> このツール、マジでヤバい。神アプデ過ぎる。
> 知らないと損する圧倒的なツール。
