**[한국어](README_KR.md)** | **[English](README.md)** | 中文 | **[日本語](README_JA.md)**

# patina

[![Tests](https://github.com/devswha/patina/actions/workflows/test.yml/badge.svg)](https://github.com/devswha/patina/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Skill](https://img.shields.io/badge/Skill-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20OpenCode-blueviolet)](#快速开始)
[![Multi-language](https://img.shields.io/badge/Languages-KO%20%7C%20EN%20%7C%20ZH%20%7C%20JA-green)](https://github.com/devswha/patina)
[![Version](https://img.shields.io/badge/version-8.5.2-blue)](CHANGELOG.md)

<p align="center">
  <strong>去掉 AI 味，保留原意。</strong>
</p>

<p align="center">
  <a href="https://patina.vibetip.help/?lang=zh&amp;utm_source=github&amp;utm_campaign=multilingual-20260907"><b>在浏览器中试用 — 无需安装</b></a>
</p>

patina 是一个面向韩文、英文、中文和日文的确定性、基于模式的人性化改写工具。它会找出听起来像 AI 的表达，并在不改变主张、数字、立场和因果关系的前提下改写。

它不是黑盒式改写器，也不是作者身份检测器或用来绕过检测器的工具。patina 面向允许使用 AI 辅助起草的场景：作者希望获得更干净的语气、可审计的轨迹，以及保留原意的校验。

编辑器集成：[VS Code、Obsidian 和 Gmail 预览版](docs/integrations/editors.md)。

## 效果展示

下面节选自[中文示例画廊](docs/EXAMPLES_ZH.md)的包装样稿邮件。这是虚构文本的模型编辑示范，不是实时运行记录，也没有实测分数。

**改写前：**

> 需要说明的是，样品预计在收到确认后3个工作日内寄出。若确认时间推迟，寄出日期也将相应顺延。

**改写后：**

> 样品预计在收到确认后3个工作日内寄出。确认若有推迟，寄出日期也会顺延。

去掉开场套话，保留“预计”、3个工作日和确认推迟时的顺延条件。完整邮件、周报和产品说明见[中文示例画廊](docs/EXAMPLES_ZH.md)。

- **可审计，不是黑箱** — 184 条有名字的模式驱动每一次修改；`--diff` 展示改了什么、为什么改。
- **含义保留校验** — playground 检查 MPS 和忠实度，拒绝低于门槛或缺少分数的结果。评分也可能误判，仍需核对原文。Node CLI 用 `--verify`、代理技能用 `/patina --strict` 启用保留校验。
- **三个相互独立的轴** — Document Type 管体裁，Persona 管声音，Register 管语域；省略的轴保持原文。
- **全渠道可用** — 代理技能（Claude Code · Codex · Cursor · OpenCode）、Node CLI，以及[浏览器 playground](https://patina.vibetip.help/?lang=zh&utm_source=github&utm_campaign=multilingual-20260907)。
- **对局限诚实** — 分数是编辑信号而非作者判定；我们的[预注册研究](docs/research/2026-rewrite-efficacy-study1.md)把失败之处与成功一并公开。

## 快速开始

**浏览器 — 无需安装。** 打开 **[patina.vibetip.help](https://patina.vibetip.help/?lang=zh&utm_source=github&utm_campaign=multilingual-20260907)**，可用入口和额度以页面提示为准。改写与评分在服务端运行；BYOK 模式按请求转发你自己的提供商密钥，不存储、不记录密钥。Pro 使用 Polar 许可证密钥认证，购买入口是否开放以页面为准。

**代理技能 — 把下面这行粘贴给 Claude Code、Codex CLI、Cursor 等任意代理：**

```text
Install patina by following https://raw.githubusercontent.com/devswha/patina/main/INSTALLATION.md
```

然后使用：

```text
/patina --lang zh

[在这里粘贴文本]
```

**CLI — Node 18.1 及以上：**

```bash
npx patina-cli --lang zh input.txt          # 改写
npx patina-cli doctor                       # 检查后端与密钥
```

已登录本地 CLI 时无需 API 密钥；按对应工具选择 `--backend codex-cli`、`--backend claude-cli` 或 `--backend gemini-cli`。完整安装选项见 [INSTALLATION.md](INSTALLATION.md)。

## 三个相互独立的轴

patina 不会从一个轴推断另一个轴。省略 Persona 和 Register 时，会保留原文的声音与语域。

| 轴 | 控制 | 不控制 | 选择方式 |
|---|---|---|---|
| **Document Type** | 体裁、用途、结构惯例、模式策略 | 声音、casual/professional 表达、含义保留下限 | `--document-type` · 配置 `document-type` · Playground "Document Type" |
| **Persona** | 可复用声音指纹：词汇、节奏、解释习惯 | 体裁、模式策略、Register、含义保留下限 | `--persona` · 配置 `persona` · Playground "Persona" |
| **Register** | `casual` 或 `professional` 表达方式 | 体裁、Persona 身份、模式策略 | `--register` · 配置 `register` · Playground "Register" |

含义保留是三轴之外的共同下限；显式指定的轴不会填充被省略的轴。

```bash
patina --document-type email --register professional note.md
patina --document-type blog --persona pragmatic-founder post.md
```

## 常用命令

```bash
patina input.txt                                          # 按默认设置改写
patina --audit input.txt                                  # 仅检测模式
patina --score --offline --exit-on 30 input.txt           # 无需 API 密钥的确定性 CI 门槛
patina --diff input.txt                                   # 逐模式展示改动
patina --verify input.txt                                 # 改写 + MPS/忠实度下限检查
patina --document-type email --register professional input.txt
patina persona new my-voice --from-sample past-posts.txt  # 从自己的文字学习声音
patina --persona my-voice draft.md
patina --batch docs/*.md --outdir cleaned/
```

`patina --help` 打印完整参数。GitHub Actions 包装器：[devswha/patina-action](https://github.com/devswha/patina-action) · [pre-commit 等集成](docs/integrations/pre-commit.md)。

项目配置放在 `.patina.yaml`：

```yaml
# .patina.default.yaml
version: "8.5.2"
language: ko              # ko | en | zh | ja
document-type: default    # 体裁/用途 + 模式策略
persona:                  # 可选；省略时保留原文声音
register:                 # casual | professional；省略时保留原文语域
```

## 一览

|  |  |
|---|---|
| **184 条模式** | 每种语言 37 条可改写模式 + 9 条仅评分的病毒式钩子模式（KO/EN/ZH/JA 各 46 条）—— 完整的 184 条模式目录见 [PATTERNS.md](docs/PATTERNS.md) |
| **模式** | rewrite · verify · audit · score · diff |
| **校准** | 编辑热点命中率 67.3% [63.5–71.0%]，跨 GPT-5.5 / Claude Sonnet 4.6 / Gemini 2.5 Pro（n=600，KO+EN）；在 KO+EN 人类对照上误检率 16.0% [11.6–21.7%]（n=200） |
| **许可证** | MIT |

分数是带有误检与漏检的编辑信号，不是作者身份的证明。见 [Ethics](docs/ETHICS.md)。

## 文档

- [Cookbook](docs/COOKBOOK.md) — 常用配方 · [CLI 契约](docs/CLI.md) — 参数、门槛、退出码
- [中文改写示例](docs/EXAMPLES_ZH.md) · [中文模式目录](docs/PATTERNS-ZH.md)
- 历史演示：[英文 playground 动画](assets/demo/patina-playground-en.gif) · [CLI 运行记录](docs/DEMO.md)
- [架构](docs/ARCHITECTURE.md) · [配置与认证](docs/AUTHENTICATION.md)
- [基准](docs/benchmarks/latest.md) · [研究](docs/research/2026-rewrite-efficacy-study1.md) · [FAQ](docs/FAQ.md)
- [贡献指南](CONTRIBUTING.md) · [变更日志](CHANGELOG.md)

## 许可证

MIT。见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。灵感来自 [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)、[Wikipedia 的 "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) 与 [blader/humanizer](https://github.com/blader/humanizer)。
