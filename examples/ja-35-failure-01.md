---
pattern: 35
type: failure
name: 前置き咳払い
pack: ja-filler
language: ja
---

# Pattern 35: 前置き咳払い — Failure (False Positive)

## Input Text

> 正直に言うと、3月に会社を畳みかけた。給与を払ったら口座には数千円しか残らず、共同創業者にも妻にも言わなかった。このニュースレターが、その話を初めて口にする場所だ。

## Expected Output

> （修正なし——このテキストは Pattern 35 を発火させるべきではない）

## Applied Pattern

- Pattern 35 (前置き咳払い): 「正直に言うと」が段落の冒頭にある。

## Judgment

**Failure (false positive)** — 除外条件に該当：一人称の文章で、言いにくい告白の前に置かれた本物のためらいである。ビジネス上の主張を率直な発言として演出しているのではなく、隠してきた事実を初めて明かす前の逡巡を示している。削除すれば告白的な段落が平板な報告文に変わる。
