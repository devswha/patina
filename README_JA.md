**[한국어](README_KR.md)** | **[English](README.md)** | **[中文](README_ZH.md)** | 日本語

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#クイックスタート)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-5.1.0-blue)](CHANGELOG.md)

<p align="center">
  <img src="assets/demo/patina-demo-en.gif" alt="patina が英語のAIっぽい文を整え、スコアを表示するターミナルデモGIF" width="780">
</p>

<p align="center">
  <a href="https://patina.vibetip.help/"><b>自分の文章で試す — インストール不要</b></a>
</p>

> **AIっぽさだけを落として、意味はそのまま。**

patina は、日本語・韓国語・英語・中国語の文章から AI っぽく見える表現を見つけ、主張・数値・極性・因果関係を変えずに整えます。[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex)、[Cursor](https://cursor.sh)、OpenCode 向けのスキルとして使うことも、単体の Node.js CLI として実行することもできます。

中身の見えない言い換えツールでも、AI 検出器を避けるためのツールでもありません。patina は **明確なパターンベースで監査可能**です。何をなぜ変更したか、原文の主張が保たれているかを示します。`codex`、`claude`、`gemini` CLI のいずれかにログイン済みなら、API キーなしでも使えます。

## デモ

**修正前** *(AI 風の文章；現在の GIF はこの英語サンプルを使用)*：
> The newly released Notion template pack is an **innovative solution** designed to **transform productivity** for modern teams. It offers 30 templates optimized for diverse workflows, with a user-friendly design that enables anyone to leverage them effortlessly. This product introduces a **new paradigm** for maximizing work efficiency.

**修正後** *(`/patina --lang en --tone marketing` — 事実はそのまま、AIっぽさだけを除去)*：
> If Notion still starts as a blank page for your team, open this pack first. It includes 30 templates for common workflows. Duplicate one, adjust the fields you need, and use it for a team project or your own planning without starting from scratch.

> **Score = 0.0%** · 30 個のテンプレート ✓ · ワークフローに合う ✓ · コピー後に調整して使える ✓

**ほかの例**

| 入力タイプ | 落とす AI っぽさ | 保つ内容 |
|---|---|---|
| 韓国語マーケティング | “혁신적인 솔루션”, “새로운 패러다임” | Notion テンプレート 30 個、ワークフローに合う、コピー後に編集して使える |
| 学術文体 | “획기적인 성과”, 広すぎる意義づけ | GitHub プロジェクト 60 個、72h→10m のセットアップ時間、p<0.01、限界の明記 |
| 技術文書 | “핵심적인 역할”, 未来標準のような誇張 | GPU 管理、1 コマンドでの準備、5× 結果の注意点 |

## ブラウザで試す — インストール不要

**[patina.vibetip.help](https://patina.vibetip.help/)** で、KO / EN / ZH / JA 段落の AI っぽい書き方のサインをブラウザ内で確認できます。

> **検出専用です。** playground は、決定的な文体統計分析だけをユーザーのブラウザ内で実行します。テキストを書き換えず、外部 LLM を呼び出さず、API キーをサーバーへ送りません。実際に書き換えたい場合は、下の CLI または skill を使ってください。

書き換えの流れは [30 秒ターミナルデモ](docs/DEMO.md) で確認できます。その他の例は [Before/After Gallery](docs/EXAMPLES.md)（[한국어](docs/EXAMPLES_KR.md)）にあります。
ブランドリソース: [logo](assets/brand/patina-logo.svg)、[mark](assets/brand/patina-mark.svg)、[icon](assets/brand/patina-icon.svg)、[social preview](assets/social/patina-og.svg)、[before/after card](assets/social/patina-before-after.svg)。利用ガイドラインは [BRANDING.md](docs/BRANDING.md) を参照してください。

## 概要

|  |  |
|---|---|
| **168 パターン** | 各言語 33 個の書き換え可能パターン + 9 個のスコア専用 viral-hook（KO/EN/ZH/JA 各 42 個） — [PATTERNS.md](docs/PATTERNS.md) |
| **編集ホットスポット再現率** | 2026-05-22 modern-model rebaseline: GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro で全体の検出率 67.3% [63.5–71.0%]（n=600、韓国語+英語） |
| **ベンチマークレポート** | 再現可能な ko/en/zh/ja suspect-zone benchmark: [overview](docs/benchmarks/README.md) · [latest.md](docs/benchmarks/latest.md) · [latest.json](docs/benchmarks/latest.json) · [2026 rebaseline](docs/benchmarks/rebaseline-latest.md) · [detector comparison](docs/benchmarks/detector-comparison.md) |
| **誤検出率** | 2026-05-22 KO+EN の人間文章コントロールで 16.0% [11.6–21.7%]（n=200）。レジスター別の境界は [stylometry.md](core/stylometry.md) に記録 — [誤検出を報告](https://github.com/devswha/patina/issues/new?template=false_positive.yml) |
| **モード** | rewrite · audit · score · diff · ouroboros |
| **無料利用** | ログイン済みの `codex`、`claude`、`gemini` CLI 経由で利用可能 (API キー不要) |
| **決定性** | スコアリング式は決定的。LLM の severity 判定段階には ±8–10pt の変動があります ([scoring.md §8](core/scoring.md)) |
| **ライセンス** | MIT |

## クイックスタート

### Claude Code または Codex CLI スキルとして

**Claude Code — プラグインマーケットプレイス（クローン不要・推奨）：**

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

**Claude Code · Codex CLI · Cursor · OpenCode — インストールスクリプト：**

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```
インストーラは Claude Code、[Codex CLI](https://github.com/openai/codex)、Cursor、OpenCode に patina をまとめて接続します。インストール時に remote HEAD を具体的な commit に固定します。特定のバージョンに固定したい場合は `PATINA_REF=<tag-or-full-sha>` を設定してください。続いて：

```
/patina --lang ja

[ここにテキストを貼り付け]
```

特定のトーンで書き換え：

```
/patina --tone narrative

[ここにエッセイの下書きを貼り付け]
```

適したトーンを自動選択：

```
/patina --tone auto --lang en

[ここにテキストを貼り付け]
```

> 注意：v1 では `--tone`（`auto` 含む）は ko/en のみ対応。zh/ja では警告を出し、profile-only モードにフォールバックします。

### スタンドアロン CLI として

Node.js ≥ 18 が必要です。npm パッケージは公開済みなので、そのまま実行できます：

```bash
npx patina-cli doctor
npx patina-cli --lang ja input.txt
```

リポジトリを手元で編集しながら試す場合：

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ja input.txt
```

`npm link` 後に stdin でも試せます:

```bash
printf '%s\n' 'コーヒーは、世界中の社会的交流を根本的に変えた重要な文化現象として浮上しました。' \
  | patina --lang ja --backend codex-cli
```

> 🆓 **API キー不要** — [`codex`](https://github.com/openai/codex)、[`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`gemini`](https://github.com/google-gemini/gemini-cli)、[`kimi`](https://moonshotai.github.io/kimi-cli/) のいずれか CLI にログイン済みであれば使えます。`--backend codex-cli | claude-cli | gemini-cli | kimi-cli` で直接選ぶか、`--backend claude-cli,codex-cli` のように明示的なフォールバック順を指定できます。モデル名で自動ルーティングすることもできます（`--model claude-*` / `--model kimi-*` → 対応 CLI など）。`--model` を省略すると、backend ごとのデフォルトモデル（`gpt-5.5`、`claude-sonnet-4-6`、`gemini-2.5-pro`、`kimi-code/kimi-for-coding`）を渡します。全バックエンドは [AUTHENTICATION.md](docs/AUTHENTICATION.md) を参照してください。

### CI 連携

Patina には、live model key なしで使える決定的な CI 文書チェックもあります:

```yaml
# .github/workflows/patina.yml
name: Patina prose score

on:
  pull_request:
    paths:
      - '**/*.md'
      - '**/*.mdx'

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  patina:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: devswha/patina-action@v1
        with:
          score-threshold: 30
          lang: auto
          comment: true
```

Docker イメージ公開は npm release 経路とは別に追跡しています。GHCR イメージが公開されるまでは、コンテナが必要なときにローカルイメージをビルドしてください：

```bash
docker build -t patina:local .
printf '%s\n' 'コーヒーは重要な文化現象として浮上しました。' \
  | docker run --rm -i -e PATINA_API_KEY patina:local --lang ja --provider openai
```

Pre-commit、Husky、Lefthook、Docker、release workflow のメモは [docs/integrations/](docs/integrations/) にあります。

## 正しい使用目的

Patina は、著者が AI 支援で下書きを作ってよい場面で、その下書きを整えるためのツールです。どこをなぜ変えたかを確認しながら、意味を保ったまま文体を自然にします。テキストが「もともと人間によって書かれた」ことを保証するものではなく、学業上の honor code 回避、出版社 disclosure の迂回、盗用の洗浄、detector-bypass 主張に使うべきではありません。スコアは誤検出と見逃しを含む編集シグナルであり、著者判定の根拠ではありません。[ETHICS.md](docs/ETHICS.md) を参照してください。

## モード

```
patina --lang <ko|en|zh|ja> [モード] [--profile <名前>] input.txt
```

| フラグ | 機能 |
|--------|------|
| *(デフォルト)* | 書き換え |
| `--audit` | AI パターン検出のみ |
| `--score` | 0–100 AI 類似度スコア + カテゴリ別内訳 |
| `--score --exit-on <n>` | CI を厳格に保つ: `overall > n` の場合は終了コード `3` |
| `--diff` | 変更箇所をパターンごとに表示 |
| `--ouroboros` | スコア収束まで反復（MPS ロールバック付き） |
| `--lang <ko\|en\|zh\|ja>` | 言語選択（デフォルト：`ko`） |
| `--profile <名前>` | トーンプリセット：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation`, `code-comment`, `commit-message`, `release-notes`, `namuwiki` |
| `--tone <名前>` | トーンカテゴリ：`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 位置引数をファイル一覧として処理（例：`--batch docs/*.md`） |
| `--format json\|text\|markdown` | JSON、プレーンテキスト、デフォルト Markdown 出力を選択 |
| `--quiet` | stderr の状態・警告・進捗ログを抑制 |

全オプションは `patina --help` を参照してください。`patina doctor --json` は LLM 呼び出しなしで Node/backend/tmux/API-key の準備状況を確認します。プロジェクト設定は任意です。単発実行ではフラグを使い、固定のデフォルトが必要な場合だけ `.patina.yaml` を追加してください。

Markdown 中心の開発ワークフローには、開発者向け profile もあります。`code-comment` は inline comments/docstrings を引き締め、`commit-message` は Git 履歴テキストを意図と検証が伝わる形に整えます。`release-notes` は changelog bullets をユーザー影響と移行リスクが見えるリリースノートに変えます。`namuwiki` は韓国語専用の wiki 風 profile で、NamuWiki の記事本文をコピーしない license-safe なオリジナルガイドだけを含みます。

### スコア専用パターン

`--score` と `--audit` は、`--rewrite` より少し広い範囲のシグナルを測定します。viral-hook パック（`ko/en/zh/ja-viral-hook`、各9パターン: 数字ショックフック、クリックベイト末尾、出典を飛ばした権威主張、息継ぎに最適化された短文の積み重ね、誇張されたエンゲージメント語彙、偽統計引用、肩書き積み上げ、未来の自分への約束、警句的パンチライン）は**検出専用**です。

これらのシグナルはスコアと監査にだけ現れ、4言語の SNS マーケティングコピーに対するユーザーの直感とベンチマークを揃えるために使います。`--rewrite`/`--diff`/`--ouroboros` は、意図的な修辞であることが多いので対象外です。実例: [`examples/viral-hook/`](examples/viral-hook/)。

### 短文スコアリング補正 (v3.11)

入力が200文字以下、または3段落以下の場合、文体に敏感なカテゴリ（`language`、`style`、`viral-hook`）へ 1.5 倍の重みを適用し、単一段落の声色変化もスコアに反映されるようにします。case-04 では、長文向けの式がこれらを過小評価していたことが確認されました。

### セルフ監査の分離 (v3.11)

rewrite モードでは、モデルは `[BODY]`/`[/BODY]` ブロックを囲む `[SELF_AUDIT]`/`[/SELF_AUDIT]` タグの中にセルフ監査メモを出力します。patina はユーザーに表示する前に監査部分を取り除くため、出力はクリーンです。以前のバージョンでは "남아 있는 AI 티" や "Phase 3" のような前置きがユーザー向けテキストに漏れることがありました。

### 機械可読出力と終了コード

`--format json` は、すべてのモードを `overall`、`categories[]`、`tone`、`mps`、`gateResult`、クリーンな `output` 本文を含む安定した JSON envelope で包みます。`--quiet` は stdout だけ欲しいスクリプトのために状態・警告・進捗ログを隠します。`--format markdown` がデフォルトで、`--format text` は YAML tone footer なしのユーザー向け本文だけを残します。終了コードは [EXIT-CODES.md](docs/EXIT-CODES.md) にまとまっています: `0` success、`1` runtime/backend、`2` input/usage、`3` score gate exceeded。

### スコア重みドリフト検出 (v3.11)

`--score` 実行時は、モデルが出力した Weight 列を設定の `category-weights` と照合します。モデルが存在しないカテゴリ（例: `discord`）を作ったり、別の数値に置き換えたりした場合、stderr に `[patina]` 警告が出ます。これは観測用であり、weight check 自体はスコアを変更しません。`src/features/*` からの deterministic shadow score も記録され、LLM スコアと 20 点以上ずれた場合は警告し、gate には保守的な方の値を使います。

`--voice-sample <path>` または config の `voice-sample: <path>` を使うと、自分が書いた 1〜3 段落を rewrite のアンカーにできます。Profile と tone は引き続き目標 register を決め、sample はリズム、具体性、視点、文の質感だけを参照します。prompt は sample facts の取り込みを明示的に禁止します。

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

`--tone auto` はヒューリスティック（語彙 + 構造シグナル）で最適なトーンを自動選択します。zh/ja では `auto` を含む全トーン指定時に警告を出して profile-only モードにフォールバックします。Phase 4.5b ヒューリスティックは ko/en のみ対応のためです。

## 仕組み

```
入力
  ↓
[ステップ 4.5]   セマンティックアンカー抽出 (主張、極性、因果、数値)
[ステップ 4.6]   文体統計プリパス (burstiness CV + MATTR; zh/ja character-token fallback)
[ステップ 4.7]   AI 語彙オーバーラップ (英 88 / 韓 102 / 中 60 / 日 60 項目)
[フェーズ 1]     構造スキャン + アンカー検証
[フェーズ 2]     文章リライト + アンカー検証
[フェーズ 3]     セルフ監査 (極性、回帰、MPS)
  ↓
自然なテキスト（意味検証済み）
```

各検証ステップで意味のずれが見つかった場合、patina は再試行またはロールバックします。

**キャリブレーション** *(2026-05-22 modern-model rebaseline；方法論は [2026-rebaseline.md](docs/research/2026-rebaseline.md))*：GPT-5.5、Claude Sonnet 4.6、Gemini 2.5 Pro CLI サンプルで、決定的な編集ホットスポット catch は 67.3% [63.5–71.0%]（n=600、韓国語+英語）。人間文章コントロールの誤検出は 16.0% [11.6–21.7%]（n=200）。言語×モデル別の結果は [rebaseline-latest.md](docs/benchmarks/rebaseline-latest.md) に記載しています。これは編集シグナルであり、作者判定でも検出回避の約束でもありません。

## 設定

```yaml
# .patina.default.yaml
version: "4.0.1"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
```

パターンパックは言語プレフィックスで自動検出されます。作業ディレクトリの `.patina.yaml` がデフォルトを上書きします。検出を拡張するリストキー（`blocklist`、`allowlist`、`skip-patterns`）は default/global/project 設定の間で追加マージされ、その他の配列キーは指定した値で置き換えられます。

## ドキュメント

- **[Cookbook](docs/COOKBOOK.md)** — 実用レシピ（Hugo バッチスコアリング、GitHub Actions、誤検出 triage、カスタム profile、pre-commit）
- **[Glossary](docs/GLOSSARY.md)** — MPS、fidelity、burstiness、MATTR、モードなどの反復用語の短い定義
- **[Demo](docs/DEMO.md)** — ターミナル transcript と複数ジャンルの before/after スナップショット
- **[Patterns](docs/PATTERNS.md)** — 168 パターンカタログ
- **[Authentication](docs/AUTHENTICATION.md)** ([한국어](docs/AUTHENTICATION_KR.md)) — バックエンド、プロバイダ、無料ティア設定
- **[GitHub Action](docs/integrations/github-action.md)** — live model key なしで PR hotspot コメントと README score badge を生成
- **[Pre-commit](docs/integrations/pre-commit.md)** — pre-commit、Husky、Lefthook の score-only レシピ
- **[Static-site Stencils](docs/integrations/static-sites.md)** — Hugo、Astro、Next.js MDX のビルド時スコアリングレシピ
- **[Docker](docs/integrations/docker.md)** — GHCR イメージの使い方と release tag
- **[Release workflow](docs/integrations/release.md)** — npm provenance + GHCR 公開チェックリスト
- **[CLI Contract](docs/CLI.md)** — score gate、JSON/text/Markdown 出力、自動化に安全なインターフェイス
- **[API Reference](docs/API.md)** — プログラム的な import とスコアリング helper 向けの生成 JSDoc リファレンス
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI と `/patina` のオプション対応範囲
- **[Exit Codes](docs/EXIT-CODES.md)** — CI とエディタ統合向けのプロセス終了コード契約
- **[Ethics](docs/ETHICS.md)** — 正しい使用目的、禁止用途、disclosure 方針
- **[FAQ](docs/FAQ.md)** ([한국어](docs/FAQ_KR.md)) — detector-bypass の懸念、MPS、誤検出、貢献の始め方
- **[False-positive Gallery](docs/FALSE-POSITIVES.md)** — 指摘ではなく編集ヒントとして扱うべき人間らしい文体の例
- **[Comparison](docs/COMPARISON.md)** — 一般的な paraphraser/humanizer ツールとの事実ベース比較
- **[Branding](docs/BRANDING.md)** — canonical logo/social assets と OG 設定メモ
- **[Design](DESIGN.md)** — repo-native SVG と README surface の製品/ブランド基準
- **[Roadmap](docs/ROADMAP.md)** — 品質、ベンチマーク、プロダクト、コミュニティ、ローンチ優先事項
- **[Docs Platform RFC](docs/RESEARCH-DOCS-PLATFORM.md)** — Docusaurus、Astro Starlight、MkDocs、GitHub Pages の調査
- **[Benchmark Reports](docs/benchmarks/README.md)** — チェックインされたベンチマーク成果物、更新コマンド、public-claim gate
- **[Benchmark Report](docs/benchmarks/latest.md)** — 最新の再現可能な suspect-zone ベンチマーク要約
- **[Detector Comparison Harness](docs/benchmarks/detector-comparison.md)** — サードパーティ detector のオフライン/手動比較プロトコル
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — AI-like writing signals 測定用ベンチマーク設計メモ
- **[2026 Modern-model Rebaseline](docs/research/2026-rebaseline.md)** — 現在の日付スタンプ付き KO+EN catch/FP claim
- **[2025+ Re-baseline Plan](docs/research/2025-rebaseline-plan.md)** — より広い model-era claim 向けのプロトコル
- **[zh/ja Lexicon Calibration](docs/research/zh-ja-lexicon-calibration.md)** — starter lexicon gate と残りの corpus risk
- **[Launch Copy](docs/social/patina-launch-copy.md)** — launch sequence、score gate、Show HN/Product Hunt/Reddit/X/韓国コミュニティ向け下書き
- **[Signs of AI Writing](docs/social/signs-of-ai-writing.md)** ([한국어](docs/social/signs-of-ai-writing_KR.md)) — 引用例付きの共有用編集 checklist
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 語彙アルゴリズム
- **[Scoring](core/scoring.md)** — AI 類似度 + 忠実度 + MPS
- **[Changelog](CHANGELOG.md)** — リリースノートと方法論
- **[Contributing](CONTRIBUTING.md)** ([한국어](CONTRIBUTING_KR.md)) — パターン提出、誤検出 triage、ベンチマーク fixture、バージョン管理
- **[Governance](GOVERNANCE.md)** / **[Maintainers](MAINTAINERS.md)** — 軽量なプロジェクト意思決定ルール

## 着想元

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) のプラグインアーキテクチャ（パターンがプラグイン、プロファイルがテーマ）、[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer)。

## ライセンス

MIT
