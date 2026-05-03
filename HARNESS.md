# Harness

Multi-language AI writing pattern detector + humanizer (Claude Code skill).

## Stack

- **Main**: `omc` (oh-my-claudecode) + `ouroboros`
- **Side**: —
- **Final pass**: N/A (this project IS the humanizer)

## Why

- Project itself is a Claude Code skill — same-ecosystem dogfooding
- Claude is strongest at multi-language prose (KO/EN/ZH/JA), especially Korean naturalness
- `ouroboros` interview/seed prevents pattern-list regression when adding new patterns

## Lane

- Use `omc + ouroboros` for: new pattern definitions, language additions, MAX-mode logic, anchor-verification scoring
- Run `ouroboros interview` before any change that touches `patterns.json` or scoring logic

## Do NOT

- Do not switch primary harness to `omx`/`omo` — Korean tone regresses
- Do not skip ouroboros seed for pattern changes — anchor verification depends on the spec being explicit
