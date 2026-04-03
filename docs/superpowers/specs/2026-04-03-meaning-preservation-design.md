# Meaning Preservation System Design

**Date**: 2026-04-03
**Status**: Draft
**Version**: patina v3.2.0+
**Approach**: Semantic Anchor + Constraint-Embedded Hybrid (A+C)

## Problem Statement

When patina humanizes AI-generated text, the transformation can corrupt the original meaning in two primary ways:

1. **Claim deletion/weakening** — Key facts, conclusions, or arguments are lost or diluted during pattern correction
2. **Meaning inversion** — Polarity flips (negative→positive or vice versa) alter the original intent

The current pipeline has fidelity scoring, but it is **post-hoc** (measured after humanization, not during). Self-review (Step 5c) is subjective with no structured methodology. There is no mechanism to prevent meaning corruption during pattern application.

## Requirements

| Requirement | Source |
|-------------|--------|
| Detect claim deletion and polarity inversion | User feedback |
| Verify meaning at each Phase boundary (not just final output) | User preference |
| When corruption detected, attempt alternative correction before falling back to original | User preference |
| Cover full system: pipeline + scoring + pattern packs | User preference |
| Work across all supported languages (ko, en, ja, zh) | Existing architecture |
| No external dependencies (local LLM, RAG, etc.) — prompt-only | Architecture constraint |

## Design Overview

```
Input Text
  │
  ▼
[Step 4.5] Semantic Anchor Extraction
  │  → Extracts: Claims, Polarity, Causation, Quantifiers, Negations
  │  → Output: Internal anchor list (not shown to user)
  │
  ▼
[Step 5a] Phase 1 — Structure (existing)
  │
  ▼
[Step 5a-v] Anchor Verification ← NEW
  │  → Check each anchor: PASS / SOFT FAIL / HARD FAIL
  │  → SOFT FAIL: Retry with constraint-embedded prompt (max 1)
  │  → HARD FAIL: Restore original sentence
  │
  ▼
[Step 5b] Phase 2 — Sentence/Vocabulary (existing, with constraint injection)
  │  → HIGH-risk patterns include preservation constraint in correction prompt
  │
  ▼
[Step 5b-v] Anchor Verification ← NEW
  │  → Same logic as 5a-v
  │  → Additional: Check Phase 1 corrections weren't reverted
  │
  ▼
[Step 5c] Self-Review (ENHANCED)
  │  → Structured checklist replaces subjective question
  │  → Final anchor reconciliation
  │  → MPS calculation
  │
  ▼
Output + Scores (AI Score, Fidelity, MPS)
```

## Section 1: Semantic Anchor Extraction (Step 4.5)

### Anchor Types

| Type | What It Captures | Example |
|------|------------------|---------|
| **Claim** | Factual assertions, conclusions | "The system failed", "Revenue grew 30%" |
| **Polarity** | Positive/negative/neutral stance | "has not been verified" → negative |
| **Causation** | Cause-effect relationships | "A caused B", "Due to X, Y happened" |
| **Quantifier** | Numbers, degrees, ranges | "p<0.05", "approximately 3x", "most" |
| **Negation** | Negation expressions | "does not", "impossible", "never" |

### Extraction Rules

- Extract only **explicitly stated** meaning. Do not infer implicit or between-the-lines meaning.
- Maximum **3 anchors per paragraph** to bound verification cost.
- Each anchor records: `{type, content, paragraph_index, polarity}`
- Anchor list is internal working memory — never included in user-facing output.
- Anchors are language-agnostic in structure; the LLM extracts them in the source language.

### When to Skip

- Text is ≤1 paragraph and ≤2 sentences: skip extraction, run pipeline normally (overhead not justified).

## Section 2: Phase-Boundary Anchor Verification (Steps 5a-v, 5b-v)

### Verification Logic

After each Phase completes, compare the result against the anchor list:

```
FOR each anchor IN anchor_list:
  IF anchor.content is present AND anchor.polarity is preserved:
    → PASS
  ELSE IF anchor.content is present BUT weakened/ambiguous:
    → SOFT FAIL
  ELSE IF anchor.content is missing OR anchor.polarity is inverted:
    → HARD FAIL
```

