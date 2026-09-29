# How the field measures and achieves AI-tell removal — literature survey (2026-09)

Status: research note, no code or corpus change  
Written: 2026-09-02  
Scope: benchmarks and techniques for *removing* AI-writing tells (humanization,
AI-polish, style rewriting), plus the measurement instruments those papers use.
Complements an internal May 2026 detection survey (not committed) that covered
the *detector* side; this note does not repeat it except where a detection
paper carries a humanization result.

Every arXiv identifier below was resolved against `arxiv.org/abs/<id>` on
2026-09-02 and the title matched. Items without an arXiv ID are cited by venue.
Vendor-reported numbers are labelled as such.

## 0. Why this survey, and the honest frame

Studies 0–3 (`2026-rewrite-efficacy*.md`) established four facts about patina's
rewrite that this survey is built around:

1. A plain single-pass rewrite reliably lowers blind-judge AI-likeness on AI
   text: EN documents −14.2 (Study 0 pilot, n=7) and −23.4 (Study 1, n=21);
   KO documents −6.0 (Study 1, n=27). But the cues that survive are
   **structural** (uniform report-style paragraphs, checklist coverage, tidy
   intro–body–resolution arcs), not lexical: 40% of surviving cues in EN and
   75% in KO (Study 1 H6; 49% / 81% among judgments that still said "AI"), and
   75–82% in the KO structure studies (S2, S3). Cues that flipped judges to
   "human" cited *specificity*.
2. Two structural interventions — pattern prose in the prompt (S2) and a
   plan→execute step (S3) — did not move perception, dropped facts, and pushed
   human controls *toward* AI. Both compressed the text (length ratio 0.86–0.93).
3. The `edited-AI` class (`lightly edited AI`, `heavily edited AI`) is empty in
   the rebaseline matrix, though it is the most likely shape of real user input.
4. The human-evaluation panel (`human-eval-panel.md`, #159) is designed but has
   never run, and the meaning proxy (MPS) checks anchors only.

The September 2 backlog prioritized the KO GPT-family miss review. This survey
records possible follow-up work as pre-registrable hypotheses in §9; the
historical backlog does not fix the order of future investigations.

Ethics frame (`docs/ETHICS.md`): patina's success metric is *perceived*
AI-likeness by blind readers plus meaning preservation, not detector bypass.
Most of the literature below is written as attacks on detectors. Their evasion
numbers are reported here because they are the only large-scale humanization
measurements that exist, not because bypass is a goal.

## 1. How humanization is benchmarked

| Benchmark / study | Year, venue | What is humanized | Success metric | Quality / meaning metric | Structure measured? | Fact gate? |
|---|---|---|---|---|---|---|
| Recursive paraphrasing (Sadasivan et al.) | 2023→TMLR 2025, arXiv 2303.11156 | ~300-token passages, DIPPER paraphraser | detector AUROC / TPR@low FPR | human study + perplexity + downstream task accuracy | no | no |
| RAID (Dugan et al.) | ACL 2024, arXiv 2405.07940 | 6M generations × 11 adversarial attacks | detector accuracy at fixed FPR | none for attacks | no | no |
| DetectRL (Wu et al.) | NeurIPS 2024 D&B, arXiv 2410.23746 | prompt / paraphrase / perturbation / data-mixing attacks | zero-shot AUROC drop: prompt −2.6%, paraphrase −17.5%, perturbation −38.5%, mixing −20.3% | none | no | no |
| DAMAGE (Masrour et al.) | GenAIDetect @ COLING 2025, arXiv 2501.03437 | 19 commercial humanizer / paraphraser tools | detector recall | *qualitative* faithfulness review of each tool | no | no |
| TH-Bench (Zheng et al.) | KDD 2025, arXiv 2503.08708 | 6 attacks (paraphrase, perturbation, data-mixing) × 13 detectors × 6 datasets, 19 domains, 11 LLMs | evasion effectiveness | fluency (GPT-2 perplexity), semantic consistency (embedding similarity before/after), complexity; plus compute overhead | no | no |
| PADBen (2025) | arXiv 2511.00416 | iterative paraphrase of human and AI text | 5 progressive detection tasks over a 5-type text taxonomy | none | no | no |
| DetectRL-X | ACL 2026, arXiv 2605.15518 | 8 languages, 6 domains, 4 commercial LLMs; polishing / expanding / condensing ops; multilingual paraphrase + perturbation attacks | detector AUROC across 8 dimensions | none | no | no |
| Pangram 4 technical report | 2026, arXiv 2607.27183 | output of 13 commercial humanizers | vendor-reported 98.83% of humanized output still flagged | none | no | no |
| HumanizerBench (commercial) | web, 2026 | 5 commercial detectors | bypass rate 42% + meaning preservation 32% + readability 16% + consistency 10%; readability rated by an LLM | embedding / LLM-rated | no | no |

Three things fall out of the table.

- **Quality is always fluency + similarity.** Every peer-reviewed benchmark
  measures text quality as perplexity (or grammar) plus an embedding-similarity
  "semantic consistency" score. None asks blind human readers whether the
  result reads human; none measures document architecture; none gates on
  numbers, entities, polarity, or causation. patina's Study 1–3 instrument
  (cross-family blind panel + anchor-based meaning gate) is therefore *stricter*
  than the field norm, which is worth stating in public docs.
- **Perturbation and mixing beat paraphrase on detectors** (DetectRL), and a
  2026 forensic-linguistic study of three commercial humanizers finds detector
  degradation comes from "the accumulation of localized microtransformations
  affecting lexical predictability, stylistic regularity, and normative
  stability", not "deep discourse restructuring" (Queralt et al., *Biblioteca
  de Babel* 2026). That is the opposite of what patina's judges respond to,
  which is one more reason not to import detector bypass as the metric.
