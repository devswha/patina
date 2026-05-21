# Lexicon Freshness Lift Report

- Language: en
- Source: hape-en-gpt4o-vs-human-2026-05-22
- Validated at: 2026-05-22
- Input: artifacts/rebaseline-2025/private/hape-en.private.jsonl
- Entries evaluated: 108
- Decision summary: 88 keep / 20 drop
- Gate: **PASS** (8290 hot docs, 8290 cold docs)
- Source note: HAP-E MIT English paired corpus: GPT-4o 2024-08-06 continuations vs human chunk_2; raw text kept local/private, aggregate only committed.

## Source provenance

- <https://huggingface.co/datasets/browndw/human-ai-parallel-corpus>
- <https://cmustatistics.github.io/data-repository/language/hap-e.html>
- Public report policy: aggregate counts only; raw corpus rows stay local/private.

## Register coverage

| class | registers |
|---|---|
| hot | acad=1227, blog=1526, fic=1395, news=1322, spok=1721, tvm=1099 |
| cold | acad=1227, blog=1526, fic=1395, news=1322, spok=1721, tvm=1099 |

## Entry decisions

| decision | kind | entry | hot docs | cold docs | lift | cold rate |
|---|---|---|---:|---:|---:|---:|
| drop | phrase | a host of | 9 | 14 | 0.64 | 0.17% |
| drop | phrase | a wide range of | 26 | 47 | 0.55 | 0.57% |
| drop | phrase | close the gap | 1 | 1 | 1 | 0.01% |
| drop | phrase | driving force | 25 | 7 | 3.57 | 0.08% |
| drop | phrase | end-to-end | 1 | 3 | 0.33 | 0.04% |
| drop | phrase | gain a deeper understanding | 0 | 0 | 0 | 0.00% |
| drop | phrase | in the age of | 6 | 4 | 1.5 | 0.05% |
| drop | phrase | it is essential to | 32 | 13 | 2.46 | 0.16% |
| drop | phrase | key drivers | 1 | 3 | 0.33 | 0.04% |
| drop | phrase | on the other hand | 157 | 158 | 0.99 | 1.91% |
| drop | phrase | play a key role | 1 | 5 | 0.2 | 0.06% |
| drop | phrase | to ensure that | 140 | 43 | 3.26 | 0.52% |
| drop | phrase | under the hood | 3 | 2 | 1.5 | 0.02% |
| drop | strict | dimensions | 179 | 46 | 3.89 | 0.55% |
| drop | strict | elevated | 74 | 61 | 1.21 | 0.74% |
| drop | strict | enable | 140 | 82 | 1.71 | 0.99% |
| drop | strict | framework | 380 | 129 | 2.95 | 1.56% |
| drop | strict | state-of-the-art | 36 | 24 | 1.5 | 0.29% |
| drop | strict | unleash | 45 | 13 | 3.46 | 0.16% |
| drop | strict | workflow | 11 | 8 | 1.38 | 0.10% |
| keep | phrase | a deeper dive | 7 | 0 | Infinity | 0.00% |
| keep | phrase | a myriad of | 67 | 3 | 22.33 | 0.04% |
| keep | phrase | a new chapter | 138 | 0 | Infinity | 0.00% |
| keep | phrase | a new era | 130 | 9 | 14.44 | 0.11% |
| keep | phrase | a new frontier | 8 | 0 | Infinity | 0.00% |
| keep | phrase | a plethora of | 26 | 5 | 5.2 | 0.06% |
| keep | phrase | a robust framework | 28 | 0 | Infinity | 0.00% |
| keep | phrase | a wide array of | 13 | 1 | 13 | 0.01% |
| keep | phrase | at its core | 48 | 2 | 24 | 0.02% |
| keep | phrase | at the forefront | 95 | 2 | 47.5 | 0.02% |
| keep | phrase | at the heart of | 143 | 18 | 7.94 | 0.22% |
| keep | phrase | best practices | 51 | 6 | 8.5 | 0.07% |
| keep | phrase | bridge the gap | 94 | 3 | 31.33 | 0.04% |
| keep | phrase | comprehensive approach | 33 | 1 | 33 | 0.01% |
| keep | phrase | continuous improvement | 28 | 1 | 28 | 0.01% |
| keep | phrase | ever-changing | 74 | 0 | Infinity | 0.00% |
| keep | phrase | ever-evolving | 144 | 0 | Infinity | 0.00% |
| keep | phrase | fast-paced | 53 | 3 | 17.67 | 0.04% |
| keep | phrase | gain valuable insights | 2 | 0 | Infinity | 0.00% |
| keep | phrase | glean insights | 3 | 0 | Infinity | 0.00% |
| keep | phrase | harness the power | 8 | 0 | Infinity | 0.00% |
| keep | phrase | holistic approach | 128 | 4 | 32 | 0.05% |
| keep | phrase | in the digital age | 23 | 0 | Infinity | 0.00% |
| keep | phrase | in the modern era | 7 | 1 | 7 | 0.01% |
| keep | phrase | in today's | 69 | 17 | 4.06 | 0.21% |
| keep | phrase | key insights | 4 | 0 | Infinity | 0.00% |
| keep | phrase | key takeaways | 2 | 0 | Infinity | 0.00% |
| keep | phrase | pave the path | 4 | 0 | Infinity | 0.00% |
| keep | phrase | pave the way | 133 | 1 | 133 | 0.01% |
| keep | phrase | play a crucial role | 75 | 4 | 18.75 | 0.05% |
| keep | phrase | plays a vital role | 11 | 1 | 11 | 0.01% |
| keep | phrase | rapidly changing | 42 | 1 | 42 | 0.01% |
| keep | phrase | rapidly evolving | 32 | 1 | 32 | 0.01% |
| keep | phrase | realize the potential | 3 | 0 | Infinity | 0.00% |
| keep | phrase | the bigger picture | 22 | 2 | 11 | 0.02% |
| keep | phrase | the competitive landscape | 1 | 0 | Infinity | 0.00% |
| keep | phrase | the digital landscape | 13 | 0 | Infinity | 0.00% |
| keep | phrase | the future of | 212 | 24 | 8.83 | 0.29% |
| keep | phrase | the landscape of | 134 | 1 | 134 | 0.01% |
| keep | phrase | the realm of | 224 | 7 | 32 | 0.08% |
| keep | phrase | the regulatory landscape | 4 | 0 | Infinity | 0.00% |
| keep | phrase | the world of | 241 | 42 | 5.74 | 0.51% |
| keep | phrase | unlock the potential | 6 | 0 | Infinity | 0.00% |
| keep | phrase | usher in | 37 | 6 | 6.17 | 0.07% |
| keep | phrase | valuable insights | 124 | 3 | 41.33 | 0.04% |
| keep | strict | accelerate | 69 | 17 | 4.06 | 0.21% |
| keep | strict | actionable | 104 | 3 | 34.67 | 0.04% |
| keep | strict | align | 370 | 17 | 21.76 | 0.21% |
| keep | strict | alignment | 135 | 23 | 5.87 | 0.28% |
| keep | strict | amplify | 117 | 5 | 23.4 | 0.06% |
| keep | strict | bespoke | 69 | 8 | 8.63 | 0.10% |
| keep | strict | bolster | 175 | 12 | 14.58 | 0.14% |
| keep | strict | catalyst | 161 | 26 | 6.19 | 0.31% |
| keep | strict | compelling | 340 | 27 | 12.59 | 0.33% |
| keep | strict | curated | 106 | 7 | 15.14 | 0.08% |
| keep | strict | cutting-edge | 165 | 1 | 165 | 0.01% |
| keep | strict | dynamic | 765 | 110 | 6.95 | 1.33% |
| keep | strict | ecosystem | 205 | 48 | 4.27 | 0.58% |
| keep | strict | elevate | 106 | 4 | 26.5 | 0.05% |
| keep | strict | empower | 142 | 4 | 35.5 | 0.05% |
| keep | strict | empowering | 166 | 7 | 23.71 | 0.08% |
| keep | strict | enabling | 263 | 39 | 6.74 | 0.47% |
| keep | strict | envision | 117 | 9 | 13 | 0.11% |
| keep | strict | ethical | 259 | 25 | 10.36 | 0.30% |
| keep | strict | harness | 218 | 14 | 15.57 | 0.17% |
| keep | strict | impactful | 83 | 3 | 27.67 | 0.04% |
| keep | strict | inclusive | 205 | 18 | 11.39 | 0.22% |
| keep | strict | inflection | 12 | 0 | Infinity | 0.00% |
| keep | strict | meaningful | 305 | 48 | 6.35 | 0.58% |
| keep | strict | modalities | 61 | 15 | 4.07 | 0.18% |
| keep | strict | pivot | 184 | 5 | 36.8 | 0.06% |
| keep | strict | prioritize | 239 | 3 | 79.67 | 0.04% |
| keep | strict | reimagine | 22 | 0 | Infinity | 0.00% |
| keep | strict | rethink | 45 | 3 | 15 | 0.04% |
| keep | strict | scalable | 34 | 5 | 6.8 | 0.06% |
| keep | strict | seamless | 176 | 4 | 44 | 0.05% |
| keep | strict | seamlessly | 352 | 9 | 39.11 | 0.11% |
| keep | strict | skillset | 4 | 0 | Infinity | 0.00% |
| keep | strict | streamline | 42 | 3 | 14 | 0.04% |
| keep | strict | streamlined | 26 | 3 | 8.67 | 0.04% |
| keep | strict | sustainable | 690 | 67 | 10.3 | 0.81% |
| keep | strict | thoughtful | 228 | 33 | 6.91 | 0.40% |
| keep | strict | thrive | 279 | 18 | 15.5 | 0.22% |
| keep | strict | thriving | 137 | 6 | 22.83 | 0.07% |
| keep | strict | toolkit | 39 | 3 | 13 | 0.04% |
| keep | strict | transformative | 417 | 5 | 83.4 | 0.06% |
| keep | strict | unlock | 165 | 15 | 11 | 0.18% |
| keep | strict | vibrant | 989 | 13 | 76.08 | 0.16% |
