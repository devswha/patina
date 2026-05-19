# Pattern Catalog

146 pattern entries across 4 languages (37 KO + 36 EN + 36 ZH + 37 JA). The main catalog has 126 rewrite-capable patterns; the extra 20 are score/audit-only viral-hook patterns (5 per language). Most patterns are universal; a few slots have language-specific variants. Each pattern has a fire condition, an exclude condition (so legitimate uses don't get flagged), and example before/after pairs in `examples/`.

| Category | # of patterns | Range |
|----------|---------------|-------|
| Content | 6 | #1–#6 |
| Language | 6 | #7–#12 *(language-specific)* |
| Style | 6 | #13–#18 *(some language-specific)* |
| Communication | 4 | #19–#21, #29 |
| Filler & Hedging | 3 | #22–#24 |
| Structure | 4 | #25–#28 *(some language-specific)* |
| Universal extensions | 3 | #30–#32 *(KO/JA only for #32)* |
| Viral hook | 5 per language | score/audit-only SNS-marketing signals |

## Universal patterns

These categories are identical across all four languages.

### Content (#1–#6)

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 1 | Importance Inflation | "groundbreaking milestone", "pivotal turning point" | Specific facts, dates, numbers |
| 2 | Media/Notability Inflation | "garnered significant attention" | Cite one specific source |
| 3 | Superficial Analysis | Chains of "-ing" / "-하며" verbs with no real explanation | Real explanation or sources |
| 4 | Promotional Language | "stunning, world-class, hidden gem" | Neutral description |
| 5 | Vague Attributions | "experts say... studies show" | Name the actual source |
| 6 | Formulaic Challenges/Prospects | "despite challenges... bright future" | Specific problems and concrete plans |

### Communication (#19–#21, #29)

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 19 | Chatbot Phrases | "Hope this helps! Let me know" | Remove |
| 20 | Training Cutoff Disclaimers | "as of my last update" | Find sources or remove |
| 21 | Sycophantic Tone | "Great question! Exactly right" | Respond directly |
| 29 | False Nuance | "Actually, it's more nuanced..." | Add real evidence or cut |

### Filler & Hedging (#22–#24)

| # | Pattern | What AI does | Fix |
|---|---------|-------------|-----|
| 22 | Filler Phrases | Padding words | Cut |
| 23 | Excessive Hedging | Over-qualified statements | Direct statement |
| 24 | Vague Positive Conclusions | "bright future ahead" | Specific plans or facts |

## Language-specific patterns

### Language (#7–#12) — grammar and vocabulary

| # | KO | EN | ZH | JA |
|---|----|----|----|----|
| 7 | AI filler vocabulary | AI vocabulary (delve, tapestry) | AI buzzwords (赋能/助力/深耕) | AI buzzword overuse |
| 8 | -jeok (적) suffix overuse | Copula avoidance ("serves as") | Four-character idioms (成语) | -teki (的) suffix overuse |
| 9 | Negative parallelisms | Negative parallelisms | 的/地/得 over-normalization | Negative parallelisms |
| 10 | Rule of three | Rule of three | Parallelism overuse (排比句) | Rule of three |
| 11 | Synonym cycling | Synonym cycling | Synonym cycling | Synonym cycling |
| 12 | Verbose particles | False ranges ("from X to Y") | Verbose prepositional frames | Katakana loanword overuse |

### Style (#13–#18) — formatting and register

| # | KO | EN | ZH | JA |
|---|----|----|----|----|
| 13 | Excessive connectors | Em dash overuse | Excessive connectors | Excessive connectors |
| 14 | Boldface overuse | Boldface overuse | Boldface overuse | Boldface overuse |
| 15 | Inline-header lists | Inline-header lists | Inline-header lists | Inline-header lists |
| 16 | Progressive tense (-고 있다) | Title Case in headings | 地-adverb overuse | Excessive keigo (ございます) |
| 17 | Emojis | Emojis | Emojis | Emojis |
| 18 | Excessive formal language | Curly quotation marks | Bureaucratic register (公文体) | Stiff である-style |

### Structure (#25–#28) — document-level

| # | KO | EN | ZH | JA |
|---|----|----|----|----|
| 25 | Structural repetition | Metronomic paragraph structure | Structural repetition | Structural repetition |
| 26 | Translationese | Passive nominalization chains | Translationese / Europeanized | Translationese |
| 27 | Passive voice overuse | Zombie nouns | 被-overuse | ている progressive overuse |
| 28 | Unnecessary loanwords | Stacked subordinate clauses | 总分总 structure overuse | 起承転結 formula overuse |

## Universal extensions (v3.4.0+)

| # | All languages |
|---|---------------|
| 30 | Rhetorical question openers ("Have you ever wondered…?", "혹시 ~인가요?", "那么…呢？", "~でしょうか？") |
| 31 | Conclusion signal words ("In conclusion", "결론적으로", "总而言之", "結論として") |
| 32 | Comparative adverb overuse — KO `보다` / JA `より` only |

## Score-only viral hooks (v3.11.0+)

Each language has a `patterns/{lang}-viral-hook.md` pack with 5 score/audit-only patterns:

1. Shock numbers as hook
2. Clickbait mystery close
3. Source-skipping authority
4. Breath-optimized short-sentence stacking
5. Hyperbolic engagement lexicon

These signals affect `--score` and `--audit` only. `--rewrite`, `--diff`, and `--ouroboros` skip them because the rhetoric may be intentional.

## AI-lexicon overlap (step 4.7)

Separate from the pattern catalog, two flat dictionaries flag AI-favored phrases:

- `lexicon/ai-en.md` — 108 entries (50 strict + 58 phrases)
- `lexicon/ai-ko.md` — 102 entries (49 strict + 54 phrases)

Densities are computed per 1000 tokens; threshold default is 2.0. See `core/stylometry.md` §16 for the algorithm and the post-evaluation drop list.

## Adding a new language

1. Create `patterns/{lang}-content.md`, `{lang}-language.md`, `{lang}-style.md`, `{lang}-communication.md`, `{lang}-filler.md`, `{lang}-structure.md`, and optionally `{lang}-viral-hook.md` for score-only SNS signals.
2. Set `language: {lang}` in each file's frontmatter.
3. Use `/patina --lang {lang}` — auto-discovered, no config changes needed.

Pattern frontmatter format:

```yaml
---
pack: my-patterns
language: ko
name: My Custom Patterns
version: 1.0.0
patterns: 1
---
```

## Custom patterns

Drop a `.md` file into `custom/patterns/` — auto-loaded:

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

See [CONTRIBUTING.md](../CONTRIBUTING.md) for submission guidelines and staleness reports.