- **Commercial detectors have adapted.** Pangram 4 claims near-total recall on
  humanizer output; PADBen shows the remaining hole is a "laundering region"
  where iterative paraphrase preserves generation patterns while displacing
  semantics. Any public claim that patina output "passes detectors" would be
  both off-mission and, on current evidence, false.

## 2. Edited, polished, and mixed text (feeds step 2: edited-AI intake)

| Dataset | Year, venue | Direction | How edit depth is operationalized | Headline finding |
|---|---|---|---|---|
| HPPT / Polish Ratio (Yang et al.) | 2023, arXiv 2307.11380 | human → ChatGPT-polished abstracts | "polish ratio" = measured modification degree vs. original | detectors trained on pure-AI fail on polished text |
| MixSet (Zhang et al.) | NAACL 2024 Findings, arXiv 2401.05952 | both: AI-revised human, human-revised AI | operation type (token- and sentence-level polish, complete, rewrite, token- and sentence-level adapt) | existing detectors struggle on "mixtext", especially subtle edits |
| Beemo (Artemova et al.) | NAACL 2025, arXiv 2411.04032 | AI → expert-edited (6.5k) and AI → LLM-edited (13.1k) | edit source (expert vs LLM) × use case | **expert edits evade detection; LLM edits do not** |
| APT-Eval (Saha & Feizi) | ACL 2025, arXiv 2502.15666 | human → AI-polished, 14.7K samples | two schemes: degree-based (extremely-minor / minor / slightly-major / major prompts) and percentage-based (a fixed p% of words modified, p from 1% upward); 12 detectors | detectors flag even minimally polished text; 46% of LLaMA2-7B-polished vs 23% of DeepSeek-V3-polished samples flagged; speech domain most fragile |
| HERO (2025) | EMNLP 2025 Findings, arXiv 2509.15350 | 4-way: human / generated / polished / translated | class label with length-specialist models | polished and translated text are separable classes, not noise |
| EditLens (Thai et al., Pangram) | 2025, arXiv 2510.03154 | human → AI-edited | **lightweight similarity metrics validated by human annotators**, then a regression model on edit magnitude | ternary human/AI/mixed F1 90.4; Grammarly case study |
| DETree / RealBench (He et al.) | NeurIPS 2025, arXiv 2510.17489 | all collaboration modes | hierarchical affinity tree over processes | hybrid texts carry stronger AI traces than human ones |
| Ar-APT (Almohaimeed et al.) | J. Big Data 2026, arXiv 2511.16690 | human Arabic → slightly polished by 10 LLMs × 4 settings | polish setting | Originality.ai human-only accuracy 92% → 12% after slight polish |
| OpAI-Bench (Bsharat et al.) | June 2026, arXiv 2606.06481 | human → progressively AI-revised, 9 versions per document | AI coverage level × 5 edit operations × 4 domains, provenance at document / sentence / token / span | detectability is **non-monotonic** in AI share: intermediate mixed versions are harder than either endpoint; operation and revision history matter |
| Post-editing for personal style (Baumler et al.) | ACL 2026, arXiv 2604.24444 | AI draft → human post-edited, pre-registered n=81 | embedding style similarity to the author's own unassisted writing | post-editing moves style toward the author but stays closer to LLM text; authors *perceive* it as theirs anyway |

