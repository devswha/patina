# Decorative-rhetoric stage trace (2026-09-14)

Status: static / offline trace only. No product prompt, threshold, or version change.
Inspected tree: `bot/rhetoric-stage-trace` @ `a9b2c6483d3f553ae70a1b3b08c09d2428fdf2f7` (`origin/dev`).
Plan source: PLAN.md v2 in the sibling checkout `/home/devswha/workspace/patina/PLAN.md` (read-only, untracked there; not copied or committed here).

This note answers PLAN v2 §4 before any H-RHETORIC experiment: where would a leftover like the PLAN §2.3 synthetic adverb survive on the current rewrite path, and do existing tools already record stage outputs?

**Do not treat this note as permission to ship a prompt change.**

## Verdict

| Field | Value |
|---|---|
| `primary_cause` | **unknown** |
| Strongest static hypothesis | **prompt conflict** on the first draft (rewrite instructions collide; the adverb is not a rewrite-pack watch word) |
| Ruled out as generate-skip | CLI rewrite always calls a backend; `warnIfAlreadyHuman` is advisory |
| Conditional later cause | **verify revert** only if `--verify` is on; not observed |
| Postprocess restore | **not supported** by current `cleanRewriteOutput` |
| Live rewrite | **not run** |

Evidence is insufficient to name a single observed failure stage. PLAN v2 §4: if evidence is thin, record `unknown`.

## What was run / not run

### Run (deterministic / offline)

- Read PLAN.md v2 (sibling path, read-only).
- Read `src/cli/run.js`, `src/cli/args.js`, `src/cli/score-gate.js`, `src/prompt-builder.js`, `src/verify.js`, `src/output.js`, `src/scoring.js` (MPS/fidelity prompts), `src/logger.js`, `src/backends/contract.js`, `.patina.default.yaml`.
- Repo-wide search: the syllable `폭발` does not appear in tracked `patterns/`, `lexicon/`, `core/`, `document-types/`, or `personas/`.
- Offline `buildPrompt` + `analyzeText` + `scoreDeterministicSignals` + `cleanRewriteOutput` + `droppedNumbers` against a **synthetic** PLAN §2.3 sentence. Worktree has no `node_modules`; the same SHA was imported from `/home/devswha/workspace/patina` with default-config snapshot only (`loadConfig(..., { snapshotPath: .patina.default.yaml })`). No user `.patina.yaml` overlay. No model call.
- Binary presence check: `claude`, `codex`, `gemini`, `kimi` are on `PATH`. Home dirs `~/.claude`, `~/.codex`, `~/.gemini` exist. `PATINA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` were unset in this shell.

### Not run

- Live rewrite, `--verify`, MPS/fidelity judges, retry, hosted playground.
- `tests/quality/live-quality.mjs --live`, iterative baseline, benchmark, npm, paid HTTP.
- PLAN §7 diagnostic KO-8 live stage capture.
- Backend login/auth probes beyond file and binary presence. PLAN §3: file presence is not success. Skip-vs-generate did not need a generate call (see F1).
- #159 / #643 (not revived).

## Existing stage-recording surfaces (reuse; no new public flag)

PLAN asked to reuse tools if they already record first draft / verify reject / retry / postprocess / returned text.

| Surface | What it records | First draft text? | Retry text? | Returned text? |
|---|---|---|---|---|
| Default rewrite stdout | Final body only (`formatOutput` → `cleanRewriteOutput`) | no | no | yes (final only) |
| `--verify --format json` | `verification.{verified,mps,fidelity,retried,reason,mpsFloor,fidelityFloor,outputHash}` (`src/output.js:352-357`) | no | no | `output` = final body; hash of verify-selected text (`src/cli/run.js:295-300`) |
| stderr `verify.*` / `rewrite.*` | Status strings: `verify.retry`, `verify.retry_failed`, `verify.result`, `verify.failed`, `verify.output_changed`, `rewrite.meaning_guard`, `rewrite.over_editing_guard` | no | no | no |
| `PATINA_LOG_LEVEL` | Filters those events (`src/logger.js:21-26`). `debug` exists but the rewrite path does not emit stage payloads at debug | no | no | no |
| `--dry-run` | XLIFF plan only; rejected without `--xliff` (`src/cli/args.js:658-662`) | n/a | n/a | n/a |
| `--exit-on` / `applyScoreGate` | Score-mode overall gate (`src/cli/score-gate.js:5-17`; wired from `src/cli/run.js:390-392`) | n/a | n/a | n/a |
| Web receipt v2 | Hashes + MPS/fidelity public fields; attempt **counts/usage**, not bodies (`src/web-rewrite-receipt.js:138-166`, `src/web-rewrite-stream.js:112-180`) | no | no | hash only |
| `PATINA_KO_DIAGNOSIS_RESEARCH=1` | Hosted KO diagnosis research flag, not a CLI stage dump | no | no | no |
| `tests/quality/live-quality.mjs` | Input → one rewrite → scores. Default is skip-live. Does **not** call `verifyRewrite` | no (only delivered rewrite) | no | yes, if `--live` |
| `scripts/iterative-rewrite-baseline.mjs` | Iteration scores; not CLI `--verify` stages | iteration texts in memory; not a public CLI ledger | n/a | research-only |

