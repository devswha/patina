---
pattern: 10
type: failure
name: 三の法則の多用
pack: ja-language
language: ja
---

# Pattern 10 (ja): 三の法則の多用 — 失敗事例（誤検出）

## 入力テキスト

> 実験は三つの段階で行う。準備、測定、解析である。準備ではセンサーを校正し、測定は48時間連続で行い、解析には約2週間かかる。

## 期待される出力

> （修正なし — Pattern 10 はこのテキストで発火すべきではない）

## 適用パターン

- Pattern 10 (三の法則の多用): 三項目の列挙がある。

## 判定

**失敗（誤検出）** — 準備・測定・解析は実在の工程三项であり、classification/segmentation/detection や input/process/output と同じ除外に入る。修辞的な三项が文書に2回以上あるときだけ発火する。
