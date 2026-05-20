---
pattern: 20
type: success
name: 训练数据截止声明
pack: zh-communication
language: zh
---

# Pattern 20 (zh): 训练数据截止声明 — 成功案例

## 输入文本

> 截至我的知识截止日期，该公司约有5000名员工。具体数据可能有变化，建议您查阅最新资料。

## 期望输出

> 该公司2024年年报显示员工约5000人。

## 适用模式

- Pattern 20 (训练数据截止声明): source example from `patterns/zh-communication.md`.

## 判定

**成功** — 源模式文档中的修改前文本触发该模式，修改后文本保留核心事实与语气目标，同时去掉对应 AI 写作痕迹。
