---
pattern: 26
type: failure
name: 翻译腔/欧化语法
pack: zh-structure
language: zh
---

# Pattern 26 (zh): 翻译腔/欧化语法 — 失败案例（误报）

## 输入文本

> 该译文保留了英文原句“This can be considered a material breach”的结构，因此写成“这可以被认为是重大违约”。译注说明这是为了对应合同术语。

## 期望输出

> （不修改 — Pattern 26 不应触发这段文本）

## 适用模式

- Pattern 26 (翻译腔/欧化语法): 出现“可以被认为是”等翻译腔表达。

## 判定

**失败（误报）** — 这是一份有英文原文的翻译说明，直译痕迹是有意保留的术语对应。模式排除了实际翻译文档。
