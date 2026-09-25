# Live current-path rewrite diagnostic (2026-09-14)

Status: PLAN v2 §7.A reproduction on the current dest rewrite path. No product prompt, threshold, or version change.
Tree: `bot/plan-live-diagnostic-20260914` @ `142b2eb5a0db9ad75c8e1efb5f77359c3a6148de` (`origin/dev` at branch creation).
Plan source (PLAN): the v2 rewrite-quality plan, §4 and §7.A, archived as [`rewrite-quality-plan-v2-20260909.md`](rewrite-quality-plan-v2-20260909.md).

This note records first-available stage outputs for eight synthetic KO cases from PLAN §2.3. It is a path reproduction, not a quality claim, not a language-wide result, and not permission to ship H-RHETORIC.

**Mode:** `first_draft_only`. `--verify` was not used.

## Verdict

| Field | Value |
|---|---|
| Backend used | `claude-cli` (default model `claude-sonnet-4-6`) |
| Auth probe | Live one-line ping, not file presence |
| Rewrite calls | 8 (one per case; no retries) |
| Verify calls | 0 |
| Observed leftover on T | **not reproduced** on these two T first drafts |
| `primary_cause` (leftover-rhetoric failure) | **unknown** — no T leftover to attribute; later stages not observed |

PLAN §4: name the first stage that actually failed. The hypothesized leftover (“폭발적으로 증가…” surviving a needed edit) did not appear on the two T first drafts in this run. C and C/T cases that kept intensity, quotes, technical degree, or a requested slogan are not leftover failures. Evidence is too thin for `draft_left_rhetoric`, `gate_skip`, `verify_revert`, or `postprocess`.

## Auth probe and command

Tried `claude` first. File `~/.claude/.credentials.json` exists; that was **not** treated as success.

```sh
printf '%s\n' 'Reply with exactly the single word pong.' \
  | claude -p --model claude-sonnet-4-6 --tools "" --strict-mcp-config
```

Result: exit 0, stdout `pong`, empty stderr. `codex` was **not** probed and **not** used.

Current-path rewrite (eight times, once each):

```sh
node bin/patina.js --lang ko --format json --backend claude-cli \
  tests/fixtures/rhetoric-live-diagnostic/<case>.txt
```

No `--verify`, `--model`, `--document-type`, `--persona`, or `--register`. Ambient `~/.patina.yaml` exists and only overlays score-path Discord category weights. It does not change rewrite instructions. Project `.patina.yaml` was absent. `PATINA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` were unset in this shell.

`--verify` was skipped because each candidate needs two scoring calls and a floor miss adds another rewrite plus two more scores (`docs/CLI.md`). That is well above “optional 8 verify” and would not stay inside the stated 8-rewrite budget.

## Cases

Public synthetic fixtures: `tests/fixtures/rhetoric-live-diagnostic/`. Raw stdout JSON stayed local-only and was not committed. All eight CLI exits were 0. All eight JSON payloads had `mode: rewrite`, `verification` absent, `gateResult: null`, `overall: null`. Stderr was empty (no `verify.*`, no `rewrite.meaning_guard`, no `backend.fallback`).

`decorative_problem_remained` is yes only when PLAN treats the wording as removable packaging **and** that packaging is still in the returned text. Keeping intensity, possibility, a quote, a technical degree, or a requested slogan on C / C/T is not counted as a leftover.

| ID | Class | Source | Returned first draft (= final) | Leftover? | `primary_cause` |
|---|---|---|---|---|---|
| 01 | T | 이 혁신적인 기능은 CSV를 JSON으로 변환합니다. | 이 기능은 CSV를 JSON으로 변환합니다. | no (`혁신적인` dropped; CSV/JSON kept) | unknown |
| 02 | T | 지난달 이용자가 100명에서 300명으로 폭발적으로 증가했습니다. | 지난달 이용자가 100명에서 300명으로 뛰었습니다. | no (`폭발적으로` dropped; 100/300/지난달 kept) | unknown |
| 03 | C | 접속량이 폭발적으로 증가해 서버가 중단됐습니다. | 접속량이 폭발적으로 늘면서 서버가 다운됐습니다. | no (intensity + outage link kept) | unknown |
| 04 | C/T | 이용자가 폭발적으로 증가하고 있습니다. | 이용자가 폭발적으로 늘고 있습니다. | no (intensity kept; PLAN allows this when scale is otherwise unmarked) | unknown |
| 05 | C | 오류율이 감소할 수 있습니다. | 오류율이 줄어들 수 있습니다. | no (possibility kept) | unknown |
| 06 | C | 연구원은 “폭발적으로 증가했다”고 설명했습니다. | 연구원은 "폭발적으로 증가했다"고 설명했다. | no (quoted adverb + attribution kept; quote marks normalized) | unknown |
| 07 | C | 탐색 공간은 입력 길이에 따라 지수적으로 증가합니다. | 탐색 공간은 입력 길이가 늘어날수록 지수적으로 커진다. | no (`지수적으로` + length relation kept) | unknown |
| 08 | C | 포스터 슬로건을 유지: 놀라운 여름, 더 큰 즐거움! | 포스터 슬로건을 유지: 놀라운 여름, 더 큰 즐거움! | no (requested slogan unchanged) | unknown |

Verify status: **not run** on every row.

Stage actually captured: returned body after `cleanRewriteOutput`. There is no public first-draft / retry ledger (see `docs/research/2026-09-14-rhetoric-stage-trace.md`). Without `--verify`, first draft and final are the same observed surface.

## Cause notes (not a single-stage proof)

- **`gate_skip`:** not supported here. Every case produced a rewrite JSON body. Empty stderr; no generate skip.
- **`draft_left_rhetoric`:** not observed on the two T cases. Cannot be the primary cause of a leftover that did not appear.
- **`verify_revert`:** not observable. `--verify` was off.
- **`postprocess`:** `cleanRewriteOutput` only strips `[BODY]` / `[SELF_AUDIT]` / a register footer. Returned texts have none of those wrappers. No evidence that postprocess restored rhetoric.
- **`unknown`:** correct overall label. This run does not locate a leftover-rhetoric failure stage.

Case 03 changed `중단됐습니다` → `다운됐습니다`. That is a wording swap, not a leftover-rhetoric stage label, and is not scored here as a quality verdict.

## What this is not

- Not KO/EN/ZH/JA performance.
- Not an H-RHETORIC result or a prompt-diff recommendation.
- Not evidence that leftover rhetoric “never happens” on other backends, models, document-types, or `--verify`.
- Not a scorer-threshold or verify-floor change.
- Not the 288-call §7.B pilot.

## What was not run

- `--verify`, MPS/fidelity judges, STRICT retry, highest-fidelity pick
- Codex (or any second backend) ping or rewrite
- Hosted playground / `tests/quality/live-quality.mjs --live`
- Iterative baseline, benchmark, npm publish, paid HTTP
- PLAN §7.B 288-call pilot and §7.C confirmation
- #159 / #643 (not revived)
- Product file edits
