# Live rhetoric A/B and default flip (2026-09-14)

Status: PLAN.md v2 leftover-rhetoric question, now with first-draft **and** `--verify`. Product default rhetoric text flipped to H-RHETORIC after this run.
Tree: `bot/rhetoric-default-live-20260914` from `d3fa6b6f0ead3d77e982b752272c40c49b9727c9` (`origin/dev`).
Raw stdout JSON is local-only under `.omo/research/rhetoric-ab-20260914/` (gitignored).

This is a same-model A/B, not a language-wide quality claim, not §7.B 288-call scale, and not §7.C confirmation.

## What was run

| Field | Value |
|---|---|
| Backend requested | `claude-cli` |
| Model requested | `claude-sonnet-4-6` (CLI default). Response model id is **not** returned by `claude-cli` stdout; not silently swapped |
| Auth | Live `pong` ping, then 52 rewrite-path CLI invocations |
| Cases | 13: PLAN §2.3 KO diagnostic 8 + KO marketing/product T + KO natural N + EN marketing T + EN natural N |
| Arms | source no-op (0 calls); `default` (old similar-weight); `h-rhetoric` |
| Modes | `first_draft` and `--verify` on **every** case × both policies |
| Verify retries observed | 0 (`retried: false` on all 26 verify runs) |
| Fallback | none (`backend.fallback` absent) |

`codex` / `gemini` / `kimi` were on PATH and **not** used.

## Verdict (human, not AI-score)

Short PLAN §2.3 T leftover (`혁신적인`, numeric `폭발적으로`) **did not reproduce** on either policy, matching #819. C quote / `지수적으로` / slogan / unique intensity / possibility stayed on both. Natural N was light-touch on both; H stayed closer to the source.

The remaining mechanical tell on the **old default** is the similar-weight instruction restocking promo:

- KO marketing `--verify` (old default): stock CTA `망설이지 마세요` plus restocked “생활 방식 자체를 바꾸는 경험”. MPS/fidelity 100 — score drop is **not** how this failed.
- Same case, H-RHETORIC `--verify`: CTA and lifestyle restock gone; 7일 / 월 9,900원 kept.
- Old default also added modality (`바꿀 수 있다`) and a derived `세 배` on the short T cases; H dropped empty hype without those extras.

C/N damage from H: **not observed**. Traffic C used PLAN-allowed `급증` on one H verify. No verify-retry restore of leftover hype.

`primary_cause` for leftover-on-verify marketing: **prompt restock** (similar-weight clause), not gate skip, colliding pattern pack, or verify revert. P2a–d not implemented.

## Product change

Default rhetoric strings are now the H-RHETORIC text. `rhetoricPolicy: 'h-rhetoric'` stays an alias. `PATINA_RHETORIC_POLICY=legacy` restores the similar-weight sentence. Fidelity length envelope (50–130% / ±30%) is unchanged.

## What this is not

- Not KO/EN/ZH/JA performance.
- Not n=8-as-proof; the discriminating leftover was the longer marketing T, not the two PLAN one-liners.
- Not §7.B / §7.C.
- Not a scorer-threshold or verify-floor change.
