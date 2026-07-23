---
pattern: 37
type: success
name: 冒号悬念揭晓
pack: zh-style
language: zh
---

# Pattern 37: 冒号悬念揭晓 — Success

## Input Text

> 假期里我们用 Rust 重写了导入器。结果：提速 12 倍。更绝的是：内存占用减半。反转：二进制体积比原来的 Python 包还小。

## Expected Output

> 假期里我们用 Rust 重写了导入器，提速 12 倍。内存占用减半，二进制体积比原来的 Python 包还小。

## Applied Pattern

- Pattern 37 (冒号悬念揭晓): 四句话里三处冒号揭晓——"结果："、"更绝的是："、"反转："——把每个事实都变成抖包袱。

## Judgment

**Success** — 满足触发条件：3 处冒号悬念超过 2 处阈值，且没有一个冒号承担列表、标签或定义的结构功能。平铺直叙的句子传达同样的事实，没有人为的鼓点，段落也不再像互动优化文案。
