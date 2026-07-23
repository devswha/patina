---
pattern: 36
type: failure
name: 伪洞察铺垫
pack: zh-filler
language: zh
---

# Pattern 36: 伪洞察铺垫 — Failure (False Positive)

## Input Text

> 很多人不知道，1976 年版权法已经覆盖了这种情形。我书架上五本教科书里有三本都在重复一个通行说法：1978 年以前的录音完全不受联邦保护。但第 301(c) 条写得很清楚：州法保护延续到 2067 年，2018 年的 CLASSICS 法案又在其上叠加了联邦数字表演权。

## Expected Output

> （不修改——此文本不应触发 Pattern 36）

## Applied Pattern

- Pattern 36 (伪洞察铺垫): "很多人不知道"位于段首。

## Judgment

**Failure (false positive)** — 适用排除条件：文章先记录通行观点是什么（并指出它出现在哪里），再用具体法条反驳。铺垫在做真实的论证工作——先确认一个确实广泛存在的误读，再用证据纠正——不是唯一内部人的姿态。
