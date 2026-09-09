**[한국어](README_KR.md)** | **[English](README.md)** | **[中文](README_ZH.md)** | 日本語

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#クイックスタート)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-8.6.0-blue)](CHANGELOG.md)

> **AIっぽさだけを落として、意味はそのまま。**

<p align="center">
  <a href="https://patina.vibetip.help/?lang=ja&amp;utm_source=github&amp;utm_campaign=multilingual-20260907"><b>ブラウザで試す — インストール不要</b></a>
</p>

patina は、韓国語・英語・中国語・日本語向けの、決定的でパターンベースのヒューマナイザーです。AI っぽく聞こえる表現を見つけ、主張・数値・極性・因果関係を変えずに書き換えます。

中身の見えない言い換えツールでも、著者判定ツールでも、AI 検出器を回避するためのツールでもありません。patina は、著者がより自然な文体・監査証跡・意味保持チェックを求める、許容された AI 支援の下書き作成のために作られています。

エディター連携：VS Code、Obsidian、Gmail プレビューの各クライアントはサポートを終了しました。[終了の記録](docs/integrations/editors.md)を参照してください。

## 日本語の書き換え例

見積書の確認依頼からの短い抜粋です。説明用に作成した例で、実際の実行結果や測定値ではありません。

**変更前**

> 添付の見積書は2ページでございます。可能であれば、9月10日17時までにご確認いただけますと幸いです。

**変更後**

> 添付の見積書は2ページです。可能であれば、9月10日17時までにご確認ください。

