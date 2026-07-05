**[한국어](README_KR.md)** | **[English](README.md)** | **[中文](README_ZH.md)** | 日本語

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#クイックスタート)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-6.2.0-blue)](CHANGELOG.md)

> **AIっぽさだけを落として、意味はそのまま。**

<p align="center">
  <a href="https://patina.vibetip.help/"><b>ブラウザで試す — インストール不要</b></a>
</p>

patina は、韓国語・英語・中国語・日本語向けの、決定的でパターンベースのヒューマナイザーです。AI っぽく聞こえる表現を見つけ、主張・数値・極性・因果関係を変えずに書き換えます。

中身の見えない言い換えツールでも、著者判定ツールでも、AI 検出器を回避するためのツールでもありません。patina は、著者がより自然な文体・監査証跡・意味保持チェックを求める、許容された AI 支援の下書き作成のために作られています。

## デモ

AI っぽいテキストを **[playground](https://patina.vibetip.help/)** に貼り付けると、patina がその場で書き換えます。意味フロアが書き換えを検証し（ここでは **MPS 100 / Fidelity 75** — 「30 templates」という事実は保たれます）、決定的な AI シグナルを before → after で測定します。hot-paragraph 比率は **100 → 0** に下がり、誇張表現（"thrilled to announce"、"revolutionize your workflow"、"unlock their full potential"）は消えています。

<p align="center">
  <img src="https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-playground-en.gif" alt="patina playground のアニメーションデモ：AI っぽいテンプレートパックの告知文を web playground に貼り付け、30-templates の事実を保ったまま自然に書き換え、MPS 100・Fidelity 75・100 から 0 への決定的な AI シグナル低下で検証する様子" width="820">
</p>

ほかの例：[Before/After Gallery](docs/EXAMPLES.md)（[한국어](docs/EXAMPLES_KR.md)）· [CLI transcript](docs/DEMO.md)。

## クイックスタート

### ブラウザ playground

**[patina.vibetip.help](https://patina.vibetip.help/)** を開き、KO / EN / ZH / JA のテキストを貼り付けると、MPS/忠実度フロアでゲートされた実際の書き換えを、決定的な AI シグナルの before → after 付きで試せます。書き換えと採点はサーバー側で実行され、無料ティアはサービス自身のモデルキーを使います（レート制限あり）。**API モード**では、リクエストごとに自分のキーが patina サーバーを経由して選択したプロバイダーへ転送され、保存もログ記録もされません（メトリクスはサニタイズ済み：テキスト・プロンプト・出力・キー・IP を含みません）。

### エージェントスキル

**コーディングエージェントにインストールさせる** — Claude Code、Codex CLI、Cursor、Gemini CLI などのエージェントに以下を貼り付けてください：

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

エージェントが [`INSTALLATION.md`](INSTALLATION.md)（AI エージェント向けに書かれています）を取得し、ホストに合ったインストール手順を実行して検証します。自分で行う場合：

**Claude Code — プラグインマーケットプレイス（クローン不要・推奨）：**

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

**Claude Code · Codex CLI · Cursor · OpenCode — インストールスクリプト：**

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

続いて Claude Code、Codex CLI、Cursor、OpenCode からスキルを実行します：

```text
/patina --lang en

[ここにテキストを貼り付け]
```

便利なスキル呼び出し：

```text
/patina --tone professional
/patina --tone auto --lang en
```

### スタンドアロン CLI

Node.js >= 18 が必要です。

```bash
npx patina-cli doctor
npx patina-cli --lang en input.txt
```

API キーなしで、ログイン済みのローカルモデル CLI を使う：

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | npx patina-cli --lang en --backend codex-cli
```

対応するローカルバックエンド：`codex-cli`、`claude-cli`、`gemini-cli`、`kimi-cli` — patina はバックエンドごとに、ドキュメント化された中で最も強力なデフォルトモデルを渡します。[Authentication](docs/AUTHENTICATION.md)（[한국어](docs/AUTHENTICATION_KR.md)）を参照してください。

大規模な `--batch` 実行には OpenAI 互換の HTTP バックエンドを推奨します。ローカル CLI バックエンドはエージェントランタイムであり、バッチ処理の安全のために `--timeout-ms`、`--max-concurrency`、`--max-retries`、`--max-failures` で保守的に上限が設定されます。

## できること

|  |  |
|---|---|
| **168 パターン** | 各言語 33 個の書き換え可能パターン + 9 個のスコア専用 viral-hook（KO/EN/ZH/JA 各 42 個） — 完全な 168 パターンカタログは [PATTERNS.md](docs/PATTERNS.md) を参照 |
| **モード** | rewrite · verify · audit · score · diff |
| **利用形態** | agent skill · Node CLI · ページ内 preview · ブラウザ playground（rewrite + score） |
| **ボイス** | `--persona`（組み込み + 自作、ko/en/zh/ja）· `--tone` レジスター · `--profile` ジャンル — 固定の優先順位で組み合わせ可能 |
| **無料利用** | ログイン済みの `codex`、`claude`、`gemini` CLI なら `PATINA_API_KEY` なしで書き換え可能 |
| **キャリブレーション** | GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro で編集ホットスポット再現率 67.3% [63.5–71.0%]（n=600、KO+EN）；KO+EN の人間文章コントロールで誤検出 16.0% [11.6–21.7%]（n=200） |
| **ライセンス** | MIT |

スコアは誤検出と見逃しを含む編集シグナルであり、著者判定の根拠ではありません。[Ethics](docs/ETHICS.md) を参照してください。

## 主なコマンド

```bash
patina --lang <ko|en|zh|ja> [mode] [--profile <name>] input.txt
```

| コマンド | 目的 |
|---|---|
| `patina input.txt` | デフォルトで書き換え |
| `patina --audit input.txt` | パターン検出のみ |
| `patina --score input.txt` | 0-100 の AI 類似度スコアを出力 |
| `patina --score --exit-on 30 input.txt` | `overall > 30` で終了コード `3` を返す CI ゲート |
| `patina --diff input.txt` | 変更をパターンごとに表示 |
| `patina --preview page.html` | 保存済み HTML ページ上に書き換えを反映し、トグルとインライン diff を表示 |
| `patina --verify input.txt` | 書き換え後、1 回のリトライで MPS/忠実度フロアを検査 |
| `patina --tone auto --lang en input.txt` | KO/EN のトーン軸を推定して適用 |
| `patina --persona pragmatic-founder input.txt` | 組み込みボイスペルソナで書き換え |
| `patina persona new my-voice --from-sample past.txt` | 文章サンプルから自分のペルソナを作成 |
| `patina persona list` | 組み込み + カスタムペルソナを一覧表示 |
| `patina --format json --quiet input.txt` | スクリプト向け出力 |
| `patina --batch docs/*.md --outdir cleaned/` | 複数ファイルの一括処理 |

`patina --help` は全フラグ一覧を表示します。`patina doctor --json` は LLM 呼び出しなしで Node・backend・tmux・API キーの準備状況を確認します。

### ペルソナ（ボイス）

**ペルソナ**は再利用できるボイスです — 組み込み（`patina persona list`）か、ソースを触らずに自作できます：

```bash
patina persona new my-voice --from-sample past-posts.txt   # learn from your writing
patina persona new my-voice --describe "plain-spoken founder, casual"
patina --persona my-voice draft.md                          # then reuse it
```

ko/en/zh/ja で動作し、`--tone`/`--profile` と組み合わせられます（レジスター優先順位は `--tone` > persona > profile）。ペルソナはボイスを形づくるだけで意味フロアを下げることはありません。作成したペルソナは保存時に検証され、安全ゲートは MPS/忠実度 + 数値欠落チェックを引き続き強制します。

## CI

GitHub Actions では、メンテナンス済みのラッパーが手書きのセットアップよりも短く済みます：

```yaml
name: Patina prose score
on:
  pull_request:
    paths: ['**/*.md', '**/*.mdx']
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

そのほかの連携：[pre-commit](docs/integrations/pre-commit.md)、[static sites](docs/integrations/static-sites.md)、[Docker](docs/integrations/docker.md)、[release workflow](docs/integrations/release.md)。

## 仕組み

```text
Input
  -> semantic anchor extraction (claims, polarity, causation, numbers)
  -> stylometry + AI-lexicon scan
  -> pattern-guided rewrite
  -> self-audit and MPS/fidelity checks
  -> cleaned text
```

意味がずれた場合、その変更は再試行またはロールバックされます。決定的な解析は `src/features/*` にあり、LLM を用いる書き換えとスコア呼び出しは選択したバックエンドを使います。

## 設定

```yaml
# .patina.default.yaml
version: "6.2.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | auto  (register; genre = profile)
```

プロジェクトの `.patina.yaml` がデフォルトを上書きします。パターンパックは言語プレフィックスで自動検出されます。追加型のリストキー（`blocklist`、`allowlist`、`skip-patterns`）はマージされ、その他の配列は置き換えられます。

## ドキュメント

まずはここから：

- [Cookbook](docs/COOKBOOK.md) — 一般的なレシピとワークフロー
- [CLI Contract](docs/CLI.md) — フラグ、フォーマット、スコアゲート、終了時の挙動
- [Authentication](docs/AUTHENTICATION.md) — ローカル CLI バックエンドと API プロバイダー
- [Patterns](docs/PATTERNS.md) — 完全なパターンカタログ
- [Subagents & strict flow](docs/agents.md) — 任意の読み取り専用 detector/fidelity/naturalness サブエージェントと `--strict` マルチパスモード
- [Benchmarks](docs/benchmarks/README.md) · [latest report](docs/benchmarks/latest.md) · [2026 rebaseline](docs/research/2026-rebaseline.md)
- [Measurement harness](docs/HARNESS.md) — すべてのベンチマーク・キャリブレーション・ゲートツールの索引（signal-impact ablation ハーネスを含む）
- [FAQ](docs/FAQ.md)（[한국어](docs/FAQ_KR.md)）
- [Ethics](docs/ETHICS.md)
- [Contributing](CONTRIBUTING.md)（[한국어](CONTRIBUTING_KR.md)）
- [Changelog](CHANGELOG.md)

ブランドアセットと利用ルールは [Branding](docs/BRANDING.md) にあります。設計メモは [DESIGN.md](DESIGN.md) にあります。

## 謝辞

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) のプラグインアーキテクチャ、[Wikipedia「Signs of AI writing」](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer) に着想を得ています。

## ライセンス

MIT。[LICENSE](LICENSE) と [NOTICE](NOTICE) を参照してください。
