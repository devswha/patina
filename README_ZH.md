**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.8.0-blue)](CHANGELOG.md)

> **让 AI 生成的文字读起来像人写的。**

一个用于检测和改写中文、韩文、英文及日文文本中 AI 写作痕迹的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 技能 + 独立 CLI。基于模式、可审计 — 不是黑箱式 LLM 改写器。评分公式是确定性的，但 LLM 严重程度判定阶段有 ±8–10pt 的波动（参见 [scoring.md §8](core/scoring.md)）。

## 效果展示

**修改前** *(AI 风格)*：
> 咖啡已成为**深刻改变**全球社交互动的**核心文化现象**。这种备受喜爱的饮品充当了社区建设的催化剂，促进了有意义的联结，并推动了跨文化对话。

**修改后** *(`/patina --lang zh` 处理 — 同样内容，仅去除 AI 包装)*：
> 咖啡在不知不觉中改变了人们见面的方式。和人坐下来聊久了，关系自然就有了，哪怕文化背景完全不同也能聊到一起。

> **MPS = 100** · 社交变革 ✓ · 社区建设 ✓ · 有意义的联结 ✓ · 跨文化对话 ✓

## 一览

|  |  |
|---|---|
| **126 个模式** | 韩文 32 + 英文 31 + 中文 31 + 日文 32 — [PATTERNS.md](docs/PATTERNS.md) |
| **AI 检出率** | 韩文 91% / 英文 76% (HC3) |
| **误检率** | 人类写作 13–25% *(百科风格本质局限，[已记录](core/stylometry.md))* |
| **模式** | rewrite · audit · score · diff · ouroboros |
| **免费层** | 支持 — 通过 `codex` CLI（无需 API 密钥） |
| **许可证** | MIT |

## 快速开始

### 作为 Claude Code 或 Codex CLI 技能

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

安装脚本会一次性将 patina 接入 Claude Code、[Codex CLI](https://github.com/openai/codex)、Cursor、OpenCode。然后：

```
/patina --lang zh

[在此粘贴你的文本]
```

### 作为独立 CLI

需要 Node.js ≥ 18。

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang zh input.txt
```

> 🆓 **无需 API 密钥** — 只要 [`codex`](https://github.com/openai/codex) CLI 已登录即可。完整后端列表见 [AUTHENTICATION.md](docs/AUTHENTICATION.md)。

## 模式

```
patina --lang <ko|en|zh|ja> [模式] [--profile <名称>] input.txt
```

| 参数 | 功能 |
|------|------|
| *(默认)* | 改写 |
| `--audit` | 仅检测 AI 模式 |
| `--score` | 0–100 AI 相似度评分 + 类别细分 |
| `--diff` | 按模式逐项展示改动 |
| `--ouroboros` | 反复改写直到分数收敛（含 MPS 回滚） |
| `--lang <ko\|en\|zh\|ja>` | 选择语言（默认：`ko`） |
| `--profile <名称>` | 语气预设：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing` |
| `--batch` | 把位置参数当作文件列表（例：`--batch docs/*.md`） |

完整选项请运行 `patina --help`。

### MAX 模式

将同一段文本独立交给 Claude、Codex、Gemini。通过 MPS ≥ 70 门槛后，AI 分数最低（最像人写）的结果胜出：

```
/patina-max

[在此粘贴你的文本]
```

## 工作原理

```
输入
  ↓
[步骤 4.5]   语义锚点提取 (主张、极性、因果、数值)
[步骤 4.6]   文体统计预处理 (burstiness CV + MATTR)
[步骤 4.7]   AI 词汇重叠 (英 ~108 / 韩 102 项)
[阶段 1]     结构扫描 + 锚点验证
[阶段 2]     句子改写 + 锚点验证
[阶段 3]     自审 (极性、回归、MPS)
  ↓
自然的文本（语义已验证）
```

任一验证阶段语义偏移则重试或回滚。

**校准** *(500 段语料，可通过 `.omc/research/v3_8_remeasure.py` 复现)*：HC3 ChatGPT (en) AI 检出 76%，paired ko/AI 语料 91%，人类写作误检 13–25%。接受门槛：AI ≥ 75%，最大 FP ≤ 25%。算法见 [stylometry.md](core/stylometry.md)。

## 配置

```yaml
# .patina.default.yaml
version: "3.8.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
max-models: [claude, gemini]
```

模式包按语言前缀自动发现。工作目录中的 `.patina.yaml` 会覆盖默认值。

## 文档

- **[Patterns](docs/PATTERNS.md)** — 126 个模式目录
- **[Authentication](docs/AUTHENTICATION.md)** — 后端、服务商、免费层设置
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 词汇算法
- **[Scoring](core/scoring.md)** — AI 相似度 + 忠实度 + MPS
- **[Changelog](CHANGELOG.md)** — 发布说明和方法论
- **[Contributing](CONTRIBUTING.md)** — 模式提交、陈旧报告

## 致谢

灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 的插件架构（模式即插件，配置文件即主题）、[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer)。

## 许可证

MIT
