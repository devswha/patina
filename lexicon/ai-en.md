---
pack: ai-lexicon-en
language: en
version: 1.0.0
entries: 108
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
- state-of-the-art
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
- enable
- enabling
- align
- alignment
- pivot
- ecosystem
- workflow
- skillset
- toolkit
- framework
- modalities
- dimensions
- harness
- unlock
- unleash
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
- elevated
- reimagine
- rethink
- envision
- prioritize

## Multi-word phrases (case-insensitive substring)

- a wide range of
- a wide array of
- a host of
- a plethora of
- a myriad of
- in today's
- in the modern era
- in the digital age
- in the age of
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
- gain a deeper understanding
- gain valuable insights
- glean insights
- valuable insights
- key insights
- key takeaways
- key drivers
- driving force
- play a crucial role
- play a key role
- plays a vital role
- pave the path
- bridge the gap
- close the gap
- at the forefront
- at the heart of
- at its core
- end-to-end
- holistic approach
- comprehensive approach
- best practices
- continuous improvement
- to ensure that
- it is essential to
- a deeper dive
- under the hood
- the bigger picture
- a robust framework
- on the other hand
- the digital landscape
- the regulatory landscape
- the competitive landscape

## Notes on each entry (why AI-favored)

Single words above cluster around three habits the catalog under-covers:
modal scaffolding ("empower", "enable", "harness", "unlock"), abstraction
nouns AI defaults to over concrete ones ("ecosystem", "workflow", "toolkit",
"framework", "modalities", "dimensions"), and self-flattering quality
adjectives ("meaningful", "impactful", "thoughtful", "compelling"). None
duplicate `en-language.md` Pattern 7's word list — they extend it.

Calibration drop list (v3.7 eval, see core/stylometry.md §16):
"intersection", "principles", "mindset", "iterative", "responsible",
"methodologies", "redefine", "accessible", "equitable", "one of the most",
"in conjunction with", "the power of" — fired more on Wikipedia/HC3 human
than on HC3 ChatGPT. Do not re-add without re-running the eval.

The phrases above are templated openers and closers AI uses to package
ordinary content as significant: "in today's [adjective] world", "the
ever-evolving landscape of X", "unlock the potential of Y", "play a crucial
role in Z". A single hit is forgivable; density is the signal — that is
what the density-per-1000-tokens threshold measures.

Adding entries: prefer phrases AI uses to scaffold significance over
content. Verify against HC3 ChatGPT samples before shipping. If a phrase
also fires in HC3 human at similar rate, drop it.