Implications for the step 2 data contract:

- Define edit depth by a **measured similarity continuum** (EditLens / Polish
  Ratio style: character- and embedding-level distance from the source), not
  by the intent label alone. "Lightly edited" as a prompt instruction is not a
  reproducible class.
- Record the **operation** (polish / expand / condense / rewrite / humanize)
  and the **direction** (human→AI-polished vs AI→human-edited). Beemo shows the
  two directions behave oppositely under detection; OpAI-Bench shows
  detectability depends on the operation and on cumulative history.
- Expect non-monotonic behaviour from patina's deterministic score too:
  OpAI-Bench's finding predicts that a 30–60% AI-share document may score
  *lower* than either endpoint. Report score against measured edit depth as a
  curve, not a threshold.
- Baumler's perception gap ("feels like mine, still reads LLM") is the same
  gap patina's over-editing guard exists for. A human-edited-AI fixture set
  should carry the author's own baseline text where licensing allows.

## 3. What humans actually use as cues (feeds step 3: human-eval panel)

- **Frequent LLM users are excellent detectors; non-users are at chance.**
  Russell, Karpinska & Iyyer (ACL 2025, arXiv 2501.15654): 300 non-fiction
  articles from GPT-4o / Claude / o1; five "expert" annotators' majority vote
  misclassifies 1 of 300 (expert TPR 92.7 / FPR 4.0 vs non-expert 56.7 / 51.7),
  beating most commercial detectors *including on paraphrased and humanized
  text*. Cue coding of their explanations: "AI vocabulary" (vibrant, crucial,
  significantly) is the most common giveaway; close behind are **formulaic
  sentence and document structures ("optimistically vague conclusions")** and
  **originality**. Non-experts fixate on any fancy word or on informality
  (contractions, slang) as a human sign. "Neither paraphrasing nor humanization
  effectively removes all of these signatures."
- **Untrained intuitions are flawed and manipulable.** Jakesch, Hancock &
  Naaman (PNAS 2023, arXiv 2206.07271): six experiments, N=4,600; people
  associate first-person pronouns, contractions, and family topics with
  humanness, so AI text can be made "more human than human".
- **Multilingual upper bound.** "Is Human-Like Text Liked by Humans?" (ACL 2026,
  arXiv 2502.11614): 16 datasets, 9 languages, 9 domains, 19 annotators reach
  87.6% accuracy. The gaps they name are **concreteness, cultural nuance, and
  diversity**. Humans do not always prefer human text when they cannot tell
  the source.
- **Korean, rubric-calibrated — and revised.** Park & Han, arXiv 2601.19913.
  Earlier versions (v3 checked; "From Intuition to Calibrated Judgment", LREAD) reported
  three trained annotators going from 0.60 (intuition only, 30 essays) to 0.90
  (criterion-anchored rubric, disjoint 30 essays). **v4 (2026-08-01) retitles
  the paper "When LLM Essays Outscore Student Essays" and reframes it as a
  post-hoc rubric audit**: on a 16-criterion, 100-point Korean rubric, 24 LLM
  essays beat 6 student essays by 18.35 points; orthographic norms and
  genre-appropriate register account for 44.7% of the gap (all 72 LLM ratings
  hit the orthographic maximum, 70 the register maximum), while students score
  highest on both creativity criteria and on *natural Korean phrasing*, exactly
  where reader agreement is weak. Cite v4, not the LREAD framing (the internal
  May 2026 detection note used the v3 framing). The reusable finding is that
  Korean AI text is
  "too correct" on orthography and register and that Korean readers disagree
  most on naturalness — an external replication of patina's Study 1 Arm D
  construct noise (α = 0.53).
- **Japanese.** Zaitsu et al. (PLOS One 2025): stylometry (phrase patterns, POS
  bigrams, function-word unigrams) separates 100 human comments from 350 texts
  by 7 LLMs at 99.8%, but 403 lay participants are weak, and the more polished
  o1 outputs are read as *more* human than GPT-4o's.
- **German medical essays.** Doru et al. (JMIR Med Educ 2025): 70% correct;
  redundancy (OR 6.9), repetition (OR 8.1), and thread/coherence (OR 6.6) drive
  the "AI" call, not content errors.
