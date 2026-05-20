---
pattern: 25
type: failure
name: 结构性重复
pack: zh-structure
language: zh
---

# Pattern 25 (zh): 结构性重复 — 失败案例（误报）

## 输入文本

> **iPhone 15 Pro：** A17 Pro芯片CPU提升10%，视频播放续航23小时，起售价999美元。
>
> **Galaxy S24 Ultra：** Snapdragon 8 Gen 3性能接近A17，电池容量5000mAh，起售价1299美元。
>
> **Pixel 8 Pro：** Tensor G3更重视AI功能，续航约24小时，起售价999美元。

## 期望输出

> （不修改 — Pattern 25 不应触发这段文本）

## 适用模式

- Pattern 25 (结构性重复): 三个段落按芯片、续航、价格重复。

## 判定

**失败（误报）** — 这是产品对比评测，重复标准是为了公平比较。结构一致不是AI模板，而是读者查找规格所需的格式。
