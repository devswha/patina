---
pattern: 35
type: failure
name: 清嗓式开场
pack: zh-filler
language: zh
---

# Pattern 35: 清嗓式开场 — Failure (False Positive)

## Input Text

> 说实话，三月我差点把公司关了。工资发出去后账上只剩几十块钱，我没告诉联合创始人，也没告诉妻子。写这篇通讯，是我第一次把这件事说出口。

## Expected Output

> （不修改——此文本不应触发 Pattern 35）

## Applied Pattern

- Pattern 35 (清嗓式开场): "说实话"位于段首。

## Judgment

**Failure (false positive)** — 适用排除条件：这是第一人称写作中难以启齿的剖白之前的真实迟疑。"说实话"不是在把商业论点包装成坦率发言，而是作者在鼓起勇气承认一直隐瞒的事。删掉它会把告白段落压平成干巴巴的汇报，改变文体。
