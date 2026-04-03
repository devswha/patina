**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)
[![Based on](https://img.shields.io/badge/Based%20on-blader%2Fhumanizer-blue)](https://github.com/blader/humanizer)
[![Multi-language](https://img.shields.io/badge/Languages-Korean%20%7C%20English%20%7C%20Chinese%20%7C%20Japanese-green)](https://github.com/devswha/patina)

**让 AI 生成的文字读起来像人写的。**

一个 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 技能，用于检测和消除中文、韩文、英文及日文文本中的 AI 写作痕迹。它能发现那些典型的 AI 特征——"赋能"、"助力"、排比句堆砌、空洞的总结——并将其改写成自然流畅的文字。

> "大语言模型使用统计算法来预测下一个词。其结果倾向于产出适用范围最广的、统计概率最高的内容。" — [维基百科](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

## 效果展示

**修改前**（AI风格）：
> 咖啡已成为**深刻改变**全球社交互动的**核心文化现象**。这种备受喜爱的饮品充当了社区建设的催化剂，促进了有意义的联结，并推动了跨文化对话。从巴黎繁华的咖啡馆到东京宁静的茶室，这一**非凡旅程**展示了人类饮食文化探索的**创新精神**。

**修改后**（`/patina --lang zh` 处理——同样内容，更少AI感）：
> 咖啡在不知不觉中改变了人们见面的方式。和人坐下来聊久了，关系自然就有了，哪怕文化背景完全不同也能聊到一起。巴黎的咖啡馆和东京从茶室改过来的店里，发生的事情其实差不多。一颗豆子烤一烤，就这样变成了全世界共享的社交文化。

锚点验证（MPS = 100）：全球社交变革 ✓、社区建设 ✓、有意义的联结 ✓、跨文化对话 ✓、巴黎咖啡馆 ✓、东京茶室 ✓、饮食文化探索 ✓。仅去除AI包装。

共检测 116 个模式，覆盖韩文（29 个）、英文（29 个）、中文（29 个）和日文（29 个）。完整模式列表见[下文](#模式)。

## 安装

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/devswha/patina.git ~/.claude/skills/patina

# 将 MAX 变体暴露为独立的 Claude 技能
ln -snf ~/.claude/skills/patina/patina-max ~/.claude/skills/patina-max
```

Claude Code 会自动识别 `/patina`。如果还需要使用 `/patina-max`，请同时执行上面的符号链接步骤。

### 快速安装

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

一键完成：创建技能目录、克隆仓库、设置 patina-max 符号链接。已安装的情况下再次运行即可更新到最新版本。

## 使用方法

在 Claude Code 中输入：

```
/patina --lang zh

[在此粘贴你的文本]
```

使用 `--lang` 选择语言：

| 参数 | 语言 |
|------|------|
| `--lang ko` | 韩文 |
| `--lang en` | 英文 |
| `--lang zh` | 中文 |
| `--lang ja` | 日文 |

默认语言在 `.patina.default.yaml` 中设置（默认值：`ko`）。可在配置文件中修改，或每次运行时用 `--lang` 覆盖。

### 更多选项

| 参数 | 功能 |
|------|------|
| `--batch docs/*.md` | 批量处理多个文件 |
| `--in-place` | 覆盖原文件（与 `--batch` 配合使用） |
| `--suffix .humanized` | 另存为 `{file}.humanized.md` |
| `--outdir output/` | 将结果保存到指定目录 |
| `--profile blog` | 使用博客/随笔写作风格 |
| `--profile formal` | 使用正式文档风格（简历、提案等） |
| `--diff` | 逐个模式展示改动内容及原因 |
| `--audit` | 仅检测 AI 模式（不改写） |
| `--score` | 获取 0-100 的 AI 相似度评分 |
| `--ouroboros` | 迭代自我优化：反复改写直到 AI 评分收敛 |

参数可自由组合：`/patina --lang en --audit --profile blog` 或 `/patina --profile formal`

### MAX 模式（多模型）

将同一段文本交给多个 AI 模型分别处理，然后选出最佳结果：

```
/patina-max

[在此粘贴你的文本]
```

每个模型独立进行人性化改写，结果同时按 AI 相似度和语义保留度（MPS）评分，得分最低（最像人写的）且通过 MPS 门槛（≥ 70）的胜出。

| 参数 | 功能 |
|------|------|
| `--models claude,gemini` | 选择使用的模型 |
| `--lang en` | 处理英文文本 |
| `--profile blog` | 使用博客/随笔写作风格 |

支持的模型：`claude`、`codex`、`gemini`。MAX 模式通过 stdin 调用三个模型（`claude -p`、`gemini -p '' --output-format text`、`codex exec --skip-git-repo-check`），并通过 `--output-last-message` 捕获 Codex 的最终输出。

每次 MAX 运行使用独立的临时目录，仅等待所选模型完成，超时的运行标记为失败而非无限等待。

### 评分模式

在不改写的情况下检查文本的 AI 痕迹程度：

```
/patina --score

[在此粘贴你的文本]
```

返回 0-100 的 AI 相似度评分，并按类别细分：

```
| 类别          | 权重   | 检出数 | 原始得分 | 加权得分 |
|---------------|--------|--------|----------|----------|
| 内容          | 0.20   | 3/6    | 33.3     | 6.7      |
| 语言          | 0.20   | 1/6    | 11.1     | 2.2      |
| 风格          | 0.20   | 2/6    | 27.8     | 5.6      |
| 沟通          | 0.15   | 0/3    | 0.0      | 0.0      |
| 填充          | 0.10   | 1/3    | 11.1     | 1.1      |
| 结构          | 0.15   | 1/4    | 25.0     | 3.8      |
| 综合          |        |        |          | 19.3 (±10) |

解读：16-30 = 基本像人写的，有轻微痕迹
```

分值范围：**0-15** 人写 | **16-30** 基本像人写 | **31-50** 混合 | **51-70** AI 味明显 | **71-100** 严重 AI 痕迹

与改写或 ouroboros 模式配合使用时，还会显示**保真度评分**（0-100，越高越好），衡量输出对原文语义的保留程度：

```
| 指标              | 分数    |
|-------------------|---------|
| AI相似度          | 23/100  |
| 忠实度            | 87/100  |
| 语义保留 (MPS)    | 92/100  |
| 综合              | 19/100  |
```

忠实度检查四项标准：观点保留、无捏造内容、语气匹配、篇幅比例。MPS（语义保留分数）追踪改写流水线中具体语义锚点——主张、极性、因果关系、数值——是否得以保留。综合得分同时权衡两个维度——可按配置文件调整（例如：学术型：忠实度 0.60，AI 0.40；博客型：AI 0.70，忠实度 0.30）。

评分基于模式匹配，结果确定——复用审计模式中的 29 个（韩文）、29 个（英文）、29 个（中文）或 29 个（日文）检测模式。配置文件覆盖会影响评分（例如：博客配置文件会屏蔽粗体模式 #14）。

### Ouroboros 模式（迭代自我优化）

自动反复改写，直到 AI 评分降至目标以下：

```
/patina --ouroboros

[在此粘贴你的文本]
```

Ouroboros 循环反复执行完整的人性化流水线，每次迭代后评分：

```
Ouroboros 迭代日志

| 迭代 | 改写前 | 改写后 | 改善幅度 | 原因        |
|------|--------|--------|----------|-------------|
| 0    | —      | 78     | —        | 初始        |
| 1    | 78     | 45     | +33      |             |
| 2    | 45     | 28     | +17      | 达到目标    |

最终得分：28/100 (±10)
迭代次数：2/3
终止原因：达到目标（目标值：30）

[最终人性化文本]
```

**终止条件**（以先满足者为准）：
- **达到目标**：评分降至 ≤ 30（可配置）
- **平台期**：两次迭代间改善不足 10 分
- **退化**：评分反而升高（文本变差）——回退到上一次迭代
- **最大迭代次数**：硬性上限 3 次（可配置）
- **忠实度下限**：忠实度低于 70——回退到上一次迭代
- **MPS下限**：MPS（语义保留度）低于 70——回退到上一次迭代

**配置** — 在 `.patina.yaml` 中自定义：

```yaml
ouroboros:
  target-score: 30          # 评分 <= 此值时停止 (0-100)
  max-iterations: 3         # 最大迭代次数
  plateau-threshold: 10     # 所需最小改善幅度
  fidelity-floor: 70        # 忠实度低于此值时停止
  mps-floor: 70             # 语义保留度低于此值时停止
```

`--ouroboros` 不能与 `--diff`、`--audit` 或 `--score` 组合使用。

## 工作原理

```
输入文本
  |
  v
[步骤4.5] 语义锚点提取 -- 提取核心主张、极性、因果关系、数值
  |
  v
[阶段1] 结构扫描 -- 修复段落级问题（重复、被动语态）
  |
  v
[步骤5a-v] 锚点验证 -- 阶段1后检查语义保留
  |
  v
[阶段2] 句子改写 -- 修复词汇级问题（AI词汇、填充词、模糊表达）
  |
  v
[步骤5b-v] 锚点验证 -- 阶段2后检查语义保留
  |
  v
[阶段3] 自审 -- 极性扫描、回归检查、最终MPS计算
  |
  v
自然的文本（语义已验证）
```

该技能加载对应语言的模式包（`ko-*.md`、`en-*.md`、`zh-*.md` 或 `ja-*.md`），通过这条流水线进行处理。语义锚点（核心主张、极性、数值）在改写前提取，并在每个阶段后进行验证——若语义遭到破坏，相关修改会被重试或回滚。配置文件和语气指南决定最终的文风。

## <a name="模式"></a>模式

四种语言共享相同的 6 大类结构，每种语言各有 29 个模式（共 116 个）。各类别及大多数模式是通用的——只有少数槽位有语言特定的实现。

### 共享模式类别

<details>
<summary><b>内容模式</b> — 6 个模式，针对内容实质问题</summary>

以下模式在四种语言中完全相同：

| # | 模式 | AI 的典型做法 | 修正方案 |
|---|------|--------------|----------|
| 1 | 重要性夸大 | "开创性的里程碑"、"关键转折点" | 替换为具体事实、日期、数据 |
| 2 | 媒体/知名度夸大 | "被《纽约时报》、BBC 等报道" | 引用一篇具体的报道 |
| 3 | 表面化的动词链分析 | "展现着、象征着、推动着" 连用 | 删除填充词或添加真实来源 |
| 4 | 推销性语言 | "令人惊叹、世界级、隐藏瑰宝" | 中性描述加具体事实 |
| 5 | 模糊归因 | "专家表示……研究表明" | 给出具体来源 |
| 6 | 套路化的挑战与展望 | "尽管面临挑战……前景一片光明" | 指出具体问题和实际方案 |

</details>

<details>
<summary><b>沟通模式</b> — 4 个模式，针对聊天机器人痕迹</summary>

以下模式在四种语言中完全相同：

| # | 模式 | AI 的典型做法 | 修正方案 |
|---|------|--------------|----------|
| 19 | 聊天机器人用语 | "希望对你有帮助！有问题随时问" | 直接删除 |
| 20 | 训练截止声明 | "具体信息有限" | 查找来源或删除 |
| 21 | 谄媚语气 | "好问题！说得太对了" | 直接回答 |
| 29 | 虚假细化 | "其实这个问题更复杂……" | 补充真实依据或删除 |

</details>

<details>
<summary><b>填充与含糊模式</b> — 3 个模式，针对水分内容</summary>

以下模式在四种语言中完全相同：

| # | 模式 | AI 的典型做法 | 修正方案 |
|---|------|--------------|----------|
| 22 | 填充短语 | 不必要的凑字词 | 简洁的等价表达 |
| 23 | 过度含糊 | 过分限定的陈述 | 直接陈述 |
| 24 | 空洞的正面结语 | "未来一片光明" | 具体计划或事实 |

</details>

### 语言特定模式

部分模式槽位在各语言中有不同实现，针对每种语言特有的 AI 写作特征：

<details>
<summary><b>语言模式</b>（#7–#12）— 语法与词汇</summary>

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
<summary><b>风格模式</b>（#13–#18）— 格式与文体</summary>

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
<summary><b>结构模式</b>（#25–#29）— 文档级问题</summary>

| # | 韩文 | 英文 | 中文 | 日文 |
|---|------|------|------|------|
| 25 | 结构重复 | 节拍器式段落结构 | 结构重复 | 结构重复 |
| 26 | 翻译腔 | 被动名词化链 | 翻译腔/欧化语法 | 翻译腔 |
| 27 | 被动语态滥用 | 僵尸名词 | 被字句滥用 | ている 进行时滥用 |
| 28 | 不必要的外来词 | 从句嵌套过深 | 总分总结构滥用 | 起承转结套路滥用 |
| 29 | 虚假细化 | False Nuance | 虚假细化 | 偽りのニュアンス |

</details>

## 配置

编辑 `.patina.default.yaml`：

```yaml
version: "3.3.0"
language: ko              # ko | en | zh | ja（或使用 --lang 参数）
profile: default
output: rewrite           # rewrite | diff | audit | score
skip-patterns: []         # 例如 [ko-filler] 跳过某个模式包
blocklist: []             # 额外标记的词语
allowlist: []             # 永不标记的词语
max-models:             # MAX 模式使用的模型（claude, codex, gemini）
  - claude
  - gemini
dispatch: omc             # omc | direct
```

模式包按语言前缀自动发现——无需手动列出。

## 配置文件（Profiles）

| 配置文件 | 语气风格 | 适用场景 |
|----------|----------|----------|
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

```
/patina --profile blog text...
/patina --profile academic text...
/patina --profile technical text...
/patina --profile formal text...
```

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

### 1. Pattern Name
**Problem:** What AI does wrong
**Before:** > AI-sounding example
**After:** > Natural-sounding fix
```

## 项目结构

```
patina/
├── SKILL.md                  # /patina 入口
├── SKILL-MAX.md              # MAX 模式源文件/参考文档
├── patina-max/               # 可安装的 /patina-max 技能目录
│   ├── SKILL.md              # MAX 模式入口
│   ├── core -> ../core
│   ├── patterns -> ../patterns
│   └── profiles -> ../profiles
├── .patina.default.yaml      # 配置文件
├── core/voice.md             # 语气与个性指南
├── core/scoring.md           # 评分算法（AI相似度 + 忠实度 + MPS）
├── patterns/
│   ├── ko-*.md               # 韩文模式（6 个包，29 个模式）
│   ├── en-*.md               # 英文模式（6 个包，29 个模式）
│   ├── zh-*.md               # 中文模式（6 个包，29 个模式）
│   └── ja-*.md               # 日文模式（6 个包，29 个模式）
├── profiles/                 # 写作风格配置文件
├── examples/                 # 改写前后的测试用例
└── custom/                   # 你的扩展（已 gitignore）
```

灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 的插件架构：模式是插件，配置文件是主题。

## 添加新语言

1. 创建 `patterns/{lang}-content.md`、`{lang}-language.md` 等文件
2. 在每个文件的 frontmatter 中设置 `language: {lang}`
3. 使用 `/patina --lang {lang}` 即可——自动发现，无需修改配置

## 参考资料

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) -- 模式的主要来源
- [WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) -- 社区行动
- [blader/humanizer](https://github.com/blader/humanizer) -- 英文原版

## 版本历史

| 版本 | 变更内容 |
|------|----------|
| **3.3.0** | 语义保留系统（MPS）：确保人性化后的文本保持原文的意图和主张 |
| **3.2.0** | Ouroboros 评分系统：基于模式的 AI 相似度评分（0-100）、`--score` 模式含类别细分、`--ouroboros` 迭代自我优化循环，支持可配置的终止条件（目标值/平台期/退化/最大迭代次数） |
| **3.1.1** | MAX 模式可靠性修复：独立运行临时目录、模型级等待循环 + 超时处理、Gemini stdin 分发、Codex CLI 兼容性（`--output-last-message`，移除 `-q`） |
| **3.1.0** | MAX 模式：可安装的 `/patina-max` 技能入口 + 按提供商分发（Claude/Gemini 使用 `claude -p` / `gemini -p`，Codex 使用 `codex exec`） |
| **3.0.0** | 多语言框架、`--lang` 参数、英文模式（24 个）来自 blader/humanizer、技能更名为 `patina` |
| **2.2.0** | 外来词滥用模式（#28）、徽章、仓库更名 |
| **2.1.0** | 2 阶段流水线、结构模式、博客配置文件、示例 |
| **2.0.0** | 插件架构：模式包、配置文件、配置 |
| **1.0.0** | 初版韩语适配（24 个模式） |

## 许可证

MIT
