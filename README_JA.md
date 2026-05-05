**[한국어](README_KR.md)** | **[English](README.md)** | **[中文](README_ZH.md)** | 日本語

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#クイックスタート)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.9.0-blue)](CHANGELOG.md)

> **AI が書いた文章を、人間が書いたように変えます。**

韓国語・英語・中国語・日本語のテキストから AI 特有の文体パターンを検出して書き換えます。[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex)、[Cursor](https://cursor.sh)、OpenCode 向けスキル + スタンドアロン Node.js CLI として利用可能。パターンベース・監査可能 — ブラックボックス LLM パラフレーザーではありません。スコアリング式は決定的ですが LLM の severity 判定段階に ±8–10pt の変動があります（[scoring.md §8](core/scoring.md) 参照）。

## デモ

**修正前** *(AI 風の文章)*：
> コーヒーは、世界中の社会的交流を**根本的に変革した****中核的な文化現象**として台頭してきました。この愛される飲料はコミュニティ構築の触媒として機能し、意義ある繋がりを促進し、異文化間の対話を導いています。

**修正後** *(`/patina --lang ja` — 同じ内容、AI 装飾のみ除去)*：
> コーヒーは、人の会い方をかなり変えてきたと思う。誰かと向かい合って座っているうちに自然と関係ができるし、文化が違う人同士でも会話が生まれやすくなる。

> **MPS = 100** · 社会的交流の変革 ✓ · コミュニティ構築 ✓ · 意義ある繋がり ✓ · 異文化間の対話 ✓

## 概要

|  |  |
|---|---|
| **126 パターン** | 韓国語 32 + 英語 31 + 中国語 31 + 日本語 32 — [PATTERNS.md](docs/PATTERNS.md) |
| **AI 検出率** | 韓国語 91% / 英語 76% (HC3) |
| **誤検出率** | 人間文章で 13–25% *(百科事典体の本質的限界、[文書化済み](core/stylometry.md))* |
| **モード** | rewrite · audit · score · diff · ouroboros |
| **無料利用** | 可能 — `codex` CLI 経由 (API キー不要) |
| **ライセンス** | MIT |

## クイックスタート

### Claude Code または Codex CLI スキルとして

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

インストーラが Claude Code、[Codex CLI](https://github.com/openai/codex)、Cursor、OpenCode に一括で配線します。続いて：

```
/patina --lang ja

[ここにテキストを貼り付け]
```

### スタンドアロン CLI として

Node.js ≥ 18 が必要です。

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang ja input.txt
```

> 🆓 **API キー不要** — [`codex`](https://github.com/openai/codex) CLI にログイン済みであれば OK。全バックエンドは [AUTHENTICATION.md](docs/AUTHENTICATION.md) を参照。

## モード

```
patina --lang <ko|en|zh|ja> [モード] [--profile <名前>] input.txt
```

| フラグ | 機能 |
|--------|------|
| *(デフォルト)* | 書き換え |
| `--audit` | AI パターン検出のみ |
| `--score` | 0–100 AI 類似度スコア + カテゴリ別内訳 |
| `--diff` | 変更箇所をパターンごとに表示 |
| `--ouroboros` | スコア収束まで反復（MPS ロールバック付き） |
| `--lang <ko\|en\|zh\|ja>` | 言語選択（デフォルト：`ko`） |
| `--profile <名前>` | トーンプリセット：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing` |
| `--batch` | 位置引数をファイル一覧として処理（例：`--batch docs/*.md`） |

全オプションは `patina --help`。

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

**キャリブレーション** *(500 段落コーパス、`.omc/research/v3_8_remeasure.py` で再現可能)*：HC3 ChatGPT (en) AI 検出 76%、paired ko/AI コーパス 91%、人間文章誤検出 13–25%。受け入れ基準：AI ≥ 75%、最大 FP ≤ 25%。アルゴリズムは [stylometry.md](core/stylometry.md)。

## 設定

```yaml
# .patina.default.yaml
version: "3.9.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
max-models: [claude, gemini]
```

パターンパックは言語プレフィックスで自動検出されます。作業ディレクトリの `.patina.yaml` がデフォルトを上書きします。

## ドキュメント

- **[Patterns](docs/PATTERNS.md)** — 126 パターンカタログ
- **[Authentication](docs/AUTHENTICATION.md)** — バックエンド、プロバイダ、無料ティア設定
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 語彙アルゴリズム
- **[Scoring](core/scoring.md)** — AI 類似度 + 忠実度 + MPS
- **[Changelog](CHANGELOG.md)** — リリースノートと方法論
- **[Contributing](CONTRIBUTING.md)** — パターン提出、陳腐化レポート

## 着想元

[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) のプラグインアーキテクチャ（パターンがプラグイン、プロファイルがテーマ）、[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer)。

## ライセンス

MIT