**SOFT FAIL criteria** (anchor is present but weakened):
- A specific claim became vague: "Revenue grew 30%" → "Revenue grew significantly"
- A quantifier lost precision: "p<0.05" → "statistically meaningful"
- A causal link became correlational: "A caused B" → "A is associated with B"
- A definitive statement became hedged: "The system failed" → "The system may have had issues"

**PASS vs SOFT FAIL boundary**: If the anchor's core assertion can still be unambiguously recovered by a reader, it is PASS. If a reader could reasonably interpret the rewritten version differently from the original, it is SOFT FAIL.

### Verdict Actions

| Verdict | Condition | Action |
|---------|-----------|--------|
| **PASS** | Anchor meaning preserved, polarity intact | Proceed to next step |
| **SOFT FAIL** | Anchor exists but weakened/ambiguous | Attempt alternative correction (1 retry) |
| **HARD FAIL** | Anchor deleted or polarity inverted | Restore original sentence for that segment |

### Alternative Correction (Retry on SOFT FAIL)

When a SOFT FAIL is detected:

1. Re-apply the same pattern to the **original sentence** (not the failed result)
2. Inject constraint into the correction prompt: "The following meaning MUST be preserved: {anchor.content}"
3. Verify the retry result against the anchor
4. If retry also fails → treat as HARD FAIL (restore original)
5. Maximum 1 retry per anchor — no retry loops

### Step 5b-v Additional Check

Step 5b-v includes everything in 5a-v plus:
- **Regression check**: Verify that corrections made in Phase 1 (5a) were not reverted by Phase 2 (5b). Compare 5a output against 5b output for the specific segments that 5a modified.

## Section 3: Constraint-Embedded Pattern Application

HIGH semantic-risk patterns inject meaning preservation constraints directly into the correction prompt.

### How It Works

Standard pattern correction (current):
```
"Correct this AI pattern: [pattern description]. Rewrite naturally."
```

Constraint-embedded correction (new, for HIGH-risk patterns):
```
"Correct this AI pattern: [pattern description]. Rewrite naturally.
CONSTRAINT: The following claims must appear in your rewrite:
- {anchor_1.content}
- {anchor_2.content}
Do not invert, weaken, or omit these claims."
```

### When Constraints Are Injected

- **HIGH risk patterns**: Always inject constraints for anchors in the affected paragraph
- **MEDIUM risk patterns**: Inject only if the paragraph contains Polarity or Negation anchors
- **LOW risk patterns**: No constraint injection (style-only changes, no meaning risk)

## Section 4: Scoring Extension (scoring.md)

### New Metric: Meaning Preservation Score (MPS)

Calculated from anchor verification results:

```
anchor_pass_rate = PASS_count / total_anchor_count
polarity_preserved = polarity_PASS_count / total_polarity_anchor_count

MPS = (anchor_pass_rate × 0.6 + polarity_preserved × 0.4) × 100
```

**Retry counting rule**: If a SOFT FAIL anchor passes after retry (alternative correction), it counts as PASS in the MPS formula. Only anchors that remain SOFT FAIL or HARD FAIL after all remediation are counted as failures.

If no polarity anchors exist, formula simplifies to:
```
MPS = anchor_pass_rate × 100
```

### MPS Interpretation

| Range | Label | Meaning |
|-------|-------|---------|
| 90–100 | Excellent | Full meaning preservation |
| 70–89 | Good | Minor weakening, acceptable |
| 50–69 | Warning | Significant anchor loss, review needed |
| < 50 | Critical | Severe meaning corruption |

### Integration Points

**1. `--score` mode output:**
```
AI Score: 23/100 (Good)
Fidelity: 85/100 (High)
MPS: 92/100 (Excellent)  ← new
```

**2. Ouroboros loop gating:**
- Existing: fidelity floor = 70 → rollback if violated
- New: **MPS floor = 70** → rollback if violated (independent of fidelity)
- Both floors must pass for an iteration to be accepted