- **Attribution labels swamp content.** "Everyone prefers human writers,
  including AI" (arXiv 2510.08831): the label alone shifts humans +13.7 pp
  toward "human-written" and LLM judges +34.3 pp; labels invert the evaluation
  criteria applied to identical features. Consistent with Findings of ACL 2025
  "Human Bias in the Face of AI" (arXiv 2410.03723), a >30% swing on swapped
  labels.

What this says about patina's evidence so far: the structure-vs-specificity
split that patina's LLM judges produced in Studies 0–3 is the same split human
experts produce (Russell: structure + originality; 2502.11614: concreteness +
diversity). It is not an artifact of LLM judging.

Design consequences for the panel (recorded for step 3, not started):

- Recruit or screen for **heavy LLM users**, or add a rubric-calibration phase;
  a lay panel measures label bias, not text.
- Full label blinding, no tool names, both orders — attribution bias is larger
  than any rewrite effect measured so far.
- Report **"AI-call"** and **"preference"** separately; the two dissociate.
- Reuse a published **cue coding scheme** so patina's cue data is comparable:
  Russell's categories (vocabulary, structure, originality, formality, clarity)
  plus 2502.11614's (concreteness, cultural nuance, diversity).

## 4. What differs measurably: the layered evidence base for a structure transform

The tells stack in four layers. Each has quantitative evidence and a different
half-life.

**Layer 1 — lexical (fast-moving, model-specific, easiest to remove).**
Kobak et al. (Science Advances 2025, arXiv 2406.07016) track excess vocabulary
in 14M+ PubMed abstracts and date the surge to late 2022. Juzek & Ward (COLING
2025, arXiv 2412.11385) isolate 21 focal words and find model testing
consistent with RLHF as a cause. Sam Paech's Slop Score and the Antislop
framework (ICLR 2026, arXiv 2510.15061) profile per-model over-represented
words, "not X but Y" frames, and trigrams against a human baseline; some
patterns are >1,000× more frequent in LLM output. Wikipedia's living
"Signs of AI writing" catalog notes in 2026 that much of the 2024–25 list is
already outdated for newer models and that GPT-5-era and Grok vocabulary differ.
**Reading:** lexicon freshness must be dated and model-family-stamped
(`lexicon-freshness-audit.md` already assumes this; the drift rate is faster
than the audit cadence).

