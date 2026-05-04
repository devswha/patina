**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.8.0-blue)](#版本历史)

> **让 AI 生成的文字读起来像人写的。**

一个用于检测和改写中文、韩文、英文及日文文本中 AI 写作痕迹的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 技能 + 独立 CLI。基于模式、可审计、确定性评分 — 不是黑箱式 LLM 改写器。

## 效果展示

**修改前**（AI 风格）：
> 咖啡已成为**深刻改变**全球社交互动的**核心文化现象**。这种备受喜爱的饮品充当了社区建设的催化剂，促进了有意义的联结，并推动了跨文化对话。从巴黎繁华的咖啡馆到东京宁静的茶室，这一**非凡旅程**展示了人类饮食文化探索的**创新精神**。

**修改后**（`/patina --lang zh` 处理 — 同样内容，仅去除 AI 包装）：
> 咖啡在不知不觉中改变了人们见面的方式。和人坐下来聊久了，关系自然就有了，哪怕文化背景完全不同也能聊到一起。巴黎的咖啡馆和东京从茶室改过来的店里，发生的事情其实差不多。一颗豆子烤一烤，就这样变成了全世界共享的社交文化。

> **MPS = 100** · 全球社交变革 ✓ · 社区建设 ✓ · 有意义的联结 ✓ · 跨文化对话 ✓ · 巴黎咖啡馆 ✓ · 东京茶室 ✓ · 饮食文化探索 ✓

---

## 一览

|  |  |
|---|---|
| **126 个模式** | 韩文 32 + 英文 31 + 中文 31 + 日文 32 |
| **AI 检出率** | 韩文 91% / 英文 76% (HC3) |
| **误检率** | NamuWiki 13% / HC3 human 19% / Wikipedia 25% *(百科风格本质局限 — 已记录)* |
| **模式** | rewrite · audit · score · diff · ouroboros |
| **免费层** | 支持 — 通过 `codex` CLI（无需 API 密钥） |
| **许可证** | MIT |

---

## 目录

- [快速开始](#快速开始)
- [模式与参数](#模式与参数)
- [MAX 模式](#max-模式多模型)
- [评分 & ouroboros](#评分--ouroboros)
- [认证](#认证)
- [工作原理](#工作原理)
- [校准](#校准)
- [模式](#模式)
- [配置](#配置)
- [配置文件](#配置文件profiles)
- [自定义模式](#自定义模式)
- [项目结构](#项目结构)
- [添加新语言](#添加新语言)
- [参考资料](#参考资料)
- [版本历史](#版本历史)

---

## 快速开始

### 作为 Claude Code 技能

一行安装：

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

在 Claude Code 中：

```
/patina --lang zh

[在此粘贴你的文本]
```

[手动安装 →](#手动安装)

### 作为独立 CLI

需要 **Node.js ≥ 18**。

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang zh input.txt
```

```bash
# 常用示例
patina --lang en --profile blog input.txt
patina --lang ko --score input.txt
patina --lang en --ouroboros input.txt
patina --batch docs/*.md --suffix .humanized
```

> 🆓 **无需 API 密钥** — 只要安装并登录 [`codex`](https://github.com/openai/codex) CLI 即可。完整后端列表见 [认证](#认证)。

#### 手动安装

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max  # MAX 模式技能
```

如果已通过独立 CLI 流程克隆，无需重复克隆 — 直接在该目录下执行 `npm link`。

---

## 模式与参数

```
patina --lang <ko|en|zh|ja> [模式] [--profile <名称>] [批处理选项] input.txt
```

| 参数 | 功能 |
|------|------|
| `--lang <ko\|en\|zh\|ja>` | 选择语言（默认：`ko`） |
| `--profile <名称>` | 语气预设 — 见 [配置文件](#配置文件profiles) |
| `--audit` | 仅检测 AI 模式（不改写） |
| `--score` | 0–100 AI 相似度评分 + 类别细分 |
| `--diff` | 按模式逐项展示改动 |
| `--ouroboros` | 反复改写直到分数收敛（含 MPS 回滚） |
| `--batch <glob>` | 批量处理多个文件 |
| `--in-place` | 覆盖原文件（与 `--batch` 配合） |
| `--suffix <ext>` | 另存为 `{file}.{ext}.md` |
| `--outdir <dir>` | 将结果保存到指定目录 |
| `--models <list>` | MAX 模式 — 见下文 |

可自由组合：`patina --lang en --audit --profile blog`。完整选项请运行 `patina --help`。

---

## MAX 模式（多模型）

将同一段文本独立交给 Claude、Codex、Gemini。每个模型独立改写，按 AI 相似度 + MPS 评分，得分最低（最像人写）且通过 MPS ≥ 70 门槛者胜出。

```
/patina-max

[在此粘贴你的文本]
```

| 模型 | 调度 | 认证 |
|-----|------|------|
| `claude` | `claude -p` | Claude Code |
| `codex` | `codex exec --skip-git-repo-check --output-last-message` | ChatGPT OAuth |
| `gemini` | `gemini -p '' --output-format text` | Google AI Studio |

每次 MAX 运行使用独立的临时目录，仅等待所选模型，超时按失败处理（不无限等待）。

> 独立 CLI MAX：`patina --models gpt-4o,gpt-4o-mini input.txt` — 通过同一个 `--base-url` 端点调用所有模型。要混用多家服务商，请将 `--base-url` 指向 OpenRouter 等多服务商网关。Claude Code `/patina-max` 技能通过本地 CLI 调度 — 无需 API 密钥。

---

## 评分 & ouroboros

### 评分模式

不改写，仅检查 AI 痕迹程度：

```bash
patina --score input.txt
```

```
| Category      | Weight | Detected | Raw  | Weighted |
|---------------|--------|----------|------|----------|
| content       | 0.20   | 3/6      | 33.3 | 6.7      |
| language      | 0.20   | 1/6      | 11.1 | 2.2      |
| style         | 0.20   | 2/6      | 27.8 | 5.6      |
| communication | 0.15   | 0/3      | 0.0  | 0.0      |
| filler        | 0.10   | 1/3      | 11.1 | 1.1      |
| structure     | 0.15   | 1/4      | 25.0 | 3.8      |
| Overall       |        |          |      | 19.3 (±10) |
```

| 范围 | 解读 |
|------|------|
| 0–15 | 人写 |
| 16–30 | 基本像人写 |
| 31–50 | 混合 |
| 51–70 | AI 味明显 |
| 71–100 | 严重 AI 痕迹 |

与改写模式配合时，还会输出：

| 指标 | 分数 | 含义 |
|------|------|------|
| AI 相似度 | 23/100 | 越低越像人写 |
| 忠实度 | 87/100 | 观点保留、无捏造、语气一致、篇幅比例 |
| MPS | 92/100 | 语义锚点（主张、极性、因果、数值） |
| 综合 | 19/100 | 按配置文件加权（如博客：AI 0.70 / 忠实度 0.30） |

### ouroboros 模式

反复改写直到分数收敛：

```bash
patina --ouroboros input.txt
```

```
| Iter | Before | After | Improvement | Reason     |
|------|--------|-------|-------------|------------|
| 0    | —      | 78    | —           | Initial    |
| 1    | 78     | 45    | +33         |            |
| 2    | 45     | 28    | +17         | Target met |
```

终止条件（先满足者为准）：
- 达到目标（分数 ≤ 30，可配置）
- 平台期（迭代间改善 < 10）
- 退化（分数升高 — 回滚）
- 最大迭代次数（默认 3）
- 忠实度 / MPS 下限触发（回滚）

在 `.patina.yaml` 中配置：

```yaml
ouroboros:
  target-score: 30
  max-iterations: 3
  plateau-threshold: 10
  fidelity-floor: 70
  mps-floor: 70
```

> `--ouroboros` 不能与 `--diff`、`--audit`、`--score` 同时使用。

---

## 认证

| 后端 | 设置 | 成本 |
|------|------|------|
| `codex-cli` *(可用时为默认)* | `codex login` | **免费**（ChatGPT OAuth） |
| OpenAI 兼容 HTTP | `PATINA_API_KEY=...` | 按服务商计费 |
| Google Gemini | `GEMINI_API_KEY=...` + `--provider gemini` | 免费层 |
| Groq | `GROQ_API_KEY=...` + `--provider groq` | 免费层 |
| Together AI | `TOGETHER_API_KEY=...` + `--provider together` | 有免费模型 |
| OpenRouter | `--base-url https://openrouter.ai/api/v1` + 密钥 | 按服务商计费 |

```bash
patina auth status         # 后端可用性 + 认证状态
patina auth login          # 各后端登录指引
patina --list-providers    # 预设服务商 + 密钥设置状态
```

未设置 `PATINA_API_KEY` 且 `codex` 已登录时，patina 自动回退到 `codex-cli`。

> `codex-cli` v1 仅支持单模式改写。`--audit`、`--score`、`--diff`、`--ouroboros`、`--models`/MAX 仍走 HTTP 后端。

默认环境变量：

```bash
PATINA_API_KEY=...                            # HTTP 后端必需
PATINA_API_BASE=https://api.openai.com/v1     # 或代理
PATINA_MODEL=gpt-4o                           # 默认模型
```

---

## 工作原理

```
输入文本
  │
  ▼
[步骤 4.5]   语义锚点提取
             (核心主张、极性、因果、数值)
  │
  ▼
[步骤 4.6]   文体统计预处理
             (burstiness CV + MATTR)
  │
  ▼
[步骤 4.7]   AI 词汇重叠
             (扁平词典：英 ~108 / 韩 102 项)
  │
  ▼
[阶段 1]     结构扫描
             (段落级：重复、被动语态)
  │
  ▼
[步骤 5a-v]  锚点验证
  │
  ▼
[阶段 2]     句子改写
             (词汇级：AI 词汇、填充、含糊)
  │
  ▼
[步骤 5b-v]  锚点验证
  │
  ▼
[阶段 3]     自审
             (极性扫描、回归检查、最终 MPS)
  │
  ▼
自然的文本（语义已验证）
```

模式包按语言前缀（`{lang}-*.md`）自动发现。语义锚点在改写前提取，每个阶段后验证 — 若语义遭到破坏，相关修改会被重试或回滚。

---

## 校准

通过 `.omc/research/v3_7_lexicon_eval.py` 在 400 段语料（HC3 + Wikipedia + NamuWiki + paired ko/AI）上可复现：

| 来源 | Hot rate | 备注 |
|------|----------|------|
| HC3 ChatGPT (en) | **76%** | AI 检出率 |
| HC3 human (en) | 19% | 真实人类写作的误检 |
| Wikipedia (en) | 25% | 百科风格句长均匀 — 本质局限 |
| NamuWiki (ko) | 13% | 韩文人类写作的误检 |
| ko/AI corpus | **91%** | 系统中最强信号 *(post-v3.8.0)* |

接受门槛：AI 检出 ≥ 75% · 最大 FP ≤ 25% · NamuWiki 回归 ≤ +5pp。全部达成。

> 文体统计与词汇信号是给 LLM 的**建议性标记**，不是单独决策门槛。Wikipedia 25% FP 是百科风格的本质，无法靠调参消除。详见 `core/stylometry.md` §13、§16。

---

## 模式

四种语言共享相同的 6 大类结构。大多数模式是通用的，仅少数槽位有语言特定实现。模式 #30（修辞性疑问句段首）和 #31（结论信号词）覆盖全部 4 种语言。模式 #32（比较副词滥用 — KO `보다`、JA `より`）仅韩文/日文专属。

### 通用类别

<details>
<summary><b>内容</b> — 6 个模式（#1–#6）</summary>

| # | 模式 | AI 的典型做法 | 修正方案 |
|---|------|--------------|----------|
| 1 | 重要性夸大 | "开创性的里程碑" | 替换为具体事实、日期、数据 |
| 2 | 媒体/知名度夸大 | "被《纽约时报》、BBC 等报道" | 引用一篇具体的报道 |
| 3 | 表面化的动词链分析 | "展现着、象征着、推动着" 连用 | 删除填充词或添加真实来源 |
| 4 | 推销性语言 | "令人惊叹、世界级、隐藏瑰宝" | 中性描述加具体事实 |
| 5 | 模糊归因 | "专家表示……研究表明" | 给出具体来源 |
| 6 | 套路化的挑战与展望 | "尽管面临挑战……前景一片光明" | 指出具体问题和实际方案 |

</details>

<details>
<summary><b>沟通</b> — 4 个模式（#19–#21, #29）</summary>

| # | 模式 | AI 的典型做法 | 修正方案 |
|---|------|--------------|----------|
| 19 | 聊天机器人用语 | "希望对你有帮助！有问题随时问" | 直接删除 |
| 20 | 训练截止声明 | "具体信息有限" | 查找来源或删除 |
| 21 | 谄媚语气 | "好问题！说得太对了" | 直接回答 |
| 29 | 虚假细化 | "其实这个问题更复杂……" | 补充真实依据或删除 |

</details>

<details>
<summary><b>填充与含糊</b> — 3 个模式（#22–#24）</summary>

| # | 模式 | AI 的典型做法 | 修正方案 |
|---|------|--------------|----------|
| 22 | 填充短语 | 不必要的凑字词 | 简洁的等价表达 |
| 23 | 过度含糊 | 过分限定的陈述 | 直接陈述 |
| 24 | 空洞的正面结语 | "未来一片光明" | 具体计划或事实 |

</details>

### 语言特定槽位

<details>
<summary><b>语言</b>（#7–#12）— 语法与词汇</summary>

| # | 韩文 | 英文 | 中文 | 日文 |
|---|------|------|------|------|
| 7 | AI 填充词滥用 | AI 词汇（delve、tapestry） | AI 流行词（赋能/助力/深耕） | AI 流行词滥用 |
| 8 | -적 后缀滥用 | 系动词回避（"serves as"） | 成语堆砌（四字格） | -的（teki）后缀滥用 |
| 9 | 否定式排比 | 否定式排比 | 的/地/得过度规范化 | 否定式排比 |
| 10 | 三连排列 | 三连排列 | 排比句滥用 | 三连排列 |
| 11 | 同义词轮换 | 同义词轮换 | 同义词轮换 | 同义词轮换 |
| 12 | 冗长助词 | 虚假范围（"from X to Y"） | 冗长介词框架 | 片假名外来词滥用 |

</details>

<details>
<summary><b>风格</b>（#13–#18）— 格式与文体</summary>

| # | 韩文 | 英文 | 中文 | 日文 |
|---|------|------|------|------|
| 13 | 过多连接词 | 破折号滥用 | 过多连接词 | 过多连接词 |
| 14 | 粗体滥用 | 粗体滥用 | 粗体滥用 | 粗体滥用 |
| 15 | 行内标题列表 | 行内标题列表 | 行内标题列表 | 行内标题列表 |
| 16 | 进行时态滥用 | 标题大写 | 地字状语滥用（积极地/深入地） | 敬语过度使用（ございます） |
| 17 | 表情符号 | 表情符号 | 表情符号 | 表情符号 |
| 18 | 过度正式语言 | 弯引号 | 公文体（官僚语体） | 生硬的である体 |

</details>

<details>
<summary><b>结构</b>（#25–#28）— 文档级</summary>

| # | 韩文 | 英文 | 中文 | 日文 |
|---|------|------|------|------|
| 25 | 结构重复 | 节拍器式段落 | 结构重复 | 结构重复 |
| 26 | 翻译腔 | 被动名词化链 | 翻译腔/欧化语法 | 翻译腔 |
| 27 | 被动语态滥用 | 僵尸名词 | 被字句滥用 | ている 进行时滥用 |
| 28 | 不必要的外来词 | 从句嵌套过深 | 总分总结构滥用 | 起承转结套路滥用 |

</details>

### 通用扩展（v3.4.0+）

| # | 全部语言 |
|---|---------|
| 30 | 修辞性疑问句段首（"Have you ever wondered…?"、"那么…呢？"） |
| 31 | 结论信号词（"In conclusion"、"결론적으로"、"总而言之"、"結論として"） |
| 32 | 比较副词滥用 — 仅韩文 `보다` / 日文 `より` |

---

## 配置

```yaml
# .patina.default.yaml
version: "3.8.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # 例如 [ko-filler] 跳过某个模式包
blocklist: []             # 额外标记的词语
allowlist: []             # 永不标记的词语
max-models: [claude, gemini]
dispatch: omc             # omc | direct
```

模式包按语言前缀自动发现 — 无需手动列出。

---

## 配置文件（Profiles）

| 配置文件 | 语气风格 | 适用场景 |
|---------|----------|---------|
| `default` | 保持原文语气 | 通用 |
| `blog` | 更个人化、有观点 | 博客文章、随笔 |
| `academic` | 正式、注重证据 | 学术论文、毕业论文 |
| `technical` | 清晰、精准、无主观意见 | API 文档、README、指南 |
| `social` | 随性、简短、可用 emoji | Twitter/X、Instagram、帖子 |
| `email` | 礼貌但简洁 | 商务邮件、正式信函 |
| `legal` | 保留法律文书惯例 | 合同、法律意见书 |
| `medical` | 保留医学精确性 | 临床报告、医学论文 |
| `marketing` | 有说服力、具体 | 广告文案、产品页面、新闻稿 |
| `formal` | 专业、简洁 | 简历、求职信、提案 |

```bash
patina --profile blog text...
```

---

## 自定义模式

将 `.md` 文件放入 `custom/patterns/` 即可自动加载：

```markdown
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 1
---

### 1. 模式名
**问题：** AI 做错的事
**Before：** > AI 风格示例
**After：** > 自然修正
```

---

## 项目结构

```
patina/
├── SKILL.md                  # /patina 入口
├── SKILL-MAX.md              # MAX 模式参考文档
├── patina-max/               # /patina-max 技能（可安装）
│   └── SKILL.md
├── .patina.default.yaml      # 配置
├── core/
│   ├── voice.md              # 语气与个性指南
│   ├── scoring.md            # 评分算法参考
│   └── stylometry.md         # 文体统计算法参考
├── lexicon/
│   ├── ai-en.md              # 英文 AI 词典（108 项）
│   └── ai-ko.md              # 韩文 AI 词典（102 项）
├── patterns/
│   ├── ko-*.md               # 韩文（6 个包，32 个模式）
│   ├── en-*.md               # 英文（6 个包，31 个模式）
│   ├── zh-*.md               # 中文（6 个包，31 个模式）
│   └── ja-*.md               # 日文（6 个包，32 个模式）
├── profiles/                 # 语气预设
├── examples/                 # 改写前后的测试用例
└── custom/                   # 用户扩展（已 gitignore）
```

灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 的插件架构：模式是插件，配置文件是主题。

---

## 添加新语言

1. 创建 `patterns/{lang}-content.md`、`{lang}-language.md` 等文件。
2. 在每个文件的 frontmatter 中设置 `language: {lang}`。
3. 使用 `/patina --lang {lang}` — 自动发现，无需修改配置。

---

## 参考资料

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — 模式的主要来源
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) — 社区行动
- [blader/humanizer](https://github.com/blader/humanizer) — 英文原版

## 贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。模式提交和**陈旧报告**（"这个信号不再是 AI 特征了"）是最有价值的贡献 — AI 写作模式会随着模型微调而变化。

[提交 issue →](https://github.com/devswha/patina/issues)

---

## 版本历史

| 版本 | 主要变更 |
|------|---------|
| **3.8.0** | 韩文 lexicon 再策展（NamuWiki vs Claude 生成 KO 的差分频率挖掘）。韩文 AI 检出：83% → **91%**（+8pp）。误检回归 0pp。 |
| **3.7.0** | AI 词汇重叠信号（4.7 步骤）。英 108 + 韩 90 项。Hot 规则扩展为 3-signal OR。HC3 ChatGPT AI 检出：66% → **76%** — v3.5.1 以来首次突破 Pareto 墙。 |
| **3.5.1** | 文体统计校准补丁 — burstiness 阈值 0.25 → 0.30。AI 检出 57% → 66%。 |
| **3.5.0** | 文体统计疑似区间检测（4.6 步骤）— burstiness CV + MATTR。v1 = ko + en。 |
| **3.4.0** | codex-cli 后端（无需 API 密钥）、`patina auth` 子命令、免费层服务商快捷方式。模式 #30、#31 扩展到 4 种语言，KO/JA 增加 #32。新增 CI 工作流。 |
| **3.3.0** | 语义保留系统（MPS）。 |
| **3.2.0** | Ouroboros 评分 + 迭代自我优化循环。 |
| **3.1.x** | MAX 模式可靠性，多 CLI 调度（claude / codex / gemini）。 |
| **3.0.0** | 多语言框架，`--lang` 参数，blader/humanizer 来源的英文模式，技能更名为 `patina`。 |
| **2.x** | 插件架构，blog 配置文件，结构模式，外来词模式（#28）。 |
| **1.0.0** | 初版韩语适配（24 个模式）。 |

<details>
<summary><b>详细发布说明</b></summary>

#### 3.8.0 — 数据驱动的韩文 lexicon 挖掘

v3.7.0 的韩文 lexicon 由作者直觉策展，对 AI 检出仅贡献 +1pp（对比英文 +10pp）。v3.8.0 通过与 NamuWiki 人文散文的差分频率挖掘语料库，发现 12 个 AI 高频但人类极少使用的 register marker。

挖掘规则（`.omc/research/v3_8_ko_lexicon_mine.py`）：
- 어절 doc-frequency：AI count ≥ 4 AND 比率 AI / (human + 1) ≥ 4.0
- 排除领域工件（专有名词、年份 token）
- 仅保留 register marker（被动评价动词、百科式动词、数量表达支架）

新增项：
- Strict（8 个）：`평가된다`、`꼽힌다`、`가리킨다`、`사례로`、`다수의`、`알려져`、`일컬어진다`、`평가받다`
- Phrase（4 个）：`가운데 하나로`、`자리 잡았다`、`알려져 있다`、`~의 사례로`

500 段语料结果：ko/AI catch 83% → **91%**（+8pp）。NamuWiki human FP 维持在 **13%** — 回归 0pp，清晰的 Pareto 改进。

#### 3.7.0 — AI 词汇重叠信号

扁平词典（`lexicon/ai-en.md` 108 项，`lexicon/ai-ko.md` 90 项）匹配 28-模式目录未明确列出的 AI 偏好短语。按每 1,000 词元密度计算，将 4.6 步骤 hot 规则扩展为 3-signal OR（burstiness OR MATTR OR lexicon_density > 2.0）。

400 段语料校准：AI 检出 66% → **76%**，HC3 human FP 12%→19%，Wikipedia FP 23%→**25%** 边界，NamuWiki FP 11%→13%（在 +5pp 护栏内）。所有 acceptance 标准达成 — 首次突破 v3.5.1 Pareto 墙。

Drop list（评估后）：`intersection`、`principles`、`mindset`、`iterative`、`responsible`、`methodologies`、`redefine`、`accessible`、`equitable`、`one of the most`、`in conjunction with`、`the power of` — 学术散文的发火率高于 AI 文本。

跳过 v3.6（n-gram drop，§15 negative finding）。

#### 3.5.1 — 文体统计校准补丁

300 段外部验证后，将 `stylometry.burstiness.bands.low` 从 0.25 上调至 0.30。v3.5.0 仅检测到实际 AI 文本的 57% — v3.5.1 达成 66% 检测率 + HC3 human FP 12% + Wikipedia FP 23%。

阈值扫描结果：不存在同时满足 AI ≥70% 且 max FP ≤20% 的阈值组合 — Wikipedia 百科风格自然句长一致。MATTR 阈值保持 0.55。坦诚定位：v3.5.x 是给 LLM 的建议性标记，不是单独决策门槛。

</details>

---

## 许可证

MIT