**Fact R1.** There is no existing public or private CLI flag that writes a first-draft / verify-reject / retry / postprocess / returned-text ledger. Closest reusable status channel: `--verify --format json` plus stderr `verify.*` events. This PR does not add a flag.

## Current rewrite path (code)

```
input
  → warnIfAlreadyHuman          # advisory; never returns early
  → buildPrompt (strict|minimal)
  → invokeBackendChain          # always, if rewrite mode
  → [--verify] verifyRewrite    # opt-in
        grade first draft
        if below floor: one STRICT retry from original
        if still below: highest-fidelity candidate
  → cleanRewriteOutput          # strip [BODY]/[SELF_AUDIT]/register footer
  → deterministicMeaningGuard   # dropped numbers only; warn
  → droppedNumbers              # can set exit 4; does not rewrite
  → formatOutput                # stdout
```

Citations: `src/cli/run.js:232-249` (guard + first generate), `254-308` (`--verify` block), `310-331` (postprocess + number guard), `376` (emit).

## Facts

### F1. Generate is not skipped

`runDefault` always `await invokeBackendChain(...)` after the over-editing warning (`src/cli/run.js:232-249`). `warnIfAlreadyHuman` returns `null` or a score and never blocks (`src/cli/run.js:1236-1256`, `.patina.default.yaml:73-78`). Short text (`paragraphs<=2`) makes the deterministic score `skipped` (`scoreDeterministicSignals`); the guard then no-ops (`src/cli/run.js:1244-1245`) and rewrite still proceeds.

Offline: the PLAN synthetic one-liner scored `skipped: true`, `skipReason: "paragraphs<=2"`, `hotParagraphs: 0`. That is a scorer skip, not a rewrite skip.

### F2. `--verify` is opt-in

`parsed.verify` defaults unset; `--verify` sets it (`src/cli/args.js:188-189, 805`). Default output is rewrite without MPS/fidelity (`src/cli/run.js:256`). Floors exist in config (`verification.mps-floor` / `fidelity-floor` = 70, `.patina.default.yaml:156-158`) but are unused unless `--verify` (or XLIFF, which implies verify).

A leftover on **default** CLI rewrite cannot be a verify revert.

### F3. Prompt assembly tells the model both to cut hype and to keep meaning/weight

Strict Phase 2 (`src/prompt-builder.js:448-457`):

- step 3: preserve core meaning, claims, polarity, causation, numbers
- step 5: “Cut filler and hype freely, but replace it with natural phrasing of similar weight; never compress the text into a summary”
- fidelity length band 50–130% is named in that same step as a reason to keep length

Minimal KO/EN (`src/prompt-builder.js:740-742`) repeats: keep meaning/numbers/causation; cut filler/hype; replace with similar-weight phrasing (±30%).

`core/voice.md` (loaded as “Claim-safe Rewrite Baseline”, `src/prompt-builder.js:311-314`) tells the model to preserve source viewpoint, complexity, and not invent stance. It does not name manner adverbs such as the PLAN example.

### F4. The PLAN adverb is not a rewrite watch word

