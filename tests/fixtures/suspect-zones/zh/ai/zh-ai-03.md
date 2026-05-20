---
fixture_id: zh-ai-03
language: zh
class: ai
expected_hot: true
why_designed_this_way: |
  Chat-register AI fixture. The sentences are deliberately even and procedural, mirroring assistant-style status prose without private operational details.
topic: 文档审核
---

审核脚本会先读取公开文档中的段落。评分器随后记录每个段落的风险信号。报告页面再汇总语言维度和样本数量。维护者可以根据结果补充新的案例。整个流程保持离线运行并避免发送隐私文本。
