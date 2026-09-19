# 한국어 어투 평탄화 candidate fixture (#882)

`flattening-50.jsonl` is the 50-pair evaluation manifest for the Korean
flattening overcorrection signal named in #882 ("한국어 어투를 한 형태로 과도하게
평탄화하면서 직역만 남김"). Each row is a `(original, rewrite)` pair — the
guard compares source to output, the same pair shape as
`tests/fixtures/number-swap-calibration/`.

- **25 hot** pairs: a source that genuinely mixed speech levels
  (합니다체/한다체/해요체/명사형/의문/해체) flattened into a single ending
  class. Collapse directions: 합니다체 11, 평서형 9, 해요체 5. Registers:
  블로그 9, 업무 문서 8, SNS 8.
- **25 cold** controls in five deliberate groups:
  - **10 faithful** rewrites that compress and edit but keep ≥2 ending
    classes below 0.90 dominance.
  - **4 uniform-source** negatives — an already-uniform source (single class,
    or 2 classes above 0.80 dominance) has nothing to defend, so the guard
    stays silent even when the rewrite is fully collapsed (the same
    min-source logic as the dash-wipe signal).
  - **4 short** sources with fewer than 5 classifiable sentences — too small
    a sample to judge.
  - **5 register-requested** rows (`registerRequested: true`) — the user
    explicitly asked for register unification, so the collapse is the
    request, not overcorrection. The implementation must veto on config.
  - **2 boundary** rows at dominance 0.875 (7/8 unified, one surviving
    ending) — probe documents that keep v2 honest below 0.90.

## Provenance and licensing

Every pair is **synthetic**, authored for this repository as part of #882.
No scraped Korean text, no private drafts, no real personal data, so the
manifest is redistributable with the repo.

## Scoring

```bash
node scripts/ko-overcorrection-flattening-candidate-eval.mjs        # report
node scripts/ko-overcorrection-flattening-candidate-eval.mjs --json # numbers
```

Recorded conclusion (2026-09-19): v1 strict-collapse fires at precision
1.00 / recall 1.00 with zero cold fires; the calque-coupled v3 drops to
recall 0.28 — see `docs/research/2026-ko-overcorrection-flattening.md`.
Measurement only; nothing here is wired into the product.
