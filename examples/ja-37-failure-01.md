---
pattern: 37
type: failure
name: コロン種明かし
pack: ja-style
language: ja
---

# Pattern 37: コロン種明かし — Failure (False Positive)

## Input Text

> 本報告書は三つのリスクを扱う：為替エクスポージャー、サプライヤー集中、規制変動。定義：サプライヤー集中とは、単一サプライヤーからの調達比率が 40% を超える状態を指す。参考資料：2022 年 OECD サプライチェーンレビュー。

## Expected Output

> （修正なし——このテキストは Pattern 37 を発火させるべきではない）

## Applied Pattern

- Pattern 37 (コロン種明かし): 連続する三つの文にコロンが三回現れる。

## Judgment

**Failure (false positive)** — 除外条件に該当：三つのコロンはすべて構造的である。一つ目はリストの導入、二つ目は明示的な定義、三つ目は参考資料のラベル。どれも劇的な種明かしを演出しておらず、削除すればリズムの修正ではなく文書の参照形式を壊すことになる。
