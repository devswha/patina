**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#快速开始)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-5.4.0-blue)](CHANGELOG.md)

<p align="center">
  <img src="assets/demo/patina-preview-en.gif" alt="patina --preview 在真实网页上切换 Rewritten、Original、Both、Diff 视图，页面布局保持不变，AI 味表达被替换，分数从 60 降到 0 的动画" width="820">
</p>

<p align="center">
  <a href="https://patina.vibetip.help/"><b>用你自己的文本试用 — 无需安装</b></a>
</p>

> **去掉 AI 味，保留原意。**

patina 会在中文、韩文、英文和日文中找出 AI 味较重的表达，并在不改变主张、数字、立场和因果关系的前提下改写。你可以把它装成 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex)、[Cursor](https://cursor.sh)、OpenCode 的 agent skill，也可以直接运行独立的 Node.js CLI。

它不是黑盒式改写器，也不是用来绕过 AI 检测器的工具。patina **基于清晰的模式规则，并且可审计**：会说明改了什么、为什么改，以及原文的主张是否保留下来。只要 `codex`、`claude`、`gemini` 任一 CLI 已登录，就可以不填 API 密钥使用。

## 效果展示：在真实页面上预览

`--preview` 会把 URL 或本地 `.html` 做成快照，只改写正文段落，然后把结果渲染回原页面。浮动工具条可以切换 **Rewritten / Original / Both / Diff**，跳到每个改动块，并显示确定性分数的前后变化。

```bash
patina --preview --lang zh page.html
patina --preview https://example.com/post
```

示例保留页面结构、标题、CTA 和具体事实（`30 个模板`、规划文档、交接文档）。它去掉 “innovative solution”“transform productivity”“new paradigm” 这类包装，并用内联 diff 留下审计轨迹，而不是黑盒改写。

**更多例子**

| 输入类型 | 去掉的 AI 味 | 保留的含义 |
|---|---|---|
| 韩语营销文案 | “혁신적인 솔루션”, “새로운 패러다임” | 30 个 Notion 模板、适配工作流、复制后可自行修改 |
| 学术文本 | “획기적인 성과”, 宽泛的意义宣称 | 60 个 GitHub 项目、72h→10m 设置时间、p<0.01、限制说明 |
| 技术文档 | “핵심적인 역할”, 未来标准式夸张 | GPU 管理、一条命令完成配置、5× 结果的注意事项 |

CLI transcript 见 [Demo](docs/DEMO.md)。更多例子见 [Before/After Gallery](docs/EXAMPLES.md)（[한국어](docs/EXAMPLES_KR.md)）。

## 浏览器 playground — 无需安装

在 **[patina.vibetip.help](https://patina.vibetip.help/)** 粘贴 KO / EN / ZH / JA 文本，即可在浏览器里获得真实的改写结果，并附带 MPS/忠实度下限校验和确定性 AI 信号（before → after）。

> **改写与评分在服务器端执行。** 免费模式使用服务自己的模型 key（有速率限制）。**API 模式**使用你自己的 key：它只保存在你的浏览器存储中，每次请求经由 patina 服务器转发给你选择的 provider，不会被存储或记录（服务器指标不含文本、prompt、输出、key 或 IP）。

品牌资源：[logo](assets/brand/patina-logo.svg)、[mark](assets/brand/patina-mark.svg)、[icon](assets/brand/patina-icon.svg)、[social preview](assets/social/patina-og.svg)、[before/after card](assets/social/patina-before-after.svg)。使用指南见 [BRANDING.md](docs/BRANDING.md)。

## 一览

|  |  |
|---|---|
| **168 条模式** | 每种语言 33 条可改写模式 + 9 条仅评分的病毒式钩子模式（KO/EN/ZH/JA 各 42 条） — [PATTERNS.md](docs/PATTERNS.md) |
| **编辑热点召回率** | 2026-05-22 现代模型重基线：GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro 的总体命中率为 67.3% [63.5–71.0%]（n=600，韩文+英文） |
| **基准报告** | 可复现的 ko/en/zh/ja 可疑区间基准：[overview](docs/benchmarks/README.md) · [latest.md](docs/benchmarks/latest.md) · [latest.json](docs/benchmarks/latest.json) · [2026 rebaseline](docs/benchmarks/rebaseline-latest.md) · [detector comparison](docs/benchmarks/detector-comparison.md) |
| **误检率** | 2026-05-22 KO+EN 人类对照为 16.0% [11.6–21.7%]（n=200）；不同文体的边界见 [stylometry.md](core/stylometry.md) — [报告误检](https://github.com/devswha/patina/issues/new?template=false_positive.yml) |
| **模式** | rewrite · audit · score · diff · ouroboros |
| **使用入口** | agent skill · Node CLI · 页面内 preview · 浏览器 playground（改写 + 评分） |
| **免费使用** | 已登录的 `codex`、`claude` 或 `gemini` CLI 可直接运行，无需 API 密钥 |
| **确定性** | 评分公式是确定性的；LLM 严重度判定阶段会有 ±8–10pt 波动（[scoring.md §8](core/scoring.md)） |
| **许可证** | MIT |

## 快速开始

### 作为 Claude Code 或 Codex CLI 技能

**Claude Code — 插件市场（无需克隆，推荐）：**

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

**Claude Code · Codex CLI · Cursor · OpenCode — 安装脚本：**

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```
安装脚本会把 patina 一次接入 Claude Code、[Codex CLI](https://github.com/openai/codex)、Cursor 和 OpenCode。安装时会先把远程 HEAD 固定到具体 commit；如果想固定到某个版本，请设置 `PATINA_REF=<tag-or-full-sha>`。然后：

```
/patina --lang zh

[在此粘贴你的文本]
```

按指定语气改写：

```
/patina --tone narrative

[在此粘贴你的随笔草稿]
```

自动选择合适的语气：

```
/patina --tone auto --lang en

[在此粘贴你的文本]
```

> 注意：`--tone`（含 `auto`）在 v1 仅对 ko/en 生效。zh/ja 使用任何语气都会触发警告，并回退到 profile-only 模式。

### 作为独立 CLI

需要 Node.js ≥ 18。npm 包已公开，可以直接运行：

```bash
npx patina-cli doctor
npx patina-cli --lang zh input.txt
```

如果想拉下仓库本地修改再试：

```bash
git clone https://github.com/devswha/patina.git
cd patina && npm install && npm link
patina --lang zh input.txt
```

`npm link` 后也可以通过 stdin 试用：

```bash
printf '%s\n' '咖啡已成为一种关键文化现象，从根本上改变了全球各地的社会互动。' \
  | patina --lang zh --backend codex-cli
```

> 🆓 **无需 API 密钥** — 只要 [`codex`](https://github.com/openai/codex)、[`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`gemini`](https://github.com/google-gemini/gemini-cli)、[`kimi`](https://moonshotai.github.io/kimi-cli/) 任一 CLI 已登录即可。可以用 `--backend codex-cli | claude-cli | gemini-cli | kimi-cli` 直接选择，也可以用 `--backend claude-cli,codex-cli` 指定后备顺序；还可以交给模型名自动路由（如 `--model claude-*` 或 `--model kimi-*` → 对应 CLI）。未传 `--model` 时，patina 会按 backend 传入默认模型：`gpt-5.5`、`claude-sonnet-4-6`、`gemini-2.5-pro` 或 `kimi-code/kimi-for-coding`。完整后端列表见 [AUTHENTICATION.md](docs/AUTHENTICATION.md)。

### CI 集成

Patina 提供确定性的 CI 文档检查，不需要 live model key：

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

Patina 适合在作者可以使用 AI 辅助起草的场景中，用来编辑草稿、看清改了哪里和为什么改，并让文字读起来更自然。它不保证文本“原本由人类写成”，也不应被用于规避学术 honor code、绕过出版方 disclosure、洗白抄袭，或声称可以 bypass detector。分数只是有误报和漏报的编辑信号，不是作者身份的证明。见 [ETHICS.md](docs/ETHICS.md)。

## 模式

```
patina --lang <ko|en|zh|ja> [模式] [--profile <名称>] input.txt
```

| 参数 | 功能 |
|------|------|
| *(默认)* | 改写 |
| `--audit` | 仅检测 AI 模式 |
| `--score` | 0–100 AI 相似度评分 + 类别细分 |
| `--score --exit-on <n>` | 保持 CI 严格：当 `overall > n` 时以退出码 `3` 结束 |
| `--diff` | 按模式逐项展示改动 |
| `--ouroboros` | 反复改写直到分数收敛（含 MPS 回滚） |
| `--lang <ko\|en\|zh\|ja>` | 选择语言（默认：`ko`） |
| `--profile <名称>` | 语气预设：`blog`, `academic`, `technical`, `formal`, `social`, `email`, `legal`, `medical`, `marketing`, `narrative`, `instructional`, `casual-conversation`, `code-comment`, `commit-message`, `release-notes`, `namuwiki` |
| `--tone <名称>` | 语调类别：`casual`, `professional`, `academic`, `narrative`, `marketing`, `instructional`, `auto` |
| `--batch` | 把位置参数当作文件列表（例：`--batch docs/*.md`） |
| `--format json\|text\|markdown` | 选择 JSON、纯文本或默认 Markdown 输出 |
| `--quiet` | 隐藏 stderr 中的状态、警告和进度日志 |

完整选项请运行 `patina --help`。`patina doctor --json` 可在不调用 LLM 的情况下检查 Node/backend/tmux/API-key 状态。项目配置是可选的；一次性运行请用 flags，只有需要固定默认值时再添加 `.patina.yaml`。

Markdown 较多的工程流程可以使用开发者 profile：`code-comment` 会收紧 inline comments/docstrings，`commit-message` 会把 Git 历史文本改成更强调意图和验证，`release-notes` 会把 changelog bullets 改成面向用户影响的发布说明，并保留迁移风险。`namuwiki` 是仅适用于韩文的 wiki 风格 profile，只包含原创的 license-safe 指南，不复制 NamuWiki 文章文本。

### 仅评分模式

`--score` 和 `--audit` 测量的信号范围比 `--rewrite` 略广。viral-hook 包（`ko/en/zh/ja-viral-hook`，每种语言 9 个模式：数字震撼钩子、标题党收尾、跳过来源的权威断言、适合呼吸节奏的短句堆叠、夸张互动词汇、伪统计引用、头衔堆叠、未来自我承诺、格言式收束句）为**仅检测**模式。

这些信号只会出现在评分和审计中，用来让基准更贴近用户对四种语言 SNS 营销文案的直觉。`--rewrite`/`--diff`/`--ouroboros` 会跳过它们，因为这些表达往往是有意的修辞。实例：[`examples/viral-hook/`](examples/viral-hook/)。

### 短文本评分增强 (v3.11)

当输入不超过 200 个字符或不超过 3 个段落时，对语气更敏感的类别（`language`、`style`、`viral-hook`）会获得 1.5 倍权重，让单段文本里的声音变化也能体现在分数中。case-04 发现这些信号会被长文本公式低估。

### 自审隔离 (v3.11)

在 rewrite 模式中，模型会把自审笔记放在 `[SELF_AUDIT]`/`[/SELF_AUDIT]` 标签内，并包裹一个 `[BODY]`/`[/BODY]` 块。patina 会在展示给用户前移除审计内容，因此原始输出保持干净。早期版本有时会把 “남아 있는 AI 티” 或 “Phase 3” 之类的前言泄漏到用户可见文本中。

### 机器可读输出和退出码

`--format json` 会把所有模式包进稳定的 JSON envelope，包含 `overall`、`categories[]`、`tone`、`mps`、`gateResult` 和清理后的 `output` 正文。`--quiet` 则为只需要 stdout 的脚本隐藏状态、警告和进度日志。`--format markdown` 是默认值；`--format text` 保留无 YAML tone footer 的用户可见正文。退出码见 [EXIT-CODES.md](docs/EXIT-CODES.md)：`0` 成功，`1` runtime/backend，`2` input/usage，`3` score gate 超限。

### 分数权重漂移检测 (v3.11)

`--score` 运行会把模型输出的 Weight 列与配置中的 `category-weights` 对照。如果模型凭空创造类别（例如 `discord`）或替换成不同数字，stderr 会出现 `[patina]` 警告。这只用于可观测性，权重检查本身不会改变分数。确定性 shadow score 也会从 `src/features/*` 记录；当它与 LLM 分数相差超过 20 分时，patina 会警告并使用更保守的分数作为 gate。

## 语调

`--tone` 是叠加在模式改写之上的具名语气轴。优先级：`--tone` CLI > `tone:` 配置 > `profile:` 配置。

| 语调 | 适用 | 主要特征 |
|------|------|----------|
| `casual` | 博客、社交内容、个人笔记 | 缩略、第一人称、表情符号可用、低正式度 |
| `professional` | 工作邮件、报告、商务写作 | 清晰简洁、正式而不僵硬（legal/medical 子档案强制 fidelity 下限） |
| `academic` | 论文、研究综述、技术分析 | 客观、证据导向、第一人称最少 |
| `narrative` | 个人随笔、回忆录、经历叙述 | 第一人称为锚、场景细节、情感在场 |
| `marketing` | 广告文案、落地页、产品公告 | 短促有力、有说服力、CTA 友好 |
| `instructional` | 教程、操作指南、技术文档 | 命令式动词、编号结构、抑制猜测语 |

`--tone auto` 通过启发式（词汇 + 结构信号）自动选择最契合的语气。zh/ja 上使用任何语气（包括 `auto`）都会发出警告并回退到 profile-only 模式，因为 Phase 4.5b 启发式仅覆盖 ko/en。

## 工作原理

```
输入
  ↓
[步骤 4.5]   语义锚点提取 (主张、极性、因果、数值)
[步骤 4.6]   文体统计预处理 (burstiness CV + MATTR; zh/ja 字符 token fallback)
[步骤 4.7]   AI 词汇重叠 (英文 88 / 韩文 102 / 中文 60 / 日文 60 项)
[阶段 1]     结构扫描 + 锚点验证
[阶段 2]     句子改写 + 锚点验证
[阶段 3]     自审 (极性、回归、MPS)
  ↓
自然文本（语义已验证）
```

如果任一验证阶段发现语义偏移，patina 会重试或回滚。

**校准** *(2026-05-22 现代模型重基线；方法见 [2026-rebaseline.md](docs/research/2026-rebaseline.md))*：在 GPT-5.5、Claude Sonnet 4.6、Gemini 2.5 Pro CLI 样本上，确定性编辑热点命中率为 67.3% [63.5–71.0%]（n=600，韩文+英文）。人类对照误检率为 16.0% [11.6–21.7%]（n=200）。语言×模型的细分结果见 [rebaseline-latest.md](docs/benchmarks/rebaseline-latest.md)。这只是编辑信号，不是作者判定，也不是绕过检测的承诺。

## 配置

```yaml
# .patina.default.yaml
version: "4.0.1"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | academic | narrative | marketing | instructional | auto
```

模式包按语言前缀自动发现。工作目录中的 `.patina.yaml` 会覆盖默认值。用于扩展检测的列表键（`blocklist`、`allowlist`、`skip-patterns`）会在 default/global/project 配置之间追加合并；其他数组键会直接替换，方便用户指定精确值。

## 文档

- **[Cookbook](docs/COOKBOOK.md)** — 实用配方（Hugo 批量打分、GitHub Actions、误报 triage、自定义 profile、pre-commit）
- **[Glossary](docs/GLOSSARY.md)** — MPS、fidelity、burstiness、MATTR、模式等常见术语的简短定义
- **[Demo](docs/DEMO.md)** — 终端 transcript 与多种体裁的 before/after 快照
- **[Patterns](docs/PATTERNS.md)** — 168 个模式目录
- **[Authentication](docs/AUTHENTICATION.md)** ([한국어](docs/AUTHENTICATION_KR.md)) — 后端、服务商、免费层设置
- **[GitHub Action](docs/integrations/github-action.md)** — 无需 live model key 即可生成 PR hotspot 评论与 README score badge
- **[Pre-commit](docs/integrations/pre-commit.md)** — pre-commit、Husky 与 Lefthook 的 score-only 配方
- **[Static-site Stencils](docs/integrations/static-sites.md)** — Hugo、Astro 与 Next.js MDX 构建期打分配方
- **[Docker](docs/integrations/docker.md)** — GHCR 镜像用法与 release tag
- **[Release workflow](docs/integrations/release.md)** — npm provenance + GHCR 发布清单
- **[CLI Contract](docs/CLI.md)** — score gate、JSON/text/Markdown 输出，以及适合自动化的接口边界
- **[API Reference](docs/API.md)** — 用于编程式导入与打分 helper 的生成 JSDoc 参考
- **[Flag Parity](docs/FLAG-PARITY.md)** — standalone CLI 与 `/patina` 的选项支持范围
- **[Exit Codes](docs/EXIT-CODES.md)** — 面向 CI 与编辑器集成的进程退出码约定
- **[Ethics](docs/ETHICS.md)** — 正确使用目的、禁止用途和披露立场
- **[FAQ](docs/FAQ.md)** ([한국어](docs/FAQ_KR.md)) — detector-bypass 疑虑、MPS、误报、贡献起点
- **[False-positive Gallery](docs/FALSE-POSITIVES.md)** — 应被视为编辑提示而非指控的人类文风示例
- **[Comparison](docs/COMPARISON.md)** — 与常见 paraphraser/humanizer 工具的事实比较
- **[Branding](docs/BRANDING.md)** — canonical logo/social assets 和 OG 设置说明
- **[Design](DESIGN.md)** — repo-native SVG 与 README surface 的产品/品牌基准
- **[Roadmap](docs/ROADMAP.md)** — 质量、基准、产品、社区和发布优先级
- **[Docs Platform RFC](docs/RESEARCH-DOCS-PLATFORM.md)** — Docusaurus、Astro Starlight、MkDocs 与 GitHub Pages 调研
- **[Benchmark Reports](docs/benchmarks/README.md)** — 已签入的基准产物、刷新命令与 public-claim gate
- **[Benchmark Report](docs/benchmarks/latest.md)** — 最新可复现 suspect-zone 基准摘要
- **[Detector Comparison Harness](docs/benchmarks/detector-comparison.md)** — 第三方 detector 的离线/手动对比协议
- **[AI/Human Metrics Research](docs/research/ai-human-metrics.md)** — 用于测量 AI-like writing signals 的基准设计说明
- **[2026 Modern-model Rebaseline](docs/research/2026-rebaseline.md)** — 带当前日期戳的 KO+EN catch/FP claim
- **[2025+ Re-baseline Plan](docs/research/2025-rebaseline-plan.md)** — 面向更广 model-era claim 的协议
- **[zh/ja Lexicon Calibration](docs/research/zh-ja-lexicon-calibration.md)** — starter lexicon gate 与剩余 corpus risk
- **[Launch Copy](docs/social/patina-launch-copy.md)** — launch sequence、score gate 与 Show HN/Product Hunt/Reddit/X/韩国社区草稿
- **[Signs of AI Writing](docs/social/signs-of-ai-writing.md)** ([한국어](docs/social/signs-of-ai-writing_KR.md)) — 附带引用示例的可分享编辑 checklist
- **[Stylometry](core/stylometry.md)** — burstiness + MATTR + AI 词汇算法
- **[Scoring](core/scoring.md)** — AI 相似度 + 忠实度 + MPS
- **[Changelog](CHANGELOG.md)** — 发布说明和方法论
- **[Contributing](CONTRIBUTING.md)** ([한국어](CONTRIBUTING_KR.md)) — 模式提交、误报 triage、基准 fixture、版本管理
- **[Governance](GOVERNANCE.md)** / **[Maintainers](MAINTAINERS.md)** — 轻量级项目决策规则

## 致谢

灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 的插件架构（模式即插件，profile 即主题）、[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)、[blader/humanizer](https://github.com/blader/humanizer)。

## 许可证

MIT