- Tracked tree: no `폭발`.
- Rewrite-active KO packs (6): communication, content, filler, language, structure, style. `ko-viral-hook` is `score_only` and filtered out of rewrite/diff (`src/prompt-builder.js:262-268`, `src/loader.js:81`).
- Closest listed token is viral-hook “N% 폭증” (`patterns/ko-viral-hook.md:25`), score-only, so it is not in the rewrite catalog. Strict rewrite prefixes still *mention* `ko-viral-hook` only as cross-references from other packs (“this is not viral-hook #2/#4”).
- Offline `buildPrompt`: the adverb appears in the input fence only, not in the instruction prefix (strict `## Input Text`, minimal `## 입력`).
- `ko-content` #1 targets 획기적/전환점-style importance stacking (`patterns/ko-content.md:16-29`), not manner-of-increase adverbs. Preservation note there: do not shrink real scale when removing importance words.

Local CLI backends default to `promptMode: 'minimal'` (`src/backends/contract.js:116-149`, `src/cli/run.js:739-746`). HTTP default is `strict`. Neither prefix lists the PLAN adverb.

### F5. Postprocess cannot restore or target the adverb

`cleanRewriteOutput` only splits `[BODY]`, strips `[SELF_AUDIT]`, and drops a trailing register footer (`src/output.js:247-259`). Offline: wrapping the synthetic sentence in `[BODY]…[/BODY]` plus a self-audit block still leaves the adverb in the body. There is no rhetorical rewriter in postprocess.

`droppedNumbers` is digit-token identity (`src/verify.js:50-54`). Removing only the adverb while keeping `100`/`300` yields `[]`. It cannot reject or restore a manner adverb.

### F6. Verify retry, if enabled, prefers minimal change and then source-closest text

On floor miss, one retry is built from the **original** plus `STRICT_RETRY_DIRECTIVE` (`src/verify.js:68-79, 146-161`):

- preserve every claim, number, named entity, polarity, causal relation
- prefer leaving a sentence unchanged
- only remove AI-pattern wording; never rephrase content whose meaning could shift

If retry also misses: sort by higher fidelity, then MPS; emit that candidate (`src/verify.js:179-190`). That is fail-closed for meaning, not for leftover hype. A first draft that dropped a manner adverb and a retry that restored it would, on a fidelity tie-break toward the source, prefer restoration. This path is **not observed** here.

### F7. Judge prompts already authorize de-puffing — with a degree/intensifier tension

MPS (`src/scoring.js:717-723`): extract “quantifier: number, degree, or range” **and** “Stylistic packaging is NOT an anchor. Intensifiers, marketing hype… must never be penalized as meaning loss.”

Fidelity (`src/scoring.js:872-880`): stripping inflated adjectives / marketing hype is the intended outcome; intensifier absence is never a claims loss.

So a verify **reject** of a safe de-puff is not implied by the fidelity rubric. It remains possible if a judge treats the PLAN adverb as a degree quantifier (MPS SOFT/HARD_FAIL) rather than packaging. Unverified without a live grade.

### F8. live-quality is not a verify-stage tracer

`tests/quality/live-quality.mjs` scores one delivered rewrite (or skips). It does not invoke `verifyRewrite`. Enabling `--live` would still not separate first draft / reject / retry.

## Hypotheses (not observed)

### H1. Prompt conflict produces a first-draft leftover (most likely static story)

The model is told to cut hype **and** keep meaning plus similar weight, and is given no rewrite-pack example that the PLAN adverb is hype. A conservative model can copy “폭발적으로 증가합니다” as a claim. Local CLIs use the shorter minimal prompt, which has even less pattern context.

This would make `primary_cause = prompt_conflict` **if** a live first draft already contains the leftover. Not shown.

### H2. `--verify` retry / fidelity pick can undo a good first cut

Only if `--verify` is on **and** the first draft actually de-puffed. STRICT retry + highest-fidelity pick can restore source wording. Would be `verify_revert`. No live pair.

### H3. Gate skip

Not supported for generate. The only “skip” on the synthetic line is deterministic scoring `paragraphs<=2`, which does not skip `invokeBackendChain`.

## Unverified

- Whether any real user leftover used `--verify`, which backend/promptMode, or which document-type/persona.
- Actual first draft, retry body, or judge rationale for any input.
- Whether MPS would call the PLAN adverb a degree quantifier or packaging.
- Whether a local CLI seat is authenticated (binaries and home dirs only).
- Language transfer (EN/ZH/JA). KO packs only.
- Quality metrics from PLAN §6. This is a path map, not an efficacy result.

## What this is not

- Not an H-RHETORIC implementation or prompt-diff recommendation.
- Not a scorer-threshold or verify-floor change.
- Not a revival of #159 / #643.
- Not evidence that leftover rhetoric is “working as designed” or that first drafts already fail.

## Next research step (out of scope)

Reuse `--verify --format json` plus stderr `verify.*` on a **pre-declared** synthetic T/C/N set (PLAN §2.3 / §7.A). Capture first draft by wrapping or logging **outside** product stdout (worktree-local sidecar), without a new public CLI flag and without changing rewrite instructions. If the first draft already keeps the leftover, test H-RHETORIC as a single-variable prompt experiment. If the first draft cuts it and `--verify` restores it, test verify-retry assembly — not the first-draft prompt. If evidence stays mixed, keep `primary_cause = unknown`.
