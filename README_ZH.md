**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#快速开始)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-6.1.0-blue)](CHANGELOG.md)

<p align="center">
  <strong>去掉 AI 味，保留原意。</strong>
</p>

<p align="center">
  <a href="https://patina.vibetip.help/"><b>在浏览器中试用 — 无需安装</b></a>
</p>

patina 是一个面向韩文、英文、中文和日文的确定性、基于模式的人性化改写工具。它会找出听起来像 AI 的表达，并在不改变主张、数字、立场和因果关系的前提下改写。

它不是黑盒式改写器，也不是作者身份检测器或用来绕过检测器的工具。patina 面向允许使用 AI 辅助起草的场景：作者希望获得更干净的语气、可审计的轨迹，以及保留原意的校验。

## 效果展示

把听起来像 AI 的文本粘贴进 **[playground](https://patina.vibetip.help/)**，patina 会就地改写。含义下限会校验这次改写（这里是 **MPS 100 / Fidelity 75** —— “30 templates” 这个事实被保留了下来），确定性 AI 信号则在 before → after 之间测量：hot-paragraph 比例从 **100 → 0** 下降，而那些夸张包装（“thrilled to announce”“revolutionize your workflow”“unlock their full potential”）也随之消失。

<p align="center">
  <img src="https://raw.githubusercontent.com/devswha/patina/main/assets/demo/patina-playground-en.gif" alt="patina playground 动画演示：把一段听起来像 AI 的模板包公告粘贴进网页 playground，在保留 30-templates 事实的前提下改写得更自然，并通过 MPS 100、Fidelity 75 以及确定性 AI 信号从 100 降到 0 的校验" width="820">
</p>

更多例子：[Before/After Gallery](docs/EXAMPLES.md)（[한국어](docs/EXAMPLES_KR.md)） · [CLI transcript](docs/DEMO.md)。

## 快速开始

### 浏览器 playground

打开 **[patina.vibetip.help](https://patina.vibetip.help/)** —— 粘贴 KO / EN / ZH / JA 文本，即可获得由 MPS/忠实度下限把关的真实改写，并附带确定性 AI 信号的 before → after 测量。改写与评分在服务器端执行；免费层使用服务自己的模型 key（有速率限制）。**API 模式**会把你自己的 key 按请求经由 patina 服务器转发给你选择的 provider —— 从不存储、也不记录（指标已脱敏：不含文本、prompt、输出、key 或 IP）。

### Agent skill

**让你的编码代理来安装** —— 把下面这行粘贴到 Claude Code、Codex CLI、Cursor、Gemini CLI 或任意代理：

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

代理会获取 [`INSTALLATION.md`](INSTALLATION.md)（面向 AI 代理编写），按你的宿主环境执行相应安装路径，然后验证。或者自己来：

**Claude Code — 插件市场（无需克隆，推荐）：**

```text
/plugin marketplace add devswha/patina
/plugin install patina@patina
```

**Claude Code · Codex CLI · Cursor · OpenCode — 安装脚本：**

```bash
curl -fsSL https://raw.githubusercontent.com/devswha/patina/main/install.sh | bash
```

然后在 Claude Code、Codex CLI、Cursor 或 OpenCode 中运行 skill：

```text
/patina --lang en

[paste your text here]
```

常用 skill 调用：

```text
/patina --tone professional
/patina --tone auto --lang en
```

### 独立 CLI

需要 Node.js >= 18。

```bash
npx patina-cli doctor
npx patina-cli --lang en input.txt
```

使用已登录的本地模型 CLI，无需 API 密钥：

```bash
printf '%s\n' 'Coffee has emerged as a pivotal cultural phenomenon.' \
  | npx patina-cli --lang en --backend codex-cli
```

支持的本地后端：`codex-cli`、`claude-cli`、`gemini-cli`、`kimi-cli` —— patina 会按每个后端传入其文档记载的最强默认模型。见 [Authentication](docs/AUTHENTICATION.md)（[한국어](docs/AUTHENTICATION_KR.md)）。

对于较大的 `--batch` 运行，建议使用兼容 OpenAI 的 HTTP 后端；本地 CLI 后端是代理运行时，会通过 `--timeout-ms`、`--max-concurrency`、`--max-retries` 和 `--max-failures` 保守设限以保证批处理安全。

## 一览

|  |  |
|---|---|
| **168 条模式** | 每种语言 33 条可改写模式 + 9 条仅评分的病毒式钩子模式（KO/EN/ZH/JA 各 42 条）—— 完整的 168 条模式目录见 [PATTERNS.md](docs/PATTERNS.md) |
| **模式** | rewrite · verify · audit · score · diff |
| **使用入口** | agent skill · Node CLI · 页面内 preview · 浏览器 playground（改写 + 评分） |
| **声音** | `--persona`（内置 + 自制，ko/en/zh/ja）· `--tone` 语域 · `--profile` 体裁 —— 按固定优先级可组合 |
| **免费使用** | 已登录的 `codex`、`claude` 或 `gemini` CLI 可直接运行改写，无需 `PATINA_API_KEY` |
| **校准** | 编辑热点命中率 67.3% [63.5–71.0%]，跨 GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro（n=600，KO+EN）；在 KO+EN 人类对照上误检率 16.0% [11.6–21.7%]（n=200） |
| **许可证** | MIT |

分数是有误报和漏报的编辑信号，不是作者身份的证明。见 [Ethics](docs/ETHICS.md)。

## 常用命令

```bash
patina --lang <ko|en|zh|ja> [mode] [--profile <name>] input.txt
```

| 命令 | 用途 |
|---|---|
| `patina input.txt` | 用默认设置改写 |
| `patina --audit input.txt` | 仅检测模式 |
| `patina --score input.txt` | 输出 0-100 的 AI 相似度分数 |
| `patina --score --exit-on 30 input.txt` | CI gate：当 `overall > 30` 时以退出码 `3` 结束 |
| `patina --diff input.txt` | 按模式逐项展示改动 |
| `patina --preview page.html` | 把改写结果渲染回保存的 HTML 页面，带视图切换和内联 diff |
| `patina --verify input.txt` | 改写后检查 MPS/忠实度下限，并重试一次 |
| `patina --tone auto --lang en input.txt` | 推断并应用 KO/EN 语气轴 |
| `patina --persona pragmatic-founder input.txt` | 用内置声音人格改写 |
| `patina persona new my-voice --from-sample past.txt` | 从写作样本创建你自己的人格 |
| `patina persona list` | 列出内置 + 自制人格 |
| `patina --format json --quiet input.txt` | 适合脚本的输出 |
| `patina --batch docs/*.md --outdir cleaned/` | 批量文件处理 |

`patina --help` 会打印完整的选项列表。`patina doctor --json` 会在不调用 LLM 的情况下检查 Node、后端、tmux 和 API-key 就绪状态。

### 人格（声音）

**人格**是可复用的“声音” —— 一个内置人格（`patina persona list`）或你自己创建的、无需改动源码的人格：

```bash
patina persona new my-voice --from-sample past-posts.txt   # 从你的写作中学习
patina persona new my-voice --describe "plain-spoken founder, casual"
patina --persona my-voice draft.md                          # 之后复用
```

在 ko/en/zh/ja 上生效，并与 `--tone`/`--profile` 组合（语域优先级 `--tone` > 人格 > profile）。人格塑造声音，但绝不会降低含义下限 —— 自制人格在保存时会经过校验，安全闸门仍然强制 MPS/忠实度 + 数字缺失检查。

## CI

对于 GitHub Actions，官方维护的 wrapper 比手写配置更简短：

```yaml
name: Patina prose score
on:
  pull_request:
    paths: ['**/*.md', '**/*.mdx']
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

其他集成：[pre-commit](docs/integrations/pre-commit.md)、[静态站点](docs/integrations/static-sites.md)、[Docker](docs/integrations/docker.md)、[release workflow](docs/integrations/release.md)。

## 工作原理

```text
Input
  -> semantic anchor extraction (claims, polarity, causation, numbers)
  -> stylometry + AI-lexicon scan
  -> pattern-guided rewrite
  -> self-audit and MPS/fidelity checks
  -> cleaned text
```

如果含义发生偏移，改动会被重试或回滚。确定性分析位于 `src/features/*`；由 LLM 支撑的改写与评分调用则使用所选后端。

## 配置

```yaml
# .patina.default.yaml
version: "6.1.0"
language: ko              # ko | en | zh | ja
profile: default
output: rewrite           # rewrite | diff | audit | score
tone:                     # casual | professional | auto  (register; genre = profile)
```

项目级 `.patina.yaml` 会覆盖默认值。模式包按语言前缀自动发现。可追加的列表键（`blocklist`、`allowlist`、`skip-patterns`）会合并；其他数组会直接替换。

## 文档

从这里开始：

- [Cookbook](docs/COOKBOOK.md) —— 常用配方与工作流
- [CLI Contract](docs/CLI.md) —— 选项、格式、score gate 和退出行为
- [Authentication](docs/AUTHENTICATION.md) —— 本地 CLI 后端与 API 服务商
- [Patterns](docs/PATTERNS.md) —— 完整模式目录
- [Subagents & strict flow](docs/agents.md) —— 可选的只读 detector/fidelity/naturalness 子代理，以及 `--strict` 多轮模式
- [Benchmarks](docs/benchmarks/README.md) · [latest report](docs/benchmarks/latest.md) · [2026 rebaseline](docs/research/2026-rebaseline.md)
- [Measurement harness](docs/HARNESS.md) —— 每个基准、校准和 gate 工具的索引（含信号影响 ablation harness）
- [FAQ](docs/FAQ.md)（[한국어](docs/FAQ_KR.md)）
- [Ethics](docs/ETHICS.md)
- [Contributing](CONTRIBUTING.md)（[한국어](CONTRIBUTING_KR.md)）
- [Changelog](CHANGELOG.md)

品牌资源和使用规则见 [Branding](docs/BRANDING.md)。设计说明见 [DESIGN.md](DESIGN.md)。

## 致谢

灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) 的插件架构、[Wikipedia 的 “Signs of AI writing”](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) 和 [blader/humanizer](https://github.com/blader/humanizer)。

## 许可证

MIT。见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
