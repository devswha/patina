**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#快速开始)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-3.11.0-blue)](CHANGELOG.md)

> **只剥掉 AI 包装，保留原意。**

patina 会在中文、韩文、英文和日文里找出 AI 味比较重的写作模式，并在不改动原意的前提下重写。它可以作为 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex)、[Cursor](https://cursor.sh)、OpenCode 的技能使用，也可以作为独立的 Node.js CLI 运行。

它不是黑盒式改写工具，也不是 AI 检测器规避工具。patina **基于清晰的模式规则且可审计**：会说明改了什么、为什么改，以及原文的主张是否保留下来。只要 `codex`、`claude`、`gemini` 任一 CLI 已登录，就可以不填 API 密钥使用。

## 效果展示

**修改前** *(AI 风格)*：
> 咖啡已成为**深刻改变**全球社交互动的**核心文化现象**。这种备受喜爱的饮品充当了社区建设的催化剂，促进了有意义的联结，并推动了跨文化对话。

**修改后** *(`/patina --lang zh` 处理 — 同样内容，仅去除 AI 包装)*：
> 咖啡在不知不觉中改变了人们见面的方式。和人坐下来聊久了，关系自然就有了，哪怕文化背景完全不同也能聊到一起。

> **MPS = 100** · 社交变革 ✓ · 社区建设 ✓ · 有意义的联结 ✓ · 跨文化对话 ✓

**更多示例片段**

| 输入类型 | 去掉的 AI 包装 | 保留的含义 |
|---|---|---|
| 韩文营销文案 | “혁신적인 솔루션”, “새로운 패러다임” | 30 个 Notion 模板、适配工作流、复制后可自行修改 |
| 学术文本 | “획기적인 성과”, 宽泛的意义宣称 | 60 个 GitHub 项目、72h→10m 设置时间、p<0.01、限制说明 |
| 技术文档 | “핵심적인 역할”, 未来标准式 hype | GPU 管理、一条命令 provisioning、5× 结果 caveat |

## 浏览器直接体验 — 无需安装

**[patina.vibetip.help](https://patina.vibetip.help/)** 可以在浏览器里直接检查 KO / EN / ZH / JA 段落中的 AI 写作模式。

> **仅检测。** playground 只在你的浏览器内运行确定性的文体统计分析。它不会改写文本，不会调用外部 LLM，也不会把 API key 发送到服务器。需要实际 rewrite 时，请使用下面的 CLI 或 skill。

完整 rewrite 流程见 [30 秒终端演示](docs/DEMO.md)。更多例子见 [Before/After Gallery](docs/EXAMPLES.md)（[한국어](docs/EXAMPLES_KR.md)）。
品牌资源：[logo](assets/brand/patina-logo.svg)、[mark](assets/brand/patina-mark.svg)、[icon](assets/brand/patina-icon.svg)、[social preview](assets/social/patina-og.svg)、[before/after card](assets/social/patina-before-after.svg)。使用指南见 [BRANDING.md](docs/BRANDING.md)。

## 一览

|  |  |
|---|---|
| **160 个模式** | 韩文 40 + 英文 40 + 中文 40 + 日文 40 (各含8个仅评分的 viral-hook) — [PATTERNS.md](docs/PATTERNS.md) |
| **编辑热点召回率** | 韩文 91% [84.0–95.4%] (n=100) / 英文 76% [66.7–83.3%] (n=100), binomial 95% CI |
| **基准报告** | 可复现的 ko/en/zh/ja suspect-zone 基准：[latest.md](docs/benchmarks/latest.md) · [latest.json](docs/benchmarks/latest.json) · [detector comparison](docs/benchmarks/detector-comparison.md) |
| **误检率** | 人类文本不同体裁 13–25% 点估计范围 *(不是 CI；百科风格本质局限，[已记录](core/stylometry.md))* |
| **模式** | rewrite · audit · score · diff · ouroboros |
| **免费层** | 支持 — 通过已登录的 `codex`、`claude` 或 `gemini` CLI（无需 API 密钥） |
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

需要 Node.js ≥ 18。npm 包已公开，可以直接运行：

```bash
npx patina-cli init --defaults
npx patina-cli doctor
npx patina-cli --lang zh input.txt
```

如果想直接修改仓库再试：

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang zh input.txt
```

link 后也可以通过 stdin 试用：

```bash
printf '%s\n' '咖啡已成为一种关键文化现象，从根本上改变了全球各地的社会互动。' \
  | patina --lang zh --backend codex-cli
```

> 🆓 **无需 API 密钥** — 只要 [`codex`](https://github.com/openai/codex)、[`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`gemini`](https://github.com/google-gemini/gemini-cli) 任一 CLI 已登录即可。可通过 `--backend codex-cli | claude-cli | gemini-cli` 直接选择，也可以声明显式 fallback 链，如 `--backend claude-cli,codex-cli`，或让模型名启发式自动路由（`--model claude-*` → claude-cli 等）。完整后端列表见 [AUTHENTICATION.md](docs/AUTHENTICATION.md)。

### CI 集成

Patina 提供不需要 live model key 的确定性 CI prose review：

```yaml
# .github/workflows/patina.yml
name: Patina prose score

on:
  pull_request:
    paths:
      - '**/*.md'
      - '**/*.mdx'

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  patina:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: devswha/patina-action@v1
        with:
          score-threshold: 30
          lang: auto
          comment: true
```

Docker 镜像发布与 npm release 路径分开追踪。GHCR 镜像公开前，需要容器时请先构建本地镜像：

```bash
docker build -t patina:local .
printf '%s\n' '咖啡已成为一种关键文化现象。' \
  | docker run --rm -i -e PATINA_API_KEY patina:local --lang zh --provider openai
```

Pre-commit、Husky、Lefthook、Docker 和 release workflow 说明见 [docs/integrations/](docs/integrations/)。

## 正确使用目的

Patina 适合在作者可以使用 AI 辅助起草的场景中，用来编辑草稿、看清改了哪里和为什么改，并让语气读起来更自然。它不保证文本“原本由人类写成”，也不应被用于规避学术 honor-code、绕过出版方 disclosure、洗白抄袭，或声称 detector-bypass。分数只是带有误报和漏报的编辑信号，不是作者身份的证明。见 [ETHICS.md](docs/ETHICS.md)。

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
| `--profile <名称>` | 语气预设：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation`, `code-comment`, `commit-message`, `release-notes`, `namuwiki` |
| `--tone <名称>` | 语调类别：`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 把位置参数当作文件列表（例：`--batch docs/*.md`） |
| `--format json\|text\|markdown` | 选择 JSON、纯文本或默认 Markdown 输出 |
| `--quiet` | 隐藏 stderr 中的状态、警告和进度日志 |
| `--json-logs` | 以 NDJSON 输出 stderr 日志，包含 `level`、`event`、`model`、`latency_ms` 字段 |
| `--prompt-mode strict\|minimal\|auto` | 选择完整模式包提示、压缩提示，或按后端自动选择 |
| `--variants <1-5>` | 生成多个改写变体，同时保留相同事实和意义锚点 |
| `--card <path>` | 写出 1200×630 SVG before/after card，包含 AI 分数和 MPS |

完整选项请运行 `patina --help`。`patina doctor --json` 可在不调用 LLM 的情况下检查 Node/backend/tmux/API-key 状态，`patina init` 会写入项目 `.patina.yaml`。

Markdown-heavy 工程流程可使用开发者原生 profile shortcut：`code-comment` 收紧 inline comments/docstrings，`commit-message` 围绕意图和验证改写 Git 历史文本，`release-notes` 把 changelog bullets 改成面向用户影响的发布说明，并保留迁移风险。`namuwiki` 是仅适用于韩文的 wiki 风格 profile，只包含原创的 license-safe 指南，不复制 NamuWiki 文章文本。

### 仅评分模式

`--score` 和 `--audit` 测量的信号范围比 `--rewrite` 略广。viral-hook 包（`ko/en/zh/ja-viral-hook`，每种语言 8 个模式：数字震撼钩子、标题党收尾、跳过来源的权威断言、适合呼吸节奏的短句堆叠、夸张互动词汇、伪统计引用、头衔堆叠、未来自我承诺）为**仅检测**模式。

这些信号只会出现在评分和审计中，用来让基准更贴近用户对四种语言 SNS 营销文案的直觉。`--rewrite`/`--diff`/`--ouroboros` 会跳过它们，因为这些信号往往是有意的修辞。实例: [`examples/viral-hook/`](examples/viral-hook/).

### 提示模式调优 (v3.11)

`--prompt-mode strict|minimal|auto` 可在完整模式包（约 34KB 结构化提示）和压缩的轻量指令（约 3KB）之间取舍。`auto` 会按后端选择 — Gemini 在 minimal 下表现更好（长结构化提示会让它过度受限），Claude 能利用完整模式包，Codex 大致不敏感。Standalone CLI 的 MAX rewrite worker 默认使用 `minimal`，除非 `--prompt-mode` 或配置覆盖，这样多候选运行默认更轻；在 MAX 中，`auto` 会在 dispatch 前解析一次，而不是对每个候选单独解析。case-05 记录了 A/B 结果。

### 多个风格变体 (v3.11)

`--variants <1-5>` 会在一次调用中请求多个文本语气变体（例如 V1 casual、V2 direct、V3 measured）— 事实、数字和因果关系在所有变体中保持一致。每个结果会以 `## Variant N` 返回，方便你选择需要的语气。

### 短文本评分增强 (v3.11)

当输入不超过 200 个字符或不超过 3 个段落时，对 register 敏感的类别（`language`、`style`、`viral-hook`）会获得 1.5 倍 severity multiplier，让单段文本里的声音变化也能体现在分数中。case-04 发现这些信号会被长文本公式低估。

### 自审隔离 (v3.11)

在 rewrite 模式中，模型会把自审笔记放在 `[SELF_AUDIT]`/`[/SELF_AUDIT]` 标签内，并包裹一个 `[BODY]`/`[/BODY]` 块（当 `--variants > 1` 时则是 `[VARIANT n]` 块）。patina 会在展示给用户前移除审计内容，因此原始输出保持干净 — 早期版本有时会把 “남아 있는 AI 티” 或 “Phase 3” 之类的前言泄漏到用户可见文本中。

### Machine-readable output and exit codes

`--format json` 会把所有模式包进稳定 envelope，包含 `overall`、`categories[]`、`tone`、`mps`、`gateResult` 和清理后的 `output` 正文。`--json-logs` 会让 stderr 也保持 NDJSON 格式，`--quiet` 则为只需要 stdout 的脚本隐藏状态、警告和进度日志。`--format markdown` 是默认值；`--format text` 保留无 YAML tone footer 的用户可见正文。退出码见 [EXIT-CODES.md](docs/EXIT-CODES.md)：`0` 成功，`1` runtime/backend，`2` input/usage，`3` score gate 超限，`4` MAX MPS fallback/all-candidates-failed。

### 分数权重漂移检测 (v3.11)

`--score` 运行会把模型输出的 Weight 列与配置中的 `category-weights` 交叉检查。如果模型凭空创造类别（例如 `discord`）或替换成不同数字，stderr 会出现 `[patina]` 警告 — 这只用于可观测性，权重检查本身不会改变分数。确定性 shadow score 也会从 `src/features/*` 记录；当它与 LLM 分数相差超过 20 分时，patina 会警告并使用更悲观的分数作为 gate。

`--save-run <dir>` 现在写入 manifest schema v2：结果条目包含 prompt/response hash、可用的输入/输出 token count、temperature/seed、score details、provider 返回时的 per-call cost，以及 Ouroboros iteration logs。

重复 benchmark 可通过 `--cache <dir>` 或 `PATINA_CACHE_DIR` 启用 HTTP response cache。Cache key 包含 prompt、model、temperature 和 API host；`--cache-ttl <sec>` 控制过期时间，`--no-cache` 强制 fresh run。cached run 结束时会打印 hit/miss/write stats。

使用 `--voice-sample <path>` 或配置中的 `voice-sample: <path>`，可以让 rewrite 参考你写过的 1–3 个段落。Profile 和 tone 仍然决定目标 register；sample 只用于学习节奏、具体度、视角和句子纹理，prompt 会明确禁止引入 sample facts。

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

将同一段文本独立交给 Claude、Codex、Gemini。通过 MPS ≥ 70 门槛后，AI 分数最低（最自然）的结果胜出：

```
/patina-max

[在此粘贴你的文本]
```

## 工作原理

```
输入
  ↓
[步骤 4.5]   语义锚点提取 (主张、极性、因果、数值)
[步骤 4.6]   文体统计预处理 (burstiness CV + MATTR; zh/ja 字符 token fallback)
[步骤 4.7]   AI 词汇重叠 (英文 ~108 / 韩文 102 / 中文 60 / 日文 60 项)
[阶段 1]     结构扫描 + 锚点验证
[阶段 2]     句子改写 + 锚点验证
[阶段 3]     自审 (极性、回归、MPS)
  ↓
自然的文本（语义已验证）
```

任一验证阶段语义偏移则重试或回滚。

**校准** *(500 段语料；方法论见 [stylometry.md](core/stylometry.md))*：HC3 ChatGPT (en) 编辑热点召回率 76% [66.7–83.3%]，paired ko/AI 语料 91% [84.0–95.4%]（各 n=100，binomial 95% CI）。人类写作误检以不同体裁 13–25% 点估计范围单独报告，不作为置信区间。接受门槛：AI ≥ 75%，最大 FP ≤ 25%。

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
- **[Patterns](docs/PATTERNS.md)** — 160 个模式目录
- **[Authentication](docs/AUTHENTICATION.md)** — 后端、服务商、免费层设置
- **[CLI Contract](docs/CLI.md)** — score gate、退出码，以及适合自动化的接口边界
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI、`/patina`、`/patina-max` 的选项支持范围
- **[Ethics](docs/ETHICS.md)** — 正确使用目的、禁止用途和披露立场
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
