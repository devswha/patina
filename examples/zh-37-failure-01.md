---
pattern: 37
type: failure
name: 冒号悬念揭晓
pack: zh-style
language: zh
---

# Pattern 37: 冒号悬念揭晓 — Failure (False Positive)

## Input Text

> 报告涵盖三类风险：汇率敞口、供应商集中、监管变动。定义：供应商集中指单一供应商采购占比超过 40%。参考资料：2022 年 OECD 供应链评估。

## Expected Output

> （不修改——此文本不应触发 Pattern 37）

## Applied Pattern

- Pattern 37 (冒号悬念揭晓): 连续三句话出现三个冒号。

## Judgment

**Failure (false positive)** — 适用排除条件：三个冒号都是结构性的。第一个引出列表，第二个标记明确的定义，第三个是指向参考文献的标签。没有一个在制造戏剧性揭晓；删掉它们不是修复节奏，而是破坏文档的引用格式。
