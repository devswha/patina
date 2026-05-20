**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#快速开始)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.11.0-blue)](CHANGELOG.md)

> **只剥掉 AI 包装，保留原意。**

patina 会在中文、韩文、英文和日文里找出 AI 味比较重的写作模式，并在不改动原意的前提下重写。它可以作为 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex)、[Cursor](https://cursor.sh)、OpenCode 的技能使用，也可以作为独立的 Node.js CLI 运行。

它不是黑盒改写器。patina **基于模式且可审计**：会说明改了什么、为什么改，以及原文的主张是否保留下来。

## 效果展示

**修改前** *(AI 风格)*：
> 咖啡已成为**深刻改变**全球社交互动的**核心文化现象**。这种备受喜爱的饮品充当了社区建设的催化剂，促进了有意义的联结，并推动了跨文化对话。

**修改后** *(`/patina --lang zh` 处理 — 同样内容，仅去除 AI 包装)*：
> 咖啡在不知不觉中改变了人们见面的方式。和人坐下来聊久了，关系自然就有了，哪怕文化背景完全不同也能聊到一起。

> **MPS = 100** · 社交变革 ✓ · 社区建设 ✓ · 有意义的联结 ✓ · 跨文化对话 ✓

## 一览

|  |  |
|---|---|
| **146 个模式** | 韩文 37 + 英文 36 + 中文 36 + 日文 37 (各含5个仅评分的 viral-hook) — [PATTERNS.md](docs/PATTERNS.md) |
| **编辑热点召回率** | 韩文 91% [84.0–95.4%] (n=100) / 英文 76% [66.7–83.3%] (n=100), binomial 95% CI |
| **误检率** | 人类文本不同体裁 13–25% 点估计范围 *(不是 CI；百科风格本质局限，[已记录](core/stylometry.md))* |
| **模式** | rewrite · audit · score · diff · ouroboros |
| **免费层** | 支持 — 通过 `codex` CLI（无需 API 密钥） |
| **确定性** | 评分公式是确定性的；LLM 严重度判定阶段 ±8–10pt 波动（[scoring.md §8](core/scoring.md)） |
| **许可证** | MIT |

## 快速开始

### 作为 Claude Code 或 Codex CLI 技能

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

安装脚本会把 patina 一次性接入 Claude Code、[Codex CLI](https://github.com/openai/codex)、Cursor、OpenCode。它会在 checkout 前把 repository HEAD 解析到具体 commit；如果需要完全固定安装，请设置 `PATINA_REF=<tag-or-full-sha>`。然后：

```
/patina --lang zh

[在此粘贴你的文本]
```

以特定语调改写：

```
/patina --tone narrative

[在此粘贴你的随笔草稿]
```

自动检测最适合的语调：

```
/patina --tone auto --lang en

[在此粘贴你的文本]
```

> 注意：`--tone`（含 `auto`）在 v1 仅对 ko/en 生效。zh/ja 使用任何语调均会触发警告并回退到 profile-only 模式。

### 作为独立 CLI

需要 Node.js ≥ 18。

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang zh input.txt
```

也可以 link 后通过 stdin 试用：

```bash
printf '%s\n' '咖啡已成为一种关键文化现象，从根本上改变了全球各地的社会互动。' \
  | patina --lang zh --backend codex-cli
```

> 🆓 **无需 API 密钥** — 只要 [`codex`](https://github.com/openai/codex)、[`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`gemini`](https://github.com/google-gemini/gemini-cli) 任一 CLI 已登录即可。可通过 `--backend codex-cli | claude-cli | gemini-cli` 直接选择，或用 `--model claude-*` / `--model gemini-*` 按模型名路由。完整后端列表见 [AUTHENTICATION.md](docs/AUTHENTICATION.md)。

### CI integrations

Patina 提供不需要 live model key 的确定性 CI prose review：

```yaml
# .github/workflows/patina.yml
steps:
  - uses: actions/checkout@v6
  - uses: devswha/patina-action@main # npm 发布并打 Action 标签后改用 @v1
    with:
      patina-package: github:devswha/patina # patina-cli@latest 发布到 npm 后删除
      report-threshold: 30
      comment: true
```

Pre-commit、Husky、Lefthook、Docker 和 release workflow 说明见 [docs/integrations/](docs/integrations/)。

## 预期用途

Patina 适合在作者可以使用 AI 辅助时，用来做 AI 后编辑、保留审计轨迹和清理 voice。它不承诺文本“原本由人类写成”，也不应被用于规避学术 honor-code、绕过出版方 disclosure、洗白抄袭，或声称 detector-bypass。见 [ETHICS.md](docs/ETHICS.md)。

## 模式

```
patina --lang <ko|en|zh|ja> [模式] [--profile <名称>] input.txt
```

| 参数 | 功能 |
|------|------|
| *(默认)* | 改写 |
| `--audit` | 仅检测 AI 模式 |
| `--score` | 0–100 AI 相似度评分 + 类别细分 |
| `--score --exit-on <n>` | 保持 CI 严格：当 `overall > n` 时以退出码 `3` 结束（`--gate` 保留为 alias） |
| `--diff` | 按模式逐项展示改动 |
| `--ouroboros` | 反复改写直到分数收敛（含 MPS 回滚） |
| `--lang <ko\|en\|zh\|ja>` | 选择语言（默认：`ko`） |
| `--profile <名称>` | 语气预设：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation` |
| `--tone <名称>` | 语调类别：`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 把位置参数当作文件列表（例：`--batch docs/*.md`） |
| `--format json\|text\|markdown` | 选择 JSON、纯文本或默认 Markdown 输出 |
| `--prompt-mode strict\|minimal\|auto` | 选择完整模式包提示、压缩提示，或按后端自动选择 |
| `--variants <1-5>` | 生成多个改写变体，同时保留相同事实和意义锚点 |

完整选项请运行 `patina --help`。

### 仅评分模式

`--score` 和 `--audit` 测量的信号范围比 `--rewrite` 略广。viral-hook 包（`ko/en/zh/ja-viral-hook`，每种语言 5 个模式：数字震撼钩子、标题党收尾、跳过来源的权威断言、适合呼吸节奏的短句堆叠、夸张互动词汇）为**仅检测**模式。

这些信号只会出现在评分和审计中，用来让基准更贴近用户对四种语言 SNS 营销文案的直觉。`--rewrite`/`--diff`/`--ouroboros` 会跳过它们，因为这些信号往往是有意的修辞。实例: [`examples/viral-hook/`](examples/viral-hook/).

### 提示模式调优 (v3.11)

`--prompt-mode strict|minimal|auto` 可在完整模式包（约 34KB 结构化提示）和压缩的轻量指令（约 3KB）之间取舍。`auto` 会按后端选择 — Gemini 在 minimal 下表现更好（长结构化提示会让它过度受限），Claude 能利用完整模式包，Codex 大致不敏感。case-05 记录了 A/B 结果。

### 多个风格变体 (v3.11)

`--variants <1-5>` 会在一次调用中请求 N 个改写声音变体（例如 V1 casual、V2 direct、V3 measured）— 事实、数字和因果关系在所有变体中保持一致。每个结果会以 `## Variant N` 返回，方便你选择需要的语气。

### 短文本评分增强 (v3.11)

当输入不超过 200 个字符或不超过 3 个段落时，对 register 敏感的类别（`language`、`style`、`viral-hook`）会获得 1.5 倍 severity multiplier，让单段文本里的声音变化也能体现在分数中。case-04 发现这些信号会被长文本公式低估。

### 自审隔离 (v3.11)

在 rewrite 模式中，模型会把自审笔记放在 `[SELF_AUDIT]`/`[/SELF_AUDIT]` 标签内，并包裹一个 `[BODY]`/`[/BODY]` 块（当 `--variants > 1` 时则是 `[VARIANT n]` 块）。patina 会在展示给用户前移除审计内容，因此原始输出保持干净 — 早期版本有时会把 “남아 있는 AI 티” 或 “Phase 3” 之类的前言泄漏到用户可见文本中。

### Machine-readable output and exit codes

`--format json` 会把所有模式包进稳定 envelope，包含 `overall`、`categories[]`、`tone`、`mps`、`gateResult` 和清理后的 `output` 正文。`--format markdown` 是默认值；`--format text` 保留无 YAML tone footer 的用户可见正文。退出码见 [EXIT-CODES.md](docs/EXIT-CODES.md)：`0` 成功，`1` runtime/backend，`2` input/usage，`3` score gate 超限，`4` MAX MPS fallback/all-candidates-failed。

### 分数权重漂移检测 (v3.11)

`--score` 运行会把模型输出的 Weight 列与配置中的 `category-weights` 交叉检查。如果模型凭空创造类别（例如 `discord`）或替换成不同数字，stderr 会出现 `[patina]` 警告 — 这只用于可观测性，不会改变分数本身。

## 语调

`--tone` 是叠加在模式改写之上的具名声音轴。优先级：`--tone` CLI > `tone:` 配置 > `profile:` 配置。

| 语调 | 适用 | 主要特征 |
|------|------|----------|
| `casual` | 博客、社交内容、个人笔记 | 缩略、第一人称、表情符号可用、低正式度 |
| `professional` | 工作邮件、报告、商务写作 | 清晰简洁、正式而不僵硬（legal/medical 子档案强制 fidelity 下限） |
| `academic` | 论文、研究综述、技术分析 | 客观、证据导向、第一人称最少 |
| `narrative` | 个人随笔、回忆录、经历叙述 | 第一人称为锚、场景细节、情感在场 |
| `marketing` | 广告文案、落地页、产品公告 | 短促有力、有说服力、CTA 友好 |
| `instructional` | 教程、操作指南、技术文档 | 命令式动词、编号结构、抑制猜测语 |

`--tone auto` 通过启发式（词汇 + 结构信号）自动选择最契合的语调。zh/ja 上使用任何语调（包括 `auto`）均会发出警告并回退到 profile-only 模式 — Phase 4.5b 启发式仅覆盖 ko/en。

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

**校准** *(500 段语料，可通过 `.omc/research/v3_8_remeasure.py` 复现)*：HC3 ChatGPT (en) 编辑热点召回率 76% [66.7–83.3%]，paired ko/AI 语料 91% [84.0–95.4%]（各 n=100，binomial 95% CI）。人类写作误检以不同体裁 13–25% 点估计范围单独报告。接受门槛：AI ≥ 75%，最大 FP ≤ 25%。算法见 [stylometry.md](core/stylometry.md)。

## 配置

```yaml
# .patina.default.yaml
version: "3.11.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
max-models: [claude, gemini]
```

模式包按语言前缀自动发现。工作目录中的 `.patina.yaml` 会覆盖默认值。扩展检测的列表键（`blocklist`、`allowlist`、`skip-patterns`）会在 default/global/project 配置之间追加合并；`max-models` 等 provider 列表会替换原值，便于用户选择精确的后端集合。

## 文档

- **[Glossary](docs/GLOSSARY.md)** — MPS、fidelity、burstiness、MATTR、模式等常见术语的简短定义
- **[Demo](docs/DEMO.md)** — 终端 transcript 与多种体裁的 before/after 快照
- **[Patterns](docs/PATTERNS.md)** — 146 个模式目录
- **[Authentication](docs/AUTHENTICATION.md)** — 后端、服务商、免费层设置
- **[CLI Contract](docs/CLI.md)** — score gate、退出码，以及适合自动化的接口边界
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI、`/patina`、`/patina-max` 的选项支持范围
- **[Ethics](docs/ETHICS.md)** — 预期用途、禁止用途和披露立场
- **[FAQ](docs/FAQ.md)** — detector-bypass 疑虑、MPS、误报、贡献起点
- **[Comparison](docs/COMPARISON.md)** — 与常见 paraphraser/humanizer 工具的事实比较
- **[Branding](docs/BRANDING.md)** — canonical logo/social assets 和 OG 设置说明
- **[Design](DESIGN.md)** — repo-native SVG 与 README surface 的产品/品牌基准
- **[Roadmap](docs/ROADMAP.md)** — 质量、基准、产品、社区和发布优先级
- **[Benchmark Report](docs/benchmarks/latest.md)** — 最新可复现 suspect-zone 基准摘要
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — 用于测量 AI-like writing signals 的基准设计说明
- **[Launch Copy](docs/social/patina-launch-copy.md)** — Show HN、Reddit、X、韩国社区草稿
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 词汇算法
- **[Scoring](core/scoring.md)** — AI 相似度 + 忠实度 + MPS
- **[Changelog](CHANGELOG.md)** — 发布说明和方法论
- **[Contributing](CONTRIBUTING.md)** — 模式提交、误报 triage、基准 fixture、版本管理
- **[Governance](GOVERNANCE.md)** / **[Maintainers](MAINTAINERS.md)** — 轻量级项目决策规则

## 致谢

灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 的插件架构（模式即插件，profile 即主题）、[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer)。

## 许可证

MIT
