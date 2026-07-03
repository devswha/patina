# Backlog — outstanding work

> Maintainer/agent note (see `CONTRIBUTING.md` → Public vs Internal Docs). Not a
> product contract. Snapshot as of the 6.1.0 persona-hardening line.

## Released in 6.1.0 (done — for context)

Persona hardening arc shipped: enforcing safety gate (MPS/fidelity/dropped-numbers
enforce; churn + persona-match advisory), live calibration harness, multilingual
`--persona` (ko/en/zh/ja), register precedence (`--tone` > persona > profile),
profile voice/pattern split, custom voice authoring (`patina persona new|list`),
`docs/ARCHITECTURE.md`, `docs/WORKFLOW.md`, README updates.

## Parked on `dev` (not yet in `main`/npm)

Docs-only changes stacked on `dev`, to release with the next feature (patch or
folded into the next minor):
- README English slimmed: removed internal ko `translationese`/`koPostEditese`
  caveat, `--preview` demo, per-backend model list, verbose persona bullets.
- README KR/JA/ZH resynced to the slimmed English structure (playground-led Demo,
  `--preview` demo removed, version badge `5.4.0` → `6.1.0`); localized doc links
  kept for KR. The earlier "all 4 langs slimmed" note was inaccurate — only English
  had been restructured; the three translations are now caught up.
- Agent-driven install snippet (paste a prompt → agent follows `INSTALLATION.md`)
  in all 4 READMEs.
- `INSTALLATION.md` version refs fixed (3.11.0 → 6.1.0) + invalid `--tone narrative`
  example corrected.

## Not started

### Personas
1. ~~**Seed personas for en/zh/ja**~~ — DONE (v6.2.0 line). Shipped `natural-en`,
   `blog-essay`, `technical-explainer` (en) and `natural-{zh,ja}` + `blog-essay`
   (zh/ja) under `personas/{en,zh,ja}/`, with **language-neutral** `target_features`
   only (regression-fenced in `tests/unit/persona-seed.test.js` against `ko_register_*`
   and `suffix_class_diversity`). Follow-up if wanted: calibrate targets on real
   per-language corpora (current values are seed defaults with wide advisory tolerances).
2. **Retire profile's voice body** — custom personas now capture genre voice, so profile
   can shrink to a **pattern-policy-only** axis. Do after en/zh/ja seeds exist as the
   voice alternative. (persona schema still forbids pattern control — that half stays.)
3. **`persona edit|rm|show` subcommands** — only `new`/`list` exist; edit/remove is manual
   file editing today.

### Architecture seams still open (docs/ARCHITECTURE.md → Remaining)
4. **`ouroboros.js` does not consume `persona-match`** — iterative rewrite ignores persona
   drift (ouroboros is off the default CLI path; `--verify` replaced it).
5. **No deterministic MPS/fidelity proxy** — without `--verify` (or a backend-reported
   score), Lane B meaning floors are not enforced by code; `persona-match` + dropped-numbers
   are the only always-on Method-D anchors.
6. **Persona thresholds `source: placeholder`** — churn/persona-match advisory values are
   observation-informed, not a formal 2-round promotion. Only revisit if churn is ever
   re-promoted to enforcing (unlikely — it's a surface metric, not meaning).

### Release / process
7. **Next release via `dev → main` PR** (CI 6 required checks), NOT the direct-push bypass
   used for 6.1.0. Version bump across the surfaces `release:check` gates + merge (not squash).
8. Watch `dev` drift — keep it at/ahead of `main`; if a hotfix lands on `main`, merge
   `main → dev` immediately (see `docs/WORKFLOW.md`).

### Repo / branding (optional, owner decision)
9. **Org transfer** — moving `devswha/patina` to a GitHub org would drop the personal-account
   `owner` slug from search results. The `: description` part is already handled (short About
   description set 2026-07). Not doing this now.
10. **Google re-index** — the shortened GitHub About description ("AI-writing humanizer for
    KO/EN/ZH/JA") will surface in search after re-crawl; request re-index via Search Console
    if faster propagation is wanted.

## Process notes (for future sessions)
- npm auth: `~/.npmrc` had an expired literal token; fixed to `_authToken=${NPM_TOKEN}`
  (backup `~/.npmrc.bak-6.1.0`). The env `NPM_TOKEN` is the valid one.
- Calibration corpus (`artifacts/persona-calibration-2026/synthetic-ko.jsonl`) is a **local,
  gitignored** asset fed via `--corpus` at runtime — never commit generated KO text.
- `AGENTS.md` is **gitignored** in this repo (local-only); shared agent/workflow rules live in
  tracked `CONTRIBUTING.md` + `docs/WORKFLOW.md`.