**Layer 2 — grammatical (stable across model generations, measurable without a
model).** Reinhart et al. (PNAS 2025, arXiv 2410.16107), using Biber features on
parallel corpora: GPT-4o uses present participial clauses 5.3× the human rate
(paired d = 1.38), nominalizations 2.1× (d = 1.23), "that"-clauses as subject
2.6× (d = 0.77), phrasal coordination 1.9× (d = 0.81), and agentless passives at
about half the human rate. The style is "informationally dense, noun-heavy",
it is **stronger in instruction-tuned than base models**, and it persists when
the model is asked to mimic informal genres. Muñoz-Ortiz et al. (AI Review
2024) find humans have wider sentence-length dispersion, more vocabulary
variety, shorter constituents. Desaire et al. (Cell Rep. Phys. Sci. 2023) find
scientists write longer paragraphs and use "but / however / although" more.
SenFlow (June 2026, arXiv 2606.18946) finds that even after a perplexity filter
equalizes overt cues, AI insertions in hybrid documents keep a
generator-dependent **sentence-length gap**. **Reading:** patina's burstiness
CV is a Layer-2 signal with independent 2026 support. patina's EN pattern packs
already describe nominalization chains (`en-structure` #26/#27) and
present-participle chains (`en-content`) as rewrite targets, but the
deterministic layer (`src/features/*`, `core/stylometry.md`) does not measure
their *rates*; Reinhart's effect sizes say those rates would be strong
model-free signals.

**Layer 3 — discourse and argument structure (durable; what patina's judges
keep flagging).** Kim et al. (ACL 2024, arXiv 2402.10586) show hierarchical
discourse motifs separate human from machine text even OOD and after
paraphrase. "Argument Collapse" (Kim, Chang, Pham & Iyyer, arXiv 2606.01736):
in 195 NYT debates 65.3% of human main arguments are unique vs 3.4% of LLM
ones; sub-arguments 41.0% vs 9.1%; LLM essays follow a fixed arc (direct claim →
proposals) and reuse generalized, hedged sub-arguments where humans use
concrete, topic-specific ones. Inoshita et al. (arXiv 2603.21228, 6,875 essays)
measure a quality–homogenization trade-off in which cohesion architecture
loses 70–78% of its variance under AI augmentation. "Narrative Flattening"
(arXiv 2605.27878) isolates the cause with matched OLMo 32B checkpoints:
post-training compresses thematic, affective and stylistic variation; base
models sit closer to humans. Sui (arXiv 2602.16162) quantifies a persistent
uncertainty gap across 28 LLMs. Jiang et al. (Written Communication 2025)
and Mo et al. (JEAP 2025) find far fewer engagement and stance markers
(questions, personal asides, hedged evaluation) in LLM essays.

**Layer 4 — content selection (survives paraphrase entirely).** "Idiosyncrasies
in LLMs" (ICML 2025, arXiv 2502.12150) classifies five model families at 97.1%
and the signal **persists after the text is rewritten, translated, or
summarized by another LLM** — it is encoded in *what is said*, not how.
Argument Collapse says the same at essay level. **Reading:** a rewrite that only
re-shapes will leave Layer 4 intact, and Layer 4 is where human experts locate
"originality" and "concreteness".

**Cross-cutting: LLM editing changes meaning in a biased direction.** Abdulhai
et al. (arXiv 2603.18161): even grammar-only edit prompts alter semantics;
heavy LLM use raised the share of essays that stay *neutral* on the question
by ~70%. "From May to Is" (arXiv 2606.07951): certainty distortion affects up
to 75% of rewrite outputs, is 1.5–2× more likely to *increase* certainty than
decrease it, and compounds over iterations (claude-haiku-4-5: 20% after one
pass, 40% after five, medical domain). Prompt interventions reduce but do not
remove it.

**How this maps onto Studies 0–3.** The internal deterministic score fell hard
because it measures Layers 1–2. Judges kept calling the rewrite AI because
Layers 3–4 were untouched. S2/S3's compression (length ratio 0.86–0.93) is the
mechanism by which a rewrite *deletes specifics* — the very Layer-4 material
that reads human — while leaving the arc in place. The literature therefore
suggests the failure was not only "structure was not reorganized" but
"concreteness was removed", and the two should be separated in step 4's design.

## 5. Techniques with evidence

| Technique | Exemplar | Layer it changes | Meaning metric reported | Structure change reported | Fit for patina |
|---|---|---|---|---|---|
| Prompted / recursive paraphrase | DIPPER (arXiv 2303.13408); Sadasivan et al. TMLR 2025; TH-Bench "Prompt" attack | 1–2 | perplexity, similarity, human study | no | already the baseline (Study 1) |
| Adversarial word-level perturbation | Zhou et al., COLING 2024, arXiv 2404.01907 | 1 | minimal | no | detector-specific; off-mission |
| Detector-guided adversarial paraphrase | Cheng et al., NeurIPS 2025, arXiv 2506.07001 (T@1%F −87.9% avg; "mostly slight" quality loss) | 1–2 | quality/attack trade-off | no | needs a detector in the loop; off-mission |
| RL against detector APIs | AuthorMist, arXiv 2503.08716 (3B GRPO; ASR 78.6–96.2%; "semantic similarity above 0.94"); HUMPA proxy attack, arXiv 2410.19230 (AUROC −70.4%) | 1–2 | embedding similarity | no | trained model; off-mission |
| Multi-stage style alignment | MASH, ACL 2026 Findings, arXiv 2601.08564 (style-injection SFT → DPO → inference refinement; ASR 92%, "superior linguistic quality") | 1–2 | fluency / quality | no | trained model |
| Iterative base-model paraphrase | HIP, arXiv 2605.19516 (10 rounds; detector human-probability 0→~100%; semantic score 10→6–8) | 1–3? | LLM-judged semantic score | no (but shows *instruction tuning* is what detectors track) | direction is right (undo RLHF register); cost is meaning loss over rounds |
| Interpretable style-axis obfuscation | StyleRemix, EMNLP 2024, arXiv 2408.15666 (7 LoRA axes incl. formality, length; content preservation = cosine, grammar = CoLA; >5 axes hurts grammar); TinyStyler, EMNLP 2024 Findings, arXiv 2406.15586; AuthorMix, arXiv 2603.23069 (per-author LoRA, better meaning preservation than GPT-5.1) | 1–2 (length axis touches 3) | cosine / human | length only | closest to patina's pattern-pack philosophy; needs adapters, so a backend-side research track, not core |
| Decoding-time suppression | Antislop, ICLR 2026, arXiv 2510.15061 (backtracking sampler, 8,000+ patterns; FTPO −90% slop) | 1 | task benchmarks unchanged | no | generation-time, not rewrite; **its slop-profiling pipeline is reusable for lexicon mining** |
| Taxonomy-guided span editing | LAMP / Chakrabarty et al., CHI 2025, arXiv 2409.14509 (7 categories: cliché, redundant exposition, purple prose, poor sentence structure, lack of specificity, awkward phrasing, tense inconsistency; 1,057 paragraphs, 8,035 expert edits; automatic editing "shows promise", experts still prefer expert edits) | 1–2, some 4 (specificity) | expert preference | no | same shape as patina's suspect zones; its "lack of specificity" category is the Layer-4 handle |
| Quality-reward reranking | WQRM, arXiv 2504.07532 (writing-quality reward model; test-time generate-and-rank; experts prefer 66%, 72% at reward gap >1) | all, indirectly | expert preference | no | generate-k-and-rank is cheap to add on top of any backend |
| Discourse-structure RL | Align to Structure, AAAI 2026, arXiv 2504.03622 (token-level rewards from discourse-motif distinctiveness vs human writing) | 3 | ROUGE | **yes** | generation, not rewrite; no fact gate; the only method that targets Layer 3 explicitly |
| Human-like edit RL | Ziegenbein et al. 2026 (self-contained sentence-level edits; rewards = semantic similarity + fluency + pattern conformity; "LLMs perform multiple scattered edits and change meaning; humans encapsulate dependent changes") | 1–2 | similarity | no | supports patina's span-local edit contract and explains S2/S3's meaning loss |
| Human post-editing | Beemo; Baumler et al. ACL 2026 | 1–4 | n/a | implicit | the only intervention that reliably reads human *and* evades detection |

**Headline negative result.** None of the methods surveyed here reports *both*
a document-architecture change measure *and* a fact-preservation gate. The one
method that measures structure (Align to Structure) trains a generator and
evaluates with ROUGE; every rewrite-time method surveyed reports embedding
similarity and nothing about organization. Step 4 (deterministic structure transforms
with seam-only infill, judged by a blind panel under an anchor gate) would be
the first such measurement. That justifies the experiment; it also means there
is no prior art to calibrate its bar against.

## 6. Meaning preservation: what the field uses vs. what patina uses

- The humanization literature's standard is **embedding cosine similarity**
  (AuthorMist "above 0.94", StyleRemix, TH-Bench "semantic consistency", HIP's
  LLM-judged score). Meta-evaluations say this is weak: MeaningBERT
  (Frontiers in AI 2023) shows BERTScore and QuestEval correlate poorly with
  human meaning-preservation judgments and fail two trivial content tests;
  Babakov et al. (2022, 57 measures on 19 datasets) find cross-encoder /
  bidirectional-entailment measures (Mutual Implication Score) outperform
  everything else for paraphrase and style transfer. EditLens is the exception
  that validated its similarity metrics against human annotators first.
- patina's anchor-based MPS (numbers, entities, polarity, causation) is more
  conservative than the field norm, and `adversarial-mps.md` already records
  its limit: anchor preservation does not imply humanness.
- Two failure modes the literature documents that MPS does not yet check:
  **certainty inflation** (arXiv 2606.07951: asymmetric, compounding) and
  **stance neutralization** (arXiv 2603.18161: claims flattened to neutral).
  Step 6's fixture list already names modality; it should add certainty
  *direction* and claim-neutrality metamorphic cases.

## 7. Korean, Chinese, Japanese

- **Korean detection datasets exist; Korean humanization studies do not.**
  KatFish/KatFishNet (ACL 2025, arXiv 2503.00032: spacing, POS diversity, comma
  usage; essays / poetry / abstracts × 4 LLMs), Park & Han's rubric audit
  (arXiv 2601.19913 v4, see §3), and an unsupervised ensemble (Findings of EACL
  2026, pp. 1504–1518:
  syntactic token cohesiveness + regeneration similarity; 1,000 anchors across
  news / abstracts / essays; GPT-3.5, GPT-4o, HyperCLOVA X, Llama-3-8B; F1 up
  to 0.963). No paper found measures whether rewriting Korean AI text lowers
  perceived AI-likeness. patina's Study 1 Arm D and Studies 2–3 appear to be
  the only such data; the Korean α = 0.53 construct-noise finding now has one
  external comparator (2601.19913 v4's weak reader agreement on natural Korean
  phrasing).
- **Chinese:** C-ReD (ACL 2026 Findings, arXiv 2604.11796; real-prompt
  detection benchmark) and CUDRT (ACM TIST 2025; zh/en; create / update /
  delete / rewrite / translate operations). Detection only.
- **Japanese:** Zaitsu et al. (PLOS One 2025) is the only stylometry + human
  study found; no benchmark.
- **Multilingual:** DetectRL-X (8 commercially common languages, with
  polish/expand/condense ops) and 2502.11614 (9 languages, human upper bound).
  Neither reports per-language humanization quality.
- **Reading for step 8:** the ZH/JA corpus gap is not unique to patina; there
  is no external ZH/JA humanization baseline to borrow, so the per-language
  evidence gate has to be built, not imported. Korean is better placed than
  the note's "expect scarcity" prior: three labeled detection sets and one
  rubric exist and are reusable as external comparators — with the caveat
  that 2601.19913 changed title and framing between versions, so any reuse
  must pin the version.

## 8. Measurement lessons the field has paid for

1. **Detector bypass is not a stable or ethical primary metric.** Detectors
   adapt (Pangram 4), commercial humanizers work by micro-perturbation
   (Queralt 2026), and the theory paper 2510.20810 argues the target class
   "LLM-generated text" is not well defined once human editing enters. patina's
   blind-judge + anchor-gate instrument should stay primary; detector scores are
   at most a secondary column, as the internal May 2026 note already recommends.
2. **Label bias exceeds effect sizes.** +13.7 pp for humans, +34 pp for LLM
   judges on a label alone. Any panel or judge run that leaks tool identity is
   measuring the label.
3. **Length and register are moderators, not noise.** APT-Eval (speech domain
   most fragile), Study 0 (α 0.82 → 0.67 on truncation), Russell (document-level
   articles). Report per register and per length band.
4. **Model family is a variable.** APT-Eval's 46% vs 23% by polishing model,
   Idiosyncrasies' 97% family classification, Wikipedia's per-model vocabulary
   notes. Every generated row needs model, version, and date.
5. **Non-monotonic curves are expected** for mixed authorship (OpAI-Bench).
   A single threshold on edited-AI text will misbehave by construction.
6. **Iteration compounds distortion.** Certainty drift doubles over five
   paraphrase rounds; HIP's semantic score drops each round. Any iterative
   rewrite loop needs a per-iteration meaning check, not only a final one.

## 9. Pre-registrable hypotheses for steps 2–7 (recorded, not activated)

Each item names the metric that would decide it, in the style of
`2026-rewrite-efficacy-prereg.md`. None is started; step 1 remains the only
active item.

- **H-2 (edited-AI intake).** Edit depth defined as a measured similarity
  continuum plus operation and direction fields will produce a non-monotonic
  deterministic-score curve against AI share, with the minimum in the mixed
  region. *Decides:* whether edited-AI needs its own thresholds. *Metric:*
  score vs measured edit depth, per operation, per direction.
- **H-3 (human panel).** Screening for frequent-LLM-user raters or a
  rubric-calibration phase raises rater–panel agreement on Korean documents
  from the Study 1 α ≈ 0.53 toward the English 0.75; "preference" and
  "AI-call" will dissociate. *Metric:* Krippendorff α per phase; McNemar on
  call vs preference; cue codes on Russell + 2502.11614 categories.
- **H-4a (structure transform).** Deterministic merge/split with seam-only
  infill lowers Layer-3 proxies (paragraph-length CV, opener repetition,
  section-parallelism) without lowering the anchor gate below 95%. *Metric:*
  proxies + gate + blind panel Δ, against the Study 1 single-pass baseline.
- **H-4b (specificity preservation, competing hypothesis).** A length-floor
  and "retain every concrete detail" constraint on the *plain* rewrite lowers
  panel AI-likeness at least as much as H-4a, because S2/S3's compression
  removed Layer-4 material. *Metric:* same panel; rewrite/original length
  ratio ≥ 0.98; count of retained named entities, numbers, and examples.
  This is the cheapest test in the list and does not require a new mechanism.
  **Activated as Study 4 on 2026-09-02** (owner decision; registered in
  `2026-rewrite-efficacy-prereg.md`).
- **H-6 (meaning proxy).** Certainty-direction and claim-neutrality
  metamorphic fixtures will catch failures that anchor-MPS passes, with an
  asymmetry toward increased certainty. *Metric:* per-fixture pass rate,
  direction ratio.
- **H-7 (lexicon remine).** A slop-profile method (per-model over-representation
  ratio vs a human baseline, date-stamped) applied to KO/ZH/JA will produce
  entries with higher hot/cold lift than the current phrase lists and will show
  measurable drift between 2025 and 2026 generations. *Metric:* lift, cold
  document frequency, drift between model-generation cohorts.
- **Deterministic feature candidates for EN (any step, no LLM):** nominalization
  density, present-participial-clause rate, "that"-clause-as-subject rate,
  engagement-marker rate (questions, asides). All have published effect sizes
  (§4 Layer 2); the first two already exist as pattern-pack rules and would
  only need a rate computation in the deterministic layer, consistent with the
  determinism rule.

## References (verified 2026-09-02)

Humanization benchmarks and attacks: Sadasivan et al. 2303.11156 (TMLR 2025) ·
DIPPER 2303.13408 · RAID 2405.07940 (ACL 2024) · DetectRL 2410.23746
(NeurIPS 2024 D&B) · DAMAGE 2501.03437 · TH-Bench 2503.08708 (KDD 2025) ·
Adversarial Paraphrasing 2506.07001 (NeurIPS 2025) · PADBen 2511.00416 ·
DetectRL-X 2605.15518 (ACL 2026) · Pangram 4 2607.27183 · Zhou et al.
2404.01907 (COLING 2024) · AuthorMist 2503.08716 · HUMPA 2410.19230 · MASH
2601.08564 (ACL 2026 Findings) · HIP / Base Models Look Human 2605.19516 ·
Queralt et al., *Biblioteca de Babel* 2026 (no arXiv).

Edited / mixed text: HPPT 2307.11380 · MixSet 2401.05952 (NAACL 2024 Findings)
· Beemo 2411.04032 (NAACL 2025) · APT-Eval 2502.15666 (ACL 2025) · HERO
2509.15350 (EMNLP 2025 Findings) · EditLens 2510.03154 · DETree 2510.17489
(NeurIPS 2025) · Ar-APT 2511.16690 · OpAI-Bench 2606.06481 · Baumler et al.
2604.24444 (ACL 2026).

Human perception: Jakesch et al. 2206.07271 (PNAS 2023) · Russell et al.
2501.15654 (ACL 2025) · 2502.11614 (ACL 2026) · Park & Han 2601.19913 (v4,
2026-08-01; v1–v3 titled "From Intuition to Calibrated Judgment") · Human Bias
2410.03723 (ACL 2025 Findings) · Everyone prefers human writers 2510.08831 ·
Zaitsu et al., PLOS One 2025 · Doru et al., JMIR Med Educ 2025 · Gao et al.,
NPJ Digit Med 2023.

Measured differences: Kobak et al. 2406.07016 (Science Advances 2025) · Juzek
& Ward 2412.11385 (COLING 2025) · Measuring AI Slop 2509.19163 · Antislop
2510.15061 (ICLR 2026) · Idiosyncrasies 2502.12150 (ICML 2025) · Reinhart et al.
2410.16107 (PNAS 2025) · Threads of Subtlety 2402.10586 (ACL 2024) · Argument
Collapse 2606.01736 · Inoshita et al. 2603.21228 · Narrative Flattening
2605.27878 · Sui 2602.16162 · SenFlow 2606.18946 · Explaining Generalization
2601.07974 · Padmakumar & He 2309.05196 (ICLR 2024) · Homogenizing Effect
2508.01491 · Abdulhai et al. 2603.18161 · Certainty Distortion 2606.07951 ·
Detectability definition 2510.20810 · Muñoz-Ortiz et al., AI Review 2024 ·
Desaire et al., Cell Rep. Phys. Sci. 2023 · Jiang et al., Written
Communication 2025 · Mo et al., JEAP 2025 · Wikipedia:Signs of AI writing
(living page).

Techniques: StyleRemix 2408.15666 (EMNLP 2024) · TinyStyler 2406.15586 (EMNLP
2024 Findings) · AuthorMix 2603.23069 · LAMP 2409.14509 (CHI 2025) · WQRM
2504.07532 · Align to Structure 2504.03622 (AAAI 2026) · Ziegenbein et al.
2026 (venue unverified, cited by title).

Meaning metrics: BERTScore 1904.09675 · Babakov et al. 2022 · MeaningBERT,
Frontiers in AI 2023.

CJK: KatFishNet 2503.00032 (ACL 2025) · Findings of EACL 2026 pp. 1504–1518 ·
C-ReD 2604.11796 (ACL 2026 Findings) · CUDRT, ACM TIST 2025.
