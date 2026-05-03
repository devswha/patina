---
pattern: 31
type: failure
name: Conclusion Signal Words
pack: en-filler
language: en
---

# Pattern 31: Conclusion Signal Words — Failure (False Positive)

## Input Text

> ## 5. Conclusion
>
> We presented a novel fine-tuning method for improving Korean LLM reasoning, achieving 4.2 BLEU and 3.7 ROUGE-L improvements over the baseline on KORQuAD-2.
>
> In summary, our contributions are: (1) a Korean-specific instruction-tuning dataset construction pipeline, (2) a parameter-efficient PEFT variant that retains 95% of full fine-tuning quality at 12% of compute, and (3) an open evaluation protocol with reproducible scripts.

## Expected Output

> (No correction — this text should not trigger Pattern 31)

## Applied Pattern

- Pattern 31 (Conclusion Signal Words): The final paragraph opens with "In summary".

## Judgment

**Failure (false positive)** — This is the body of an academic paper's `## 5. Conclusion` section, which Pattern 31 explicitly excludes. The header already signals the conclusion; the body's "In summary" introduces a numbered contributions list — a standard academic convention. Removing it would weaken the cue that a structured contribution list is about to be enumerated, hurting readability.