ページ数と期限、対応できる場合に確認してほしいという条件を保ち、敬語を短くしました。[日本語の3作例](docs/EXAMPLES_JA.md)には、メール全文、進捗報告、製品案内を掲載しています。自分の文章では **[playground](https://patina.vibetip.help/?lang=ja&utm_source=github&utm_campaign=multilingual-20260907)** で試せます。

- **ブラックボックスではなく、監査可能** — 名前付きの 184 パターンがすべての編集を決め、`--diff` が何をなぜ変えたかをそのまま示します。
- **意味はWebで検証されて残る** — playground はすべての書き換えを MPS と忠実度フロアで検証し、逸脱した結果は拒否します。Node CLI は `--verify`、エージェントスキルは `/patina --strict` で同じ検査を有効にします。
- **互いに独立した3つの軸** — Document Type はジャンル、Persona はボイス、Register は伝え方を担当。省略した軸は原文が保たれます。
- **あらゆるサーフェスで** — エージェントスキル（Claude Code · Codex · Cursor · OpenCode）、Node CLI、[ブラウザ playground](https://patina.vibetip.help/?lang=ja&utm_source=github&utm_campaign=multilingual-20260907)。
- **限界に正直** — スコアは編集シグナルであり著者判定ではありません。[事前登録研究](docs/research/2026-rewrite-efficacy-study1.md)では失敗点も併せて公開しています。

## クイックスタート

**ブラウザ — インストール不要。** **[patina.vibetip.help](https://patina.vibetip.help/?lang=ja&utm_source=github&utm_campaign=multilingual-20260907)** を開いて貼り付けるだけ。書き換えと採点はサーバー側で実行され、API モードは自分のキーをリクエスト単位で転送します（保存・ログなし）。

**エージェントスキル — Claude Code、Codex CLI、Cursor などに貼り付けてください：**

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

その後：

```text
/patina --lang ja

[ここにテキストを貼り付け]
```

**CLI — Node 18.1 以上：**

```bash
npx patina-cli --lang ja input.txt          # 書き換え
npx patina-cli doctor                       # バックエンドとキーの確認
```

ログイン済みの CLI は、`codex` なら `--backend codex-cli`、`claude` なら `--backend claude-cli`、`gemini` なら `--backend gemini-cli` で使えます。この場合、patina に API キーを設定する必要はありません。詳細は [INSTALLATION.md](INSTALLATION.md)。

## 互いに独立した3つの軸

patina は一つの軸から別の軸を推論しません。Persona と Register を省略すると、原文のボイスとレジスターを保持します。

| 軸 | 制御するもの | 制御しないもの | 選択方法 |
|---|---|---|---|
| **Document Type** | ジャンル、目的、構造慣習、パターン方針 | ボイス、casual/professional の伝え方、意味保全フロア | `--document-type` · 設定 `document-type` · Playground "Document Type" |
| **Persona** | 再利用ボイス指紋：語彙、リズム、説明習慣 | ジャンル、パターン方針、Register、意味保全フロア | `--persona` · 設定 `persona` · Playground "Persona" |
| **Register** | `casual` または `professional` の伝え方 | ジャンル、Persona の同一性、パターン方針 | `--register` · 設定 `register` · Playground "Register" |

意味保全は3軸の外側の共通フロアであり、明示した軸が省略された軸を埋めることはありません。

```bash
patina --document-type email --register professional note.md
patina --document-type blog --persona pragmatic-founder post.md
```

## 主なコマンド

```bash
patina input.txt                                          # デフォルトで書き換え
patina --audit input.txt                                  # パターン検出のみ
patina --score --offline --exit-on 30 input.txt           # API キー不要の決定論的 CI ゲート
patina --diff input.txt                                   # パターンごとの変更を表示
patina --verify input.txt                                 # 書き換え + MPS/忠実度フロア検査
patina --document-type email --register professional input.txt
patina persona new my-voice --from-sample past-posts.txt  # 自分の文章からボイスを学習
patina --persona my-voice draft.md
patina --batch docs/*.md --outdir cleaned/
```

`patina --help` が全フラグを表示します。GitHub Actions ラッパー：[devswha/patina-action](https://github.com/devswha/patina-action) · [pre-commit などの統合](docs/integrations/pre-commit.md)。

プロジェクト設定は `.patina.yaml` に置きます：

```yaml
# .patina.default.yaml
version: "8.6.0"
language: ko              # ko | en | zh | ja
document-type: default    # ジャンル/用途 + パターン方針
persona:                  # 任意。省略時は原文ボイスを保持
register:                 # casual | professional。省略時は原文レジスターを保持
```

## できること

|  |  |
|---|---|
| **184 パターン** | 各言語 37 個の書き換え可能パターン + 9 個のスコア専用 viral-hook（KO/EN/ZH/JA 各 46 個） — 完全な 184 パターンカタログは [PATTERNS.md](docs/PATTERNS.md) を参照 |
| **モード** | rewrite · verify · audit · score · diff |
| **キャリブレーション** | GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro で編集ホットスポット再現率 67.3% [63.5–71.0%]（n=600、KO+EN）；KO+EN の人間文章コントロールで誤検出 16.0% [11.6–21.7%]（n=200） |
| **ライセンス** | MIT |

スコアは誤検出・見逃しを含む編集シグナルであり、著者性の証明ではありません。[Ethics](docs/ETHICS.md) を参照してください。

## ドキュメント

- [Cookbook](docs/COOKBOOK.md) — よく使うレシピ · [CLI 契約](docs/CLI.md) — フラグ・ゲート・終了コード
- [日本語の作例ギャラリー](docs/EXAMPLES_JA.md) · [日本語パターン](docs/PATTERNS-JA.md) · [全言語のカタログ](docs/PATTERNS.md)
- 過去の実行記録：[英語のアニメーション](assets/demo/patina-playground-en.gif) · [CLI transcript](docs/DEMO.md)
- [アーキテクチャ](docs/ARCHITECTURE.md) · [設定と認証](docs/AUTHENTICATION.md)
- [ベンチマーク](docs/benchmarks/latest.md) · [研究](docs/research/2026-rewrite-efficacy-study1.md) · [FAQ](docs/FAQ.md)
- [コントリビュート](CONTRIBUTING.md) · [変更履歴](CHANGELOG.md)

## ライセンス

MIT。[LICENSE](LICENSE) と [NOTICE](NOTICE) を参照。[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)、[Wikipedia の "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer) に着想を得ています。
