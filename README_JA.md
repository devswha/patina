**[한국어](README_KR.md)** | **[English](README.md)** | **[中文](README_ZH.md)** | 日本語

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#クイックスタート)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.11.0-blue)](CHANGELOG.md)

> **AI の装飾だけを剥がし、意味はそのまま。**

patina は、韓国語・英語・中国語・日本語の文章から AI っぽさの強いパターンを見つけ、意味を変えずに書き換えます。[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex)、[Cursor](https://cursor.sh)、OpenCode 向けのスキルとして使うことも、スタンドアロン Node.js CLI として実行することもできます。

一般的なパラフレーザーのようなブラックボックスではありません。patina は **パターンベースで監査可能**で、何をなぜ変更したか、原文の主張が保たれているかを示します。

## デモ

**修正前** *(AI 風の文章)*：
> コーヒーは、世界中の社会的交流を**根本的に変革した****中核的な文化現象**として台頭してきました。この愛される飲料はコミュニティ構築の触媒として機能し、意義ある繋がりを促進し、異文化間の対話を導いています。

**修正後** *(`/patina --lang ja` — 同じ内容、AI 装飾のみ除去)*：
> コーヒーは、人の会い方をかなり変えてきたと思う。誰かと向かい合って座っているうちに自然と関係ができるし、文化が違う人同士でも会話が生まれやすくなる。

> **MPS = 100** · 社会的交流の変革 ✓ · コミュニティ構築 ✓ · 意義ある繋がり ✓ · 異文化間の対話 ✓

## 概要

|  |  |
|---|---|
| **146 パターン** | 韓国語 37 + 英語 36 + 中国語 36 + 日本語 37 (各5個のスコア専用 viral-hook を含む) — [PATTERNS.md](docs/PATTERNS.md) |
| **編集ホットスポット再現率** | 韓国語 91% [84.0–95.4%] (n=100) / 英語 76% [66.7–83.3%] (n=100), binomial 95% CI |
| **誤検出率** | 人間文章レジスター別 13–25% の点推定範囲 *(CI ではない；百科事典体の本質的限界、[文書化済み](core/stylometry.md))* |
| **モード** | rewrite · audit · score · diff · ouroboros |
| **無料利用** | 可能 — `codex` CLI 経由 (API キー不要) |
| **決定性** | スコアリング式は決定的、LLM の severity 判定段階に ±8–10pt の変動 ([scoring.md §8](core/scoring.md)) |
| **ライセンス** | MIT |

## クイックスタート

### Claude Code または Codex CLI スキルとして

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

インストーラは Claude Code、[Codex CLI](https://github.com/openai/codex)、Cursor、OpenCode に一括で接続します。checkout 前に repository HEAD を具体的な commit に解決します。完全に固定したインストールが必要な場合は `PATINA_REF=<tag-or-full-sha>` を設定してください。続いて：

```
/patina --lang ja

[ここにテキストを貼り付け]
```

特定のトーンで書き換え：

```
/patina --tone narrative

[ここにエッセイの下書きを貼り付け]
```

最適なトーンを自動検出：

```
/patina --tone auto --lang en

[ここにテキストを貼り付け]
```

> 注意：v1 では `--tone`（`auto` 含む）は ko/en のみ対応。zh/ja では警告を出して profile-only モードにフォールバックします。

### スタンドアロン CLI として

Node.js ≥ 18 が必要です。

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ja input.txt
```

link 後に stdin でも試せます:

```bash
printf '%s\n' 'コーヒーは、世界中の社会的交流を根本的に変えた重要な文化現象として浮上しました。' \
  | patina --lang ja --backend codex-cli
```

> 🆓 **API キー不要** — [`codex`](https://github.com/openai/codex)、[`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`gemini`](https://github.com/google-gemini/gemini-cli) のいずれか CLI にログイン済みであれば OK。`--backend codex-cli | claude-cli | gemini-cli` で直接選択するか、`--model claude-*` / `--model gemini-*` のようにモデル名でルーティングできます。全バックエンドは [AUTHENTICATION.md](docs/AUTHENTICATION.md) を参照。

### CI integrations

Patina には、live model key なしで使える deterministic な prose review CI チェックもあります:

```yaml
# .github/workflows/patina.yml
steps:
  - uses: actions/checkout@v6
  - uses: devswha/patina-action@main # npm publish + Action タグ後は @v1 を使用
    with:
      patina-package: github:devswha/patina # patina-cli@latest が npm に出たら削除
      report-threshold: 30
      comment: true
```

Pre-commit、Husky、Lefthook、Docker、release workflow のメモは [docs/integrations/](docs/integrations/) にあります。

## 想定用途

Patina は、著者が AI 支援を使ってよい場面で、AI 後編集、audit trail、voice cleanup を行うためのツールです。テキストが「もともと人間によって書かれた」ことを約束するものではなく、学業上の honor-code 回避、出版社 disclosure の迂回、盗用の洗浄、detector-bypass 主張に使うべきではありません。[ETHICS.md](docs/ETHICS.md) を参照してください。

## モード

```
patina --lang <ko|en|zh|ja> [モード] [--profile <名前>] input.txt
```

| フラグ | 機能 |
|--------|------|
| *(デフォルト)* | 書き換え |
| `--audit` | AI パターン検出のみ |
| `--score` | 0–100 AI 類似度スコア + カテゴリ別内訳 |
| `--score --exit-on <n>` | CI を厳格に保つ: `overall > n` の場合は終了コード `3`（`--gate` は alias） |
| `--diff` | 変更箇所をパターンごとに表示 |
| `--ouroboros` | スコア収束まで反復（MPS ロールバック付き） |
| `--lang <ko\|en\|zh\|ja>` | 言語選択（デフォルト：`ko`） |
| `--profile <名前>` | トーンプリセット：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation` |
| `--tone <名前>` | トーンカテゴリ：`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 位置引数をファイル一覧として処理（例：`--batch docs/*.md`） |
| `--format json\|text\|markdown` | JSON、プレーンテキスト、デフォルト Markdown 出力を選択 |
| `--prompt-mode strict\|minimal\|auto` | 完全なパターンパック、圧縮プロンプト、またはバックエンド別 auto を選択 |
| `--variants <1-5>` | 同じ事実と意味アンカーを保った複数の rewrite バリアントを生成 |

全オプションは `patina --help`。

### スコア専用パターン

`--score`と`--audit`は`--rewrite`より少し広い範囲のシグナルを測定します。viral-hook パック（`ko/en/zh/ja-viral-hook`、各5パターン: 数字ショックフック、クリックベイト末尾、出典を飛ばした権威主張、息継ぎに最適化された短文の積み重ね、誇張されたエンゲージメント語彙）は**検出専用**です。

これらのシグナルはスコアと監査にだけ現れ、4言語のSNSマーケティングコピーに対するユーザーの直感とベンチマークを揃えるために使います。`--rewrite`/`--diff`/`--ouroboros` は、意図的な修辞であることが多いので対象外です。実例: [`examples/viral-hook/`](examples/viral-hook/).

### プロンプトモード調整 (v3.11)

`--prompt-mode strict|minimal|auto` では、完全なパターンパック（約34KBの構造化プロンプト）と圧縮されたカジュアル指示（約3KB）のどちらを使うかを調整できます。`auto` はバックエンドごとに選択します — Gemini は minimal の方が良く（長い構造化プロンプトで過度に制約されるため）、Claude は完全なパックを活用し、Codex はおおむね影響を受けません。case-05 が A/B を記録しています。

### 複数の文体バリアント (v3.11)

`--variants <1-5>` は、1回の呼び出しで N 個のリライト音声バリアントを求めます（例: V1 casual、V2 direct、V3 measured）。事実、数値、因果関係はすべてのバリアントで同一に保たれます。各結果は `## Variant N` として返るため、必要な声色を選べます。

### 短文スコアリング補正 (v3.11)

入力が200文字以下、または3段落以下の場合、register に敏感なカテゴリ（`language`、`style`、`viral-hook`）へ 1.5 倍の severity multiplier を適用し、単一段落の声色変化もスコアに反映されるようにします。case-04 では、長文向けの式がこれらを過小評価していたことが確認されました。

### セルフ監査の分離 (v3.11)

rewrite モードでは、モデルは `[BODY]`/`[/BODY]` ブロック（`--variants > 1` の場合は `[VARIANT n]` ブロック）を囲む `[SELF_AUDIT]`/`[/SELF_AUDIT]` タグの中にセルフ監査メモを出力します。patina はユーザーに表示する前に監査部分を取り除くため、出力はクリーンです — 以前のバージョンでは "남아 있는 AI 티" や "Phase 3" のような前置きがユーザー向けテキストに漏れることがありました。

### Machine-readable output and exit codes

`--format json` は、すべてのモードを `overall`、`categories[]`、`tone`、`mps`、`gateResult`、クリーンな `output` 本文を含む安定した envelope で包みます。`--format markdown` がデフォルトで、`--format text` は YAML tone footer なしのユーザー向け本文だけを保持します。終了コードは [EXIT-CODES.md](docs/EXIT-CODES.md) にまとまっています: `0` success、`1` runtime/backend、`2` input/usage、`3` score gate exceeded、`4` MAX MPS fallback/all-candidates-failed。

### スコア重みドリフト検出 (v3.11)

`--score` 実行時は、モデルが出力した Weight 列を設定の `category-weights` と照合します。モデルが存在しないカテゴリ（例: `discord`）を作ったり、別の数値に置き換えたりした場合、stderr に `[patina]` 警告が出ます — これは観測用であり、スコア自体は変更しません。

## トーン

`--tone` はパターン書き換えの上に重ねる、名前付きの声色軸です。優先順位：`--tone` CLI > `tone:` 設定 > `profile:` 設定。

| トーン | 用途 | 主な特徴 |
|--------|------|----------|
| `casual` | ブログ、SNS、個人メモ | 短縮形、一人称、絵文字 OK、低い形式度 |
| `professional` | 業務メール、レポート、ビジネス文書 | 明確で簡潔、形式的だが堅すぎない（legal/medical サブプロファイルは fidelity 下限を強制） |
| `academic` | 論文、研究要旨、技術分析 | 客観的、根拠重視、一人称は最小限 |
| `narrative` | 個人エッセイ、回想録、体験談 | 一人称基点、シーンの細部、感情の存在感 |
| `marketing` | 広告コピー、ランディングページ、製品告知 | 短くインパクトのある文、説得力、CTA 親和 |
| `instructional` | チュートリアル、ハウツー、技術ドキュメント | 命令形動詞、番号付き構造、推測表現を抑制 |

`--tone auto` はヒューリスティック（語彙 + 構造シグナル）で最適なトーンを自動選択します。zh/ja では `auto` を含む全トーン指定時に警告を出して profile-only モードにフォールバックします — Phase 4.5b ヒューリスティックは ko/en のみ対応のためです。

### MAX モード

同じテキストを Claude、Codex、Gemini に独立に通します。MPS ≥ 70 を満たす中で最もスコアが低い（最も人間らしい）結果が採用されます：

```
/patina-max

[ここにテキストを貼り付け]
```

## 仕組み

```
入力
  ↓
[ステップ 4.5]   セマンティックアンカー抽出 (主張、極性、因果、数値)
[ステップ 4.6]   文体統計プリパス (burstiness CV + MATTR)
[ステップ 4.7]   AI 語彙オーバーラップ (英 ~108 / 韓 102 項目)
[フェーズ 1]     構造スキャン + アンカー検証
[フェーズ 2]     文章リライト + アンカー検証
[フェーズ 3]     セルフ監査 (極性、回帰、MPS)
  ↓
自然なテキスト（意味検証済み）
```

各検証ステップで意味が損なわれた場合、変更は再試行またはロールバックされます。

**キャリブレーション** *(500 段落コーパス、`.omc/research/v3_8_remeasure.py` で再現可能)*：HC3 ChatGPT (en) 編集ホットスポット再現率 76% [66.7–83.3%]、paired ko/AI コーパス 91% [84.0–95.4%]（各 n=100、binomial 95% CI）。人間文章の誤検出はレジスター別 13–25% の点推定範囲として別に報告します。受け入れ基準：AI ≥ 75%、最大 FP ≤ 25%。アルゴリズムは [stylometry.md](core/stylometry.md)。

## 設定

```yaml
# .patina.default.yaml
version: "3.11.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
max-models: [claude, gemini]
```

パターンパックは言語プレフィックスで自動検出されます。作業ディレクトリの `.patina.yaml` がデフォルトを上書きします。検出を拡張するリストキー（`blocklist`、`allowlist`、`skip-patterns`）は default/global/project 設定の間で追加的にマージされ、`max-models` などの provider リストはユーザーが正確なバックエンド集合を選べるように置き換えられます。

## ドキュメント

- **[Glossary](docs/GLOSSARY.md)** — MPS、fidelity、burstiness、MATTR、モードなどの反復用語の短い定義
- **[Demo](docs/DEMO.md)** — ターミナル transcript と複数ジャンルの before/after スナップショット
- **[Patterns](docs/PATTERNS.md)** — 146 パターンカタログ
- **[Authentication](docs/AUTHENTICATION.md)** — バックエンド、プロバイダ、無料ティア設定
- **[CLI Contract](docs/CLI.md)** — score gate、終了コード、自動化に安全なインターフェイス
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI、`/patina`、`/patina-max` のオプション対応範囲
- **[Ethics](docs/ETHICS.md)** — 想定用途、禁止用途、disclosure 方針
- **[FAQ](docs/FAQ.md)** — detector-bypass の懸念、MPS、誤検出、貢献の始め方
- **[Comparison](docs/COMPARISON.md)** — 一般的な paraphraser/humanizer ツールとの事実ベース比較
- **[Branding](docs/BRANDING.md)** — canonical logo/social assets と OG 設定メモ
- **[Design](DESIGN.md)** — repo-native SVG と README surface の製品/ブランド基準
- **[Roadmap](docs/ROADMAP.md)** — 品質、ベンチマーク、プロダクト、コミュニティ、ローンチ優先事項
- **[Benchmark Report](docs/benchmarks/latest.md)** — 最新の再現可能な suspect-zone ベンチマーク要約
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — AI-like writing signals 測定用ベンチマーク設計メモ
- **[Launch Copy](docs/social/patina-launch-copy.md)** — Show HN、Reddit、X、韓国コミュニティ向け下書き
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 語彙アルゴリズム
- **[Scoring](core/scoring.md)** — AI 類似度 + 忠実度 + MPS
- **[Changelog](CHANGELOG.md)** — リリースノートと方法論
- **[Contributing](CONTRIBUTING.md)** — パターン提出、誤検出 triage、ベンチマーク fixture、バージョン管理
- **[Governance](GOVERNANCE.md)** / **[Maintainers](MAINTAINERS.md)** — 軽量なプロジェクト意思決定ルール

## 着想元

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) のプラグインアーキテクチャ（パターンがプラグイン、プロファイルがテーマ）、[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer)。

## ライセンス

MIT
