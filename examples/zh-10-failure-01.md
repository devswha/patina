---
pattern: 10
type: failure
name: 排比句过度使用
pack: zh-language
language: zh
---

# Pattern 10 (zh): 排比句过度使用 — 失败案例（误报）

## 输入文本

> 演讲稿写道：“我们记得过去的牺牲，珍惜现在的和平，也面向未来的责任。”这三个分句对应纪念仪式的过去、现在、未来结构。

## 期望输出

> （不修改 — Pattern 10 不应触发这段文本）

## 适用模式

- Pattern 10 (排比句过度使用): 出现三段式排比。

## 判定

**失败（误报）** — 过去/现在/未来是真实时间三项，与 classification/segmentation/detection、输入/处理/输出同类。修辞性三项且全文出现 2 次以上才触发。单独一次技术或时间三项不触发。
