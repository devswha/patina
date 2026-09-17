---
pattern: 31
type: failure
name: 结论信号词滥用
pack: zh-filler
language: zh
---

# Pattern 31: 结论信号词滥用 — Failure (False Positive)

## Input Text

> 周五发布复盘。经验教训：
> - 在发布检查清单中加入回滚手册。
> - 周五生产推送前通知第二审核人。
> - 把缓存刷新顺序写进事故模板。

## Expected Output

> （不修改——此文本不应触发 Pattern 31）

## Applied Pattern

- Pattern 31 (结论信号词滥用): “经验教训”作为列表标题出现。

## Judgment

**Failure (false positive)** — 这份经验教训列表本身就是交付物。加入回滚手册、通知第二审核人、写下缓存刷新顺序是要执行的动作，不是对正文已述故事的解说。无修改对照保留这些动作。
