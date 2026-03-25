# Bot References — Autonomous Bot Research

Research conducted 2026-03-20. Analyzed 14 repos + 4 patterns for improving patina bot.

## TIER 1 — Major Projects

| Project | URL | Key Pattern | Applied to Our Bot |
|---------|-----|-------------|-------------------|
| SWE-agent (Princeton) | github.com/SWE-agent/SWE-agent | Agent-Computer Interface. Issue → auto fix. NeurIPS 2024 | Architecture reference |
| Aider | github.com/Aider-AI/aider | tree-sitter repo map for codebase context | Future: codebase awareness |
| Sweep AI | github.com/sweepai/sweep | Dependency graph + vector search. 5 file / 300 line scope limit | Scope limiting pattern |
| Qodo PR-Agent | github.com/qodo-ai/pr-agent | Multi-agent review + judge dedup. /review /improve commands | Future: multi-agent review |
| CodeRabbit | github.com/coderabbitai/ai-pr-reviewer | Feedback learning loop. 2M+ GitHub repos. .coderabbit.yaml config | **Applied: feedback ingestion** |

## TIER 2 — Innovative Autonomous Systems

| Project | URL | Key Pattern | Applied to Our Bot |
|---------|-----|-------------|-------------------|
| OpenSepia | github.com/CelaenoIndustry/OpenSepia | 9 Claude agents as agile team, 24/7 cron | Future: multi-agent specialization |
| techtools-cron-loop | github.com/TaraJura/techtools-claude-code-cron-loop | Shared task board. Multi-agent cron collaboration | Future: task queue chaining |
| Ruflo | github.com/ruvnet/ruflo | Distributed swarm intelligence + RAG | Architecture reference |
| SWE-Squad | github.com/ArtemisAI/SWE-Squad | Self-healing — auto diagnose + fix failures. A2A protocol | **Applied: rollback detection** |
| Agents in the Wild (LogicStar) | github.com/logic-star-ai/insights | Agent performance metrics. Merge rate tracking. Hourly PR DB | **Applied: metrics tracking** |
| Visor | github.com/probelabs/visor | YAML-driven AI pipelines. Multi-surface (Action/CLI/Slack/API) | Architecture reference |
| Auto-Claude | github.com/AndyMik90/Auto-Claude | Kanban UI for autonomous SDLC | UX reference |
| claude-code-plugins (MtKana) | github.com/MtKana/claude-code-plugins | 20-domain cron system. Telegram approval loops | Future: approval loops |
| aware-swe-agent (Qodo) | github.com/qodo-ai/aware-swe-agent | Cross-repo + documentation awareness | Future: cross-repo awareness |

## Academic & Industry References

| Source | URL | Key Insight |
|--------|-----|-------------|
| ICLR 2026 Recursive Self-Improvement | recursive-workshop.github.io | Framework: what changes, when, how, alignment/safety, rollback, evaluation |
| Graphite Agent metrics | codeant.ai/blogs/github-code-reviews | <3% unhelpful comment rate. 55% code change acceptance. 33% more PRs merged |
| Claude Code /loop | winbuzzer.com (2026-03-09) | Native cron in Claude Code. Up to 50 concurrent scheduled tasks |
| Best AI Code Review 2026 | codeant.ai/blogs/best-github-ai-code-review-tools-2026 | Comprehensive comparison of AI review tools |

## What We Applied

| Improvement | Source | Implementation |
|-------------|--------|---------------|
| Feedback learning | CodeRabbit | bot-prompt.md: Pre-Run feedback ingestion → bot-learnings.md |
| Metrics tracking | LogicStar Agents in the Wild | bot-prompt.md: Metrics update → bot-metrics.md |
| Rollback detection | SWE-Squad | bot-prompt.md: Pre-Run revert check |
| Proactive health audit | Sweep AI + Qodo aware-agent | bot-prompt.md: Priority level 8 health checks |

## Future Improvements (Not Yet Applied)

| # | Improvement | Source | Complexity |
|---|-------------|--------|------------|
| 1 | Multi-run task chaining via task-queue.json | techtools-cron-loop | Medium |
| 2 | Weekly self-retrospective (analyze own metrics) | ICLR 2026 | Medium |
| 3 | Discord approval loop for high-risk changes | MtKana plugins | Medium |
| 4 | Multi-agent specialization per task type | OpenSepia | High |
| 5 | Cross-repo awareness (patina-max, clawhip) | Qodo aware-agent | High |