**3. MAX mode candidate selection:**
- Current: Select candidate with lowest AI score
- New: Select candidate with lowest AI score **WHERE MPS ≥ 70**
- Candidates with MPS < 70 are disqualified regardless of AI score

## Section 5: Per-Pattern Semantic Risk Classification

Each pattern in all pattern packs gains two new fields.

### New Fields

```markdown
Pattern #N: [Name]
- Detection: ...
- Correction: ...
- Exclusion conditions: ...
- Semantic Risk: LOW | MEDIUM | HIGH        ← new
- Preservation Note: ...                     ← new
```

### Risk Classification Criteria

| Risk | Criteria | Example Patterns |
|------|----------|------------------|
| **LOW** | Style/format only, no content change | Excessive bold, emoji overuse, sentence length |
| **MEDIUM** | Expression change may weaken meaning | Exaggerated modifiers, unnecessary transitions |
| **HIGH** | Correction risks altering core claims | False Nuance, vague sourcing, Challenge-Prospect template |

### Verification Coupling

- **HIGH**: Anchor Verification prioritizes paragraphs affected by this pattern
- **MEDIUM**: Standard verification
- **LOW**: Anchor Verification may skip affected paragraphs (efficiency gain)

### Migration

All existing patterns across 4 languages (24 pattern files) need classification. This is a one-time effort. Default to MEDIUM if uncertain — it's the safe middle ground.

## Section 6: Enhanced Self-Review (Step 5c)

### Revised 5c Process

```
Step 5c — Self-Review (Enhanced)
  1. AI Inspection (existing): "Where does this read like AI?"
  2. Final Anchor Reconciliation (new):
     - Compare full anchor list against final output
     - Any HARD FAILs not yet resolved (missed by 5a-v/5b-v) → restore original sentences
     - Note: Most HARD FAILs are already handled in 5a-v/5b-v; this is a safety net, not a duplicate pass
  3. Polarity Inversion Scan (new):
     - Explicit check: "Are there any places where the original's
       negative became positive, or vice versa?"
     - Focus on negation words, comparative statements, conditional clauses
  4. Regression Check (existing, now specified):
     - Compare Phase 1 output segments against final output
     - If any Phase 1 correction was reverted → re-apply Phase 1 correction
  5. Final MPS Calculation:
     - Compute MPS from anchor verification results
     - Include in output if --score or --ouroboros mode
```

### Key Changes from Current 5c

| Aspect | Before | After |
|--------|--------|-------|
| AI check | Subjective question | Unchanged (still valuable) |
| Meaning check | None | Structured anchor reconciliation |
| Polarity check | None | Explicit polarity inversion scan |
| Regression check | "Be careful" warning | Specified comparison method |
| Output | Brief answer | Checklist results + MPS |

## Files Affected

| File | Change Type | Description |
|------|-------------|-------------|
| `SKILL.md` | Modify | Add Step 4.5, Steps 5a-v/5b-v, enhance Step 5c, add MPS to output |
| `core/scoring.md` | Modify | Add MPS metric, formulas, interpretation table, integration rules |
| `patterns/ko-*.md` (6 files) | Modify | Add Semantic Risk + Preservation Note to each pattern |
| `patterns/en-*.md` (6 files) | Modify | Same |
| `patterns/ja-*.md` (6 files) | Modify | Same |
| `patterns/zh-*.md` (6 files) | Modify | Same |
| `SKILL-MAX.md` | Modify | Add MPS gating to candidate selection |
| `patina-max/SKILL.md` | Modify | Same MPS gating for installed MAX mode |

## Out of Scope

- Local LLM or RAG integration (conflicts with prompt-only architecture)
- Implicit/between-the-lines meaning preservation (too subjective, would cause over-conservatism)
- Automated pattern risk classification (manual one-time classification is more reliable)
- User-facing anchor display (anchors are internal working memory only)

## Version Sync

All version fields in `SKILL.md`, `SKILL-MAX.md`, `patina-max/SKILL.md`, `.patina.default.yaml`, `README.md` must be bumped together per existing CLAUDE.md rules.
