# Cross-judge agreement plan

Status: CLI warning implemented; full matrix blocked on evaluator budget.
Related issue: #158.

A score is more useful when the judge is not from the same model family as the suspected generator. Patina now exposes a warning for that risk, while the larger agreement matrix remains a research task.

## Implemented safety check

Use `--suspected-generator <family>` with `--score`:

```bash
patina --lang en --score --suspected-generator gpt draft.md
```

If the active judge appears to be from the same family, patina writes a stderr warning with event `score.judge_overlap_warning`. The warning does not fail the command. It tells the user to treat the score as a bias check rather than an independent judge.

Known family mappings:

| input examples | family |
|---|---|
| `gpt`, `openai`, `codex`, `chatgpt`, `o4` | openai |
| `claude`, `anthropic` | claude |
| `gemini`, `google` | gemini |
| `llama`, `meta` | llama |
| `mistral`, `mixtral` | mistral |
| `qwen` | qwen |
| `deepseek` | deepseek |

## Full matrix gate

The full issue is still open until a report covers:

- 3 generator families × 3 judge families × 30 samples;
- shared prompts and fixed sample ids;
- pairwise agreement table;
- Krippendorff alpha or Cohen/Fleiss kappa where the labels support it;
- a note when a judge is evaluating its own family.

## Matrix template

| sample set | generator | judge | n | hot agree | hot disagree | agreement |
|---|---|---|---:|---:|---:|---:|
| pending | pending | pending | 0 | 0 | 0 | n/a |

Do not fill this table with synthetic numbers. Use it only after the manifest and judge outputs exist.
