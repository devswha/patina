# H-RHETORIC confirmation-experiment decision (2026-09-15)

Status: decision record. No product code change. No experiment was run for this
record; it decides whether and when the PLAN.md v2 §7.B/§7.C experiments run.

## Decision

**The §7.B pilot will be run.** It is the only path to the §8 quantitative
adoption criteria (safe-correction delivery ≥15%p over P with paired 95% CI,
two-judge quality agreement, C/N damage = 0). The §7.C confirmation stays
gated on the §7.B outcome, as the plan already states.

**Execution is gated on a pre-flight budget/quota confirmation, as PLAN §7.B
itself requires** ("실제 호출·상한·가격 확인 없이 파일럿을 시작하지 않는다").
Environment check on 2026-09-15 (`node bin/patina.js doctor`): five local CLI
backends authenticated (codex-cli, claude-cli, gemini-cli, kimi-cli, agy-cli);
no default HTTP API key. The pilot's ~288 calls (72 generation + 216 judge,
two judge families) would ride subscription CLI quotas whose headroom is
**unknown** from this repository. The pre-flight check must record per-backend
quota/cap evidence, per-call latency at pilot prompt sizes, and the resulting
wall-clock estimate before the first pilot call.

**Until the pilot completes, no §8-scale claim is made.** The default flip in
#828 stands on the 13-case live A/B evidence
([`2026-09-14-rhetoric-default-h.md`](2026-09-14-rhetoric-default-h.md)), with
`PATINA_RHETORIC_POLICY=legacy` as the recorded rollback path. That evidence
is a same-model diagnostic, not a confirmation: it showed the old default's
similar-weight clause restocking empty promo (`primary_cause: prompt restock`)
and no observed C/N damage from H, at n=13, one model family.

## Language scope

The H-RHETORIC text lives in the shared prompt builder, so the default flip
applies to all languages. Evidence covers KO (11 of 13 cases) and EN (2 of
13). **ZH/JA carry no evidence; KO/EN conclusions must not be transferred to
them** (PLAN §7.C). The §7.B pilot's EN slice (8 sources) is the next EN
evidence gate; ZH/JA remain exploration-only on existing data.

## What was decided against

- **Formally closing the question on the 13-case evidence.** Rejected: §8
  requires quantitative criteria the diagnostic cannot provide, and the
  discriminating failure in #828 appeared on the longer marketing case, not
  the short PLAN one-liners — sample-size sensitivity is real.
- **Starting the pilot immediately without the quota check.** Rejected by
  PLAN §7.B's own pre-flight rule and by the repository rule that paid /
  model-backed checks need explicit authorization with a recorded profile.
- **Building new experiment infrastructure before reusing existing pieces.**
  The pilot must first inventory what #817 (`tests/quality/rhetoric-contract.mjs`),
  the #828 A/B scripts (local-only under `.omo/research/`), and the existing
  quality runners already provide.

## Next action

Run the §7.B pre-flight check (quota/cap evidence per backend, call budget,
wall-clock estimate), record it in this directory, then execute the pilot
exactly as PLAN §7.B specifies: 24 unique sources (KO 16 / EN 8; T12·C6·N6),
arms N0/G/P/H on one generation model, two judge families with balanced A/B
and pre-registered flips, no retry-until-success.

## What this record is not

- Not experiment results. No call was made for this record.
- Not a relaxation of §8 thresholds.
- Not authorization to spend against any specific backend account — the
  pre-flight check produces the evidence for that authorization.
- Not a change to `PATINA_RHETORIC_POLICY` behavior or defaults.
