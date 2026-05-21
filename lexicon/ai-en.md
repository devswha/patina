---
pack: ai-lexicon-en
language: en
version: 1.0.0
entries: 88
entry-provenance: lexicon/provenance/ai-en.json
corpus-snapshot:
  id: hape-en-gpt4o-vs-human-2026-05-22
  status: current
  source: HAP-E English paired corpus, GPT-4o 2024-08-06 continuations vs human chunk_2; see docs/benchmarks/lexicon-freshness-en-2026-05-22.md
  last_validated: 2026-05-22
---

# AI-favored vocabulary (English)

Phrases that AI assistants reach for far more often than human writers, but
which the 28-pattern catalog does not already enumerate. These extend the
language/content/style packs without overlapping them.

The catalog already lists 30 vocabulary words in `en-language.md` Pattern 7
(delve, tapestry, multifaceted, leverage, etc.) and the promotional/emphasis
adjectives in `en-content.md` Patterns 1 and 4. This lexicon adds words and
phrases beyond those — modal scaffolding, register tells, and corporate
abstractions that the catalog has not yet named.

Match policy:
- Strict matches use case-insensitive whole-word match
- Multi-word phrases use case-insensitive substring match
- A trailing `s` or `ing` form counts as the same entry; do not double-count

## Strict matches (case-insensitive whole word)

- transformative
- cutting-edge
- bespoke
- curated
- dynamic
- vibrant
- seamless
- seamlessly
- streamline
- streamlined
- empower
- empowering
- enabling
- align
- alignment
- pivot
- ecosystem
- skillset
- toolkit
- modalities
- harness
- unlock
- bolster
- amplify
- accelerate
- catalyst
- inflection
- meaningful
- impactful
- actionable
- scalable
- sustainable
- inclusive
- ethical
- thoughtful
- compelling
- thrive
- thriving
- elevate
- reimagine
- rethink
- envision
- prioritize

## Multi-word phrases (case-insensitive substring)

- a wide array of
- a plethora of
- a myriad of
- in today's
- in the modern era
- in the digital age
- ever-evolving
- ever-changing
- rapidly evolving
- rapidly changing
- fast-paced
- the world of
- the realm of
- the landscape of
- the future of
- unlock the potential
- realize the potential
- harness the power
- pave the way
- usher in
- a new era
- a new chapter
- a new frontier
- gain valuable insights
- glean insights
- valuable insights
- key insights
- key takeaways
- play a crucial role
- plays a vital role
- pave the path
- bridge the gap
- at the forefront
- at the heart of
- at its core
- holistic approach
- comprehensive approach
- best practices
- continuous improvement
- a deeper dive
- the bigger picture
- a robust framework
- the digital landscape
- the regulatory landscape
- the competitive landscape

## Notes on each entry (why AI-favored)

Single words above cluster around three habits the catalog under-covers:
modal scaffolding ("empower", "harness", "unlock"), abstraction
nouns AI defaults to over concrete ones ("ecosystem", "toolkit",
"modalities"), and self-flattering quality
adjectives ("meaningful", "impactful", "thoughtful", "compelling"). None
duplicate `en-language.md` Pattern 7's word list — they extend it.

Calibration drop list (v3.7 eval, see core/stylometry.md §16):
"intersection", "principles", "mindset", "iterative", "responsible",
"methodologies", "redefine", "accessible", "equitable", "one of the most",
"in conjunction with", "the power of" — fired more on Wikipedia/HC3 human
than on HC3 ChatGPT. Do not re-add without re-running the eval.

Freshness drop list (2026-05-22 HAP-E re-mine, see
`docs/benchmarks/lexicon-freshness-en-2026-05-22.md`):
"state-of-the-art", "enable", "workflow", "framework", "dimensions",
"unleash", "elevated", "a wide range of", "a host of", "in the age of",
"gain a deeper understanding", "key drivers", "driving force",
"play a key role", "close the gap", "end-to-end", "to ensure that",
"it is essential to", "under the hood", "on the other hand" — missed the
≥4× hot-vs-cold document-frequency lift or zero-hot floor against 8,290
GPT-4o continuations and 8,290 paired human controls. Do not re-add without
a newer paired-corpus lift report.

The phrases above are templated openers and closers AI uses to package
ordinary content as significant: "in today's [adjective] world", "the
ever-evolving landscape of X", "unlock the potential of Y", "play a crucial
role in Z". A single hit is forgivable; density is the signal — that is
what the density-per-1000-tokens threshold measures.

Adding entries: prefer phrases AI uses to scaffold significance over
content. Verify against HC3 ChatGPT samples before shipping. If a phrase
also fires in HC3 human at similar rate, drop it.
