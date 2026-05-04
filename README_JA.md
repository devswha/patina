**[한국어](README_KR.md)** | **[English](README.md)** | **[中文](README_ZH.md)** | 日本語

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.8.0-blue)](#バージョン履歴)

> **AI が書いた文章を、人間が書いたように変えます。**

韓国語・英語・中国語・日本語のテキストから AI 特有の文体パターンを検出して書き換える [Claude Code](https://docs.anthropic.com/en/docs/claude-code) スキル + スタンドアロン CLI。パターンベース・監査可能・決定的スコアリング — ブラックボックス LLM パラフレーザーではありません。

## デモ

**修正前**（AI 風の文章）：
> コーヒーは、世界中の社会的交流を**根本的に変革した****中核的な文化現象**として台頭してきました。この愛される飲料はコミュニティ構築の触媒として機能し、意義ある繋がりを促進し、異文化間の対話を導いています。パリの活気あるカフェから東京の静かな茶室に至るまで、この**驚くべき旅**は人類の食文化探求における**革新的精神**を示しています。

**修正後**（`/patina --lang ja` — 同じ内容、AI 装飾のみ除去）：
> コーヒーは、人の会い方をかなり変えてきたと思う。誰かと向かい合って座っているうちに自然と関係ができるし、文化が違う人同士でも会話が生まれやすくなる。パリのカフェでも、もともと抹茶を出していた東京の茶室でも、起きていることはよく似ている。豆を一つ焙煎しただけのものが、いつの間にか世界中で共有される社交の文化になっていた。

> **MPS = 100** · 社会的交流の変革 ✓ · コミュニティ構築 ✓ · 意義ある繋がり ✓ · 異文化間の対話 ✓ · パリのカフェ ✓ · 東京の茶室 ✓ · 食文化探求 ✓

---

## 概要

|  |  |
|---|---|
| **126 パターン** | 韓国語 32 + 英語 31 + 中国語 31 + 日本語 32 |
| **AI 検出率** | 韓国語 91% / 英語 76% (HC3) |
| **誤検出率** | NamuWiki 13% / HC3 human 19% / Wikipedia 25% *(百科事典体の本質的限界 — 文書化済み)* |
| **モード** | rewrite · audit · score · diff · ouroboros |
| **無料利用** | 可能 — `codex` CLI 経由 (API キー不要) |
| **ライセンス** | MIT |

---

## 目次

- [クイックスタート](#クイックスタート)
- [モードとフラグ](#モードとフラグ)
- [MAX モード](#max-モードマルチモデル)
- [スコア & ouroboros](#スコア--ouroboros)
- [認証](#認証)
- [仕組み](#仕組み)
- [キャリブレーション](#キャリブレーション)
- [パターン](#パターン)
- [設定](#設定)
- [プロファイル](#プロファイル)
- [カスタムパターン](#カスタムパターン)
- [プロジェクト構造](#プロジェクト構造)
- [新しい言語の追加](#新しい言語の追加)
- [参考文献](#参考文献)
- [バージョン履歴](#バージョン履歴)

---

## クイックスタート

### Claude Code スキルとして

ワンライナー インストール：

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

Claude Code で：

```
/patina --lang ja

[ここにテキストを貼り付け]
```

[手動インストール →](#手動インストール)

### スタンドアロン CLI として

**Node.js ≥ 18** が必要です。

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ja input.txt
```

```bash
# よく使う例
patina --lang en --profile blog input.txt
patina --lang ko --score input.txt
patina --lang en --ouroboros input.txt
patina --batch docs/*.md --suffix .humanized
```

> 🆓 **API キー不要** — [`codex`](https://github.com/openai/codex) CLI にログイン済みであれば OK。全バックエンドは [認証](#認証) を参照。

#### 手動インストール

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max  # MAX モードスキル
```

スタンドアロン CLI の手順で既にクローン済みの場合は、再クローンせずそのディレクトリで `npm link` のみ実行してください。

---

## モードとフラグ

```
patina --lang <ko|en|zh|ja> [モード] [--profile <名前>] [バッチオプション] input.txt
```

| フラグ | 機能 |
|--------|------|
| `--lang <ko\|en\|zh\|ja>` | 言語選択（デフォルト：`ko`） |
| `--profile <名前>` | トーンプリセット — [プロファイル](#プロファイル) を参照 |
| `--audit` | AI パターン検出のみ（書き換えなし） |
| `--score` | 0–100 AI 類似度スコア + カテゴリ別内訳 |
| `--diff` | 変更箇所をパターンごとに表示 |
| `--ouroboros` | スコア収束まで反復（MPS ロールバック付き） |
| `--batch <glob>` | 複数ファイルを一括処理 |
| `--in-place` | 元ファイルを上書き（`--batch` と併用） |
| `--suffix <ext>` | `{file}.{ext}.md` として保存 |
| `--outdir <dir>` | 結果を指定ディレクトリに保存 |
| `--models <list>` | MAX モード — 下記参照 |

自由に組み合わせ可能：`patina --lang en --audit --profile blog`。全オプションは `patina --help` で確認。

---

## MAX モード（マルチモデル）

同じテキストを Claude、Codex、Gemini に独立に通します。各モデルが人間化を行い、AI 類似度と MPS で採点され、MPS ≥ 70 を満たす中で最もスコアが低い（最も人間らしい）結果が採用されます。

```
/patina-max

[ここにテキストを貼り付け]
```

| モデル | ディスパッチ | 認証 |
|-------|------------|------|
| `claude` | `claude -p` | Claude Code |
| `codex` | `codex exec --skip-git-repo-check --output-last-message` | ChatGPT OAuth |
| `gemini` | `gemini -p '' --output-format text` | Google AI Studio |

各 MAX 実行は隔離された一時ディレクトリを使用し、選択したモデルのみを待機し、タイムアウトは無限待機ではなく失敗として処理されます。

> スタンドアロン CLI MAX：`patina --models gpt-4o,gpt-4o-mini input.txt` — 同じ `--base-url` エンドポイントで呼び出し。複数プロバイダを混在させたい場合は OpenRouter 等のマルチプロバイダゲートウェイに `--base-url` を向けてください。Claude Code `/patina-max` スキルはローカル CLI 経由でディスパッチ — API キー不要。

---

## スコア & ouroboros

### スコアモード

書き換えなしで AI 度合いを確認：

```bash
patina --score input.txt
```

```
| Category      | Weight | Detected | Raw  | Weighted |
|---------------|--------|----------|------|----------|
| content       | 0.20   | 3/6      | 33.3 | 6.7      |
| language      | 0.20   | 1/6      | 11.1 | 2.2      |
| style         | 0.20   | 2/6      | 27.8 | 5.6      |
| communication | 0.15   | 0/3      | 0.0  | 0.0      |
| filler        | 0.10   | 1/3      | 11.1 | 1.1      |
| structure     | 0.15   | 1/4      | 25.0 | 3.8      |
| Overall       |        |          |      | 19.3 (±10) |
```

| 範囲 | 解釈 |
|------|------|
| 0–15 | 人間的 |
| 16–30 | ほぼ人間的 |
| 31–50 | 混在 |
| 51–70 | AI 的 |
| 71–100 | 強い AI 的 |

書き換えモードと併用時の追加指標：

| 指標 | スコア | 意味 |
|------|--------|------|
| AI 類似度 | 23/100 | 低いほど人間的 |
| 忠実度 | 87/100 | 主張保持、捏造なし、トーン一致、長さ比 |
| MPS | 92/100 | セマンティックアンカー（主張、極性、因果、数値） |
| 総合 | 19/100 | プロファイル加重（例：blog AI 0.70 / 忠実度 0.30） |

### ouroboros モード

スコア収束まで書き換えを反復：

```bash
patina --ouroboros input.txt
```

```
| Iter | Before | After | Improvement | Reason     |
|------|--------|-------|-------------|------------|
| 0    | —      | 78    | —           | Initial    |
| 1    | 78     | 45    | +33         |            |
| 2    | 45     | 28    | +17         | Target met |
```

終了条件（最初に満たされたもの）：
- 目標達成（スコア ≤ 30、設定可能）
- 停滞（イテレーション間の改善 < 10）
- 後退（スコア上昇 — ロールバック）
- 最大イテレーション数（デフォルト 3）
- 忠実度 / MPS フロア違反（ロールバック）

`.patina.yaml` で設定：

```yaml
ouroboros:
  target-score: 30
  max-iterations: 3
  plateau-threshold: 10
  fidelity-floor: 70
  mps-floor: 70
```

> `--ouroboros` は `--diff`、`--audit`、`--score` と併用不可。

---

## 認証

| バックエンド | 設定 | コスト |
|------------|------|--------|
| `codex-cli` *(利用可能時のデフォルト)* | `codex login` | **無料**（ChatGPT OAuth） |
| OpenAI 互換 HTTP | `PATINA_API_KEY=...` | プロバイダ別 |
| Google Gemini | `GEMINI_API_KEY=...` + `--provider gemini` | 無料ティア |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | 無料ティア |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | 無料モデルあり |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + キー | プロバイダ別 |

```bash
patina auth status         # バックエンド可用性 + 認証状態
patina auth login          # バックエンド別ログイン手順
patina --list-providers    # プリセットプロバイダ + キー設定状況
```

`PATINA_API_KEY` 未設定で `codex` がログイン済みなら自動的に `codex-cli` にフォールバック。

> `codex-cli` v1 は単一モード書き換えのみ対応。`--audit`、`--score`、`--diff`、`--ouroboros`、`--models`/MAX は引き続き HTTP バックエンド使用。

デフォルト環境変数：

```bash
PATINA_API_KEY=...                            # HTTP バックエンドに必須
PATINA_API_BASE=https://api.openai.com/v1     # またはプロキシ
PATINA_MODEL=gpt-4o                           # デフォルトモデル
```

---

## 仕組み

```
入力テキスト
  │
  ▼
[ステップ 4.5]   セマンティックアンカー抽出
                 (核心主張、極性、因果、数値)
  │
  ▼
[ステップ 4.6]   文体統計プリパス
                 (burstiness CV + MATTR)
  │
  ▼
[ステップ 4.7]   AI 語彙オーバーラップ
                 (フラット辞書: 英 ~108 / 韓 102 項目)
  │
  ▼
[フェーズ 1]     構造スキャン
                 (段落レベル: 繰り返し、受動態)
  │
  ▼
[ステップ 5a-v]  アンカー検証
  │
  ▼
[フェーズ 2]     文章リライト
                 (語彙レベル: AI 語彙、フィラー、ヘッジ)
  │
  ▼
[ステップ 5b-v]  アンカー検証
  │
  ▼
[フェーズ 3]     セルフ監査
                 (極性スキャン、回帰、最終 MPS)
  │
  ▼
自然なテキスト（意味検証済み）
```

パターンパックは言語プレフィックス（`{lang}-*.md`）で自動検出されます。セマンティックアンカーは書き換え前に抽出され、各フェーズ後に検証されます — 意味が損なわれた場合、変更は再試行またはロールバックされます。

---

## キャリブレーション

`.omc/research/v3_7_lexicon_eval.py` で 400 段落コーパス（HC3 + Wikipedia + NamuWiki + paired ko/AI）に対して再現可能：

| ソース | Hot rate | 注釈 |
|--------|----------|------|
| HC3 ChatGPT (en) | **76%** | AI 検出率 |
| HC3 human (en) | 19% | 実人間文章への誤検出 |
| Wikipedia (en) | 25% | 百科事典体は文長が均一 — 本質的限界 |
| NamuWiki (ko) | 13% | 韓国語人間文章への誤検出 |
| ko/AI corpus | **91%** | システム内最強信号 *(post-v3.8.0)* |

受け入れ基準：AI 検出 ≥ 75% · 最大 FP ≤ 25% · NamuWiki 回帰 ≤ +5pp。すべて達成。

> 文体統計と語彙信号は LLM への**助言マーカー**であり、単独決定ゲートではありません。Wikipedia 25% FP は百科事典体の本質で、チューニングで除去できません。`core/stylometry.md` §13、§16 で文書化。

---

## パターン

4 言語すべてが同じ 6 カテゴリ構造を共有します。大半のパターンは普遍的で、一部のスロットのみ言語固有実装があります。パターン #30（修辞疑問の段落冒頭）と #31（結論シグナルワード）は 4 言語すべてに存在。パターン #32（比較副詞の濫用 — KO `보다`、JA `より`）は KO/JA 専用です。

### 共通カテゴリ

<details>
<summary><b>コンテンツ</b> — 6 パターン (#1–#6)</summary>

| # | パターン | AI の特徴 | 修正方法 |
|---|---------|----------|--------|
| 1 | 重要性の誇張 | 「画期的なマイルストーン」 | 具体的事実、日付、数値 |
| 2 | メディア/知名度の誇張 | 「NYT、BBC などで紹介」 | 具体的記事を 1 つ引用 |
| 3 | 表面的な動詞連鎖分析 | 「示しており、象徴しており」 | 実際の説明や出典 |
| 4 | 宣伝的な表現 | 「息を呑む、世界レベル」 | 中立的な記述 |
| 5 | 曖昧な帰属 | 「専門家によると…研究によれば」 | 実際の出典を明記 |
| 6 | 定型的な課題/展望 | 「課題はあるものの…明るい未来」 | 具体的問題と計画 |

</details>

<details>
<summary><b>コミュニケーション</b> — 4 パターン (#19–#21, #29)</summary>

| # | パターン | AI の特徴 | 修正方法 |
|---|---------|----------|--------|
| 19 | チャットボットフレーズ | 「お役に立てば幸いです！」 | 完全に削除 |
| 20 | 学習データ期限の免責 | 「具体的な情報には限界があります」 | 出典を探すか削除 |
| 21 | 追従的なトーン | 「素晴らしい質問ですね！」 | 直接回答 |
| 29 | 偽りのニュアンス | 「実はもっと複雑な問題で……」 | 根拠を追加するか削除 |

</details>

<details>
<summary><b>フィラー & ヘッジング</b> — 3 パターン (#22–#24)</summary>

| # | パターン | AI の特徴 | 修正方法 |
|---|---------|----------|--------|
| 22 | フィラーフレーズ | 不要な埋め言葉 | 簡潔な表現に |
| 23 | 過剰なヘッジング | 過度に限定された表現 | 直接的な表現 |
| 24 | 曖昧な肯定的結論 | 「明るい未来が待っている」 | 具体的な計画や事実 |

</details>

### 言語固有スロット

<details>
<summary><b>言語</b>（#7–#12）— 文法・語彙</summary>

| # | 韓国語 | 英語 | 中国語 | 日本語 |
|---|--------|------|--------|--------|
| 7 | AI フィラー語彙の多用 | AI 語彙（delve、tapestry） | AI 流行語（赋能/助力） | AI バズワード多用 |
| 8 | -jeok（적）接尾辞多用 | コピュラ回避（"serves as"） | 四字熟語多用（成语） | -teki（的）接尾辞多用 |
| 9 | 否定的並列構文 | 否定的並列構文 | 的/地/得の過度な正規化 | 否定的並列構文 |
| 10 | 三項目の法則 | 三項目の法則 | 排比句多用 | 三項目の法則 |
| 11 | 類義語の循環 | 類義語の循環 | 類義語の循環 | 類義語の循環 |
| 12 | 冗長な助詞 | 偽の範囲表現（"from X to Y"） | 冗長な前置詞構文 | カタカナ外来語多用 |

</details>

<details>
<summary><b>スタイル</b>（#13–#18）— 書式・文体</summary>

| # | 韓国語 | 英語 | 中国語 | 日本語 |
|---|--------|------|--------|--------|
| 13 | 過剰な接続詞 | em ダッシュ多用 | 過剰な接続詞 | 過剰な接続詞 |
| 14 | 太字多用 | 太字多用 | 太字多用 | 太字多用 |
| 15 | インラインヘッダーリスト | インラインヘッダーリスト | インラインヘッダーリスト | インラインヘッダーリスト |
| 16 | 進行形多用（-고 있다） | タイトルケース見出し | 地副詞多用 | 過剰な敬語（ございます） |
| 17 | 絵文字 | 絵文字 | 絵文字 | 絵文字 |
| 18 | 過度な格式体 | カーリー引用符 | 官僚的文体（公文体） | 硬い である調 |

</details>

<details>
<summary><b>構造</b>（#25–#28）— 文書レベル</summary>

| # | 韓国語 | 英語 | 中国語 | 日本語 |
|---|--------|------|--------|--------|
| 25 | 構造的繰り返し | メトロノーム的段落 | 構造的繰り返し | 構造的繰り返し |
| 26 | 翻訳調 | 受動態の名詞化連鎖 | 翻訳調/欧化文法 | 翻訳調 |
| 27 | 受動態多用 | ゾンビ名詞 | 被の多用 | ている進行形多用 |
| 28 | 不要な外来語 | 積み重ね従属節 | 総分総構造多用 | 起承転結の定型化 |

</details>

### 横断的拡張（v3.4.0+）

| # | 全言語共通 |
|---|-----------|
| 30 | 修辞疑問の段落冒頭（"Have you ever wondered…?"、「~でしょうか？」） |
| 31 | 結論シグナルワード（"In conclusion"、「결론적으로」、「总而言之」、「結論として」） |
| 32 | 比較副詞の濫用 — 韓国語 `보다` / 日本語 `より` のみ |

---

## 設定

```yaml
# .patina.default.yaml
version: "3.8.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # 例：[ko-filler] でパックをスキップ
blocklist: []             # フラグ対象に追加する単語
allowlist: []             # フラグ対象にしない単語
max-models: [claude, gemini]
dispatch: omc             # omc | direct
```

パターンパックは言語プレフィックスで自動検出されます — 手動でリスト化不要。

---

## プロファイル

| プロファイル | トーン | 用途 |
|-----------|--------|------|
| `default` | 元のトーン維持 | 汎用 |
| `blog` | 個人的、意見入り | ブログ記事、エッセイ |
| `academic` | フォーマル、エビデンスベース | 論文、学位論文 |
| `technical` | 明確、正確、意見なし | API ドキュメント、README |
| `social` | カジュアル、絵文字 OK | Twitter/X、Instagram、スレッド |
| `email` | 丁寧だが簡潔 | ビジネスメール、公式書簡 |
| `legal` | 法律慣例保持 | 契約書、法律意見書 |
| `medical` | 医学的正確さ保持 | 臨床報告、医学論文 |
| `marketing` | 説得力、具体的 | 広告コピー、プレスリリース |
| `formal` | プロフェッショナル、簡潔 | 履歴書、カバーレター、提案書 |

```bash
patina --profile blog text...
```

---

## カスタムパターン

`.md` ファイルを `custom/patterns/` にドロップするだけで自動的に読み込まれます：

```markdown
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 1
---

### 1. パターン名
**問題：** AI が間違っていること
**Before：** > AI 風の例
**After：** > 自然な修正
```

---

## プロジェクト構造

```
patina/
├── SKILL.md                  # /patina エントリポイント
├── SKILL-MAX.md              # MAX モード参考文書
├── patina-max/               # /patina-max スキル（インストール可能）
│   └── SKILL.md
├── .patina.default.yaml      # 設定
├── core/
│   ├── voice.md              # ボイス & パーソナリティガイドライン
│   ├── scoring.md            # スコアリングアルゴリズム参考
│   └── stylometry.md         # 文体統計アルゴリズム参考
├── lexicon/
│   ├── ai-en.md              # 英語 AI 語彙辞書（108 項目）
│   └── ai-ko.md              # 韓国語 AI 語彙辞書（102 項目）
├── patterns/
│   ├── ko-*.md               # 韓国語（6 パック、32 パターン）
│   ├── en-*.md               # 英語（6 パック、31 パターン）
│   ├── zh-*.md               # 中国語（6 パック、31 パターン）
│   └── ja-*.md               # 日本語（6 パック、32 パターン）
├── profiles/                 # トーンプリセット
├── examples/                 # Before/After テストケース
└── custom/                   # ユーザー拡張（gitignore 対象）
```

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) のプラグインアーキテクチャに着想：パターンがプラグイン、プロファイルがテーマ。

---

## 新しい言語の追加

1. `patterns/{lang}-content.md`、`{lang}-language.md` などを作成。
2. 各ファイルのフロントマターに `language: {lang}` を設定。
3. `/patina --lang {lang}` で使用 — 自動検出のため設定変更不要。

---

## 参考文献

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — パターンの一次ソース
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) — コミュニティ活動
- [blader/humanizer](https://github.com/blader/humanizer) — 英語版オリジナル

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md) を参照。パターン追加と**陳腐化レポート**（「この信号はもう AI ではない」）が最も価値ある貢献です — AI の書き癖はモデルがファインチューンされるにつれ変化します。

[Issue を作成 →](https://github.com/devswha/patina/issues)

---

## バージョン履歴

| バージョン | 主な変更 |
|----------|---------|
| **3.8.0** | 韓国語 lexicon 再キュレーション（NamuWiki vs Claude 生成 KO の差分頻度マイニング）。韓国語 AI 検出：83% → **91%**（+8pp）。誤検出回帰 0pp。 |
| **3.7.0** | AI 語彙オーバーラップ信号（4.7 ステップ）。英 108 + 韓 90 項目。Hot ルールを 3 信号 OR に拡張。HC3 ChatGPT AI 検出：66% → **76%** — v3.5.1 以降初の Pareto 突破。 |
| **3.5.1** | 文体統計 calibration パッチ — burstiness 閾値 0.25 → 0.30。AI 検出 57% → 66%。 |
| **3.5.0** | 文体統計疑似区間検出（4.6 ステップ）— burstiness CV + MATTR。v1 = ko + en。 |
| **3.4.0** | codex-cli バックエンド（API キー不要）、`patina auth` サブコマンド、無料ティアプロバイダショートカット。パターン #30、#31 を 4 言語すべてに追加、KO/JA に #32。CI ワークフロー追加。 |
| **3.3.0** | 意味保持システム（MPS）。 |
| **3.2.0** | Ouroboros スコアリング + 反復自己改善ループ。 |
| **3.1.x** | MAX モード信頼性、マルチ CLI ディスパッチ（claude / codex / gemini）。 |
| **3.0.0** | 多言語フレームワーク、`--lang` フラグ、blader/humanizer からの英語パターン、スキル名を `patina` に変更。 |
| **2.x** | プラグインアーキテクチャ、blog プロファイル、構造パターン、外来語パターン（#28）。 |
| **1.0.0** | 韓国語初期対応（24 パターン）。 |

<details>
<summary><b>詳細リリースノート</b></summary>

#### 3.8.0 — データ駆動の韓国語 lexicon マイニング

v3.7.0 の韓国語 lexicon は author 直感キュレーションで AI 検出に +1pp のみ寄与（英語の +10pp に対して）。v3.8.0 は NamuWiki 人間散文との差分頻度でコーパスを採掘し、AI が頻用するが人間がほぼ使わない 12 個の register marker を発見。

採掘ルール（`.omc/research/v3_8_ko_lexicon_mine.py`）：
- 어절 doc-frequency：AI count ≥ 4 AND 比率 AI / (human + 1) ≥ 4.0
- ドメインアーティファクト除外（固有名詞、年トークン）
- register marker のみ保持（受動評価動詞、百科事典的動詞、数量表現の足場）

追加項目：
- Strict（8 個）：`평가된다`、`꼽힌다`、`가리킨다`、`사례로`、`다수의`、`알려져`、`일컬어진다`、`평가받다`
- Phrase（4 個）：`가운데 하나로`、`자리 잡았다`、`알려져 있다`、`~의 사례로`

500 段落コーパスでの結果：ko/AI catch 83% → **91%**（+8pp）。NamuWiki human FP は **13% 維持** — 回帰 0pp、clean Pareto 改善。

#### 3.7.0 — AI 語彙オーバーラップ信号

フラット辞書（`lexicon/ai-en.md` 108 項目、`lexicon/ai-ko.md` 90 項目）で 28-パターンカタログが明示的に捕捉できない AI 特有のフレーズを照合。1,000 トークンあたりの出現密度を計算し、4.6 ステップ hot ルールを 3-signal OR（burstiness OR MATTR OR lexicon_density > 2.0）に拡張。

400 段落キャリブレーション：AI 検出 66% → **76%**、HC3 human FP 12%→19%、Wikipedia FP 23%→**25%** 境界、NamuWiki FP 11%→13%（+5pp ガード内）。全 acceptance 基準を満たす — v3.5.1 Pareto 壁の初突破。

Drop list（eval 後）：`intersection`、`principles`、`mindset`、`iterative`、`responsible`、`methodologies`、`redefine`、`accessible`、`equitable`、`one of the most`、`in conjunction with`、`the power of` — 学術 prose の発火率が AI 発火率より高かった。

v3.6 はスキップ（n-gram drop、§15 negative finding）。

#### 3.5.1 — 文体統計 calibration パッチ

300 段落の外部検証後、`stylometry.burstiness.bands.low` を 0.25 → 0.30 に引き上げ。v3.5.0 は実 AI の 57% しか検出できず — v3.5.1 は 66% 検出 + HC3 human FP 12% + Wikipedia FP 23%。

Sweep の結果、AI ≥70% AND max FP ≤20% を同時に満たす閾値の組み合わせは存在しない — Wikipedia の百科事典的スタイルは自然に均一な文長を持つため。MATTR 閾値は 0.55 維持。v3.5.x は LLM への助言マーカーであり、単独決定ゲートではない。

</details>

---

## ライセンス

MIT
